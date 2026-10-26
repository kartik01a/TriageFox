import { randomUUID } from "node:crypto";
import type { TriageAction } from "@triagefox/ai";
import { createDb, type Db, eq, schema } from "@triagefox/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Notifier } from "../notify";
import type { TriageInput } from "./deps";
import { recordSupportItems, supportCategory } from "./support";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 3 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const alerts: { subject: string; text: string }[] = [];
const notifier: Notifier = { emailOwners: async () => {}, alert: async (a) => void alerts.push(a) };
const userId = `user_${randomUUID()}`;
const email = `support-${randomUUID().slice(0, 8)}@example.test`;
const threads: string[] = [];

const action = (over: Partial<TriageAction>): TriageAction => ({
  kind: "no_action",
  title: "",
  summary: "",
  stepsToReproduce: [],
  priorityReason: "",
  dueDate: null,
  dueDateQuote: null,
  relevantAttachmentIds: [],
  confidence: 0.9,
  reason: "",
  needsReview: false,
  resolvedInChat: false,
  ...over,
});
const input = (customerEmail: string | undefined, verified = false) => {
  const threadId = randomUUID();
  threads.push(threadId);
  return {
    orgId: "platform-org",
    thread: { id: threadId },
    conversation: {
      sessionId: "sess",
      websiteId: "site",
      customer: { email: customerEmail, verified },
    },
  } as unknown as TriageInput;
};
const itemsOf = (i: TriageInput) =>
  db.select().from(schema.supportItems).where(eq(schema.supportItems.threadId, i.thread.id));

beforeAll(async () => {
  await owner.insert(schema.user).values({ id: userId, name: "Known", email });
});
afterAll(async () => {
  for (const t of threads)
    await owner.delete(schema.supportItems).where(eq(schema.supportItems.threadId, t));
  await owner.delete(schema.user).where(eq(schema.user.id, userId));
  await db.$client.end();
  await owner.$client.end();
});

describe("supportCategory", () => {
  it("maps what the AI found onto our own support categories", () => {
    expect(supportCategory({ kind: "create", type: "performance" })).toBe("bug");
    expect(supportCategory({ kind: "create", type: "feature" })).toBe("feature");
    expect(supportCategory({ kind: "no_action", category: "refund_request" })).toBe(
      "refund_request",
    );
    expect(supportCategory({ kind: "no_action", category: "praise" })).toBe("praise");
    expect(supportCategory({ kind: "no_action", category: "greeting" })).toBeNull();
    expect(supportCategory({ kind: "no_action", category: "spam" })).toBeNull();
    expect(supportCategory({ kind: "update" })).toBeNull();
  });
});

describe("recordSupportItems", () => {
  it("files a refund request, links the user by email, and alerts once", async () => {
    alerts.length = 0;
    const i = input(email, false);
    const acts = [
      action({ category: "refund_request", reason: "Asks for a refund after a double charge" }),
    ];
    await recordSupportItems({ db, notifier, input: i, actions: acts });
    await recordSupportItems({ db, notifier, input: i, actions: acts }); // the same conversation read again
    const items = await itemsOf(i);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: "refund_request",
      status: "new",
      matchedUserId: userId,
      identityVerified: false,
      customerEmail: email,
    });
    expect(items[0]?.crispUrl).toContain("/website/site/inbox/sess/");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.subject).toMatch(/refund/);
    expect(alerts[0]?.text).toContain("unverified");
  });

  it("praise becomes a testimonial candidate without an alert; a verified identity is recorded", async () => {
    alerts.length = 0;
    const i = input(email, true);
    await recordSupportItems({
      db,
      notifier,
      input: i,
      actions: [action({ category: "praise", reason: "Loves the tool" })],
    });
    const [item] = await itemsOf(i);
    expect(item).toMatchObject({
      category: "praise",
      identityVerified: true,
      testimonialApproved: false,
    });
    expect(alerts).toHaveLength(0);
  });

  it("alerts for a serious bug, not for a minor one, and keeps an unknown customer unmatched", async () => {
    alerts.length = 0;
    const serious = input(undefined);
    await recordSupportItems({
      db,
      notifier,
      input: serious,
      actions: [
        action({ kind: "create", type: "bug", priority: 5, title: "Tickets stopped appearing" }),
      ],
    });
    expect(alerts).toHaveLength(1);
    expect((await itemsOf(serious))[0]).toMatchObject({
      category: "bug",
      priority: 5,
      matchedUserId: null,
      customerEmail: null,
    });
    const minor = input(undefined);
    await recordSupportItems({
      db,
      notifier,
      input: minor,
      actions: [action({ kind: "create", type: "bug", priority: 2, title: "Typo" })],
    });
    expect(alerts).toHaveLength(1);
  });

  it("ignores greetings and spam", async () => {
    const i = input(email);
    await recordSupportItems({
      db,
      notifier,
      input: i,
      actions: [action({ category: "greeting" }), action({ category: "spam" })],
    });
    expect(await itemsOf(i)).toHaveLength(0);
  });
});
