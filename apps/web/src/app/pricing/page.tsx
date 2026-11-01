import { getSettings, listPlans } from "@triagefox/billing";
import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IntervalAndCurrencySwitch, PlanCard, type PlanView } from "@/components/pricing-grid";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { buttonVariants } from "@/components/ui/button";
import { billingEnabled, currencyFor } from "@/lib/billing";
import { db } from "@/lib/db";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Simple plans for turning customer chats into Trello and Jira tickets. Free trial, no card needed.",
};

export default async function PricingPage({
  searchParams,
}: {
  searchParams: Promise<{ interval?: string; currency?: string }>;
}) {
  if (!billingEnabled()) notFound();
  const q = await searchParams;
  const interval = q.interval === "monthly" ? "monthly" : "yearly";
  const currency = currencyFor((await headers()).get("cf-ipcountry"), q.currency);
  const [plans, settings] = await Promise.all([
    listPlans(db(), { publicOnly: true }),
    getSettings(db()),
  ]);
  const trialDays = settings.trial.days;
  const biggest = Math.max(
    0,
    ...plans.filter((p) => !p.byokRequired).map((p) => p.conversationLimit ?? 0),
  );
  const views: PlanView[] = plans.map((p) => ({
    id: p.id,
    name: p.name,
    prices: p.prices,
    conversationLimit: p.conversationLimit,
    fairUseCap: p.fairUseCap,
    inboxLimit: p.inboxLimit,
    byokRequired: p.byokRequired,
    supportLevel: p.supportLevel,
    isPopular: p.isPopular,
    buyable: true,
  }));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-6xl space-y-10 px-4 py-12 sm:px-6">
        <div className="space-y-3 text-center">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Simple pricing</h1>
          <p className="mx-auto max-w-xl text-muted-foreground">
            Try it free for {trialDays} days, no card needed. Every plan includes every feature;
            plans differ only in volume, inboxes and support.
          </p>
          <div className="flex justify-center">
            <IntervalAndCurrencySwitch base="/pricing" interval={interval} currency={currency} />
          </div>
        </div>

        {views.length === 0 ? (
          <p className="text-center text-muted-foreground">
            The plans will be listed here shortly. You can already start your free trial.
          </p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {views.map((p) => (
              <PlanCard
                key={p.id}
                plan={p}
                currency={currency}
                interval={interval}
                action={
                  <Link
                    href="/signup"
                    className={buttonVariants({ variant: p.isPopular ? "primary" : "outline" })}
                  >
                    Start free trial
                  </Link>
                }
              />
            ))}
          </div>
        )}

        <section className="mx-auto max-w-2xl space-y-4 text-sm" aria-labelledby="faq">
          <h2 id="faq" className="text-xl font-semibold">
            Questions
          </h2>
          <p>
            <strong>Is there a free trial?</strong> Yes: {trialDays} days, no card, with a generous
            number of conversations. Use your own OpenAI key and the trial has no conversation
            limit.
          </p>
          <p>
            <strong>What counts as a conversation?</strong> A chat counts once it reaches the AI.
            Greetings and chats with no customer message are free.
          </p>
          <p>
            <strong>What happens at my limit?</strong> We warn you at 80%. At 100%, new
            conversations wait until next month, or until you upgrade or add your own OpenAI key.
            You are never charged extra.
          </p>
          <p>
            <strong>Can I cancel?</strong> Any time. Your plan runs until the end of the period you
            paid for. Payments are non-refundable, apart from billing mistakes and where the law
            says otherwise.
          </p>
          <p>
            <strong>
              Need more{biggest > 0 ? ` than ${biggest.toLocaleString("en-US")}` : ""}{" "}
              conversations?
            </strong>{" "}
            <a href={`mailto:${SITE.contactEmail}`} className="text-primary underline">
              Contact us
            </a>{" "}
            for a custom plan. Prefer to run it yourself? TriageFox is open source and free to
            self-host.
          </p>
          <p className="text-xs text-muted-foreground">
            Prices exclude tax where applicable. In India, prices are in rupees (UPI and Indian
            cards) plus GST. Payments are handled by our payment partner, who is the seller of
            record.
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
