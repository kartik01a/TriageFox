import { billingSummary } from "@triagefox/billing";
import { eq, schema, withOrg } from "@triagefox/db";
import Link from "next/link";
import { AppNav } from "@/components/app/app-nav";
import { HelpButton } from "@/components/app/help-button";
import { StepUpProvider } from "@/components/app/step-up";
import { CrispIdentity } from "@/components/crisp-identity";
import { Wordmark } from "@/components/fox-logo";
import { buttonVariants } from "@/components/ui/button";
import { reviewCount } from "@/lib/app-data";
import { BLOCKED_NOTE, billingEnabled, workspaceBilling } from "@/lib/billing";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireSession } from "@/lib/session";
import { resolveWorkspace } from "@/lib/workspace";
import { SignOutButton } from "./sign-out-button";

const longDate = (d: Date) => d.toLocaleDateString("en-US", { dateStyle: "long" });

/** What the banner offers for each kind of block: the one thing that fixes it. */
const BLOCK_ACTION = (reason: string): { link: string; href: string } => {
  if (reason === "own_key_required" || reason === "trial_budget")
    return { link: "Add your OpenAI key", href: "/app/settings/ai" };
  if (reason === "payment_failed") return { link: "Update payment", href: "/app/billing" };
  if (reason === "over_limit") return { link: "Upgrade", href: "/app/billing" };
  if (reason === "paused") return { link: "Billing", href: "/app/billing" };
  return { link: "Choose a plan", href: "/app/billing" };
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const ctx = await resolveWorkspace();
  const pending = ctx ? await reviewCount(ctx.workspace.id).catch(() => 0) : 0;
  const hosted = billingEnabled();
  let banner: { message: string; tone: "danger" | "warn"; link: string; href?: string } | null =
    null;
  if (ctx && hosted) {
    try {
      const s = await workspaceBilling(ctx.workspace.id);
      if (s.blocked)
        banner = {
          message: `${s.blocked.message} ${BLOCKED_NOTE}`,
          tone: "danger",
          ...BLOCK_ACTION(s.blocked.reason),
        };
      else if (s.paid && s.cancelAtPeriodEnd && s.periodEnd)
        banner = {
          message: `Your subscription is cancelled. TriageFox keeps working until ${longDate(s.periodEnd)}; after that, new chats won't become tickets.`,
          tone: "danger",
          link: "Resume or choose a plan",
        };
      else if (s.percent !== null && s.percent >= 80)
        banner = {
          message: `You've used ${s.percent}% of this month's conversations.`,
          tone: "warn",
          link: "Billing",
        };
      else if (s.status === "trialing" && s.trialDaysLeft !== null && s.trialDaysLeft <= 2)
        banner = {
          message: `Your free trial ends ${s.trialDaysLeft <= 1 ? "within a day" : `in ${s.trialDaysLeft} days`}. Choose a plan to keep TriageFox creating tickets.`,
          tone: "warn",
          link: "Choose a plan",
        };
    } catch {
      /* the banner is a convenience; never break a page for it */
    }
  }
  return (
    <div className="min-h-dvh">
      {/* Stays at the top while scrolling, so the tabs are always one click away. */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/app" aria-label="TriageFox home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            {env().SUPPORT_CRISP_WEBSITE_ID ? (
              <HelpButton />
            ) : (
              hosted && (
                <Link
                  href="/support"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Help
                </Link>
              )
            )}
            <SignOutButton />
          </div>
        </div>
        {ctx && (
          <div className="mx-auto max-w-5xl px-2 sm:px-4">
            <AppNav reviewCount={pending} showBilling={hosted} />
          </div>
        )}
      </header>
      {banner && (
        <div
          role={banner.tone === "danger" ? "alert" : "status"}
          className={`px-4 py-2 text-center text-sm ${banner.tone === "danger" ? "bg-danger/10 text-danger" : "bg-p3/25"}`}
        >
          {banner.message}{" "}
          <Link href={banner.href ?? "/app/billing"} className="font-semibold underline">
            {banner.link}
          </Link>
        </div>
      )}
      {ctx && (
        <CrispIdentity
          email={user.email}
          name={user.name}
          workspaceId={ctx.workspace.id}
          workspaceName={ctx.workspace.name}
        />
      )}
      <StepUpProvider email={user.email}>
        <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
      </StepUpProvider>
    </div>
  );
}
