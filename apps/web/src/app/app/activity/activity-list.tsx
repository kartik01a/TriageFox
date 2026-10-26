"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";

interface Row {
  id: string;
  kind: string;
  message: string;
  createdAt: string;
  aiRunId: string | null;
  ticketUrl: string | null;
  conversationUrl: string | null;
}
interface Detail {
  kind: string;
  title: string;
  summary: string;
  reason: string;
  priorityReason: string;
  confidence: number;
}

const TONE: Record<string, string> = {
  ticket_created: "bg-success",
  regression: "bg-success",
  ticket_updated: "bg-primary",
  ai_no_action: "bg-muted-foreground/50",
  ai_duplicate_of: "bg-p3",
};
const tone = (k: string) =>
  TONE[k] ??
  (/(failed|problem|limit|unavailable|skipped|no_destination)/.test(k)
    ? "bg-danger"
    : "bg-muted-foreground/50");

export function ActivityList({ rows }: { rows: Row[] }) {
  return (
    <Card className="divide-y divide-border p-0">
      {rows.map((r) => (
        <Item key={r.id} row={r} />
      ))}
    </Card>
  );
}

function Item({ row }: { row: Row }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Detail[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setOpen(!open);
    if (open || detail || !row.aiRunId) return;
    try {
      const res = await fetch(`/api/activity/${row.aiRunId}`);
      const data = (await res.json()) as { ok: boolean; actions?: Detail[]; error?: string };
      if (data.ok) setDetail(data.actions ?? []);
      else setError(data.error ?? "Details are not available.");
    } catch {
      setError("Details are not available right now.");
    }
  }

  return (
    <div className="px-5 py-3 text-sm">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex w-full items-start gap-3 text-left"
      >
        <span aria-hidden className={cn("mt-1.5 size-2.5 shrink-0 rounded-full", tone(row.kind))} />
        <span className="flex-1">{row.message}</span>
        <time className="shrink-0 text-xs text-muted-foreground" dateTime={row.createdAt}>
          {new Date(row.createdAt).toLocaleString()}
        </time>
      </button>
      {open && (
        <div className="mt-3 space-y-3 border-l-2 border-border pl-4 sm:ml-5">
          {row.aiRunId && !detail && !error && <p className="text-muted-foreground">Loading…</p>}
          {error && <p className="text-muted-foreground">{error}</p>}
          {detail?.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a fixed, ordered list
            <div key={i} className="space-y-1">
              {d.title && <p className="font-medium">{d.title}</p>}
              <p>
                <span className="text-muted-foreground">Why: </span>
                {d.reason || "No reason recorded."}
              </p>
              {d.priorityReason && (
                <p>
                  <span className="text-muted-foreground">Priority: </span>
                  {d.priorityReason}
                </p>
              )}
              <p className="text-xs text-muted-foreground">
                Confidence {Math.round(d.confidence * 100)}%
              </p>
            </div>
          ))}
          <div className="flex flex-wrap gap-4">
            {row.ticketUrl && (
              <a
                href={row.ticketUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Open the ticket
              </a>
            )}
            {row.conversationUrl && (
              <a
                href={row.conversationUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary hover:underline"
              >
                Open the Crisp conversation
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
