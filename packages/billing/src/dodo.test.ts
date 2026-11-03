import { describe, expect, it } from "vitest";
import { DodoProvider } from "./dodo";
import { FakeProvider } from "./fake";
import { WebhookError } from "./provider";

const fake = new FakeProvider();
const dodo = new DodoProvider({ apiKey: "k", webhookKey: fake.secret, mode: "test" });
const event = (type: string, data: Record<string, unknown> = {}) => ({
  id: `evt_${type}`,
  type,
  data,
});

describe("webhook verification", () => {
  it("accepts a correctly signed event and normalises it", () => {
    const { body, headers } = fake.sign(
      event("subscription.active", {
        subscription_id: "sub_1",
        customer: { customer_id: "cus_1", email: "a@b.c" },
        product_id: "pdt_1",
        metadata: { org_id: "org_1" },
        previous_billing_date: "2026-11-01T00:00:00Z",
        next_billing_date: "2026-12-01T00:00:00Z",
      }),
    );
    const e = dodo.parseWebhook(headers, body);
    expect(e).toMatchObject({
      type: "subscription_active",
      orgId: "org_1",
      subscriptionId: "sub_1",
      customerId: "cus_1",
      productId: "pdt_1",
    });
    expect(e.periodEnd?.toISOString()).toBe("2026-12-01T00:00:00.000Z");
  });
  it("rejects a tampered body, a wrong secret, missing headers and a stale timestamp", () => {
    const { body, headers } = fake.sign(event("subscription.active"));
    expect(() => dodo.parseWebhook(headers, `${body} `)).toThrow(WebhookError);
    const other = new DodoProvider({ apiKey: "k", webhookKey: "whsec_b3RoZXI=", mode: "test" });
    expect(() => other.parseWebhook(headers, body)).toThrow(WebhookError);
    expect(() => dodo.parseWebhook(new Headers(), body)).toThrow(WebhookError);
    const old = fake.sign(event("subscription.active"), new Date(Date.now() - 10 * 60_000));
    expect(() => dodo.parseWebhook(old.headers, old.body)).toThrow(/Timestamp/);
  });
  it("accepts one good signature among several", () => {
    const { body, headers } = fake.sign(event("payment.succeeded", { subscription_id: "s" }));
    headers.set("webhook-signature", `v1,AAAA ${headers.get("webhook-signature")}`);
    expect(dodo.parseWebhook(headers, body).type).toBe("payment_succeeded");
  });
  it("maps event names, and ignores unknown ones instead of guessing", () => {
    const type = (t: string) => {
      const { body, headers } = fake.sign(event(t));
      return dodo.parseWebhook(headers, body).type;
    };
    expect(type("subscription.renewed")).toBe("subscription_active");
    expect(type("subscription.on_hold")).toBe("subscription_past_due");
    expect(type("subscription.cancelled")).toBe("subscription_cancelled");
    expect(type("subscription.expired")).toBe("subscription_ended");
    expect(type("payment.failed")).toBe("payment_failed");
    expect(type("refund.succeeded")).toBe("ignored");
  });

  it("an 'updated' message sent right after a cancellation does not undo it", () => {
    const parse = (t: string, data: Record<string, unknown>) => {
      const { body, headers } = fake.sign(event(t, data));
      return dodo.parseWebhook(headers, body);
    };
    // Cancelled for the end of the period: still active, with the flag set.
    expect(
      parse("subscription.updated", { status: "active", cancel_at_next_billing_date: true }),
    ).toMatchObject({ type: "subscription_cancelled", cancelAtPeriodEnd: true });
    expect(parse("subscription.updated", { status: "cancelled" }).type).toBe(
      "subscription_cancelled",
    );
    expect(parse("subscription.renewed", { status: "expired" }).type).toBe("subscription_ended");
    // An ordinary update stays an update.
    expect(
      parse("subscription.updated", { status: "active", cancel_at_next_billing_date: false }).type,
    ).toBe("subscription_active");
  });
});

describe("API calls", () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(
      JSON.stringify(
        url.endsWith("/checkouts")
          ? { checkout_url: "https://pay.example/x" }
          : { link: "https://portal.example/y" },
      ),
    );
  }) as unknown as typeof fetch;
  const live = new DodoProvider({
    apiKey: "sk_live",
    webhookKey: fake.secret,
    mode: "live",
    fetch: f,
  });
  it("creates a checkout that carries the workspace id, in the chosen currency", async () => {
    const out = await live.createCheckout({
      orgId: "org_1",
      email: "a@b.c",
      name: "A",
      productId: "pdt_9",
      currency: "INR",
      country: "IN",
      returnUrl: "https://app/ok",
    });
    expect(out.url).toBe("https://pay.example/x");
    const call = calls[0];
    expect(call?.url).toBe("https://live.dodopayments.com/checkouts");
    expect(((call?.init.headers ?? {}) as Record<string, string>).authorization).toBe(
      "Bearer sk_live",
    );
    expect(JSON.parse(String(call?.init.body))).toMatchObject({
      product_cart: [{ product_id: "pdt_9", quantity: 1 }],
      billing_currency: "INR",
      billing_address: { country: "IN" },
      metadata: { org_id: "org_1" },
    });
  });
  it("opens the customer portal", async () => {
    expect(
      (await live.createPortalSession({ customerId: "cus_1", returnUrl: "https://app/billing" }))
        .url,
    ).toBe("https://portal.example/y");
    expect(calls[1]?.url).toBe(
      "https://live.dodopayments.com/customers/cus_1/customer-portal/session",
    );
  });
});

describe("plan changes against Dodo's API (ADR 0015)", () => {
  type Call = { url: string; method: string; body: Record<string, unknown> | null };
  const recorder = (respond: (c: Call) => Response) => {
    const calls: Call[] = [];
    const f = (async (url: string, init: RequestInit) => {
      const c = {
        url,
        method: init.method ?? "GET",
        body: init.body ? JSON.parse(String(init.body)) : null,
      };
      calls.push(c);
      return respond(c);
    }) as unknown as typeof fetch;
    return {
      calls,
      provider: new DodoProvider({ apiKey: "k", webhookKey: fake.secret, mode: "test", fetch: f }),
    };
  };
  const input = {
    subscriptionId: "sub_1",
    productId: "pdt_pro_m",
    request: {
      prorationMode: "prorated_immediately_keep_cycle" as const,
      effectiveAt: "immediately" as const,
    },
  };

  it("previews and changes with the same request: no half-changes, a new choice replaces a scheduled one", async () => {
    const { calls, provider } = recorder(
      (c) =>
        new Response(
          JSON.stringify(
            c.url.endsWith("/preview")
              ? { immediate_charge: { summary: { total_amount: 1500, currency: "USD" } } }
              : { payment_id: "pay_1" },
          ),
        ),
    );
    expect(await provider.previewPlanChange(input)).toEqual({ amount: 1500, currency: "USD" });
    await provider.changePlan(input);
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["POST", "https://test.dodopayments.com/subscriptions/sub_1/change-plan/preview"],
      ["POST", "https://test.dodopayments.com/subscriptions/sub_1/change-plan"],
    ]);
    for (const c of calls)
      expect(c.body).toEqual({
        product_id: "pdt_pro_m",
        quantity: 1,
        proration_billing_mode: "prorated_immediately_keep_cycle",
        effective_at: "immediately",
        on_payment_failure: "prevent_change",
        cancel_scheduled_change_plan: true,
      });
  });

  it("cancels a scheduled change; nothing scheduled (404) is fine, other failures are not", async () => {
    const ok = recorder(() => new Response(null, { status: 204 }));
    await ok.provider.cancelScheduledPlanChange("sub_1");
    expect(ok.calls[0]).toMatchObject({
      method: "DELETE",
      url: "https://test.dodopayments.com/subscriptions/sub_1/change-plan/scheduled",
      body: null,
    });
    const none = recorder(() => new Response("{}", { status: 404 }));
    await expect(none.provider.cancelScheduledPlanChange("sub_1")).resolves.toBeUndefined();
    const down = recorder(() => new Response("{}", { status: 503 }));
    await expect(down.provider.cancelScheduledPlanChange("sub_1")).rejects.toThrow();
  });
});
