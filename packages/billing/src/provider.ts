import type { ChangeRequest } from "./plan-change";

/** What every payment provider adapter offers. Dodo today; Lemon Squeezy (the backup) would implement the same. */
export interface BillingProvider {
  readonly name: string;
  createCheckout(input: {
    orgId: string;
    email: string;
    name: string;
    productId: string;
    currency: "USD" | "INR";
    country?: string;
    returnUrl: string;
  }): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  /** What changing an existing subscription would charge today (ADR 0015). */
  previewPlanChange(input: PlanChangeInput): Promise<PlanChangePreview>;
  /** Changes an existing subscription. Replaces any scheduled change. Charges the saved payment method. */
  changePlan(input: PlanChangeInput): Promise<void>;
  /** Cancels a change scheduled for the next billing date. Nothing scheduled is not an error. */
  cancelScheduledPlanChange(subscriptionId: string): Promise<void>;
  /** Verifies the signature and timestamp and returns the event; throws WebhookError when it is not genuine. */
  parseWebhook(headers: Headers, rawBody: string, now?: Date): NormalizedEvent;
}

export interface PlanChangeInput {
  subscriptionId: string;
  productId: string;
  request: ChangeRequest;
}

export interface PlanChangePreview {
  /** Charged today, in the smallest unit of `currency` (0 for a change at the next billing date). */
  amount: number;
  currency: string;
}

export class WebhookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookError";
  }
}

export class ProviderRequestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "ProviderRequestError";
  }
}

export type NormalizedEventType =
  | "subscription_active" // created, activated, renewed or changed: sync everything
  | "subscription_past_due"
  | "subscription_cancelled" // will end at the period end (or already has)
  | "subscription_ended"
  | "payment_succeeded"
  | "payment_failed"
  | "ignored";

export interface NormalizedEvent {
  /** The provider's unique event id (repeat deliveries are ignored on it). */
  id: string;
  type: NormalizedEventType;
  rawType: string;
  /** Our workspace id, when the provider echoed the metadata we sent. */
  orgId?: string;
  subscriptionId?: string;
  customerId?: string;
  customerEmail?: string;
  productId?: string;
  periodStart?: Date;
  periodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}
