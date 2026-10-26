import { describe, expect, it } from "vitest";
import {
  type EntitlementPlan,
  type EntitlementSubscription,
  evaluate,
  periodStartFor,
} from "./entitlement";
import { defaultPlatformSettings as S } from "./settings";

const now = new Date("2026-11-10T12:00:00Z");
const day = 86_400_000;
const plan = (over: Partial<EntitlementPlan> = {}): EntitlementPlan => ({
  conversationLimit: 300,
  fairUseCap: null,
  inboxLimit: 1,
  byokRequired: false,
  ...over,
});
const sub = (over: Partial<EntitlementSubscription> = {}): EntitlementSubscription => ({
  status: "active",
  trialEndsAt: null,
  currentPeriodEnd: new Date(now.getTime() + 10 * day),
  compUntil: null,
  pastDueSince: null,
  pausedByAdmin: false,
  ...over,
});
const base = {
  now,
  settings: S,
  used: 0,
  alreadyCounted: false,
  hasOwnKey: false,
  platformTrialSpendUsd: 0,
};
const run = (
  o: Partial<Parameters<typeof evaluate>[0]> & { subscription: EntitlementSubscription | null },
) => evaluate({ ...base, plan: plan(), ...o });

describe("trial", () => {
  const trial = (over: Partial<EntitlementSubscription> = {}) =>
    sub({
      status: "trialing",
      trialEndsAt: new Date(now.getTime() + 5 * day),
      currentPeriodEnd: null,
      ...over,
    });
  it("allows up to the trial cap, then blocks new conversations", () => {
    expect(run({ subscription: trial(), plan: null, used: 49 })).toMatchObject({
      allowed: true,
      limit: 50,
    });
    expect(run({ subscription: trial(), plan: null, used: 50 })).toMatchObject({
      allowed: false,
      reason: "over_limit",
    });
  });
  it("a conversation that already counted can always continue", () => {
    expect(
      run({ subscription: trial(), plan: null, used: 50, alreadyCounted: true }),
    ).toMatchObject({ allowed: true });
  });
  it("is unlimited with the workspace's own key (a setting)", () => {
    expect(run({ subscription: trial(), plan: null, used: 5000, hasOwnKey: true })).toMatchObject({
      allowed: true,
      limit: null,
    });
    const off = { ...S, trial: { ...S.trial, unlimitedWithOwnKey: false } };
    expect(
      run({ subscription: trial(), plan: null, used: 50, hasOwnKey: true, settings: off }),
    ).toMatchObject({ allowed: false });
  });
  it("ends when the days run out", () => {
    expect(
      run({ subscription: trial({ trialEndsAt: new Date(now.getTime() - 1000) }), plan: null }),
    ).toMatchObject({ allowed: false, reason: "trial_ended" });
  });
  it("new trials need their own key once the platform's trial AI budget is spent", () => {
    expect(run({ subscription: trial(), plan: null, platformTrialSpendUsd: 10 })).toMatchObject({
      allowed: false,
      reason: "trial_budget",
    });
    expect(
      run({ subscription: trial(), plan: null, platformTrialSpendUsd: 10, hasOwnKey: true }),
    ).toMatchObject({ allowed: true });
  });
});

describe("paid plans", () => {
  it("warns at 80% and 100%, blocks above, and never bills more", () => {
    expect(run({ subscription: sub(), used: 100 })).toMatchObject({ allowed: true, warn: null });
    expect(run({ subscription: sub(), used: 239 })).toMatchObject({ allowed: true, warn: "80" });
    expect(run({ subscription: sub(), used: 299 })).toMatchObject({ allowed: true, warn: "100" });
    expect(run({ subscription: sub(), used: 300 })).toMatchObject({
      allowed: false,
      reason: "over_limit",
      limit: 300,
    });
  });
  it("unlimited plans are never blocked by volume; the fair-use ceiling is only flagged", () => {
    const p = plan({ conversationLimit: null, fairUseCap: 50_000 });
    expect(run({ subscription: sub(), plan: p, used: 49_999 })).toMatchObject({
      allowed: true,
      fairUseExceeded: false,
    });
    expect(run({ subscription: sub(), plan: p, used: 60_000 })).toMatchObject({
      allowed: true,
      fairUseExceeded: true,
    });
  });
  it("own-key plans need the key", () => {
    const p = plan({ byokRequired: true });
    expect(run({ subscription: sub(), plan: p })).toMatchObject({
      allowed: false,
      reason: "own_key_required",
    });
    expect(run({ subscription: sub(), plan: p, hasOwnKey: true })).toMatchObject({ allowed: true });
  });
  it("past due keeps working during the grace period, then stops", () => {
    expect(
      run({
        subscription: sub({ status: "past_due", pastDueSince: new Date(now.getTime() - 3 * day) }),
      }),
    ).toMatchObject({ allowed: true });
    expect(
      run({
        subscription: sub({ status: "past_due", pastDueSince: new Date(now.getTime() - 8 * day) }),
      }),
    ).toMatchObject({ allowed: false, reason: "payment_failed" });
  });
  it("cancelled plans last until the paid period ends", () => {
    expect(run({ subscription: sub({ status: "canceled" }) })).toMatchObject({ allowed: true });
    expect(
      run({
        subscription: sub({ status: "canceled", currentPeriodEnd: new Date(now.getTime() - 1000) }),
      }),
    ).toMatchObject({ allowed: false, reason: "plan_ended" });
  });
  it("free access (comp) honours its end date and still has limits", () => {
    expect(
      run({ subscription: sub({ status: "comped", compUntil: null }), used: 300 }),
    ).toMatchObject({ allowed: false, reason: "over_limit" });
    expect(
      run({ subscription: sub({ status: "comped", compUntil: new Date(now.getTime() - 1000) }) }),
    ).toMatchObject({ allowed: false, reason: "plan_ended" });
  });
  it("a paused workspace and a workspace with no plan are blocked", () => {
    expect(run({ subscription: sub({ pausedByAdmin: true }) })).toMatchObject({
      allowed: false,
      reason: "paused",
    });
    expect(run({ subscription: null })).toMatchObject({ allowed: false, reason: "no_plan" });
    expect(run({ subscription: sub(), plan: null })).toMatchObject({
      allowed: false,
      reason: "no_plan",
    });
  });
});

describe("period", () => {
  it("counts from the trial start, the billing period, or the calendar month", () => {
    const created = new Date("2026-11-03T08:00:00Z");
    expect(
      periodStartFor({ status: "trialing", createdAt: created, currentPeriodStart: null }, now),
    ).toBe("2026-11-03");
    expect(
      periodStartFor(
        {
          status: "active",
          createdAt: created,
          currentPeriodStart: new Date("2026-11-07T00:00:00Z"),
        },
        now,
      ),
    ).toBe("2026-11-07");
    expect(
      periodStartFor(
        {
          status: "comped",
          createdAt: created,
          currentPeriodStart: new Date("2026-10-01T00:00:00Z"),
        },
        now,
      ),
    ).toBe("2026-11-01");
    expect(periodStartFor(null, now)).toBe("2026-11-01");
  });
});
