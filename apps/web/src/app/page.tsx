import { Gauge, MessagesSquare, Paperclip } from "lucide-react";
import Link from "next/link";
import { Wordmark } from "@/components/fox-logo";
import { HeroDemo } from "@/components/landing/hero-demo";
import { WaitlistForm } from "@/components/landing/waitlist-form";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const features = [
  {
    icon: MessagesSquare,
    title: "Understands the chat",
    body: "Decides whether a message needs a code change. Bugs and feature requests become tickets; “how do I…” questions don't.",
  },
  {
    icon: Gauge,
    title: "Priority 1–5 by clear rules",
    body: "A fixed rubric sets the priority, so a missing checkout is a P5 and a typo is a P1. Never a guess.",
  },
  {
    icon: Paperclip,
    title: "Screenshots attached",
    body: "Every image and file the customer sent lands on the ticket, next to the steps to reproduce.",
  },
];

export default function Home() {
  return (
    <>
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/80 backdrop-blur">
        <nav
          className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6"
          aria-label="Main"
        >
          <Link href="/" aria-label="TriageFox home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-2">
            <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
              Sign in
            </Link>
            <a href="#waitlist" className={buttonVariants({ size: "sm" })}>
              Join the waitlist
            </a>
          </div>
        </nav>
      </header>

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
            <div className="mt-8 flex justify-center">
              <WaitlistForm source="hero" />
            </div>
          </div>
          <div className="mx-auto mt-14 max-w-4xl">
            <HeroDemo />
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
          <div className="mt-10 grid gap-4 md:grid-cols-3">
            {features.map(({ icon: Icon, title, body }) => (
              <Card key={title}>
                <span className="mb-4 inline-flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Icon className="size-5" aria-hidden="true" />
                </span>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-2 text-sm text-pretty text-muted-foreground">{body}</p>
              </Card>
            ))}
          </div>
        </section>

        <section
          id="waitlist"
          className="mx-auto max-w-6xl px-4 pb-24 sm:px-6"
          aria-labelledby="waitlist-title"
        >
          <Card className="flex flex-col items-center gap-5 px-6 py-12 text-center">
            <h2 id="waitlist-title" className="text-2xl font-bold tracking-tight sm:text-3xl">
              Be first to try TriageFox
            </h2>
            <p className="max-w-lg text-muted-foreground">
              We're opening to a few teams soon. Leave your email and we'll let you know. No spam,
              one message when it's ready.
            </p>
            <WaitlistForm source="footer-cta" />
          </Card>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:px-6">
          <span>© {new Date().getFullYear()} TriageFox · Made in India 🇮🇳</span>
          <span>Open source under AGPL-3.0</span>
        </div>
      </footer>
    </>
  );
}
