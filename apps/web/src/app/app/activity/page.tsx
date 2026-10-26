import type { Metadata } from "next";
import Link from "next/link";
import { Card } from "@/components/ui/card";
import { ACTIVITY_FILTERS, type ActivityFilter, listActivity } from "@/lib/app-data";
import { cn } from "@/lib/cn";
import { requireWorkspace } from "@/lib/workspace";
import { ActivityList } from "./activity-list";

export const metadata: Metadata = { title: "Activity" };
const PAGE = 30;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; before?: string }>;
}) {
  const { workspace } = await requireWorkspace();
  const { filter, before } = await searchParams;
  const active = filter && filter in ACTIVITY_FILTERS ? (filter as ActivityFilter) : undefined;
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined;
  const rows = await listActivity(workspace.id, {
    filter: active,
    before: beforeDate,
    limit: PAGE + 1,
  });
  const more = rows.length > PAGE;
  const shown = rows.slice(0, PAGE);
  const last = shown.at(-1);

  const tab = (key: ActivityFilter | undefined, label: string) => (
    <Link
      key={label}
      href={key ? `/app/activity?filter=${key}` : "/app/activity"}
      aria-current={key === active ? "page" : undefined}
      className={cn(
        "rounded-full border px-3 py-1 text-sm font-medium",
        key === active
          ? "border-primary bg-primary/10 text-foreground"
          : "border-border text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </Link>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Activity</h1>
        <p className="mt-1 text-muted-foreground">
          Every decision, with the reason. Open a row to see why the AI decided what it did.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="navigation" aria-label="Filter">
        {tab(undefined, "All")}
        {(Object.keys(ACTIVITY_FILTERS) as ActivityFilter[]).map((k) =>
          tab(k, ACTIVITY_FILTERS[k].label),
        )}
      </div>
      {shown.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          {active
            ? "Nothing here yet."
            : "Nothing yet. When a customer chats, every decision shows up here."}
        </Card>
      ) : (
        <ActivityList rows={shown.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }))} />
      )}
      {more && last && (
        <Link
          href={`/app/activity?${active ? `filter=${active}&` : ""}before=${encodeURIComponent(last.createdAt.toISOString())}`}
          className="inline-block text-sm font-medium text-primary hover:underline"
        >
          Older activity →
        </Link>
      )}
    </div>
  );
}
