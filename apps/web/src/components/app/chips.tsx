import {
  PRIORITY_NAMES,
  type Priority,
  TICKET_TYPE_LABELS,
  type TicketType,
} from "@triagefox/shared";
import { cn } from "@/lib/cn";

const PRIORITY_STYLE: Record<number, string> = {
  1: "bg-p1/20 text-foreground",
  2: "bg-p2/25 text-foreground",
  3: "bg-p3/25 text-foreground",
  4: "bg-p4/25 text-foreground",
  5: "bg-p5/20 text-foreground",
};

export function PriorityChip({ priority }: { priority: number }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        PRIORITY_STYLE[priority],
      )}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: `var(--p${priority})` }}
      />
      P{priority} {PRIORITY_NAMES[priority as Priority]}
    </span>
  );
}

export function TypeChip({ type }: { type: string }) {
  return (
    <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
      {TICKET_TYPE_LABELS[type as TicketType] ?? type}
    </span>
  );
}

export function timeAgo(d: Date, now = Date.now()) {
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}
