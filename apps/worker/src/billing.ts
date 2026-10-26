import { checkEntitlement, type Decision, recordUsage } from "@triagefox/billing";
import type { Db } from "@triagefox/db";
import type { Notifier } from "./notify";

const BLOCK_TITLES: Record<string, string> = {
  over_limit: "You've used all your conversations",
  trial_ended: "Your free trial has ended",
  trial_budget: "Free trials on TriageFox AI are full this month",
  plan_ended: "Your plan has ended",
  payment_failed: "Your last payment failed",
  own_key_required: "Your plan needs your own OpenAI key",
  no_plan: "Choose a plan",
  paused: "Your workspace is paused",
};

/** What the pipeline asks of billing: may this conversation be analysed, and then: count it. Hosted only. */
export interface BillingHooks {
  check(i: { orgId: string; threadId: string; hasOwnKey: boolean }): Promise<{
    decision: Decision;
    periodStart: string;
    trialing: boolean;
  }>;
  after(i: {
    orgId: string;
    threadId: string;
    periodStart: string;
    trialing: boolean;
    usingPlatformKey: boolean;
    costMicroUsd: number;
    ticketsCreated: number;
    limit: number | null;
  }): Promise<void>;
}

export function createBillingHooks(deps: { db: Db; notifier: Notifier }): BillingHooks {
  return {
    check: (i) => checkEntitlement(deps.db, i),
    async after(i) {
      const { crossed, used } = await recordUsage(deps.db, i);
      if (!crossed || i.limit === null) return;
      await deps.notifier.emailOwners(i.orgId, {
        subject:
          crossed === "100"
            ? "You've reached your TriageFox limit"
            : "You've used 80% of your TriageFox conversations",
        heading:
          crossed === "100" ? "You've reached your limit" : "You've used 80% of your conversations",
        body:
          crossed === "100"
            ? `TriageFox has analysed ${used} of ${i.limit} conversations this period. New conversations will wait until the next period, or until you upgrade or add your own OpenAI key. You won't be charged extra.`
            : `TriageFox has analysed ${used} of ${i.limit} conversations this period. When you reach the limit, new conversations wait until the next period (you won't be charged extra). You can upgrade or add your own OpenAI key any time.`,
        cta: { label: "See your plan", path: "/app/billing" },
      });
    },
  };
}

export const blockTitle = (reason: string) => BLOCK_TITLES[reason] ?? "Analysis paused";
