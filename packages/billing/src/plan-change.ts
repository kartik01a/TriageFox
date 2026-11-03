/**
 * Plan changes for a workspace that already pays (ADR 0015). Pure: decides when a change takes effect and
 * how the provider bills it.
 */

export type Interval = "monthly" | "yearly";

export interface PlanChoice {
  planId: string;
  interval: Interval;
  /** The plan's monthly list price in the subscription's currency (smallest unit): its size. */
  monthlyPrice: number;
}

export type ChangeKind = "same" | "now" | "at_renewal";

/** What the provider is asked to do (Dodo's change-plan request). */
export interface ChangeRequest {
  prorationMode: "prorated_immediately_keep_cycle" | "prorated_immediately" | "full_immediately";
  effectiveAt: "immediately" | "next_billing_date";
}

/**
 * A bigger plan, or switching to yearly, happens now: the customer pays the difference and gets the
 * new limit straight away. A smaller plan, or switching to monthly, happens at the next billing date, so
 * they keep what they paid for until then.
 */
export function changeKind(current: PlanChoice, target: PlanChoice): ChangeKind {
  if (current.planId === target.planId && current.interval === target.interval) return "same";
  if (target.monthlyPrice !== current.monthlyPrice)
    return target.monthlyPrice > current.monthlyPrice ? "now" : "at_renewal";
  return target.interval === "yearly" ? "now" : "at_renewal";
}

/**
 * - Now, same billing period: charge only the difference for the days left; the renewal date stays.
 * - Now, different billing period: credit the unused time and start the new period today (a cycle
 *   cannot be kept across intervals).
 * - At renewal: nothing today; the next renewal is the new plan at its full price.
 */
export function changeRequest(current: PlanChoice, target: PlanChoice): ChangeRequest | null {
  const kind = changeKind(current, target);
  if (kind === "same") return null;
  if (kind === "at_renewal")
    return { prorationMode: "full_immediately", effectiveAt: "next_billing_date" };
  return current.interval === target.interval
    ? { prorationMode: "prorated_immediately_keep_cycle", effectiveAt: "immediately" }
    : { prorationMode: "prorated_immediately", effectiveAt: "immediately" };
}
