import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <header className="space-y-1.5">
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {children && <p className="max-w-3xl text-muted-foreground">{children}</p>}
    </header>
  );
}

export function Panel({
  title,
  children,
  className,
}: {
  title?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "space-y-3 rounded-(--radius-card) border border-border bg-card p-5",
        className,
      )}
    >
      {title && <h2 className="font-semibold">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <div className="rounded-(--radius-card) border border-border bg-card p-5">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 text-3xl font-bold tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warn" | "brand";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-muted text-muted-foreground",
        tone === "good" && "bg-success/15 text-success",
        tone === "warn" && "bg-danger/15 text-danger",
        tone === "brand" && "bg-primary/15 text-primary",
      )}
    >
      {children}
    </span>
  );
}

/** A scrollable table with quiet headers. */
export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-(--radius-card) border border-border bg-card">
      <table className="w-full border-collapse text-left text-sm [&_td]:px-4 [&_td]:py-3 [&_td]:align-top [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-xs [&_th]:font-medium [&_th]:tracking-wide [&_th]:text-muted-foreground [&_th]:uppercase [&_thead]:border-b [&_thead]:border-border [&_tbody_tr:not(:last-child)]:border-b [&_tbody_tr]:border-border/60">
        {children}
      </table>
    </div>
  );
}
