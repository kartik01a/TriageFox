import { describe, expect, it } from "vitest";
import {
  buildSpecs,
  CORE_PLANS,
  dodoBody,
  formatAmount,
  type SeedPlan,
} from "./dodo-products-plan";

const plans: SeedPlan[] = [
  {
    slug: "starter",
    name: "Starter",
    prices: { USD: { monthly: 900, yearly: 9000 }, INR: { monthly: 69900, yearly: 699000 } },
  },
  { slug: "pro-own-key", name: "Pro, own key", prices: { USD: { monthly: 1200, yearly: 12000 } } },
];

describe("dodo product planning", () => {
  it("makes one product per plan, currency and interval", () => {
    const specs = buildSpecs(plans, CORE_PLANS);
    expect(specs.map((s) => s.name)).toEqual([
      "TriageFox Starter - monthly - USD",
      "TriageFox Starter - yearly - USD",
      "TriageFox Starter - monthly - INR",
      "TriageFox Starter - yearly - INR",
    ]);
    expect(buildSpecs(plans, "all")).toHaveLength(6);
  });

  it("builds a renew-until-cancelled subscription with no Dodo trial", () => {
    const [monthly, yearly] = buildSpecs(plans, ["starter"]);
    const body = dodoBody(monthly as NonNullable<typeof monthly>);
    expect(body.price).toMatchObject({
      type: "recurring_price",
      currency: "USD",
      price: 900,
      payment_frequency_interval: "Month",
      trial_period_days: 0,
      tax_inclusive: false,
    });
    expect(dodoBody(yearly as NonNullable<typeof yearly>).price.payment_frequency_interval).toBe(
      "Year",
    );
  });

  it("prints amounts the way a person reads them", () => {
    expect(formatAmount("USD", 900)).toBe("$9");
    expect(formatAmount("INR", 699000)).toBe("₹6,990");
  });
});
