import Link from "next/link";
import { Wordmark } from "@/components/fox-logo";
import { buttonVariants } from "@/components/ui/button";
import { getSession } from "@/lib/session";
import { SITE } from "@/lib/site";

export async function SiteHeader() {
  const signedIn = !!(await getSession());
  return (
    <header className="sticky top-0 z-20 border-b border-border/60 bg-background/80 backdrop-blur">
      <nav
        className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6"
        aria-label="Main"
      >
        <Link href="/" aria-label="TriageFox home">
          <Wordmark />
        </Link>
        <div className="hidden items-center gap-6 text-sm font-medium text-muted-foreground md:flex">
          <Link href="/#features" className="hover:text-foreground">
            Features
          </Link>
          <Link href="/pricing" className="hover:text-foreground">
            Pricing
          </Link>
          <Link href="/integrations" className="hover:text-foreground">
            Integrations
          </Link>
          {SITE.repoPublic && (
            <a
              href={`${SITE.repoUrl}/tree/main/docs`}
              className="hover:text-foreground"
              target="_blank"
              rel="noopener noreferrer"
            >
              Docs
            </a>
          )}
          <Link href="/support" className="hover:text-foreground">
            Support
          </Link>
        </div>
        <div className="flex items-center gap-2">
          {signedIn ? (
            <Link href="/app" className={buttonVariants({ size: "sm" })}>
              Open your workspace
            </Link>
          ) : (
            <>
              <Link href="/login" className={buttonVariants({ variant: "ghost", size: "sm" })}>
                Sign in
              </Link>
              <Link href="/signup" className={buttonVariants({ size: "sm" })}>
                Start free trial
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
