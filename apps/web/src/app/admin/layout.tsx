import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const links = [
  ["/admin", "Overview"],
  ["/admin/plans", "Plans"],
  ["/admin/settings", "Settings"],
  ["/admin/workspaces", "Workspaces"],
  ["/admin/invite-codes", "Invite codes"],
  ["/admin/usage", "AI spend"],
  ["/admin/inbox", "Support inbox"],
] as const;

/** Deliberately plain: default styles, tables and forms. Anyone who is not an admin gets a 404. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();
  return (
    <div className="mx-auto max-w-6xl p-4 text-sm">
      <header className="mb-6 flex flex-wrap items-center gap-4 border-b border-border pb-3">
        <strong>TriageFox admin</strong>
        <nav aria-label="Admin" className="flex flex-wrap gap-3">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="text-primary underline">
              {label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-muted-foreground">{admin.email}</span>
      </header>
      {children}
    </div>
  );
}
