import { randomUUID } from "node:crypto";
import { createDb, type Db, eq, like, schema, withOrg } from "@triagefox/db";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DodoProvider } from "./dodo";
import { periodStartFor } from "./entitlement";
import { FakeProvider } from "./fake";
import {
  applyBillingEvent,
  billingSummary,
  checkEntitlement,
  clearScheduledChange,
  findPlanForProduct,
  getSettings,
  getSubscription,
  grantComp,
  hashInviteCode,
  newInviteCode,
  planChangePlan,
  recordScheduledChange,
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
  await owner.delete(schema.plans).where(like(schema.plans.slug, `pc-%-${tag}`));
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

  it("a checkout whose first payment failed leaves the trial as it was (seen in production)", async () => {
    // The three messages Dodo sent in the same second, through the real Dodo parser, in every order.
    const fake = new FakeProvider();
    const dodo = new DodoProvider({ apiKey: "k", webhookKey: fake.secret, mode: "test" });
    const orders = [
      ["subscription.failed", "payment.failed", "subscription.updated"],
      ["subscription.updated", "payment.failed", "subscription.failed"],
      ["payment.failed", "subscription.updated", "subscription.failed"],
    ];
    for (const order of orders) {
      const o = fresh();
      await startTrial(db, o);
      const sub = `sub_${tag}_${randomUUID().slice(0, 6)}`;
      for (const type of order) {
        const { body, headers } = fake.sign({
          id: `evt_${randomUUID()}`,
          type,
          data: {
            subscription_id: sub,
            product_id: productMonthly,
            status: "failed",
            metadata: { org_id: o },
            next_billing_date: new Date().toISOString(),
          },
        });
        await applyBillingEvent(db, "dodo", dodo.parseWebhook(headers, body));
      }
      const got = await getSubscription(db, o);
      expect(got.subscription).toMatchObject({ status: "trialing", pastDueSince: null });
      expect(got.plan).toBeNull();
    }
  });

  it("a failed payment for another subscription does not touch the plan the workspace is on", async () => {
    const o = fresh();
    await startTrial(db, o);
    const sub = `sub_${tag}_${randomUUID().slice(0, 6)}`;
    await applyBillingEvent(
      db,
      "dodo",
      ev({ orgId: o, subscriptionId: sub, productId: productMonthly, periodStart: new Date() }),
    );
    const other = await applyBillingEvent(
      db,
      "dodo",
      ev({
        type: "payment_failed",
        rawType: "payment.failed",
        orgId: o,
        subscriptionId: "sub_other",
      }),
    );
    expect(other).toMatchObject({ handled: true, status: "active" });
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

describe("plan editing", () => {
  it("a price change makes a new version without the old product ids, so nobody buys the new price at the old one", async () => {
    const { createPlan, updatePlan, PlanError } = await import("./admin");
    const slug = `edit-${tag}`;
    const v1 = await createPlan(owner, {
      slug,
      name: "Edit me",
      prices: { USD: { monthly: 900, yearly: 9000 } },
      providerPriceIds: { dodo: { USD: { monthly: "pdt_a", yearly: "pdt_b" } } },
      isPublic: true,
    });
    expect(v1.version).toBe(1);

    const rename = await updatePlan(owner, v1.id, { name: "Renamed", isPopular: true });
    expect(rename).toMatchObject({ versioned: false });
    expect(rename.plan.id).toBe(v1.id);

    const repriced = await updatePlan(owner, v1.id, {
      prices: { USD: { monthly: 1000, yearly: 10000 } },
    });
    expect(repriced.versioned).toBe(true);
    expect(repriced.plan).toMatchObject({ version: 2, isPublic: false, providerPriceIds: {} });
    // The old version keeps its price and ids, for the people already on it.
    const old = await owner.select().from(schema.plans).where(eq(schema.plans.id, v1.id));
    expect(old[0]?.prices.USD?.monthly).toBe(900);
    expect(old[0]?.providerPriceIds.dodo?.USD?.monthly).toBe("pdt_a");

    await expect(updatePlan(owner, v1.id, { name: "x" })).rejects.toThrow(PlanError); // only the newest is editable
    await expect(updatePlan(owner, repriced.plan.id, { isPublic: true })).rejects.toThrow(
      /product ids/,
    );
    const live = await updatePlan(owner, repriced.plan.id, {
      providerPriceIds: { dodo: { USD: { monthly: "pdt_c", yearly: "pdt_d" } } },
      isPublic: true,
    });
    expect(live.plan.isPublic).toBe(true);
    await owner.delete(schema.plans).where(eq(schema.plans.slug, slug));
  });

  it("a plan cannot be created public without product ids", async () => {
    const { createPlan } = await import("./admin");
    await expect(
      createPlan(owner, {
        slug: `nope-${tag}`,
        name: "No ids",
        prices: { USD: { monthly: 100, yearly: 1000 } },
        isPublic: true,
      }),
    ).rejects.toThrow(/product ids/);
  });
});

describe("what customers can buy", () => {
  it("after a price change the old version stays on sale until the new one is published", async () => {
    const { createPlan, updatePlan } = await import("./admin");
    const { listPlans } = await import("./service");
    const slug = `sale-${tag}`;
    const v1 = await createPlan(owner, {
      slug,
      name: "On sale",
      prices: { USD: { monthly: 900, yearly: 9000 } },
      providerPriceIds: { dodo: { USD: { monthly: "pdt_1", yearly: "pdt_2" } } },
      isPublic: true,
    });
    const v2 = await updatePlan(owner, v1.id, {
      prices: { USD: { monthly: 1000, yearly: 10000 } },
    });
    expect(
      (await listPlans(owner, { publicOnly: true })).find((p) => p.slug === slug)?.version,
    ).toBe(1);
    await updatePlan(owner, v2.plan.id, {
      providerPriceIds: { dodo: { USD: { monthly: "pdt_3", yearly: "pdt_4" } } },
      isPublic: true,
    });
    expect(
      (await listPlans(owner, { publicOnly: true })).find((p) => p.slug === slug)?.version,
    ).toBe(2);
    await owner.delete(schema.plans).where(eq(schema.plans.slug, slug));
  });
});

describe("isolation between workspaces", () => {
  it("one workspace cannot read or change another's subscription or usage", async () => {
    const a = fresh();
    const b = fresh();
    await startTrial(db, a);
    await startTrial(db, b);
    const t = randomUUID();
    const c = await checkEntitlement(db, { orgId: a, threadId: t, hasOwnKey: true });
    await recordUsage(db, {
      orgId: a,
      threadId: t,
      periodStart: c.periodStart,
      costMicroUsd: 5,
      trialing: true,
      usingPlatformKey: false,
      ticketsCreated: 0,
      limit: null,
    });

    // Acting as B, A's rows are invisible and unwritable.
    expect(
      await withOrg(db, b, (tx) =>
        tx.select().from(schema.subscriptions).where(eq(schema.subscriptions.orgId, a)),
      ),
    ).toHaveLength(0);
    expect(
      await withOrg(db, b, (tx) =>
        tx.select().from(schema.usageCounters).where(eq(schema.usageCounters.orgId, a)),
      ),
    ).toHaveLength(0);
    expect(
      await withOrg(db, b, (tx) =>
        tx
          .update(schema.subscriptions)
          .set({ status: "canceled" })
          .where(eq(schema.subscriptions.orgId, a))
          .returning(),
      ),
    ).toHaveLength(0);
    await expect(
      withOrg(db, b, (tx) =>
        tx
          .insert(schema.usageConversations)
          .values({ orgId: a, periodStart: "2026-01-01", threadId: randomUUID() }),
      ),
    ).rejects.toThrow();
    expect((await getSubscription(db, a)).subscription?.status).toBe("trialing");
  });
});

describe("plan changes for a paying workspace (ADR 0015)", () => {
  const ids = (size: string) => ({
    USD: { monthly: `pdt_${size}_m_${tag}`, yearly: `pdt_${size}_y_${tag}` },
  });
  let small: typeof schema.plans.$inferSelect;
  let big: typeof schema.plans.$inferSelect;
  beforeAll(async () => {
    const make = async (size: string, monthly: number) => {
      const [p] = await owner
        .insert(schema.plans)
        .values({
          slug: `pc-${size}-${tag}`,
          name: `PC ${size}`,
          prices: { USD: { monthly, yearly: monthly * 10 } },
          conversationLimit: monthly,
          providerPriceIds: { dodo: ids(size) },
          isPublic: true,
        })
        .returning();
      if (!p) throw new Error("plan not created");
      return p;
    };
    small = await make("small", 900);
    big = await make("big", 2400);
  });
  /** A workspace paying monthly for `p` through Dodo, as the webhook leaves it. */
  async function paying(p: typeof small, periodEnd = new Date(Date.now() + 20 * 86_400_000)) {
    const o = fresh();
    const sub = `sub_${tag}_${randomUUID().slice(0, 6)}`;
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        orgId: o,
        subscriptionId: sub,
        productId: p.providerPriceIds.dodo?.USD?.monthly,
        periodStart: new Date(Date.now() - 10 * 86_400_000),
        periodEnd,
      }),
    );
    return { o, sub, periodEnd };
  }
  const plan = (o: string, planId: string, interval: "monthly" | "yearly" = "monthly") =>
    planChangePlan(db, { orgId: o, provider: "dodo", planId, interval, fallbackCurrency: "INR" });

  it("records the subscription's currency from the product it paid for", async () => {
    const { o } = await paying(small);
    expect((await getSubscription(db, o)).subscription?.currency).toBe("USD");
  });

  it("an upgrade is planned now, with the bigger plan's product in the same currency", async () => {
    const { o, sub } = await paying(small);
    const r = await plan(o, big.id);
    expect(r).toMatchObject({
      ok: true,
      kind: "now",
      subscriptionId: sub,
      productId: `pdt_big_m_${tag}`,
      currency: "USD",
      request: { prorationMode: "prorated_immediately_keep_cycle", effectiveAt: "immediately" },
    });
  });

  it("a downgrade is planned for the next billing date", async () => {
    const { o, periodEnd } = await paying(big);
    const r = await plan(o, small.id);
    expect(r).toMatchObject({ ok: true, kind: "at_renewal", effectiveAt: periodEnd });
  });

  it("refuses: no paid plan, the same plan, a plan set to end, or a failed payment", async () => {
    const trial = fresh();
    await startTrial(db, trial);
    expect(await plan(trial, big.id)).toMatchObject({ ok: false });
    const { o, sub } = await paying(small);
    expect(await plan(o, small.id)).toMatchObject({
      ok: false,
      error: "That is already your plan.",
    });
    await applyBillingEvent(
      db,
      "dodo",
      ev({ type: "payment_failed", rawType: "payment.failed", subscriptionId: sub }),
    );
    expect(await plan(o, big.id)).toMatchObject({ ok: false, error: /payment method/ });
    const ending = await paying(small);
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        type: "subscription_cancelled",
        rawType: "subscription.cancelled",
        subscriptionId: ending.sub,
        periodEnd: ending.periodEnd,
      }),
    );
    expect(await plan(ending.o, big.id)).toMatchObject({ ok: false, error: /set to end/ });
  });

  it("a scheduled downgrade keeps the bigger plan until its date, then applies and clears", async () => {
    const { o, sub, periodEnd } = await paying(big);
    await recordScheduledChange(db, o, { planId: small.id, interval: "monthly", at: periodEnd });
    expect((await billingSummary(db, o, false)).scheduled).toMatchObject({
      planName: "PC small",
      interval: "monthly",
    });
    // A message naming the smaller product before the date does not shrink the plan yet.
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        rawType: "subscription.plan_changed",
        subscriptionId: sub,
        productId: `pdt_small_m_${tag}`,
        periodStart: new Date(Date.now() - 10 * 86_400_000),
        periodEnd,
      }),
    );
    let s = (await getSubscription(db, o)).subscription;
    expect(s?.planId).toBe(big.id);
    expect(s?.scheduledPlanId).toBe(small.id);
    // The renewal at the scheduled date carries the smaller product: now it applies.
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        rawType: "subscription.renewed",
        subscriptionId: sub,
        productId: `pdt_small_m_${tag}`,
        periodStart: periodEnd,
        periodEnd: new Date(periodEnd.getTime() + 30 * 86_400_000),
      }),
    );
    s = (await getSubscription(db, o)).subscription;
    expect(s?.planId).toBe(small.id);
    expect(s?.scheduledPlanId).toBeNull();
  });

  it("an upgrade made while a downgrade was scheduled replaces it", async () => {
    const { o, sub, periodEnd } = await paying(small);
    await recordScheduledChange(db, o, { planId: small.id, interval: "yearly", at: periodEnd });
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        rawType: "subscription.plan_changed",
        subscriptionId: sub,
        productId: `pdt_big_m_${tag}`,
      }),
    );
    const s = (await getSubscription(db, o)).subscription;
    expect(s?.planId).toBe(big.id);
    expect(s?.scheduledPlanId).toBeNull();
  });

  it("undoing a scheduled change, or cancelling the subscription, clears the schedule", async () => {
    const { o, sub, periodEnd } = await paying(big);
    await recordScheduledChange(db, o, { planId: small.id, interval: "monthly", at: periodEnd });
    await clearScheduledChange(db, o);
    expect((await getSubscription(db, o)).subscription?.scheduledPlanId).toBeNull();
    await recordScheduledChange(db, o, { planId: small.id, interval: "monthly", at: periodEnd });
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
    expect((await getSubscription(db, o)).subscription?.scheduledPlanId).toBeNull();
  });
});

describe("yearly plans count conversations per month", () => {
  it("a yearly customer who used everything last month starts again this month", async () => {
    const o = fresh();
    const started = new Date(Date.now() - 40 * 86_400_000);
    await applyBillingEvent(
      db,
      "dodo",
      ev({
        orgId: o,
        subscriptionId: `sub_${tag}_${randomUUID().slice(0, 6)}`,
        productId: productYearly,
        periodStart: started,
        periodEnd: new Date(started.getTime() + 365 * 86_400_000),
      }),
    );
    const sub = (await getSubscription(db, o)).subscription;
    expect(sub?.interval).toBe("yearly");
    const now = new Date();
    const current = periodStartFor(sub, now);
    const lastMonth = periodStartFor(sub, new Date(now.getTime() - 31 * 86_400_000));
    expect(lastMonth < current).toBe(true);
    // Last month: the whole allowance (the test plan allows 10) was used.
    await owner
      .insert(schema.usageCounters)
      .values({ orgId: o, periodStart: lastMonth, conversationsAnalysed: 10 });
    const fresh1 = await checkEntitlement(db, {
      orgId: o,
      threadId: randomUUID(),
      hasOwnKey: false,
      now,
    });
    expect(fresh1.decision).toMatchObject({ allowed: true, used: 0, limit: 10 });
    // This month's allowance still applies.
    await owner
      .insert(schema.usageCounters)
      .values({ orgId: o, periodStart: current, conversationsAnalysed: 10 });
    const full = await checkEntitlement(db, {
      orgId: o,
      threadId: randomUUID(),
      hasOwnKey: false,
      now,
    });
    expect(full.decision).toMatchObject({ allowed: false, reason: "over_limit" });
  });
});
