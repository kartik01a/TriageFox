import Link from "next/link";
import { AppNav } from "@/components/app/app-nav";
import { StepUpProvider } from "@/components/app/step-up";
import { Wordmark } from "@/components/fox-logo";
import { reviewCount } from "@/lib/app-data";
import { requireSession } from "@/lib/session";
import { resolveWorkspace } from "@/lib/workspace";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const ctx = await resolveWorkspace();
  const pending = ctx ? await reviewCount(ctx.workspace.id).catch(() => 0) : 0;
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
            <SignOutButton />
          </div>
        </div>
        {ctx && (
          <div className="mx-auto max-w-5xl px-2 sm:px-4">
            <AppNav reviewCount={pending} />
          </div>
        )}
      </header>
      <StepUpProvider email={user.email}>
        <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
      </StepUpProvider>
    </div>
  );
}
