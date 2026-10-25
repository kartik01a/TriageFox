import { randomUUID } from "node:crypto";
import { type CrispHookEvent, parseCrispHook } from "@triagefox/connectors";
import { and, createDb, type Db, eq, schema, withOrg } from "@triagefox/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleCrispHook } from "./ingest";
import { createPipelineQueue, type PipelineQueue } from "./queues";
import { evaluateJobId } from "./schedule";

const url = process.env.DATABASE_URL ?? "";
const db: Db = createDb(url, { max: 3 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
let pq: PipelineQueue;

const orgA = `org_a_${randomUUID()}`;
const orgB = `org_b_${randomUUID()}`;
const siteA = `site-a-${randomUUID()}`;
const siteB = `site-b-${randomUUID()}`;
const QUIET = 60; // seconds
let autoA: string;
let autoA2: string;
let autoB: string;
let connA: string;

async function seed(
  orgId: string,
  websiteId: string,
  opts: { status?: "active" | "revoked"; enabled?: boolean; automations?: number } = {},
) {
  const [conn] = await withOrg(db, orgId, (tx) =>
    tx
      .insert(schema.connections)
      .values({
        orgId,
        provider: "crisp",
        authType: "plugin_install",
        status: opts.status ?? "active",
        metadata: { websiteId },
      })
      .returning(),
  );
  if (!conn) throw new Error("seed failed");
  const ids: string[] = [];
  for (let i = 0; i < (opts.automations ?? 1); i++) {
    const [a] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.automations)
        .values({
          orgId,
          sourceConnectionId: conn.id,
          name: `auto ${i}`,
          enabled: opts.enabled ?? true,
          settings: {
            includeSourceLink: false,
            includeCustomerNames: false,
            minConfidence: 0.7,
            quietWindowSec: QUIET,
            timezone: "UTC",
            language: "en",
          },
        })
        .returning({ id: schema.automations.id }),
    );
    if (a) ids.push(a.id);
  }
  return { connectionId: conn.id, automationIds: ids };
}

const hook = (
  website: string,
  event: string,
  data: Record<string, unknown>,
  ts = Date.now(),
): CrispHookEvent => {
  const e = parseCrispHook(JSON.stringify({ website_id: website, event, data, timestamp: ts }));
  if (!e) throw new Error("bad test hook");
  return e;
};
const visitor = (website: string, session: string, fp: number, ts?: number) =>
  hook(
    website,
    "message:send",
    { from: "user", type: "text", session_id: session, fingerprint: fp },
    ts,
  );

const threadsOf = (org: string, session: string) =>
  withOrg(db, org, (tx) =>
    tx.select().from(schema.threads).where(eq(schema.threads.sourceId, session)),
  );
const eventsOf = (org: string) => withOrg(db, org, (tx) => tx.select().from(schema.sourceEvents));

beforeAll(async () => {
  pq = createPipelineQueue(process.env.REDIS_URL ?? "", `test-pipeline-${randomUUID()}`);
  const a = await seed(orgA, siteA, { automations: 2 });
  connA = a.connectionId;
  [autoA, autoA2] = a.automationIds as [string, string];
  autoB = (await seed(orgB, siteB)).automationIds[0] as string;
});
afterAll(async () => {
  await pq.queue.obliterate({ force: true });
  await owner.$client.unsafe("delete from connections where org_id in ($1,$2)", [orgA, orgB]);
  await pq.close();
  await db.$client.end();
  await owner.$client.end();
});

describe("handling Crisp hooks", () => {
  it("a customer message creates a thread and one delayed evaluation per automation", async () => {
    const session = `session_${randomUUID()}`;
    const r = await handleCrispHook({ db, queue: pq.queue }, visitor(siteA, session, 1));
    expect(r).toEqual({ outcome: "scheduled", threads: 2 });
    const threads = await threadsOf(orgA, session);
    expect(threads.map((t) => t.automationId).sort()).toEqual([autoA, autoA2].sort());
    for (const t of threads) {
      const job = await pq.queue.getJob(evaluateJobId(t.id));
      expect(await job?.getState()).toBe("delayed");
      expect(job?.delay).toBe(QUIET * 1000);
      expect(job?.data).toEqual({ orgId: orgA, threadId: t.id });
    }
  });

  it("the same hook delivered three times is stored and scheduled once", async () => {
    const session = `session_${randomUUID()}`;
    const e = visitor(siteA, session, 7, 1_800_000_000_123);
    const outcomes = [];
    for (let i = 0; i < 3; i++)
      outcomes.push((await handleCrispHook({ db, queue: pq.queue }, e)).outcome);
    expect(outcomes).toEqual(["scheduled", "duplicate", "duplicate"]);
    const rows = (await eventsOf(orgA)).filter((x) => x.dedupeKey === e.dedupeKey);
    expect(rows).toHaveLength(1);
    const jobs = await Promise.all(
      (await threadsOf(orgA, session)).map((t) => pq.queue.getJob(evaluateJobId(t.id))),
    );
    expect(jobs.filter(Boolean)).toHaveLength(2); // one per automation, not one per delivery
  });

  it("five quick messages keep a single pending evaluation and restart its quiet window", async () => {
    const session = `session_${randomUUID()}`;
    for (let fp = 100; fp < 105; fp++)
      await handleCrispHook(
        { db, queue: pq.queue },
        visitor(siteA, session, fp, 1_800_000_001_000 + fp),
      );
    const [t] = await threadsOf(orgA, session);
    const delayed = await pq.queue.getDelayed();
    expect(delayed.filter((j) => j.id === evaluateJobId(t?.id ?? ""))).toHaveLength(1);
    const job = await pq.queue.getJob(evaluateJobId(t?.id ?? ""));
    expect(await job?.getState()).toBe("delayed");
    expect(job?.delay).toBe(QUIET * 1000);
  });

  it("'resolved' runs the evaluation immediately instead of waiting out the quiet window", async () => {
    const session = `session_${randomUUID()}`;
    await handleCrispHook({ db, queue: pq.queue }, visitor(siteA, session, 200));
    const r = await handleCrispHook(
      { db, queue: pq.queue },
      hook(siteA, "session:set_state", { session_id: session, state: "resolved" }),
    );
    expect(r.outcome).toBe("scheduled");
    const [t] = await threadsOf(orgA, session);
    expect(t?.state).toBe("resolved");
    const job = await pq.queue.getJob(evaluateJobId(t?.id ?? ""));
    expect(await job?.getState()).toBe("waiting"); // promoted: a worker would take it now
  });

  it("'reopened' goes back to the normal quiet window and marks the thread open", async () => {
    const session = `session_${randomUUID()}`;
    await handleCrispHook({ db, queue: pq.queue }, visitor(siteA, session, 300));
    await handleCrispHook(
      { db, queue: pq.queue },
      hook(siteA, "session:set_state", { session_id: session, state: "resolved" }),
    );
    await handleCrispHook(
      { db, queue: pq.queue },
      hook(siteA, "session:set_state", { session_id: session, state: "unresolved" }),
    );
    const [t] = await threadsOf(orgA, session);
    expect(t?.state).toBe("open");
  });

  it("operator messages are recorded as context and schedule nothing", async () => {
    const session = `session_${randomUUID()}`;
    const e = hook(siteA, "message:received", {
      from: "operator",
      type: "text",
      session_id: session,
      fingerprint: 400,
    });
    expect(await handleCrispHook({ db, queue: pq.queue }, e)).toEqual({
      outcome: "recorded",
      threads: 0,
    });
    expect(await threadsOf(orgA, session)).toHaveLength(0);
    expect((await eventsOf(orgA)).find((x) => x.dedupeKey === e.dedupeKey)?.status).toBe("ignored");
  });

  it("system events, notes and unrelated hooks are ignored without storing anything", async () => {
    const session = `session_${randomUUID()}`;
    const before = (await eventsOf(orgA)).length;
    for (const e of [
      hook(siteA, "message:received", {
        from: "operator",
        type: "event",
        session_id: session,
        fingerprint: 1,
      }),
      hook(siteA, "message:send", {
        from: "user",
        type: "note",
        session_id: session,
        fingerprint: 2,
      }),
      hook(siteA, "plugin:settings", { session_id: session }),
    ]) {
      expect((await handleCrispHook({ db, queue: pq.queue }, e)).outcome).toBe("ignored");
    }
    expect((await eventsOf(orgA)).length).toBe(before);
    expect(await threadsOf(orgA, session)).toHaveLength(0);
  });

  it("state changes for conversations we do not follow schedule nothing", async () => {
    const session = `session_${randomUUID()}`;
    const r = await handleCrispHook(
      { db, queue: pq.queue },
      hook(siteA, "session:set_state", { session_id: session, state: "resolved" }),
    );
    expect(r).toEqual({ outcome: "recorded", threads: 0 });
    expect(await threadsOf(orgA, session)).toHaveLength(0);
  });

  it("unknown websites, revoked connections and disabled automations are not routed", async () => {
    expect(
      (
        await handleCrispHook(
          { db, queue: pq.queue },
          visitor(`site-unknown-${randomUUID()}`, "s", 1),
        )
      ).outcome,
    ).toBe("no_route");

    const revokedSite = `site-r-${randomUUID()}`;
    await seed(orgA, revokedSite, { status: "revoked" });
    expect(
      (await handleCrispHook({ db, queue: pq.queue }, visitor(revokedSite, "s", 1))).outcome,
    ).toBe("no_route");

    const offSite = `site-off-${randomUUID()}`;
    await seed(orgA, offSite, { enabled: false });
    expect((await handleCrispHook({ db, queue: pq.queue }, visitor(offSite, "s", 1))).outcome).toBe(
      "no_route",
    );
  });

  it("events only ever reach the workspace that owns the website", async () => {
    const session = `session_${randomUUID()}`;
    await handleCrispHook({ db, queue: pq.queue }, visitor(siteB, session, 500));
    expect(await threadsOf(orgA, session)).toHaveLength(0);
    const inB = await threadsOf(orgB, session);
    expect(inB).toHaveLength(1);
    expect(inB[0]?.automationId).toBe(autoB);
    expect(inB[0]?.orgId).toBe(orgB);
    // and A's events never appear in B
    const e = visitor(siteA, `session_${randomUUID()}`, 501);
    await handleCrispHook({ db, queue: pq.queue }, e);
    expect((await eventsOf(orgB)).some((x) => x.dedupeKey === e.dedupeKey)).toBe(false);
  });

  it("if scheduling fails the event is not kept as a duplicate, so Crisp's retry works", async () => {
    const session = `session_${randomUUID()}`;
    const e = visitor(siteA, session, 600, 1_800_000_002_000);
    const broken = {
      getJob: async () => undefined,
      add: async () => {
        throw new Error("redis down");
      },
    } as never;
    await expect(handleCrispHook({ db, queue: broken }, e)).rejects.toThrow("redis down");
    expect((await eventsOf(orgA)).some((x) => x.dedupeKey === e.dedupeKey)).toBe(false);
    expect((await handleCrispHook({ db, queue: pq.queue }, e)).outcome).toBe("scheduled"); // the retry succeeds
  });

  it("stores identifiers only, never message content", async () => {
    const session = `session_${randomUUID()}`;
    const e = hook(siteA, "message:send", {
      from: "user",
      type: "text",
      session_id: session,
      fingerprint: 700,
      content: "my password is hunter2",
    });
    await handleCrispHook({ db, queue: pq.queue }, e);
    const row = (await eventsOf(orgA)).find((x) => x.dedupeKey === e.dedupeKey);
    expect(JSON.stringify(row)).not.toContain("hunter2");
    expect(Object.keys(row?.meta ?? {}).sort()).toEqual([
      "event",
      "fingerprint",
      "from",
      "messageType",
      "sessionId",
      "state",
      "timestamp",
      "websiteId",
    ]);
  });

  it("deleting a connection removes its automations, threads and events", async () => {
    const site = `site-del-${randomUUID()}`;
    const s = await seed(orgA, site);
    const session = `session_${randomUUID()}`;
    await handleCrispHook({ db, queue: pq.queue }, visitor(site, session, 800));
    expect(await threadsOf(orgA, session)).toHaveLength(1);
    await withOrg(db, orgA, (tx) =>
      tx.delete(schema.connections).where(and(eq(schema.connections.id, s.connectionId))),
    );
    expect(await threadsOf(orgA, session)).toHaveLength(0);
  });
});

describe("workspace isolation of pipeline tables", () => {
  it("the runtime role sees nothing without a workspace, and cannot write across workspaces", async () => {
    expect(await db.select().from(schema.threads)).toHaveLength(0);
    expect(await db.select().from(schema.sourceEvents)).toHaveLength(0);
    expect(await db.select().from(schema.automations)).toHaveLength(0);
    await expect(
      withOrg(db, orgA, (tx) =>
        tx.insert(schema.automations).values({ orgId: orgB, sourceConnectionId: connA, name: "x" }),
      ),
    ).rejects.toThrow();
  });
});
