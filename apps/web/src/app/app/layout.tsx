import Link from "next/link";
import { Wordmark } from "@/components/fox-logo";
import { requireSession } from "@/lib/session";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  return (
    <div className="min-h-dvh">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4 sm:px-6">
          <div className="flex items-center gap-6">
            <Link href="/app" aria-label="TriageFox home">
              <Wordmark />
            </Link>
            <nav
              className="hidden gap-4 text-sm font-medium text-muted-foreground sm:flex"
              aria-label="App"
            >
              <Link href="/app" className="hover:text-foreground">
                Overview
              </Link>
              <Link href="/app/connections" className="hover:text-foreground">
                Connections
              </Link>
              <Link href="/app/members" className="hover:text-foreground">
                Members
              </Link>
              <Link href="/app/settings/ai" className="hover:text-foreground">
                AI key
              </Link>
            </nav>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden max-w-48 truncate text-sm text-muted-foreground sm:inline">
              {user.email}
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">{children}</main>
    </div>
  );
}
