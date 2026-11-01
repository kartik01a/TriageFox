"use client";

import {
  Gauge,
  Inbox,
  LayoutDashboard,
  type LucideIcon,
  Settings,
  TicketPercent,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const links: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/admin", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/plans", label: "Plans", icon: Wallet },
  { href: "/admin/settings", label: "Settings", icon: Settings },
  { href: "/admin/workspaces", label: "Workspaces", icon: Users },
  { href: "/admin/invite-codes", label: "Invite codes", icon: TicketPercent },
  { href: "/admin/usage", label: "AI spend", icon: Gauge },
  { href: "/admin/inbox", label: "Support inbox", icon: Inbox },
];

export function AdminNav() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Admin"
      className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:overflow-visible md:pb-0"
    >
      {links.map(({ href, label, icon: Icon }) => {
        const active = href === "/admin" ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
              active
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
