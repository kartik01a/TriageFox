import { createHmac, timingSafeEqual } from "node:crypto";
import {
  type BillingProvider,
  type NormalizedEvent,
  type NormalizedEventType,
  type PlanChangeInput,
  type PlanChangePreview,
  ProviderRequestError,
  WebhookError,
} from "./provider";

const BASES = {
  test: "https://test.dodopayments.com",
  live: "https://live.dodopayments.com",
} as const;
const TOLERANCE_MS = 5 * 60 * 1000;

const str = (v: unknown) => (typeof v === "string" && v ? v : undefined);
const date = (v: unknown) => {
  const d = typeof v === "string" ? new Date(v) : undefined;
  return d && !Number.isNaN(d.getTime()) ? d : undefined;
};

/** Maps Dodo's event names onto ours. Anything unknown is ignored, never guessed at. */
const TYPES: Record<string, NormalizedEventType> = {
  "subscription.active": "subscription_active",
  "subscription.renewed": "subscription_active",
  "subscription.updated": "subscription_active",
  "subscription.plan_changed": "subscription_active",
  "subscription.unpaused": "subscription_active",
  "subscription.on_hold": "subscription_past_due",
  "subscription.past_due": "subscription_past_due",
  "subscription.failed": "subscription_past_due",
  "subscription.cancelled": "subscription_cancelled",
  "subscription.expired": "subscription_ended",
  "payment.succeeded": "payment_succeeded",
  "payment.failed": "payment_failed",
};

/**
 * Dodo Payments (merchant of record). Webhooks follow the Standard Webhooks scheme: the signature is an
 * HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{raw body}` with a `whsec_` secret, and the header can
 * carry several `v1,<base64>` entries. Field names of the payloads are read defensively and are to be checked
 * once against test mode (docs/billing.md).
 */
export class DodoProvider implements BillingProvider {
  readonly name = "dodo";
  constructor(
    private readonly opts: {
      apiKey: string;
      webhookKey: string;
      mode: "test" | "live";
      fetch?: typeof fetch;
    },
  ) {}

  private async call<T>(path: string, body: unknown, method = "POST"): Promise<T> {
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${BASES[this.opts.mode]}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20_000),
      });
    } catch {
      throw new ProviderRequestError("The payment provider could not be reached.");
    }
    if (!res.ok)
      throw new ProviderRequestError(`The payment provider answered ${res.status}.`, res.status);
    if (res.status === 204) return undefined as T;
    return (await res.json().catch(() => ({}))) as T;
  }

  private changeBody(i: PlanChangeInput) {
    return {
      product_id: i.productId,
      quantity: 1,
      proration_billing_mode: i.request.prorationMode,
      effective_at: i.request.effectiveAt,
      // A failed charge leaves the customer on their current plan instead of half-changing it.
      on_payment_failure: "prevent_change",
      // A new choice replaces any change that was scheduled before.
      cancel_scheduled_change_plan: true,
    };
  }

  async previewPlanChange(i: PlanChangeInput): Promise<PlanChangePreview> {
    const out = await this.call<{
      immediate_charge?: { summary?: { total_amount?: number; currency?: string } };
      new_plan?: { currency?: string };
    }>(
      `/subscriptions/${encodeURIComponent(i.subscriptionId)}/change-plan/preview`,
      this.changeBody(i),
    );
    const summary = out.immediate_charge?.summary;
    return {
      amount: typeof summary?.total_amount === "number" ? summary.total_amount : 0,
      currency: summary?.currency ?? out.new_plan?.currency ?? "",
    };
  }

  async changePlan(i: PlanChangeInput): Promise<void> {
    await this.call(
      `/subscriptions/${encodeURIComponent(i.subscriptionId)}/change-plan`,
      this.changeBody(i),
    );
  }

  async cancelScheduledPlanChange(subscriptionId: string): Promise<void> {
    try {
      await this.call(
        `/subscriptions/${encodeURIComponent(subscriptionId)}/change-plan/scheduled`,
        undefined,
        "DELETE",
      );
    } catch (err) {
      if (err instanceof ProviderRequestError && err.status === 404) return; // nothing was scheduled
      throw err;
    }
  }

  async createCheckout(i: Parameters<BillingProvider["createCheckout"]>[0]) {
    const out = await this.call<{ checkout_url?: string }>("/checkouts", {
      product_cart: [{ product_id: i.productId, quantity: 1 }],
      customer: { email: i.email, name: i.name },
      billing_currency: i.currency,
      ...(i.country ? { billing_address: { country: i.country } } : {}),
      return_url: i.returnUrl,
      // Echoed back on the subscription and payment webhooks, so we know which workspace paid.
      metadata: { org_id: i.orgId },
    });
    if (!out.checkout_url)
      throw new ProviderRequestError("The payment provider returned no checkout link.");
    return { url: out.checkout_url };
  }

  async createPortalSession(i: Parameters<BillingProvider["createPortalSession"]>[0]) {
    const out = await this.call<{ link?: string }>(
      `/customers/${encodeURIComponent(i.customerId)}/customer-portal/session`,
      { return_url: i.returnUrl },
    );
    if (!out.link) throw new ProviderRequestError("The payment provider returned no portal link.");
    return { url: out.link };
  }

  parseWebhook(headers: Headers, rawBody: string, now = new Date()): NormalizedEvent {
    const id = headers.get("webhook-id");
    const ts = headers.get("webhook-timestamp");
    const sigHeader = headers.get("webhook-signature");
    if (!id || !ts || !sigHeader) throw new WebhookError("Missing signature headers");
    const seconds = Number(ts);
    if (!Number.isFinite(seconds) || Math.abs(now.getTime() - seconds * 1000) > TOLERANCE_MS)
      throw new WebhookError("Timestamp outside the allowed window");

    const secret = this.opts.webhookKey.startsWith("whsec_")
      ? Buffer.from(this.opts.webhookKey.slice(6), "base64")
      : Buffer.from(this.opts.webhookKey);
    const expected = createHmac("sha256", secret).update(`${id}.${ts}.${rawBody}`).digest();
    const ok = sigHeader.split(" ").some((part) => {
      const [version, sig] = part.split(",");
      if (version !== "v1" || !sig) return false;
      const given = Buffer.from(sig, "base64");
      return given.length === expected.length && timingSafeEqual(given, expected);
    });
    if (!ok) throw new WebhookError("Signature does not match");

    let payload: { type?: unknown; data?: Record<string, unknown> };
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new WebhookError("Body is not JSON");
    }
    const rawType = str(payload.type) ?? "";
    const data = payload.data ?? {};
    const customer = (data.customer ?? {}) as Record<string, unknown>;
    const metadata = (data.metadata ?? {}) as Record<string, unknown>;
    const periodEnd = date(data.next_billing_date) ?? date(data.expires_at);
    return {
      id,
      type: TYPES[rawType] ?? "ignored",
      rawType,
      orgId: str(metadata.org_id),
      subscriptionId: str(data.subscription_id),
      customerId: str(customer.customer_id) ?? str(data.customer_id),
      customerEmail: str(customer.email),
      productId: str(data.product_id),
      periodStart: date(data.previous_billing_date),
      periodEnd,
      cancelAtPeriodEnd:
        data.cancel_at_next_billing_date === true || rawType === "subscription.cancelled",
    };
  }
}
