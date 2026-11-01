import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/fox-logo";
import { requireAdmin } from "@/lib/admin";
import { AdminNav } from "./admin-nav";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

/** Anyone who is not an admin gets a 404 (requireAdmin). */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-border bg-card/40 p-4 md:sticky md:top-0 md:h-screen md:border-r md:border-b-0 md:p-5">
        <div className="mb-5 flex items-center justify-between md:block">
          <Link href="/admin" aria-label="TriageFox admin home">
            <Wordmark />
          </Link>
          <p className="mt-0 text-xs font-semibold tracking-wide text-muted-foreground uppercase md:mt-2">
            TriageFox admin
          </p>
        </div>
        <AdminNav />
        <div className="mt-6 hidden space-y-1 border-t border-border pt-4 text-xs text-muted-foreground md:block">
          <p className="truncate" title={admin.email}>
            {admin.email}
          </p>
          <Link href="/app" className="text-primary hover:underline">
            Back to the app
          </Link>
        </div>
      </aside>
      <main className="mx-auto w-full max-w-5xl space-y-8 p-4 text-sm sm:p-8">{children}</main>
    </div>
  );
}
