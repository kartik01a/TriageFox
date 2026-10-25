import { randomUUID } from "node:crypto";
import {
  type CrispConversation,
  type CrispConversationRef,
  type CrispMessage,
  ProviderError,
  parseCrispHook,
} from "@triagefox/connectors";
import { createDb, type Db, eq, schema, withOrg } from "@triagefox/db";
import { handleCrispHook, PIPELINE_QUEUE } from "@triagefox/pipeline";
import { Queue, type Worker } from "bullmq";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CrispSource, PipelineDeps, TriageInput } from "./deps";
import { evaluateThread } from "./evaluate";
import { reconcileCrisp } from "./reconcile";
import { startPipelineWorker } from "./worker";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 5 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const queueName = `${PIPELINE_QUEUE}-test-${randomUUID()}`;
const queue = new Queue(queueName, { connection: redis });
const orgId = `org_${randomUUID()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T>(fn: () => Promise<T | false | undefined>, ms = 12_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await fn();
    if (v) return v;
    await sleep(100);
  }
  throw new Error("timed out waiting for condition");
}

// ---- Fake Crisp ---------------------------------------------------------------------------------
class FakeCrisp implements CrispSource {
  conversations = new Map<string, CrispConversation>();
  fetches: string[] = [];
  concurrent = 0;
  maxConcurrent = 0;
  fetchDelayMs = 0;
  failWith: ProviderError | null = null;
  async fetchConversation(websiteId: string, sessionId: string) {
    this.fetches.push(sessionId);
    this.concurrent++;
    this.maxConcurrent = Math.max(this.maxConcurrent, this.concurrent);
    try {
      if (this.fetchDelayMs) await sleep(this.fetchDelayMs);
      if (this.failWith) throw this.failWith;
      const c = this.conversations.get(sessionId);
      if (!c || c.websiteId !== websiteId)
        throw new ProviderError("crisp", "not_found", "no such conversation", 404);
      return structuredClone(c);
    } finally {
      this.concurrent--;
    }
  }
  async listConversations(websiteId: string, page: number): Promise<CrispConversationRef[]> {
    if (page > 1) return [];
    return [...this.conversations.values()]
      .filter((c) => c.websiteId === websiteId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map((c) => ({ sessionId: c.sessionId, updatedAt: c.updatedAt, state: c.state }));
  }
  conversation(
    websiteId: string,
    session: string,
    texts: string[],
    opts: { state?: "open" | "resolved"; updatedAt?: number; operatorOnly?: boolean } = {},
  ) {
    const base = opts.updatedAt ?? Date.now();
    const messages: CrispMessage[] = texts.map((text, i) => ({
      fingerprint: String(1000 + i),
      timestamp: base - (texts.length - i) * 1000,
      role: opts.operatorOnly ? "operator" : "customer",
      kind: "text",
      text,
    }));
    this.conversations.set(session, {
      sessionId: session,
      websiteId,
      state: opts.state ?? "open",
      updatedAt: base,
      customer: {},
      messages,
    });
  }
  addMessage(session: string, text: string) {
    const c = this.conversations.get(session);
    if (!c) throw new Error("no conversation");
    const last = c.messages.at(-1);
    c.messages.push({
      fingerprint: String(Number(last?.fingerprint ?? 999) + 1),
      timestamp: Date.now(),
      role: "customer",
      kind: "text",
      text,
    });
    c.updatedAt = Date.now();
  }
}

const crisp = new FakeCrisp();
const triaged: TriageInput[] = [];
let onTriage: ((i: TriageInput) => Promise<void>) | null = null;
const deps: PipelineDeps = {
  db,
  redis,
  queue,
  crisp: () => crisp,
  log: { info() {}, warn() {}, error() {} },
  triage: async (i) => {
    triaged.push(i);
    await onTriage?.(i);
  },
};
let worker: Worker;

async function seed(
  opts: { quietSec?: number; status?: "active" | "revoked"; enabled?: boolean } = {},
) {
  const websiteId = `site-${randomUUID()}`;
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
  const [auto] = await withOrg(db, orgId, (tx) =>
    tx
      .insert(schema.automations)
      .values({
        orgId,
        sourceConnectionId: conn?.id ?? "",
        name: "test",
        enabled: opts.enabled ?? true,
        settings: {
          includeSourceLink: false,
          includeCustomerNames: false,
          minConfidence: 0.7,
          quietWindowSec: opts.quietSec ?? 1,
          timezone: "UTC",
          language: "en",
        },
      })
      .returning(),
  );
  return { websiteId, connectionId: conn?.id ?? "", automationId: auto?.id ?? "" };
}

const hookFor = (site: string, event: string, data: Record<string, unknown>) =>
  parseCrispHook(
    JSON.stringify({
      website_id: site,
      event,
      data,
      timestamp: Date.now() + Math.floor(Math.random() * 1e6),
    }),
  );
const customerHook = (site: string, session: string, fp: number) => {
  const e = hookFor(site, "message:send", {
    from: "user",
    type: "text",
    session_id: session,
    fingerprint: fp,
  });
  if (!e) throw new Error("bad hook");
  return handleCrispHook({ db, queue }, e);
};
const resolvedHook = (site: string, session: string) => {
  const e = hookFor(site, "session:set_state", { session_id: session, state: "resolved" });
  if (!e) throw new Error("bad hook");
  return handleCrispHook({ db, queue }, e);
};
const threadOf = async (session: string) =>
  (
    await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.threads).where(eq(schema.threads.sourceId, session)),
    )
  )[0];
const triagedFor = (session: string) => triaged.filter((t) => t.thread.sourceId === session);
const newSession = () => `session_${randomUUID()}`;

beforeAll(() => {
  worker = startPipelineWorker(deps, { queueName, concurrency: 5, lookbackMs: 60 * 60 * 1000 });
});
afterAll(async () => {
  await worker.close();
  await queue.obliterate({ force: true });
  await owner.$client.unsafe("delete from connections where org_id = $1", [orgId]);
  await queue.close();
  await db.$client.end();
  await owner.$client.end();
  redis.disconnect();
});

describe("evaluating conversations", () => {
  it("fetches the conversation, analyses it once, and stores progress but never the conversation", async () => {
    const { websiteId } = await seed();
    const session = newSession();
    crisp.conversation(websiteId, session, [
      "Checkout button does nothing",
      "my card ending 4242 failed",
    ]);
    await customerHook(websiteId, session, 1);

    const t = await waitFor(async () => {
      const x = await threadOf(session);
      return x && x.evaluationCount === 1 ? x : false;
    });
    expect(triagedFor(session)).toHaveLength(1);
    expect(triagedFor(session)[0]?.conversation.messages).toHaveLength(2); // the AI step gets the full text...
    expect(t.lastProcessedMessageId).toBe("1001");
    expect(t.lastEvaluatedState).toBe("open");
    expect(t.sourceUpdatedAt).not.toBeNull();
    // ...but nothing of it is persisted anywhere we keep records.
    const stored = JSON.stringify([
      await owner.$client`select * from threads where source_id = ${session}`,
      await owner.$client`select * from source_events where meta->>'sessionId' = ${session}`,
    ]);
    expect(stored).not.toContain("Checkout button");
    expect(stored).not.toContain("4242");
  });

  it("five messages in quick succession produce one evaluation", async () => {
    const { websiteId } = await seed({ quietSec: 2 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["a"]);
    for (let i = 0; i < 5; i++) {
      crisp.addMessage(session, `m${i}`);
      await customerHook(websiteId, session, 10 + i);
      await sleep(200);
    }
    await waitFor(async () => (await threadOf(session))?.evaluationCount === 1);
    await sleep(2500); // long enough for any (wrong) second run to show up
    expect(triagedFor(session)).toHaveLength(1);
    expect(triagedFor(session)[0]?.conversation.messages).toHaveLength(6); // it saw all of them
    expect((await threadOf(session))?.evaluationCount).toBe(1);
  });

  it("the same hook three times produces one evaluation", async () => {
    const { websiteId } = await seed();
    const session = newSession();
    crisp.conversation(websiteId, session, ["hello"]);
    const e = hookFor(websiteId, "message:send", {
      from: "user",
      type: "text",
      session_id: session,
      fingerprint: 77,
    });
    if (!e) throw new Error("bad hook");
    for (let i = 0; i < 3; i++) await handleCrispHook({ db, queue }, e);
    await waitFor(async () => (await threadOf(session))?.evaluationCount === 1);
    await sleep(2000);
    expect(triagedFor(session)).toHaveLength(1);
    expect(crisp.fetches.filter((s) => s === session)).toHaveLength(1);
  });

  it("'resolved' is evaluated immediately, without waiting for the quiet window", async () => {
    const { websiteId } = await seed({ quietSec: 30 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["it works now, thanks"], { state: "resolved" });
    await customerHook(websiteId, session, 5);
    const started = Date.now();
    await resolvedHook(websiteId, session);
    const t = await waitFor(async () => {
      const x = await threadOf(session);
      return x && x.evaluationCount === 1 ? x : false;
    }, 8000);
    expect(Date.now() - started).toBeLessThan(6000); // far below the 30 s window
    expect(t.lastEvaluatedState).toBe("resolved");
  });

  it("a conversation we already processed is not analysed again, a new message is", async () => {
    const { websiteId } = await seed();
    const session = newSession();
    crisp.conversation(websiteId, session, ["first"]);
    await customerHook(websiteId, session, 1);
    const thread = await waitFor(async () => {
      const x = await threadOf(session);
      return x && x.evaluationCount === 1 ? x : false;
    });
    // Re-running changes nothing...
    const again = await evaluateThread(deps, { orgId, threadId: thread.id });
    expect(again.status).toBe("unchanged");
    expect(triagedFor(session)).toHaveLength(1);
    // ...until the customer writes again.
    crisp.addMessage(session, "second");
    await customerHook(websiteId, session, 2);
    await waitFor(async () => (await threadOf(session))?.evaluationCount === 2);
    expect(triagedFor(session)).toHaveLength(2);
  });

  it("two runs for the same conversation never overlap", async () => {
    const { websiteId } = await seed({ quietSec: 60 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["hi"]);
    await customerHook(websiteId, session, 1);
    const thread = await threadOf(session);
    crisp.maxConcurrent = 0;
    crisp.fetchDelayMs = 300;
    try {
      const results = await Promise.all([
        evaluateThread(deps, { orgId, threadId: thread?.id ?? "" }),
        evaluateThread(deps, { orgId, threadId: thread?.id ?? "" }),
        evaluateThread(deps, { orgId, threadId: thread?.id ?? "" }),
      ]);
      expect(crisp.maxConcurrent).toBe(1);
      expect(results.filter((r) => r.status === "evaluated")).toHaveLength(1);
      expect(results.filter((r) => r.status === "unchanged")).toHaveLength(2);
    } finally {
      crisp.fetchDelayMs = 0;
    }
  });

  it("activity that arrives while a conversation is being analysed is not lost", async () => {
    const { websiteId } = await seed({ quietSec: 1 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["first message"]);
    let injected = false;
    onTriage = async (i) => {
      if (i.thread.sourceId !== session || injected) return;
      injected = true;
      await sleep(50);
      crisp.addMessage(session, "message during analysis"); // the customer writes mid-run
      await customerHook(websiteId, session, 99);
    };
    try {
      await customerHook(websiteId, session, 1);
      await waitFor(async () => (await threadOf(session))?.evaluationCount === 2, 20_000);
      expect(triagedFor(session)).toHaveLength(2);
      expect(triagedFor(session)[1]?.conversation.messages.map((m) => m.text)).toContain(
        "message during analysis",
      );
    } finally {
      onTriage = null;
    }
  });

  it("skips conversations with no customer message, and inactive connections or automations", async () => {
    const a = await seed();
    const s1 = newSession();
    crisp.conversation(a.websiteId, s1, ["operator started this"], { operatorOnly: true });
    await customerHook(a.websiteId, s1, 1);
    const t1 = await waitFor(async () => {
      const x = await threadOf(s1);
      return x?.lastProcessedMessageId ? x : false;
    });
    expect(triagedFor(s1)).toHaveLength(0);
    expect(t1.evaluationCount).toBe(0);

    const b = await seed({ quietSec: 60 });
    const s2 = newSession();
    crisp.conversation(b.websiteId, s2, ["hi"]);
    await customerHook(b.websiteId, s2, 1);
    const t2 = await threadOf(s2);
    await withOrg(db, orgId, (tx) =>
      tx
        .update(schema.connections)
        .set({ status: "revoked" })
        .where(eq(schema.connections.id, b.connectionId)),
    );
    expect((await evaluateThread(deps, { orgId, threadId: t2?.id ?? "" })).status).toBe("inactive");
    await withOrg(db, orgId, (tx) =>
      tx
        .update(schema.connections)
        .set({ status: "active" })
        .where(eq(schema.connections.id, b.connectionId)),
    );
    await withOrg(db, orgId, (tx) =>
      tx
        .update(schema.automations)
        .set({ enabled: false })
        .where(eq(schema.automations.id, b.automationId)),
    );
    expect((await evaluateThread(deps, { orgId, threadId: t2?.id ?? "" })).status).toBe("inactive");
    expect(triagedFor(s2)).toHaveLength(0);
  });
});

describe("failures", () => {
  it("a conversation that no longer exists is recorded, not retried forever", async () => {
    const { websiteId } = await seed({ quietSec: 60 });
    const session = newSession();
    await customerHook(websiteId, session, 1); // Crisp has no such conversation
    const thread = await threadOf(session);
    const r = await evaluateThread(deps, { orgId, threadId: thread?.id ?? "" });
    expect(r.status).toBe("gone");
    expect((await threadOf(session))?.lastError).toContain("no longer exists");
  });

  it("when Crisp stops allowing access the connection is marked revoked and the job is not retried", async () => {
    const { websiteId, connectionId } = await seed({ quietSec: 60 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["hi"]);
    await customerHook(websiteId, session, 1);
    const thread = await threadOf(session);
    crisp.failWith = new ProviderError("crisp", "auth", "forbidden", 403);
    try {
      await expect(
        evaluateThread(deps, { orgId, threadId: thread?.id ?? "" }),
      ).rejects.toMatchObject({ name: "UnrecoverableError" });
    } finally {
      crisp.failWith = null;
    }
    const [c] = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, connectionId)),
    );
    expect(c?.status).toBe("revoked");
    expect(c?.statusDetail).toContain("Reinstall");
  });

  it("outages are retried (the error propagates to BullMQ's backoff)", async () => {
    const { websiteId } = await seed({ quietSec: 60 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["hi"]);
    await customerHook(websiteId, session, 1);
    const thread = await threadOf(session);
    crisp.failWith = new ProviderError("crisp", "unavailable", "down", 503);
    try {
      await expect(
        evaluateThread(deps, { orgId, threadId: thread?.id ?? "" }),
      ).rejects.toMatchObject({ name: "ProviderError" });
    } finally {
      crisp.failWith = null;
    }
  });
});

describe("reconcile (recovering dropped hooks)", () => {
  it("finds a conversation whose hook never arrived, evaluates it once, and then leaves it alone", async () => {
    const { websiteId } = await seed({ quietSec: 1 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["reported a bug but the hook was lost"]); // no hook is ever sent

    const first = await reconcileCrisp(deps, { lookbackMs: 60 * 60 * 1000 });
    expect(first.scheduled).toBeGreaterThanOrEqual(1);
    await waitFor(async () => (await threadOf(session))?.evaluationCount === 1);

    const second = await reconcileCrisp(deps, { lookbackMs: 60 * 60 * 1000 });
    await sleep(2500);
    expect(triagedFor(session)).toHaveLength(1);
    expect((await threadOf(session))?.evaluationCount).toBe(1);
    expect(second.scheduled).toBe(0); // nothing new anywhere
  });

  it("picks up new messages on a conversation it already followed", async () => {
    const { websiteId } = await seed({ quietSec: 1 });
    const session = newSession();
    crisp.conversation(websiteId, session, ["hi"]);
    await customerHook(websiteId, session, 1);
    await waitFor(async () => (await threadOf(session))?.evaluationCount === 1);
    await sleep(20);
    crisp.addMessage(session, "one more thing"); // hook dropped
    await reconcileCrisp(deps, { lookbackMs: 60 * 60 * 1000 });
    await waitFor(async () => (await threadOf(session))?.evaluationCount === 2);
  });

  it("ignores conversations older than the look-back window and does not postpone pending ones", async () => {
    const { websiteId } = await seed({ quietSec: 60 });
    const old = newSession();
    crisp.conversation(websiteId, old, ["ancient"], { updatedAt: Date.now() - 5 * 60 * 60 * 1000 });
    const pending = newSession();
    crisp.conversation(websiteId, pending, ["waiting"]);
    await customerHook(websiteId, pending, 1); // delayed 60 s
    await reconcileCrisp(deps, { lookbackMs: 60 * 60 * 1000 });
    expect(await threadOf(old)).toBeUndefined();
    const job = await queue.getJob(`evaluate_${(await threadOf(pending))?.id}`);
    expect(await job?.getState()).toBe("delayed");
    expect(job?.delay).toBe(60_000);
  });

  it("an authorisation failure revokes that website's connection without stopping the others", async () => {
    const bad = await seed({ quietSec: 60 });
    const failing: CrispSource = {
      fetchConversation: crisp.fetchConversation.bind(crisp),
      listConversations: async (w, page) => {
        if (w === bad.websiteId) throw new ProviderError("crisp", "auth", "forbidden", 403);
        return crisp.listConversations(w, page);
      },
    };
    const summary = await reconcileCrisp(
      { ...deps, crisp: () => failing },
      { lookbackMs: 60 * 60 * 1000 },
    );
    expect(summary.failedWebsites).toBeGreaterThanOrEqual(1);
    const [c] = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, bad.connectionId)),
    );
    expect(c?.status).toBe("revoked");
  });
});

describe("cleanup", () => {
  it("deletes hook records past retention and keeps recent ones", async () => {
    const { connectionId } = await seed({ quietSec: 60 });
    await owner.$client.unsafe(
      "insert into source_events (org_id, connection_id, dedupe_key, topic, received_at) values ($1,$2,$3,'x', now() - interval '40 days'), ($1,$2,$4,'x', now())",
      [orgId, connectionId, `old-${randomUUID()}`, `new-${randomUUID()}`],
    );
    const { purgeOldSourceEvents } = await import("@triagefox/pipeline");
    expect(await purgeOldSourceEvents(db, 30)).toBeGreaterThanOrEqual(1);
    const left =
      await owner.$client`select dedupe_key from source_events where connection_id = ${connectionId}`;
    expect(left.map((r) => r.dedupe_key).every((k: string) => k.startsWith("new-"))).toBe(true);
    expect(left).toHaveLength(1);
  });
});
