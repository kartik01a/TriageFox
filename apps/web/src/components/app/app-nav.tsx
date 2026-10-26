"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/app", label: "Overview", exact: true },
  { href: "/app/activity", label: "Activity" },
  { href: "/app/review", label: "Review" },
  { href: "/app/automation", label: "Automation" },
  { href: "/app/connections", label: "Connections" },
  { href: "/app/members", label: "Members" },
  { href: "/app/settings/ai", label: "AI key" },
  { href: "/app/settings/security", label: "Security" },
];

export function AppNav({ reviewCount }: { reviewCount: number }) {
  const path = usePathname();
  return (
    <nav className="-mb-px flex gap-1 overflow-x-auto text-sm font-medium" aria-label="App">
      {LINKS.map((l) => {
        const active = l.exact ? path === l.href : path.startsWith(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3",
              active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {l.label}
            {l.href === "/app/review" && reviewCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                {reviewCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
