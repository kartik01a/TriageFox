import { createHmac } from "node:crypto";
import { DodoProvider } from "./dodo";
import type { BillingProvider, NormalizedEvent } from "./provider";

/**
 * A stand-in for tests and local work: checkout and portal links point back at a path we can assert on, and
 * webhooks are signed exactly like Dodo's, so the real verification code runs in tests.
 */
export class FakeProvider implements BillingProvider {
  readonly name = "fake";
  readonly checkouts: Parameters<BillingProvider["createCheckout"]>[0][] = [];
  readonly secret = "whsec_dGVzdC1zZWNyZXQtZm9yLXRoZS1mYWtlLXByb3ZpZGVy"; // not a real secret
  private readonly inner = new DodoProvider({ apiKey: "x", webhookKey: this.secret, mode: "test" });

  async createCheckout(i: Parameters<BillingProvider["createCheckout"]>[0]) {
    this.checkouts.push(i);
    return { url: `https://checkout.example.test/${i.productId}?org=${i.orgId}` };
  }
  async createPortalSession(i: Parameters<BillingProvider["createPortalSession"]>[0]) {
    return { url: `https://portal.example.test/${i.customerId}` };
  }
  parseWebhook(headers: Headers, rawBody: string, now?: Date): NormalizedEvent {
    return this.inner.parseWebhook(headers, rawBody, now);
  }

  /** Builds a correctly signed webhook request (headers + body) for the given event. */
  sign(event: { id: string; type: string; data: Record<string, unknown> }, at = new Date()) {
    const body = JSON.stringify({
      type: event.type,
      timestamp: at.toISOString(),
      data: event.data,
    });
    const ts = String(Math.floor(at.getTime() / 1000));
    const key = Buffer.from(this.secret.slice(6), "base64");
    const sig = createHmac("sha256", key).update(`${event.id}.${ts}.${body}`).digest("base64");
    return {
      body,
      headers: new Headers({
        "webhook-id": event.id,
        "webhook-timestamp": ts,
        "webhook-signature": `v1,${sig}`,
      }),
    };
  }
}
