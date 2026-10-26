import { schema, withOrg } from "@triagefox/db";
import type { Metadata } from "next";
import Link from "next/link";
import { timeAgo } from "@/components/app/chips";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { listActivity, monthStats, reviewCount } from "@/lib/app-data";
import { cn } from "@/lib/cn";
import { listConnections } from "@/lib/connections";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Overview" };

const NAMES = { crisp: "Crisp", trello: "Trello", jira: "Jira" } as const;

export default async function OverviewPage() {
  const { workspace } = await requireWorkspace();
  const orgId = workspace.id;
  const [stats, recent, connections, waiting, automations] = await Promise.all([
    monthStats(orgId),
    listActivity(orgId, { limit: 6 }),
    listConnections(orgId),
    reviewCount(orgId),
    withOrg(db(), orgId, (tx) =>
      tx.select({ enabled: schema.automations.enabled }).from(schema.automations),
    ),
  ]);
  const automation = automations[0];
  const hours = Math.floor(stats.minutesSaved / 60);
  const mins = stats.minutesSaved % 60;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{workspace.name}</h1>
        <p className="mt-1 text-muted-foreground">This month so far.</p>
      </div>

      {!automation?.enabled && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-primary/40 bg-primary/5">
          <div>
            <h2 className="font-semibold">
              {automation ? "Your automation is paused" : "Set up your first automation"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {automation
                ? "No tickets are being created until you turn it back on."
                : "Connect Crisp and a ticket tool, check it on your last chats, then switch it on. It takes about five minutes."}
            </p>
          </div>
          <Link href="/app/setup" className={buttonVariants({ size: "md" })}>
            {automation ? "Open setup" : "Start setup"}
          </Link>
        </Card>
      )}

      {waiting > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm">
            <strong>{waiting}</strong> {waiting === 1 ? "ticket is" : "tickets are"} waiting for
            your decision.
          </p>
          <Link href="/app/review" className={buttonVariants({ variant: "outline", size: "sm" })}>
            Review now
          </Link>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Tickets created" value={stats.created} />
        <Stat label="Tickets updated" value={stats.updated} />
        <Stat label="Duplicates merged" value={stats.duplicates} />
        <Stat label="Chats skipped" value={stats.skipped} hint="No ticket needed" />
      </div>
      <p className="text-sm text-muted-foreground">
        Time saved this month (estimate):{" "}
        <strong className="text-foreground">
          {hours > 0 ? `${hours} h ${mins} min` : `${mins} min`}
        </strong>
        {stats.problems > 0 && (
          <>
            {" · "}
            <Link
              href="/app/activity?filter=error"
              className="font-medium text-danger hover:underline"
            >
              {stats.problems} {stats.problems === 1 ? "problem" : "problems"} to look at
            </Link>
          </>
        )}
      </p>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="space-y-3 lg:col-span-3" aria-labelledby="recent">
          <div className="flex items-center justify-between">
            <h2 id="recent" className="font-semibold">
              Recent activity
            </h2>
            <Link href="/app/activity" className="text-sm font-medium text-primary hover:underline">
              See all
            </Link>
          </div>
          {recent.length === 0 ? (
            <Card className="text-sm text-muted-foreground">
              Nothing yet. When a customer chats, every decision shows up here with its reason.
            </Card>
          ) : (
            <Card className="divide-y divide-border p-0">
              {recent.map((r) => (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 px-5 py-3 text-sm"
                >
                  <span>{r.message}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {timeAgo(r.createdAt)}
                  </span>
                </div>
              ))}
            </Card>
          )}
        </section>

        <section className="space-y-3 lg:col-span-2" aria-labelledby="health">
          <h2 id="health" className="font-semibold">
            Connections
          </h2>
          {connections.length === 0 ? (
            <Card className="text-sm text-muted-foreground">
              Nothing connected yet.{" "}
              <Link href="/app/connections" className="font-medium text-primary hover:underline">
                Connect Crisp
              </Link>
            </Card>
          ) : (
            <Card className="space-y-3">
              {connections.map((c) => (
                <div key={c.id} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{NAMES[c.provider]}</span>
                    <StatusBadge status={c.status} />
                  </div>
                  {c.status !== "active" && (
                    <Link
                      href="/app/connections"
                      className={cn("text-sm font-medium text-primary hover:underline")}
                    >
                      Reconnect
                    </Link>
                  )}
                </div>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <Card className="p-5">
      <p className="text-3xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </Card>
  );
}
