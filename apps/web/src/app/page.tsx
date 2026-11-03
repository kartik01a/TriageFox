import { getSettings, listPlans } from "@triagefox/billing";
import { ArrowRight, Eye, GitBranch, Lock, ShieldCheck, ToggleRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { BeforeAfter } from "@/components/landing/before-after";
import { FeatureVisual, type VisualKind } from "@/components/landing/feature-visuals";
import { HeroDemo } from "@/components/landing/hero-demo";
import { Reveal } from "@/components/landing/reveal";
import { TerminalDemo } from "@/components/landing/terminal";
import { PlanCard } from "@/components/pricing-grid";
import { SiteFooter } from "@/components/site/site-footer";
import { SiteHeader } from "@/components/site/site-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSession } from "@/lib/session";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: {
    title: "TriageFox: customer chats in, perfect tickets out",
    description:
      "Open-source AI that turns Crisp conversations into Jira and Trello tickets, with priority, steps to reproduce and screenshots.",
    type: "website",
  },
};

const features: { title: string; body: string; visual: VisualKind }[] = [
  {
    title: "Understands the chat",
    body: "Decides whether a message needs a code change. Bugs and feature requests become tickets; “how do I…” questions don't.",
    visual: "sort",
  },
  {
    title: "Priority 1–5 by clear rules",
    body: "A fixed rubric sets the priority, so a missing checkout is a P5 and a typo is a P1. Never a guess.",
    visual: "priority",
  },
  {
    title: "Screenshots attached",
    body: "Every image and file the customer sent lands on the ticket, next to the steps to reproduce.",
    visual: "screenshot",
  },
  {
    title: "Keeps the same ticket updated",
    body: "When the customer adds detail, the existing ticket gets a comment. People's own edits are never overwritten.",
    visual: "update",
  },
  {
    title: "Merges duplicates",
    body: "The same bug from a second customer becomes “Reported by 2 customers” on the first ticket, not a second ticket.",
    visual: "duplicates",
  },
  {
    title: "Never invents due dates",
    body: "A date appears only when the customer actually said one (“by Friday”). Otherwise there is none.",
    visual: "dates",
  },
];

const steps = [
  {
    n: 1,
    title: "Connect Crisp",
    body: "Install the TriageFox plugin on your Crisp website and link it to your workspace.",
  },
  {
    n: 2,
    title: "Connect Jira or Trello",
    body: "Approve access, choose the board or project, and check the AI on your last 10 chats.",
  },
  {
    n: 3,
    title: "Turn it on",
    body: "From then on, every real bug and feature request becomes a ticket. You see why for each decision.",
  },
];

const faq = [
  {
    q: "What counts as a conversation?",
    a: "A chat counts once, when it reaches the AI. Greetings and chats with no customer message are free, and follow-ups to a chat that already counted never use more room.",
  },
  {
    q: "Does it work with my Jira setup?",
    a: "It works with Jira Cloud. During setup we check your project: if an issue type has required custom fields we can't fill, we tell you which, so you can pick another type or make the field optional. Priority and due date are set after the issue is created, so they work even when they aren't on the create screen.",
  },
  {
    q: "What does the AI see?",
    a: "The text of the conversation and up to four screenshots. Email addresses, phone numbers and card numbers are removed before anything is sent. The AI has no tools: it can only answer in a strict format that we check, and your chat transcripts are not stored.",
  },
  {
    q: "Can I use my own OpenAI key?",
    a: "Yes. Paste it under AI key and OpenAI bills you directly. It is encrypted when you save it and can never be read back, only its last four characters are shown. We choose the models.",
  },
  {
    q: "What happens at my limit?",
    a: "You get a warning at 80%. At 100% new conversations are not turned into tickets until the next period, or until you upgrade or add your own key. You are never charged extra.",
  },
  {
    q: "Is my data safe?",
    a: "Trello and Jira tokens are encrypted so that the website can store them but only a separate worker can use them. Workspaces are isolated in the database, webhooks are signature-checked, and the code is open for you to read. See the security page for the details.",
  },
];

export default async function Home() {
  const signedIn = !!(await getSession());
  // Someone who is already signed in has no use for the sign-in page's sales pitch: send them to their workspace.
  if (signedIn) redirect("/app");
  // A self-hosted install has no marketing site: go straight to the product.
  if (env().APP_MODE === "selfhost") redirect("/login");

  const [settings, plans] = await Promise.all([
    getSettings(db()),
    listPlans(db(), { publicOnly: true }),
  ]);
  const trialDays = settings.trial.days;
  const preview = plans.filter((p) => !p.byokRequired).slice(0, 3);

  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <div className="mx-auto max-w-3xl text-center">
            <p className="mb-4 inline-block rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              Open source · Crisp → Jira &amp; Trello
            </p>
            <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-6xl">
              Customer chats in. <span className="text-primary">Perfect tickets out.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
              TriageFox reads your Crisp conversations and creates Jira and Trello tickets for real
              bugs and feature requests, with priority, steps to reproduce and screenshots attached.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Link href="/signup" className={buttonVariants({ size: "lg" })}>
                Start free trial <ArrowRight className="size-4" aria-hidden="true" />
              </Link>
              <a
                href={SITE.repoUrl}
                className={buttonVariants({ variant: "outline", size: "lg" })}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on GitHub
              </a>
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {trialDays}-day free trial, no card needed · Open source · Self-host free
            </p>
          </div>
          <div className="mx-auto mt-14 max-w-4xl">
            <HeroDemo />
          </div>
        </section>

        <section className="border-y border-border bg-muted/30" aria-label="Works with">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-x-8 gap-y-3 px-4 py-6 text-sm sm:px-6">
            <span className="text-muted-foreground">Works with</span>
            {["Crisp", "Jira Cloud", "Trello"].map((n) => (
              <span key={n} className="font-semibold">
                {n}
              </span>
            ))}
            <span className="text-muted-foreground">Coming soon:</span>
            {["Chatwoot", "Linear", "GitHub Issues", "tawk.to"].map((n) => (
              <span key={n} className="text-muted-foreground italic">
                {n}
              </span>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-20 sm:px-6" aria-labelledby="problem-title">
          <Reveal>
            <h2
              id="problem-title"
              className="text-center text-2xl font-bold tracking-tight sm:text-3xl"
            >
              Stop copy-pasting bugs from chat into your tracker
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
              Every bug report starts as a chat message. Someone has to read it, work out if it
              matters, find the screenshot, write the ticket and check it isn't already there.
              TriageFox does that, and tells you why.
            </p>
          </Reveal>
          <div className="mt-10">
            <BeforeAfter />
          </div>
        </section>

        <section
          id="features"
          className="mx-auto max-w-6xl px-4 py-16 sm:px-6"
          aria-labelledby="features-title"
        >
          <h2
            id="features-title"
            className="text-center text-2xl font-bold tracking-tight sm:text-3xl"
          >
            Less copy-paste. Nothing gets lost.
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {features.map((f, i) => (
              <Reveal key={f.title} index={i % 3}>
                <Card className="flex h-full flex-col gap-4">
                  <FeatureVisual kind={f.visual} />
                  <div>
                    <h3 className="font-semibold">{f.title}</h3>
                    <p className="mt-1.5 text-sm text-pretty text-muted-foreground">{f.body}</p>
                  </div>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="how-title">
          <h2 id="how-title" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Five minutes to set up
          </h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-3">
            {steps.map((s, i) => (
              <li key={s.n}>
                <Reveal index={i}>
                  <div className="space-y-2">
                    <span className="flex size-9 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground">
                      {s.n}
                    </span>
                    <h3 className="font-semibold">{s.title}</h3>
                    <p className="text-sm text-muted-foreground">{s.body}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="trust-title">
          <h2
            id="trust-title"
            className="text-center text-2xl font-bold tracking-tight sm:text-3xl"
          >
            You stay in control
          </h2>
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                icon: Eye,
                title: "Every decision explained",
                body: "The activity log shows what the AI did with each chat and why, including the reason for its priority.",
              },
              {
                icon: ToggleRight,
                title: "Unsure? It asks you first",
                body: "Low-confidence tickets wait in a review queue. Fix the type or priority, then create or dismiss.",
              },
              {
                icon: Lock,
                title: "You choose what goes in",
                body: "Conversation links and customer names are off by default. Switch each on or off, and see a live preview.",
              },
              {
                icon: ShieldCheck,
                title: "Credentials stay encrypted",
                body: "The website can store your tokens but never read them back. A separate worker uses them.",
              },
              {
                icon: GitBranch,
                title: "Open source",
                body: "Read every line on GitHub. Self-host it for free, or let us run it.",
              },
            ].map((t, i) => (
              <Reveal key={t.title} index={i % 3}>
                <Card className="h-full">
                  <span className="mb-3 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <t.icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="font-semibold">{t.title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{t.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-4xl px-4 py-16 sm:px-6" aria-labelledby="oss-title">
          <h2 id="oss-title" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Self-host free forever, or let us host it
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            TriageFox is open source under AGPL-3.0. Run it on your own server with Docker, using
            your own OpenAI key.
          </p>
          <div className="mt-8">
            <TerminalDemo />
          </div>
          <p className="mt-4 text-center text-sm">
            <a
              href={`${SITE.repoUrl}/blob/main/docs/self-hosting.md`}
              className="font-medium text-primary hover:underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Read the self-hosting guide →
            </a>
          </p>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6" aria-labelledby="pricing-title">
          <h2
            id="pricing-title"
            className="text-center text-2xl font-bold tracking-tight sm:text-3xl"
          >
            Simple pricing
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-center text-muted-foreground">
            Every plan includes every feature. {trialDays}-day free trial, no card needed.
          </p>
          {preview.length > 0 && (
            <div className="mt-10 grid gap-5 md:grid-cols-3">
              {preview.map((p) => (
                <PlanCard
                  key={p.id}
                  plan={{ ...p, buyable: true }}
                  currency="USD"
                  interval="yearly"
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
          <p className="mt-6 text-center">
            <Link href="/pricing" className="font-medium text-primary hover:underline">
              See all plans and prices →
            </Link>
          </p>
        </section>

        <section className="mx-auto max-w-3xl px-4 py-16 sm:px-6" aria-labelledby="faq-title">
          <h2 id="faq-title" className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Questions
          </h2>
          <div className="mt-8 divide-y divide-border rounded-(--radius-card) border border-border bg-card">
            {faq.map((f) => (
              <details key={f.q} className="group px-5 py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-medium">
                  {f.q}
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-pretty text-muted-foreground">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-24 sm:px-6" aria-labelledby="cta-title">
          <Card className="flex flex-col items-center gap-5 bg-primary/5 px-6 py-14 text-center">
            <h2 id="cta-title" className="text-2xl font-bold tracking-tight sm:text-4xl">
              Stop copy-pasting bugs.
            </h2>
            <p className="max-w-lg text-muted-foreground">
              Connect Crisp and your tracker, try it on your last 10 chats, and switch it on when
              you're happy.
            </p>
            <Link href="/signup" className={buttonVariants({ size: "lg" })}>
              Start free trial <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </Card>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
