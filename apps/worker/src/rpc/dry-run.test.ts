import { randomUUID } from "node:crypto";
import type { AiProvider, ModelAction } from "@triagefox/ai";
import type { CrispConversation, CrispPluginClient } from "@triagefox/connectors";
import { generateKeyPair, type PrivateKeyring } from "@triagefox/crypto";
import { createDb, type Db, schema, withOrg } from "@triagefox/db";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Ctx } from "./context";
import { dryRun } from "./dry-run";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const redis = new Redis(process.env.REDIS_URL ?? "", { maxRetriesPerRequest: null });
const orgId = `org_${randomUUID()}`;
let ctx: Ctx;
let automationId = "";

const action = (over: Partial<ModelAction>): ModelAction => ({
  kind: "create",
  issueId: null,
  type: "bug",
  title: "Checkout fails on Safari",
  summary: "Cannot pay.",
  stepsToReproduce: ["Open checkout", "Click Pay"],
  expected: null,
  actual: null,
  environment: null,
  priority: 4,
  priorityReason: "Core flow.",
  dueDateQuote: null,
  relevantAttachmentIds: [],
  confidence: 0.9,
  reason: "Payment failing",
  category: null,
  resolvedInChat: false,
  ...over,
});

const conv = (id: string, text: string): CrispConversation => ({
  sessionId: id,
  websiteId: "w",
  state: "open",
  updatedAt: Date.now(),
  customer: {},
  messages: [{ fingerprint: `${id}-1`, timestamp: 1, role: "customer", kind: "text", text }],
});

const crisp = {
  listConversations: async () => [
    { sessionId: "a", updatedAt: 3, state: "open" as const },
    { sessionId: "b", updatedAt: 2, state: "open" as const },
    { sessionId: "c", updatedAt: 1, state: "open" as const },
  ],
  fetchConversation: async (_w: string, s: string) =>
    s === "c"
      ? { ...conv(s, ""), messages: [] } // no customer message: skipped
      : conv(s, s === "a" ? "Checkout is broken, mail me at jane@acme.com" : "How do I export?"),
} as unknown as CrispPluginClient;

const provider: AiProvider = {
  async complete(req) {
    const isBug = req.text.includes("Checkout is broken");
    return {
      json: {
        actions: [
          isBug
            ? action({})
            : action({
                kind: "no_action",
                type: null,
                priority: null,
                title: "",
                summary: "",
                category: "question",
                reason: "How-to",
              }),
        ],
      },
      usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 },
      finishReason: "stop",
    };
  },
};

beforeAll(async () => {
  const kp = await generateKeyPair();
  const keyring: PrivateKeyring = {
    currentVersion: 1,
    publicKeys: { 1: kp.publicKey },
    privateKeys: { 1: kp.privateKey },
  };
  ctx = {
    db,
    redis,
    keyring,
    log: { info() {}, warn() {}, error() {} },
    config: {
      OPENAI_API_KEY: "sk-test",
      AI_MODEL_DEFAULT: "m1",
      AI_MODEL_ESCALATION: "m2",
      AI_MODEL_EMBEDDING: "e",
    } as Ctx["config"],
  };
  const [source] = await withOrg(db, orgId, (tx) =>
    tx
      .insert(schema.connections)
      .values({
        orgId,
        provider: "crisp",
        authType: "plugin_install",
        status: "active",
        metadata: { websiteId: `w-${randomUUID()}` },
      })
      .returning(),
  );
  const [a] = await withOrg(db, orgId, (tx) =>
    tx
      .insert(schema.automations)
      .values({ orgId, sourceConnectionId: source?.id ?? "", name: "a" })
      .returning(),
  );
  automationId = a?.id ?? "";
  await redis.del(`dryrun:${orgId}`);
});
afterAll(async () => {
  await redis.del(`dryrun:${orgId}`);
  await owner.$client.unsafe("delete from connections where org_id = $1", [orgId]);
  await db.$client.end();
  await owner.$client.end();
  redis.disconnect();
});

describe("dry run", () => {
  it("says what it would do for each recent chat and creates nothing", async () => {
    const out = await dryRun(ctx, crisp, { orgId, automationId }, () => provider);
    expect(out.analysed).toBe(2);
    const bug = out.results.find((r) => r.decision === "create");
    expect(bug).toMatchObject({
      type: "bug",
      priority: 4,
      title: "Checkout fails on Safari",
      needsReview: false,
    });
    expect(bug?.bodyPreview).toContain("## Steps to reproduce");
    expect(bug?.snippet).not.toContain("jane@acme.com"); // personal data is stripped from what we show
    expect(out.results.find((r) => r.decision === "no_action")).toMatchObject({
      category: "question",
    });

    const issues = await withOrg(db, orgId, (tx) => tx.select().from(schema.issues));
    const runs = await withOrg(db, orgId, (tx) => tx.select().from(schema.aiRuns));
    expect(issues).toHaveLength(0);
    expect(runs).toHaveLength(0);
  });

  it("allows only a few tries an hour", async () => {
    await dryRun(ctx, crisp, { orgId, automationId }, () => provider);
    await dryRun(ctx, crisp, { orgId, automationId }, () => provider);
    await expect(dryRun(ctx, crisp, { orgId, automationId }, () => provider)).rejects.toMatchObject(
      {
        code: "rate_limited",
      },
    );
  });

  it("refuses an automation from another workspace", async () => {
    await expect(
      dryRun(ctx, crisp, { orgId: "other", automationId }, () => provider),
    ).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
