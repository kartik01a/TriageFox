import { PRIORITY_NAMES } from "@triagefox/shared";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { formatPrice } from "@/lib/billing";
import { cn } from "@/lib/cn";

export interface PlanView {
  id: string;
  name: string;
  prices: Record<string, { monthly: number; yearly: number }>;
  conversationLimit: number | null;
  fairUseCap: number | null;
  inboxLimit: number | null;
  byokRequired: boolean;
  supportLevel: string;
  isPopular: boolean;
  /** Available to buy in the chosen currency and interval. */
  buyable: boolean;
}

const n = (v: number) => v.toLocaleString("en-US");

/** A plan card. `action` is the call to action: a link (public page) or a button (billing page). */
export function PlanCard({
  plan,
  currency,
  interval,
  action,
  current,
}: {
  plan: PlanView;
  currency: string;
  interval: "monthly" | "yearly";
  action: React.ReactNode;
  current?: boolean;
}) {
  const price = plan.prices[currency];
  const monthlyEquivalent = price
    ? interval === "yearly"
      ? price.yearly / 12
      : price.monthly
    : null;
  return (
    <Card
      className={cn(
        "flex flex-col gap-4",
        plan.isPopular && "border-primary ring-1 ring-primary/30",
      )}
      role="article"
      aria-label={plan.name}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{plan.name}</h3>
        {plan.isPopular && (
          <span className="rounded-full bg-primary px-2.5 py-0.5 text-xs font-semibold text-primary-foreground">
            Most popular
          </span>
        )}
        {current && (
          <span className="rounded-full bg-success/15 px-2.5 py-0.5 text-xs font-semibold text-success">
            Current plan
          </span>
        )}
      </div>
      <div>
        {price ? (
          <>
            <p className="text-3xl font-bold tabular-nums">
              {formatPrice(Math.round(monthlyEquivalent ?? 0), currency)}
              <span className="text-sm font-normal text-muted-foreground"> / month</span>
            </p>
            <p className="text-sm text-muted-foreground">
              {interval === "yearly"
                ? `${formatPrice(price.yearly, currency)} billed yearly`
                : "billed monthly"}
            </p>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">Not available in {currency}.</p>
        )}
      </div>
      <ul className="flex-1 space-y-1.5 text-sm">
        <li>
          {plan.conversationLimit === null
            ? "Unlimited conversations (fair use)"
            : `${n(plan.conversationLimit)} conversations a month`}
        </li>
        <li>
          {plan.inboxLimit === null
            ? "Unlimited connected inboxes"
            : `${plan.inboxLimit} connected ${plan.inboxLimit === 1 ? "inbox" : "inboxes"}`}
        </li>
        <li>Every feature included</li>
        <li>{plan.supportLevel === "priority" ? "Priority email support" : "Email support"}</li>
        {plan.byokRequired && <li>Uses your own OpenAI key</li>}
      </ul>
      {action}
    </Card>
  );
}

export function IntervalAndCurrencySwitch({
  base,
  interval,
  currency,
}: {
  base: string;
  interval: "monthly" | "yearly";
  currency: string;
}) {
  const pill = (active: boolean) =>
    cn(
      "rounded-full px-4 py-1.5 text-sm font-medium",
      active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
    );
  const href = (i: string, c: string) => `${base}?interval=${i}&currency=${c}`;
  return (
    <div className="flex flex-wrap items-center gap-4">
      <nav
        aria-label="Billing interval"
        className="inline-flex rounded-full border border-border p-1"
      >
        <Link href={href("yearly", currency)} className={pill(interval === "yearly")}>
          Yearly <span className="text-xs opacity-80">2 months free</span>
        </Link>
        <Link href={href("monthly", currency)} className={pill(interval === "monthly")}>
          Monthly
        </Link>
      </nav>
      <nav aria-label="Currency" className="inline-flex rounded-full border border-border p-1">
        {(["USD", "INR"] as const).map((c) => (
          <Link key={c} href={href(interval, c)} className={pill(currency === c)}>
            {c === "USD" ? "$ USD" : "₹ INR"}
          </Link>
        ))}
      </nav>
    </div>
  );
}

export { buttonVariants, PRIORITY_NAMES };
