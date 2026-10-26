import { randomUUID } from "node:crypto";
import { AiError, type AiProvider, type ModelAction } from "@triagefox/ai";
import type { CrispConversation } from "@triagefox/connectors";
import { generateKeyPair, openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { createDb, type Db, eq, schema, sql, withOrg } from "@triagefox/db";
import { UnrecoverableError } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TriageInput } from "./deps";
import { createTriage, toAiMessages } from "./triage";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 5 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const orgId = `org_${randomUUID()}`;
const otherOrg = `org_${randomUUID()}`;
const capOrg = `org_${randomUUID()}`;
let keyring: PrivateKeyring;

const config = {
  AI_MODEL_DEFAULT: "gpt-6-luna",
  AI_MODEL_ESCALATION: "gpt-6.1-sol",
  AI_MODEL_EMBEDDING: "e",
  OPENAI_API_KEY: "sk-platform-key" as string | undefined,
  AI_MAX_RUNS_PER_THREAD_PER_MONTH: 2,
  AI_PLATFORM_DAILY_USD_PER_ORG: 1,
};
const log = { info() {}, warn() {}, error() {} };

const create: ModelAction = {
  kind: "create",
  issueId: null,
  type: "bug",
  title: "Checkout fails on Safari",
  summary: "Cannot pay.",
  stepsToReproduce: ["Open checkout", "Click Pay"],
  expected: "Form opens",
  actual: "Nothing",
  environment: { browser: "Safari", os: null, device: null, pageUrl: null },
  priority: 4,
  priorityReason: "Core flow broken.",
  dueDateQuote: null,
  relevantAttachmentIds: [],
  confidence: 0.9,
  reason: "Checkout failing",
  category: null,
  resolvedInChat: false,
};

function fakeProvider(actions: ModelAction[] | AiError) {
  const keys: string[] = [];
  const make = (key: string): AiProvider => {
    keys.push(key);
    return {
      async complete() {
        if (actions instanceof AiError) throw actions;
        return {
          json: { actions },
          usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 200, reasoningTokens: 0 },
          finishReason: "stop",
        };
      },
    };
  };
  return { make, keys };
}

const conversation: CrispConversation = {
  sessionId: "s1",
  websiteId: "w1",
  state: "open",
  updatedAt: Date.now(),
  customer: {},
  messages: [
    {
      fingerprint: "1",
      timestamp: Date.now() - 5000,
      role: "customer",
      kind: "text",
      text: "Checkout button does nothing on Safari",
    },
  ],
};

async function seedThread(org = orgId) {
  const [conn] = await withOrg(db, org, (tx) =>
    tx
      .insert(schema.connections)
      .values({
        orgId: org,
        provider: "crisp",
        authType: "plugin_install",
        status: "active",
        metadata: { websiteId: randomUUID() },
      })
      .returning(),
  );
  const [automation] = await withOrg(db, org, (tx) =>
    tx
      .insert(schema.automations)
      .values({ orgId: org, sourceConnectionId: conn?.id ?? "", name: "t", enabled: true })
      .returning(),
  );
  const [thread] = await withOrg(db, org, (tx) =>
    tx
      .insert(schema.threads)
      .values({ orgId: org, automationId: automation?.id ?? "", sourceId: randomUUID() })
      .returning(),
  );
  if (!automation || !thread) throw new Error("seed failed");
  return { automation, thread };
}

const input = async (org = orgId, conv = conversation): Promise<TriageInput> => ({
  orgId: org,
  conversation: conv,
  ...(await seedThread(org)),
});

beforeAll(async () => {
  const kp = await generateKeyPair();
  keyring = {
    currentVersion: 1,
    publicKeys: { 1: kp.publicKey },
    privateKeys: { 1: kp.privateKey },
  };
});
afterAll(async () => {
  for (const o of [orgId, otherOrg, capOrg])
    await owner.$client.unsafe("delete from connections where org_id = $1", [o]);
  await owner.$client.unsafe("delete from ai_settings where org_id = $1", [orgId]);
  await db.$client.end();
  await owner.$client.end();
});

describe("worker AI step", () => {
  it("saves the run, seals the model output and logs plain-language activity", async () => {
    const f = fakeProvider([create]);
    const i = await input();
    await createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async () => {},
      db,
      config,
      keyring,
      log,
      providerFor: f.make,
    })(i);

    const [run] = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.aiRuns).where(eq(schema.aiRuns.threadId, i.thread.id)),
    );
    expect(run?.keySource).toBe("platform");
    expect(run?.model).toBe("gpt-6-luna");
    expect(run?.costMicroUsd).toBeGreaterThan(0);
    // Plain columns carry no AI-written text; the sealed output does, and only the worker can open it.
    expect(JSON.stringify(run?.decision)).not.toContain("Safari");
    expect(run?.rawOutputSealed).not.toContain("Safari");
    const opened = await openSecret(
      run?.rawOutputSealed ?? "",
      { orgId, recordId: run?.id ?? "", purpose: "ai_run.output" },
      keyring,
    );
    expect(opened).toContain("Checkout fails on Safari");

    const rows = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, i.thread.id)),
    );
    expect(rows.map((r) => r.kind)).toEqual(["ai_create", "no_destination"]);
    expect(rows[0]?.message).not.toContain("Safari");
  });

  it("uses the workspace's own key when it has one, and the platform key otherwise", async () => {
    await withOrg(db, otherOrg, (tx) =>
      tx.insert(schema.aiSettings).values({
        orgId: otherOrg,
        keySealed: undefined,
      }),
    );
    const sealed = await sealSecret(
      "sk-own-key",
      { orgId: otherOrg, recordId: otherOrg, purpose: "ai.key" },
      keyring,
    );
    await withOrg(db, otherOrg, (tx) =>
      tx
        .update(schema.aiSettings)
        .set({ keySealed: sealed })
        .where(eq(schema.aiSettings.orgId, otherOrg)),
    );
    const f = fakeProvider([create]);
    const i = await input(otherOrg);
    await createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async () => {},
      db,
      config,
      keyring,
      log,
      providerFor: f.make,
    })(i);
    expect(f.keys).toEqual(["sk-own-key"]);
    const [run] = await withOrg(db, otherOrg, (tx) =>
      tx.select().from(schema.aiRuns).where(eq(schema.aiRuns.threadId, i.thread.id)),
    );
    expect(run?.keySource).toBe("byok");
    await owner.$client.unsafe("delete from ai_settings where org_id = $1", [otherOrg]);
  });

  it("does not leak one workspace's runs into another", async () => {
    const rows = await withOrg(db, otherOrg, (tx) => tx.select().from(schema.aiRuns));
    expect(rows.every((r) => r.orgId === otherOrg)).toBe(true);
  });

  it("stops after the monthly per-conversation limit", async () => {
    const f = fakeProvider([create]);
    const i = await input();
    const run = createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async () => {},
      db,
      config,
      keyring,
      log,
      providerFor: f.make,
    });
    await run(i);
    await run(i);
    await run(i); // third is over the limit of 2
    expect(f.keys).toHaveLength(2);
    const rows = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, i.thread.id)),
    );
    expect(rows.map((r) => r.kind)).toContain("ai_limit");
  });

  it("with no key at all it records why and stops retrying", async () => {
    const f = fakeProvider([create]);
    const i = await input();
    await expect(
      createTriage({
        enqueueUpdate: async () => {},
        enqueueDelivery: async () => {},
        db,
        config: { ...config, OPENAI_API_KEY: undefined },
        keyring,
        log,
        providerFor: f.make,
      })(i),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(f.keys).toHaveLength(0);
  });

  it("pauses when the platform spend ceiling for the day is reached", async () => {
    const f = fakeProvider([create]);
    const i = await input(capOrg);
    await withOrg(db, capOrg, (tx) =>
      tx.insert(schema.aiRuns).values({
        orgId: capOrg,
        threadId: i.thread.id,
        model: "m",
        keySource: "platform",
        costMicroUsd: 2_000_000,
      }),
    );
    await expect(
      createTriage({
        enqueueUpdate: async () => {},
        enqueueDelivery: async () => {},
        db,
        config,
        keyring,
        log,
        providerFor: f.make,
      })(i),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    expect(f.keys).toHaveLength(0);
  });

  it("a rejected own key pauses analysis with a clear message; outages are retried", async () => {
    const i = await input();
    await expect(
      createTriage({
        enqueueUpdate: async () => {},
        enqueueDelivery: async () => {},
        db,
        config,
        keyring,
        log,
        providerFor: fakeProvider(new AiError("no_quota", "x")).make,
      })(i),
    ).rejects.toBeInstanceOf(UnrecoverableError);
    const rows = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, i.thread.id)),
    );
    expect(rows.map((r) => r.kind)).toContain("ai_key_problem");

    const j = await input();
    const err = await createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async () => {},
      db,
      config,
      keyring,
      log,
      providerFor: fakeProvider(new AiError("unavailable", "down")).make,
    })(j).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).not.toBeInstanceOf(UnrecoverableError);
  });

  it("an empty answer still leaves an activity entry", async () => {
    const i = await input();
    await createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async () => {},
      db,
      config,
      keyring,
      log,
      providerFor: fakeProvider([]).make,
    })(i);
    const rows = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, i.thread.id)),
    );
    expect(rows.map((r) => r.kind)).toEqual(["ai_no_action"]);
  });
});

describe("creating issues from the AI's answer", () => {
  async function withDestination(i: TriageInput) {
    const [conn] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.connections)
        .values({ orgId, provider: "trello", authType: "token", status: "active", metadata: {} })
        .returning(),
    );
    const [dest] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.automationDestinations)
        .values({
          orgId,
          automationId: i.automation.id,
          connectionId: conn?.id ?? "",
          config: { kind: "trello", boardId: "B", listId: "L" },
        })
        .returning(),
    );
    return dest?.id ?? "";
  }
  const issuesOf = (threadId: string) =>
    withOrg(db, orgId, (tx) =>
      tx.select().from(schema.issues).where(eq(schema.issues.originThreadId, threadId)),
    );
  const run = (queued: unknown[], answer: Parameters<typeof fakeProvider>[0]) =>
    createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async (p) => void queued.push(p),
      db,
      config,
      keyring,
      log,
      providerFor: fakeProvider(answer).make,
    });

  it("saves the issue with a finished body and queues one delivery per destination", async () => {
    const queued: unknown[] = [];
    const i = await input();
    const dest = await withDestination(i);
    await run(queued, [create])(i);
    const [issue] = await issuesOf(i.thread.id);
    expect(issue).toMatchObject({ type: "bug", priority: 4, status: "active", reportCount: 1 });
    expect(issue?.bodyMd).toContain("## Steps to reproduce");
    expect(issue?.bodyMd).toContain("Reported by 1 customer");
    expect(issue?.bodyMd).not.toContain("Source:"); // off by default
    expect(queued).toEqual([{ orgId, issueId: issue?.id, destinationId: dest }]);
  });

  it("keeps low-confidence tickets for review and does not send them", async () => {
    const queued: unknown[] = [];
    const i = await input();
    await withDestination(i);
    await run(queued, [{ ...create, confidence: 0.4 }])(i);
    const [issue] = await issuesOf(i.thread.id);
    expect(issue?.status).toBe("pending_review");
    expect(queued).toHaveLength(0);
  });

  it("says so when there is nowhere to send the ticket", async () => {
    const queued: unknown[] = [];
    const i = await input();
    await run(queued, [create])(i);
    expect(queued).toHaveLength(0);
    const rows = await withOrg(db, orgId, (tx) =>
      tx.select().from(schema.activityLog).where(eq(schema.activityLog.threadId, i.thread.id)),
    );
    expect(rows.map((r) => r.kind)).toContain("no_destination");
  });

  it("shows the AI the tickets already made from this conversation", async () => {
    const i = await input();
    await run([], [create])(i);
    const seen: string[] = [];
    await createTriage({
      enqueueUpdate: async () => {},
      enqueueDelivery: async () => {},
      db,
      config,
      keyring,
      log,
      providerFor: () => ({
        async complete(req) {
          seen.push(req.text);
          return {
            json: { actions: [] },
            usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5, reasoningTokens: 0 },
            finishReason: "stop",
          };
        },
      }),
    })(i);
    expect(seen[0]).toContain("Checkout fails on Safari");
  });
});

describe("follow-ups and duplicates", () => {
  const unit = [1, ...new Array(1535).fill(0)];
  const embedFake = async (_m: string, texts: string[]) => texts.map(() => unit);
  const vectorSql = `[${unit.join(",")}]`;

  const providerWith =
    (actions: ModelAction[], seen: string[] = []): ((key: string) => AiProvider) =>
    () => ({
      async complete(req) {
        seen.push(req.text);
        return {
          json: { actions },
          usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 },
          finishReason: "stop",
        };
      },
      embed: embedFake,
    });

  const triageWith = (
    queued: { updates: unknown[]; deliveries: unknown[] },
    actions: ModelAction[],
    seen: string[] = [],
  ) =>
    createTriage({
      enqueueDelivery: async (p) => void queued.deliveries.push(p),
      enqueueUpdate: async (p) => void queued.updates.push(p),
      db,
      config,
      keyring,
      log,
      providerFor: providerWith(actions, seen),
    });

  /** An issue that already exists for `i`'s conversation, with one destination. */
  async function existingIssue(
    i: TriageInput,
    over: Partial<typeof schema.issues.$inferInsert> = {},
    thread = i.thread.id,
  ) {
    const [issue] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.issues)
        .values({
          orgId,
          automationId: i.automation.id,
          originThreadId: thread,
          title: "Checkout fails on Safari",
          summary: "Cannot pay.",
          bodyMd:
            "## Summary\nCannot pay.\n\n---\nType: Bug · Priority: 3 (Medium) — x\nReported by 1 customer\nCreated by TriageFox",
          type: "bug",
          priority: 3,
          confidence: 0.9,
          ...over,
        })
        .returning(),
    );
    await withOrg(db, orgId, (tx) =>
      tx.insert(schema.issueReports).values({
        orgId,
        issueId: issue?.id ?? "",
        threadId: thread,
        customerRef: "Ann",
      }),
    );
    return issue;
  }
  const destinationFor = async (i: TriageInput) => {
    const [conn] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.connections)
        .values({ orgId, provider: "trello", authType: "token", status: "active", metadata: {} })
        .returning(),
    );
    const [dest] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.automationDestinations)
        .values({
          orgId,
          automationId: i.automation.id,
          connectionId: conn?.id ?? "",
          config: { kind: "trello", boardId: "B", listId: "L" },
        })
        .returning(),
    );
    return dest?.id ?? "";
  };
  const reload = (id: string) =>
    withOrg(db, orgId, (tx) =>
      tx.select().from(schema.issues).where(eq(schema.issues.id, id)),
    ).then((r) => r[0]);
  const updatesOf = (issueId: string) =>
    withOrg(db, orgId, (tx) =>
      tx.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.issueId, issueId)),
    );

  it("a follow-up becomes a sealed update per destination, with the new priority applied", async () => {
    const i = await input();
    const dest = await destinationFor(i);
    const issue = await existingIssue(i);
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    await triageWith(q, [
      {
        ...create,
        kind: "update",
        issueId: issue?.id ?? null,
        type: "bug",
        priority: 5,
        summary: "Now fails for everyone.",
        dueDateQuote: null,
      },
    ])(i);

    const after = await reload(issue?.id ?? "");
    expect(after?.priority).toBe(5);
    expect(after?.bodyMd).toContain("Priority: 5 (Critical)");
    const [u] = await updatesOf(issue?.id ?? "");
    expect(u).toMatchObject({ kind: "update", newPriority: 5 });
    expect(u?.contentSealed).not.toContain("Now fails");
    const text = JSON.parse(
      await openSecret(
        u?.contentSealed ?? "",
        { orgId, recordId: u?.id ?? "", purpose: "issue_update.content" },
        keyring,
      ),
    );
    expect(text.text).toBe("Now fails for everyone.");
    expect(q.updates).toEqual([{ orgId, updateId: u?.id, destinationId: dest }]);
    expect(q.deliveries).toHaveLength(0); // an update never creates a ticket
  });

  it("'resolved in chat' only comments: nothing else about the ticket changes", async () => {
    const i = await input();
    await destinationFor(i);
    const issue = await existingIssue(i);
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    await triageWith(q, [
      {
        ...create,
        kind: "update",
        issueId: issue?.id ?? null,
        priority: 1,
        summary: "Disabling the extension fixed it.",
        resolvedInChat: true,
        dueDateQuote: null,
      },
    ])(i);
    expect((await reload(issue?.id ?? ""))?.priority).toBe(3);
    const [u] = await updatesOf(issue?.id ?? "");
    expect(u).toMatchObject({ kind: "resolved_in_chat", newPriority: null });
    expect(q.updates).toHaveLength(1);
  });

  it("a ticket still waiting for review is updated in our database only", async () => {
    const i = await input();
    await destinationFor(i);
    const issue = await existingIssue(i, { status: "pending_review" });
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    await triageWith(q, [
      {
        ...create,
        kind: "update",
        issueId: issue?.id ?? null,
        priority: 5,
        summary: "Worse.",
        dueDateQuote: null,
      },
    ])(i);
    expect((await reload(issue?.id ?? ""))?.priority).toBe(5);
    expect(await updatesOf(issue?.id ?? "")).toHaveLength(0);
    expect(q.updates).toHaveLength(0);
  });

  it("a confirmed duplicate counts the report once, even if analysed again", async () => {
    const first = await input();
    const original = await existingIssue(first);
    await withOrg(db, orgId, (tx) =>
      tx.execute(
        sql`update issues set embedding = ${vectorSql}::vector where id = ${original?.id}`,
      ),
    );
    // A second customer, a second conversation in the same automation.
    const [thread2] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.threads)
        .values({ orgId, automationId: first.automation.id, sourceId: randomUUID() })
        .returning(),
    );
    const second: TriageInput = { ...first, thread: thread2 as TriageInput["thread"] };
    const dest = await destinationFor(first);
    const seen: string[] = [];
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    const dup: ModelAction = {
      ...create,
      kind: "duplicate_of",
      issueId: original?.id ?? null,
      summary: "Same checkout problem.",
      dueDateQuote: null,
    };

    const run2 = triageWith(q, [dup], seen);
    await run2(second);
    expect(seen[0]).toContain("similar_tickets");
    expect(seen[0]).toContain("Checkout fails on Safari");
    await run2(second); // the same conversation again

    const after = await reload(original?.id ?? "");
    expect(after?.reportCount).toBe(2);
    expect(after?.bodyMd).toContain("Reported by 2 customers");
    const reports = await withOrg(db, orgId, (tx) =>
      tx
        .select()
        .from(schema.issueReports)
        .where(eq(schema.issueReports.issueId, original?.id ?? "")),
    );
    expect(reports).toHaveLength(2);
    const ups = await updatesOf(original?.id ?? "");
    expect(ups).toHaveLength(1);
    expect(ups[0]?.kind).toBe("duplicate");
    expect(q.updates).toEqual([{ orgId, updateId: ups[0]?.id, destinationId: dest }]);
  });

  it("names appear only when the automation allows them", async () => {
    const first = await input();
    const original = await existingIssue(first);
    await withOrg(db, orgId, (tx) =>
      tx.execute(
        sql`update issues set embedding = ${vectorSql}::vector where id = ${original?.id}`,
      ),
    );
    const [thread2] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.threads)
        .values({ orgId, automationId: first.automation.id, sourceId: randomUUID() })
        .returning(),
    );
    const named: TriageInput = {
      ...first,
      thread: thread2 as TriageInput["thread"],
      automation: {
        ...first.automation,
        settings: { ...first.automation.settings, includeCustomerNames: true },
      },
      conversation: { ...conversation, customer: { nickname: "Jane" } },
    };
    await destinationFor(first);
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    await triageWith(q, [
      {
        ...create,
        kind: "duplicate_of",
        issueId: original?.id ?? null,
        summary: "Same.",
        dueDateQuote: null,
      },
    ])(named);
    expect((await reload(original?.id ?? ""))?.bodyMd).toContain("Reported by Ann, Jane");
    expect((await updatesOf(original?.id ?? ""))[0]?.customerRef).toBe("Jane");
  });

  it("ignores a duplicate pointing at a ticket the search never offered", async () => {
    const first = await input();
    const other = await existingIssue(first); // no embedding: not a candidate
    const [thread2] = await withOrg(db, orgId, (tx) =>
      tx
        .insert(schema.threads)
        .values({ orgId, automationId: first.automation.id, sourceId: randomUUID() })
        .returning(),
    );
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    await triageWith(q, [
      {
        ...create,
        kind: "duplicate_of",
        issueId: other?.id ?? null,
        summary: "x",
        dueDateQuote: null,
      },
    ])({ ...first, thread: thread2 as TriageInput["thread"] });
    expect((await reload(other?.id ?? ""))?.reportCount).toBe(1);
    expect(q.updates).toHaveLength(0);
  });

  it("gives every new ticket an embedding so later conversations can match it", async () => {
    const i = await input();
    const q = { updates: [] as unknown[], deliveries: [] as unknown[] };
    await triageWith(q, [create])(i);
    const rows = await withOrg(db, orgId, (tx) =>
      tx.execute<{ has: boolean }>(
        sql`select embedding is not null as has from issues where origin_thread_id = ${i.thread.id}`,
      ),
    );
    expect(rows[0]?.has).toBe(true);
  });
});

describe("conversation mapping", () => {
  it("only shows files hosted on Crisp storage to the model", () => {
    const m = toAiMessages({
      ...conversation,
      messages: [
        {
          fingerprint: "a",
          timestamp: 1,
          role: "customer",
          kind: "file",
          file: { name: "ok.png", url: "https://storage.crisp.chat/x/ok.png", mime: "image/png" },
        },
        {
          fingerprint: "b",
          timestamp: 2,
          role: "customer",
          kind: "file",
          file: { name: "evil.png", url: "http://169.254.169.254/latest", mime: "image/png" },
        },
        {
          fingerprint: "c",
          timestamp: 3,
          role: "customer",
          kind: "file",
          file: {
            name: "x.png",
            url: "https://storage.crisp.chat.evil.com/x.png",
            mime: "image/png",
          },
        },
      ],
    });
    expect(m[0]?.attachment?.url).toContain("storage.crisp.chat");
    expect(m[1]?.attachment).toBeUndefined();
    expect(m[1]?.text).toContain("not shown");
    expect(m[2]?.attachment).toBeUndefined();
  });
});
