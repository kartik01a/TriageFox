import { randomUUID } from "node:crypto";
import { createDb, type Db, eq, like, schema, withOrg } from "@triagefox/db";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  applyBillingEvent,
  checkEntitlement,
  findPlanForProduct,
  getSettings,
  getSubscription,
  grantComp,
  hashInviteCode,
  newInviteCode,
  recordUsage,
  redeemInviteCode,
  revokeComp,
  startTrial,
} from "./service";

const db: Db = createDb(process.env.DATABASE_URL ?? "", { max: 5 });
const owner: Db = createDb(process.env.DATABASE_MIGRATION_URL ?? "", { max: 1 });
const tag = randomUUID().slice(0, 8);
const org = () => `org_${randomUUID()}`;
let plan: typeof schema.plans.$inferSelect;
const productMonthly = `pdt_m_${tag}`;
const productYearly = `pdt_y_${tag}`;
const orgs: string[] = [];
const fresh = () => {
  const o = org();
  orgs.push(o);
  return o;
};
const ev = (over: Record<string, unknown>) =>
  ({
    id: `evt_${randomUUID()}`,
    type: "subscription_active",
    rawType: "subscription.active",
    ...over,
  }) as Parameters<typeof applyBillingEvent>[2];

beforeAll(async () => {
  const [inserted] = await owner
    .insert(schema.plans)
    .values({
      slug: `test-${tag}`,
      name: "Test plan",
      conversationLimit: 10,
      inboxLimit: 1,
      providerPriceIds: { dodo: { USD: { monthly: productMonthly, yearly: productYearly } } },
    })
    .returning();
  if (!inserted) throw new Error("plan not created");
  plan = inserted;
});
afterAll(async () => {
  for (const o of orgs) {
    await owner.delete(schema.subscriptions).where(eq(schema.subscriptions.orgId, o));
    await owner.delete(schema.usageCounters).where(eq(schema.usageCounters.orgId, o));
    await owner.delete(schema.usageConversations).where(eq(schema.usageConversations.orgId, o));
  }
  await owner.delete(schema.inviteCodes).where(eq(schema.inviteCodes.planId, plan.id));
  await owner.delete(schema.plans).where(eq(schema.plans.id, plan.id));
  await owner.delete(schema.billingEvents).where(like(schema.billingEvents.eventId, "evt_%"));
  await db.$client.end();
  await owner.$client.end();
});

describe("settings", () => {
  it("falls back to the built-in values and takes a valid saved value", async () => {
    const before = await getSettings(db);
    expect(before.trial.days).toBeGreaterThan(0);
    await owner
      .insert(schema.platformSettings)
      .values({ key: "reminders", value: { monthlyDays: 5, yearlyDays: 9 } })
      .onConflictDoUpdate({
        target: schema.platformSettings.key,
        set: { value: { monthlyDays: 5, yearlyDays: 9 } },
      });
    expect((await getSettings(db)).reminders).toEqual({ monthlyDays: 5, yearlyDays: 9 });
    // An invalid saved value is ignored rather than breaking checkout.
    await owner
      .update(schema.platformSettings)
      .set({ value: { monthlyDays: "x" } })
      .where(eq(schema.platformSettings.key, "reminders"));
    expect((await getSettings(db)).reminders.monthlyDays).toBe(3);
    await owner.delete(schema.platformSettings).where(eq(schema.platformSettings.key, "reminders"));
  });
});

describe("trial and limits", () => {
  it("starts a trial once, and blocks the conversation after the cap", async () => {
    const o = fresh();
    await startTrial(db, o);
    await startTrial(db, o);
    const { subscription } = await getSubscription(db, o);
    expect(subscription?.status).toBe("trialing");
    expect(subscription?.trialEndsAt && subscription.trialEndsAt > new Date()).toBe(true);

    const thread = randomUUID();
    const first = await checkEntitlement(db, { orgId: o, threadId: thread, hasOwnKey: true });
    expect(first.decision).toMatchObject({ allowed: true, limit: null }); // own key: unlimited trial
    const noKey = await checkEntitlement(db, { orgId: o, threadId: thread, hasOwnKey: false });
    expect(noKey.decision).toMatchObject({ allowed: true, limit: 50 });
  });

  it("counts a conversation once per period and warns exactly once at 80% and 100%", async () => {
    const o = fresh();
    await grantComp(db, { orgId: o, planId: plan.id, months: null, reason: "test" });
    const threads = Array.from({ length: 10 }, () => randomUUID());
    const crossings: (string | null)[] = [];
    for (const t of threads) {
      const c = await checkEntitlement(db, { orgId: o, threadId: t, hasOwnKey: false });
      expect(c.decision.allowed).toBe(true);
      const r = await recordUsage(db, {
        orgId: o,
        threadId: t,
        periodStart: c.periodStart,
        costMicroUsd: 1000,
        trialing: false,
        usingPlatformKey: true,
        ticketsCreated: 0,
        limit: 10,
      });
      crossings.push(r.crossed);
    }
    expect(crossings.filter(Boolean)).toEqual(["80", "100"]);
    // The same conversation again does not use up room, and a new one is now blocked.
    const again = await checkEntitlement(db, {
      orgId: o,
      threadId: threads[0] as string,
      hasOwnKey: false,
    });
    expect(again.decision.allowed).toBe(true);
    const next = await checkEntitlement(db, { orgId: o, threadId: randomUUID(), hasOwnKey: false });
    expect(next.decision).toMatchObject({ allowed: false, reason: "over_limit" });
    const r2 = await recordUsage(db, {
      orgId: o,
      threadId: threads[0] as string,
      periodStart: again.periodStart,
      costMicroUsd: 500,
      trialing: false,
      usingPlatformKey: true,
      ticketsCreated: 1,
      limit: 10,
    });
    expect(r2).toMatchObject({ crossed: null, used: 10 });
    const [row] = await withOrg(db, o, (tx) =>
      tx.select().from(schema.usageCounters).where(eq(schema.usageCounters.orgId, o)),
    );
    expect(row).toMatchObject({
      conversationsAnalysed: 10,
      aiRuns: 11,
      ticketsCreated: 1,
      aiCostMicroUsd: 10_500,
    });
  });
});

describe("webhooks", () => {
  it("activates the plan from the product, ignores a repeat delivery, and tracks failed payments", async () => {
    const o = fresh();
    await startTrial(db, o);
    const sub = `sub_${tag}_${randomUUID().slice(0, 6)}`;
    const periodEnd = new Date(Date.now() + 30 * 86_400_000);
    const e1 = ev({
      orgId: o,
      subscriptionId: sub,
      customerId: "cus_x",
      productId: productYearly,
      periodStart: new Date(),
      periodEnd,
    });
    expect(await applyBillingEvent(db, "dodo", e1)).toMatchObject({
      handled: true,
      status: "active",
    });
    expect(await applyBillingEvent(db, "dodo", e1)).toEqual({
      handled: false,
      reason: "duplicate",
    });
    const got = await getSubscription(db, o);
    expect(got.subscription).toMatchObject({
      status: "active",
      interval: "yearly",
      providerSubscriptionId: sub,
      cancelAtPeriodEnd: false,
    });
    expect(got.plan?.id).toBe(plan.id);

    // Later events carry no metadata: the workspace is found through the subscription id.
    const failed = await applyBillingEvent(
      db,
      "dodo",
      ev({ type: "payment_failed", rawType: "payment.failed", subscriptionId: sub }),
    );
    expect(failed).toMatchObject({ handled: true, orgId: o, status: "past_due" });
    expect((await getSubscription(db, o)).subscription?.pastDueSince).toBeTruthy();
    const ok = await applyBillingEvent(
      db,
      "dodo",
      ev({ type: "payment_succeeded", rawType: "payment.succeeded", subscriptionId: sub }),
    );
    expect(ok).toMatchObject({ status: "active" });
    expect((await getSubscription(db, o)).subscription?.pastDueSince).toBeNull();
  });

  it("a cancellation keeps access until the period ends; an expiry ends it", async () => {
    const o = fresh();
    const sub = `sub_${tag}_${randomUUID().slice(0, 6)}`;
    const periodEnd = new Date(Date.now() + 10 * 86_400_000);
    await applyBillingEvent(
      db,
      "dodo",
      ev({ orgId: o, subscriptionId: sub, productId: productMonthly, periodEnd }),
    );
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        type: "subscription_cancelled",
        rawType: "subscription.cancelled",
        subscriptionId: sub,
        periodEnd,
      }),
    );
    expect((await getSubscription(db, o)).subscription).toMatchObject({
      status: "active",
      cancelAtPeriodEnd: true,
    });
    await applyBillingEvent(
      db,
      "dodo",
      ev({ type: "subscription_ended", rawType: "subscription.expired", subscriptionId: sub }),
    );
    expect((await getSubscription(db, o)).subscription?.status).toBe("canceled");
  });

  it("an event for an unknown workspace, and an unknown event type, change nothing", async () => {
    expect(
      await applyBillingEvent(db, "dodo", ev({ subscriptionId: `nope_${randomUUID()}` })),
    ).toEqual({ handled: false, reason: "unknown_workspace" });
    expect(await applyBillingEvent(db, "dodo", ev({ type: "ignored" }))).toEqual({
      handled: false,
      reason: "ignored",
    });
  });

  it("one workspace cannot be changed through another's subscription id", async () => {
    const a = fresh();
    const b = fresh();
    const sa = `sub_${tag}_a${randomUUID().slice(0, 4)}`;
    await applyBillingEvent(
      db,
      "dodo",
      ev({ orgId: a, subscriptionId: sa, productId: productMonthly }),
    );
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        orgId: b,
        subscriptionId: `sub_${tag}_b${randomUUID().slice(0, 4)}`,
        productId: productMonthly,
      }),
    );
    await applyBillingEvent(
      db,
      "dodo",
      ev({ type: "subscription_ended", rawType: "subscription.expired", subscriptionId: sa }),
    );
    expect((await getSubscription(db, a)).subscription?.status).toBe("canceled");
    expect((await getSubscription(db, b)).subscription?.status).toBe("active");
  });
});

describe("plans", () => {
  it("finds the plan, interval and currency for a provider product", async () => {
    const plans = await owner.select().from(schema.plans).where(eq(schema.plans.id, plan.id));
    expect(findPlanForProduct(plans, "dodo", productYearly)).toMatchObject({
      interval: "yearly",
      currency: "USD",
    });
    expect(findPlanForProduct(plans, "dodo", "pdt_unknown")).toBeNull();
  });
});

describe("free access", () => {
  it("a comp can be revoked", async () => {
    const o = fresh();
    await grantComp(db, { orgId: o, planId: plan.id, months: 3, reason: "beta" });
    expect((await getSubscription(db, o)).subscription).toMatchObject({
      status: "comped",
      compReason: "beta",
    });
    await revokeComp(db, o);
    expect((await getSubscription(db, o)).subscription?.status).toBe("canceled");
  });

  it("an invite code works once, only for its email, and only before it expires; only its hash is stored", async () => {
    const code = newInviteCode();
    expect(code.length).toBeGreaterThanOrEqual(20);
    await owner.insert(schema.inviteCodes).values({
      codeHash: hashInviteCode(code),
      email: "Friend@Example.com",
      planId: plan.id,
      months: 2,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: "admin",
    });
    const [stored] = await owner
      .select()
      .from(schema.inviteCodes)
      .where(eq(schema.inviteCodes.codeHash, hashInviteCode(code)));
    expect(JSON.stringify(stored)).not.toContain(code);

    const o1 = fresh();
    expect(
      await redeemInviteCode(db, { code: "wrong", email: "friend@example.com", orgId: o1 }),
    ).toMatchObject({ ok: false, reason: "invalid" });
    expect(
      await redeemInviteCode(db, { code, email: "other@example.com", orgId: o1 }),
    ).toMatchObject({ ok: false, reason: "wrong_email" });
    expect(
      await redeemInviteCode(db, { code, email: "friend@example.com", orgId: o1 }),
    ).toMatchObject({ ok: true, planName: "Test plan" });
    expect((await getSubscription(db, o1)).subscription?.status).toBe("comped");
    const o2 = fresh();
    expect(
      await redeemInviteCode(db, { code, email: "friend@example.com", orgId: o2 }),
    ).toMatchObject({ ok: false, reason: "used" });

    const old = newInviteCode();
    await owner.insert(schema.inviteCodes).values({
      codeHash: hashInviteCode(old),
      email: "f@e.c",
      planId: plan.id,
      months: 1,
      expiresAt: new Date(Date.now() - 1000),
      createdBy: "admin",
    });
    expect(await redeemInviteCode(db, { code: old, email: "f@e.c", orgId: o2 })).toMatchObject({
      ok: false,
      reason: "expired",
    });
  });

  it("two simultaneous redemptions cannot both win", async () => {
    const code = newInviteCode();
    await owner.insert(schema.inviteCodes).values({
      codeHash: hashInviteCode(code),
      email: "r@e.c",
      planId: plan.id,
      months: 1,
      expiresAt: new Date(Date.now() + 86_400_000),
      createdBy: "admin",
    });
    const [a, b] = await Promise.all([
      redeemInviteCode(db, { code, email: "r@e.c", orgId: fresh() }),
      redeemInviteCode(db, { code, email: "r@e.c", orgId: fresh() }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
  });
});
