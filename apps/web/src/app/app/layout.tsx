import { billingSummary } from "@triagefox/billing";
import { eq, schema, withOrg } from "@triagefox/db";
import Link from "next/link";
import { AppNav } from "@/components/app/app-nav";
import { HelpButton } from "@/components/app/help-button";
import { StepUpProvider } from "@/components/app/step-up";
import { CrispIdentity } from "@/components/crisp-identity";
import { Wordmark } from "@/components/fox-logo";
import { reviewCount } from "@/lib/app-data";
import { billingEnabled } from "@/lib/billing";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/session";
import { resolveWorkspace } from "@/lib/workspace";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const ctx = await resolveWorkspace();
  const pending = ctx ? await reviewCount(ctx.workspace.id).catch(() => 0) : 0;
  const hosted = billingEnabled();
  let banner: { message: string; tone: "danger" | "warn" } | null = null;
  if (ctx && hosted) {
    try {
      const [key] = await withOrg(db(), ctx.workspace.id, (tx) =>
        tx
          .select({ hint: schema.aiSettings.keyHint })
          .from(schema.aiSettings)
          .where(eq(schema.aiSettings.orgId, ctx.workspace.id)),
      );
      const s = await billingSummary(db(), ctx.workspace.id, !!key?.hint);
      if (s.blocked)
        banner = { message: `${s.blocked.message} New conversations are waiting.`, tone: "danger" };
      else if (s.percent !== null && s.percent >= 80)
        banner = {
          message: `You've used ${s.percent}% of this period's conversations.`,
          tone: "warn",
        };
      else if (s.status === "trialing" && s.trialDaysLeft !== null && s.trialDaysLeft <= 3)
        banner = {
          message: `Your free trial ends in ${s.trialDaysLeft} ${s.trialDaysLeft === 1 ? "day" : "days"}.`,
          tone: "warn",
        };
    } catch {
      /* the banner is a convenience; never break a page for it */
    }
  }
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <Link href="/app" aria-label="TriageFox home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            {process.env.NEXT_PUBLIC_CRISP_WEBSITE_ID && <HelpButton />}
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
          className={`px-4 py-2 text-center text-sm ${banner.tone === "danger" ? "bg-danger/10 text-danger" : "bg-p4/20"}`}
        >
          {banner.message}{" "}
          <Link href="/app/billing" className="font-semibold underline">
            Billing
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
