import { changeKind, listPlans } from "@triagefox/billing";
import { eq, schema, withOrg } from "@triagefox/db";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { IntervalAndCurrencySwitch, PlanCard } from "@/components/pricing-grid";
import { Card } from "@/components/ui/card";
import {
  BLOCKED_NOTE,
  billingEnabled,
  billingProvider,
  currencyFor,
  workspaceBilling,
} from "@/lib/billing";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";
import {
  ChangePlanButton,
  ChooseButton,
  KeepPlanButton,
  PortalButton,
  RedeemForm,
} from "./billing-actions";

export const metadata: Metadata = { title: "Billing" };

const STATUS: Record<string, string> = {
  trialing: "Free trial",
  active: "Active",
  past_due: "Payment failed",
  canceled: "Cancelled",
  comped: "Free access",
  none: "No plan",
};
const date = (d: Date | null) =>
  d ? d.toLocaleDateString(undefined, { dateStyle: "medium" }) : "";

export default async function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{
    interval?: string;
    currency?: string;
    checkout?: string;
    ended?: string;
  }>;
}) {
  const { workspace, role } = await requireWorkspace();
  if (!billingEnabled())
    return (
      <div className="mx-auto max-w-2xl space-y-3">
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <Card className="text-sm text-muted-foreground">
          This installation is self-hosted, so there is no billing or plan limit. AI usage is billed
          by OpenAI to whoever owns the OpenAI key.
        </Card>
      </div>
    );

  const q = await searchParams;
  const isOwner = role === "owner";
  const [summary, plans] = await Promise.all([
    workspaceBilling(workspace.id),
    listPlans(db(), { publicOnly: true }),
  ]);
  const provider = billingProvider();
  // A paying workspace sees its own billing period and the currency it pays in (plan changes stay in it).
  const interval =
    q.interval === "monthly" || q.interval === "yearly"
      ? q.interval
      : (summary.interval ?? "yearly");
  const currency =
    summary.paid && summary.currency
      ? (summary.currency as "USD" | "INR")
      : currencyFor((await headers()).get("cf-ipcountry"), q.currency);
  const currentPlan = summary.paid ? plans.find((p) => p.slug === summary.planSlug) : undefined;
  const changeBlocked = summary.paid
    ? summary.status === "past_due"
      ? "Update your payment method first, then change the plan."
      : summary.cancelAtPeriodEnd
        ? "Your plan is set to end. Resume it under Manage subscription to change plans."
        : null
    : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Billing</h1>
        <p className="mt-1 text-muted-foreground">
          Your plan, your usage, and your payment details.
        </p>
      </div>

      {q.checkout === "done" && (
        <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success" role="status">
          Thank you! Your payment is being confirmed. This page updates in a moment.
        </p>
      )}
      {summary.blocked && (
        <div
          className="space-y-1 rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {q.ended && <p className="font-semibold">Choose a plan to keep creating tickets</p>}
          <p>
            {summary.blocked.message} {BLOCKED_NOTE}
          </p>
          {q.ended && (
            <p className="text-muted-foreground">
              Everything else (activity, connections, settings) stays open from the menu above.
            </p>
          )}
        </div>
      )}
      {!isOwner && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm">
          Only the workspace owner can change the plan or payment.
        </p>
      )}

      <Card className="grid gap-6 sm:grid-cols-3">
        <div>
          <p className="text-sm text-muted-foreground">Plan</p>
          <p className="text-xl font-semibold">{summary.planName ?? STATUS[summary.status]}</p>
          <p className="text-sm text-muted-foreground">
            {STATUS[summary.status]}
            {summary.interval ? ` · ${summary.interval}` : ""}
          </p>
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            {summary.status === "trialing"
              ? "Trial"
              : summary.cancelAtPeriodEnd
                ? "Ends"
                : "Renews"}
          </p>
          <p className="text-xl font-semibold">
            {summary.trialDaysLeft !== null
              ? `${summary.trialDaysLeft} ${summary.trialDaysLeft === 1 ? "day" : "days"} left`
              : summary.periodEnd
                ? date(summary.periodEnd)
                : summary.compUntil
                  ? date(summary.compUntil)
                  : "No end date"}
          </p>
          {summary.cancelAtPeriodEnd && (
            <p className="text-sm text-muted-foreground">Cancelled: access continues until then.</p>
          )}
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            {summary.status === "trialing"
              ? "Conversations in your trial"
              : "Conversations this month"}
          </p>
          <p className="text-xl font-semibold tabular-nums">
            {summary.used}
            {summary.limit !== null ? ` / ${summary.limit.toLocaleString("en-US")}` : " (no limit)"}
          </p>
          {summary.percent !== null && (
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={summary.percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Conversations used"
            >
              <div
                className={
                  summary.percent >= 100
                    ? "h-full bg-danger"
                    : summary.percent >= 80
                      ? "h-full bg-p4"
                      : "h-full bg-primary"
                }
                style={{ width: `${summary.percent}%` }}
              />
            </div>
          )}
          {summary.status !== "trialing" && summary.usageResetsAt && summary.limit !== null && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Starts again on {date(summary.usageResetsAt)}
              {summary.interval === "yearly" ? " (every month, also on yearly plans)" : ""}
            </p>
          )}
        </div>
        {isOwner && summary.hasPortal && (
          <div className="sm:col-span-3">
            <PortalButton />
          </div>
        )}
      </Card>

      <section className="space-y-4" aria-labelledby="plans">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h2 id="plans" className="text-lg font-semibold">
            {summary.paid ? "Change plan" : "Choose a plan"}
          </h2>
          <IntervalAndCurrencySwitch base="/app/billing" interval={interval} currency={currency} />
        </div>
        {!provider && (
          <p className="text-sm text-muted-foreground">
            Payments aren't set up on this server yet.
          </p>
        )}
        {summary.scheduled && (
          <div
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted px-4 py-3 text-sm"
            role="status"
          >
            <p>
              Your plan changes to <strong>{summary.scheduled.planName}</strong> (
              {summary.scheduled.interval}) on <strong>{date(summary.scheduled.at)}</strong>. Until
              then you keep {summary.planName ?? "your current plan"} and its limits.
            </p>
            {isOwner && <KeepPlanButton />}
          </div>
        )}
        {changeBlocked && <p className="text-sm text-muted-foreground">{changeBlocked}</p>}
        {plans.length === 0 ? (
          <Card className="text-sm text-muted-foreground">Plans are coming soon.</Card>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {plans.map((p) => {
              const current =
                summary.planSlug === p.slug &&
                (summary.paid ? summary.interval === interval : summary.status === "active");
              const buyable =
                !!provider && !!p.providerPriceIds[provider.name]?.[currency]?.[interval];
              // For a paying workspace: does choosing this happen now (bigger/yearly) or at renewal?
              const kind =
                currentPlan &&
                summary.interval &&
                currentPlan.prices[currency] &&
                p.prices[currency]
                  ? changeKind(
                      {
                        planId: currentPlan.id,
                        interval: summary.interval,
                        monthlyPrice: currentPlan.prices[currency].monthly,
                      },
                      { planId: p.id, interval, monthlyPrice: p.prices[currency].monthly },
                    )
                  : null;
              return (
                <PlanCard
                  key={p.id}
                  plan={{ ...p, buyable }}
                  currency={currency}
                  interval={interval}
                  current={current}
                  action={
                    isOwner && summary.paid ? (
                      <ChangePlanButton
                        planId={p.id}
                        interval={interval}
                        current={current}
                        primary={kind === "now" && p.isPopular}
                        disabled={!buyable || current || !kind || !!changeBlocked}
                        label={
                          current
                            ? "Your plan"
                            : !buyable
                              ? "Not available yet"
                              : kind === "now"
                                ? "Upgrade now"
                                : "Switch at renewal"
                        }
                      />
                    ) : isOwner ? (
                      <ChooseButton
                        planId={p.id}
                        interval={interval}
                        currency={currency}
                        primary={p.isPopular}
                        disabled={!buyable || current}
                        label={
                          current ? "Your plan" : buyable ? "Choose plan" : "Not available yet"
                        }
                      />
                    ) : null
                  }
                />
              );
            })}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          A bigger plan or yearly billing starts now: you pay only the difference for the rest of
          the period and get the new limit straight away. A smaller plan or monthly billing starts
          at your next billing date. Cancel any time; payments are non-refundable. Cards and
          invoices are in the payment portal.
        </p>
      </section>

      {isOwner && (
        <section className="space-y-3" aria-labelledby="invite-h">
          <h2 id="invite-h" className="text-lg font-semibold">
            Have an invite code?
          </h2>
          <Card>
            <RedeemForm />
          </Card>
        </section>
      )}
    </div>
  );
}
