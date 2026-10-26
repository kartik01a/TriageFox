import type { schema } from "@triagefox/db";
import type { PlatformSettings } from "./settings";

export interface EntitlementPlan {
  conversationLimit: number | null;
  fairUseCap: number | null;
  inboxLimit: number | null;
  byokRequired: boolean;
}

export interface EntitlementSubscription {
  status: SubscriptionStatus;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
  compUntil: Date | null;
  pastDueSince: Date | null;
  pausedByAdmin: boolean;
}

export type BlockReason =
  | "paused"
  | "no_plan"
  | "trial_ended"
  | "trial_budget"
  | "plan_ended"
  | "payment_failed"
  | "own_key_required"
  | "over_limit";

export type Decision =
  | {
      allowed: true;
      used: number;
      limit: number | null;
      warn: "80" | "100" | null;
      fairUseExceeded: boolean;
    }
  | { allowed: false; reason: BlockReason; message: string; used: number; limit: number | null };

type SubscriptionStatus = (typeof schema.subscriptions.$inferSelect)["status"];

const DAY = 24 * 60 * 60 * 1000;

/**
 * Decides whether a workspace may have another conversation analysed. Pure: everything it needs is passed in,
 * so every rule is testable. "No surprise charges": hitting a limit blocks new conversations, it never bills more.
 */
export function evaluate(i: {
  now: Date;
  subscription: EntitlementSubscription | null;
  plan: EntitlementPlan | null;
  settings: Pick<PlatformSettings, "trial" | "grace" | "budgets">;
  /** Distinct conversations already counted in the current period. */
  used: number;
  /** This conversation already counted in the period (a follow-up never needs new room). */
  alreadyCounted: boolean;
  hasOwnKey: boolean;
  /** Platform-wide trial AI spend this month, in USD. */
  platformTrialSpendUsd: number;
}): Decision {
  const { now, subscription: s, plan, settings, used } = i;
  const block = (reason: BlockReason, message: string, limit: number | null = null): Decision => ({
    allowed: false,
    reason,
    message,
    used,
    limit,
  });
  if (!s) return block("no_plan", "Choose a plan to start analysing conversations.");
  if (s.pausedByAdmin) return block("paused", "This workspace is paused. Please contact support.");

  let limit: number | null;
  let fairCap: number | null = null;

  if (s.status === "trialing") {
    if (!s.trialEndsAt || now > s.trialEndsAt)
      return block("trial_ended", "Your free trial has ended. Choose a plan to keep going.");
    const unlimited = settings.trial.unlimitedWithOwnKey && i.hasOwnKey;
    if (!unlimited && !i.hasOwnKey && i.platformTrialSpendUsd >= settings.budgets.trialAiUsdMonthly)
      return block(
        "trial_budget",
        "Free trials on TriageFox AI are full this month. Add your own OpenAI key to continue the trial.",
      );
    limit = unlimited ? null : settings.trial.conversationCap;
  } else {
    if (!plan) return block("no_plan", "Choose a plan to start analysing conversations.");
    if (s.status === "canceled" && (!s.currentPeriodEnd || now > s.currentPeriodEnd))
      return block("plan_ended", "Your plan has ended. Choose a plan to continue.");
    if (s.status === "comped" && s.compUntil && now > s.compUntil)
      return block("plan_ended", "Your complimentary access has ended. Choose a plan to continue.");
    if (s.status === "past_due") {
      const graceMs = settings.grace.pastDueDays * DAY;
      if (s.pastDueSince && now.getTime() - s.pastDueSince.getTime() > graceMs)
        return block(
          "payment_failed",
          "Your last payment failed. Update your payment method to continue.",
        );
    }
    if (plan.byokRequired && !i.hasOwnKey)
      return block("own_key_required", "This plan needs your own OpenAI key. Add it under AI key.");
    limit = plan.conversationLimit;
    fairCap = plan.conversationLimit === null ? plan.fairUseCap : null;
  }

  if (limit !== null && !i.alreadyCounted && used >= limit)
    return block("over_limit", "You've used all your conversations for this period.", limit);

  const ratio = limit === null || limit === 0 ? 0 : (used + (i.alreadyCounted ? 0 : 1)) / limit;
  return {
    allowed: true,
    used,
    limit,
    warn: limit === null ? null : ratio >= 1 ? "100" : ratio >= 0.8 ? "80" : null,
    fairUseExceeded: fairCap !== null && used >= fairCap,
  };
}

/** The first day of the entitlement period that usage is counted in (a `YYYY-MM-DD` string, UTC). */
export function periodStartFor(
  s: { status: SubscriptionStatus; createdAt: Date; currentPeriodStart: Date | null } | null,
  now: Date,
): string {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (!s) return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  if (s.status === "trialing") return iso(s.createdAt);
  if (s.status !== "comped" && s.currentPeriodStart) return iso(s.currentPeriodStart);
  return iso(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
}
