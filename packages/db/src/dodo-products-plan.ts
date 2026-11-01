/** Pure planning for scripts/dodo-products: which Dodo products a set of plans needs. No network, no database. */

export interface SeedPlan {
  slug: string;
  name: string;
  prices: Record<string, { monthly: number; yearly: number }>;
}

export type Interval = "monthly" | "yearly";

export interface ProductSpec {
  slug: string;
  currency: string;
  interval: Interval;
  /** Smallest currency unit (cents, paise). */
  amount: number;
  name: string;
}

/** The plans a first test run covers: the three main ones. `--all` adds the own-key plans. */
export const CORE_PLANS = ["starter", "pro", "business"];

export function productName(plan: Pick<SeedPlan, "name">, interval: Interval, currency: string) {
  return `TriageFox ${plan.name} - ${interval} - ${currency}`;
}

export function buildSpecs(plans: SeedPlan[], only: string[] | "all"): ProductSpec[] {
  const chosen = only === "all" ? plans : plans.filter((p) => only.includes(p.slug));
  const specs: ProductSpec[] = [];
  for (const plan of chosen)
    for (const [currency, p] of Object.entries(plan.prices))
      for (const interval of ["monthly", "yearly"] as const)
        specs.push({
          slug: plan.slug,
          currency,
          interval,
          amount: p[interval],
          name: productName(plan, interval, currency),
        });
  return specs;
}

/** The body Dodo's POST /products expects for a subscription that renews until cancelled. */
export function dodoBody(spec: ProductSpec) {
  return {
    name: spec.name,
    tax_category: "saas",
    metadata: { plan_slug: spec.slug, interval: spec.interval, currency: spec.currency },
    price: {
      type: "recurring_price",
      currency: spec.currency,
      price: spec.amount,
      payment_frequency_count: 1,
      payment_frequency_interval: spec.interval === "monthly" ? "Month" : "Year",
      // Dodo's documented way to say "until cancelled" (20 years is its maximum).
      subscription_period_count: 20,
      subscription_period_interval: "Year",
      // Our own 7-day trial runs in the app with no card, so Dodo must not add one.
      trial_period_days: 0,
      // Prices are shown without tax; Dodo adds the customer's tax on top.
      tax_inclusive: false,
    },
  };
}

export function formatAmount(currency: string, amount: number) {
  const symbol = currency === "USD" ? "$" : currency === "INR" ? "₹" : `${currency} `;
  return `${symbol}${(amount / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}
