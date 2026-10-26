import type { Metadata } from "next";
import Link from "next/link";
import { DestinationToggle, EnableButton, RetryButton } from "@/components/app/automation-controls";
import { DryRunPanel } from "@/components/app/dry-run-panel";
import { SettingsForm } from "@/components/app/settings-form";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { automationOverview } from "@/lib/automations";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Automation" };

export default async function AutomationPage() {
  const { workspace, canManage } = await requireWorkspace();
  const o = await automationOverview(workspace.id);

  if (!o) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold tracking-tight">Automation</h1>
        <Card className="space-y-3">
          <p className="text-sm text-muted-foreground">
            There is no automation yet. Connect Crisp, then follow the setup steps.
          </p>
          <Link href="/app/setup" className={buttonVariants({ size: "md" })}>
            Open setup
          </Link>
        </Card>
      </div>
    );
  }

  const { automation, source, destinations, failedTickets } = o;
  const sourceName =
    (source?.metadata as { websiteName?: string; websiteId?: string } | undefined)?.websiteName ??
    "Crisp";
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Automation</h1>
          <p className="mt-1 text-muted-foreground">
            {automation.enabled
              ? "On. New chats are read and turned into tickets."
              : "Paused. Nothing is created until you turn it on."}
          </p>
        </div>
        {canManage && <EnableButton id={automation.id} enabled={automation.enabled} />}
      </div>

      <section aria-labelledby="flow" className="space-y-3">
        <h2 id="flow" className="font-semibold">
          Where chats go
        </h2>
        <div className="grid items-stretch gap-3 md:grid-cols-[1fr_auto_1fr]">
          <Card className="space-y-1 p-5">
            <p className="text-xs font-semibold uppercase text-muted-foreground">From</p>
            <p className="font-medium">{sourceName}</p>
            {source && <StatusBadge status={source.status} />}
          </Card>
          <div aria-hidden className="hidden items-center text-2xl text-muted-foreground md:flex">
            →
          </div>
          <div className="space-y-3">
            {destinations.length === 0 ? (
              <Card className="space-y-2 p-5 text-sm text-muted-foreground">
                No destination yet.
                <Link
                  href="/app/connections"
                  className="block font-medium text-primary hover:underline"
                >
                  Connect Trello or Jira
                </Link>
              </Card>
            ) : (
              destinations.map((d) => (
                <Card key={d.id} className="space-y-2 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{d.provider === "trello" ? "Trello" : "Jira"}</p>
                    <StatusBadge status={d.connectionStatus} />
                  </div>
                  <p className="text-sm text-muted-foreground">{d.target}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.ok} sent{d.failed ? ` · ${d.failed} failed` : ""}
                  </p>
                  {d.connectionStatus !== "active" && (
                    <Link
                      href="/app/connections"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Reconnect
                    </Link>
                  )}
                  {canManage && (
                    <DestinationToggle
                      automationId={automation.id}
                      destinationId={d.id}
                      enabled={d.enabled}
                      label={d.provider === "trello" ? "Trello" : "Jira"}
                    />
                  )}
                </Card>
              ))
            )}
          </div>
        </div>
      </section>

      {failedTickets.length > 0 && (
        <section aria-labelledby="failed" className="space-y-3">
          <h2 id="failed" className="font-semibold text-danger">
            Tickets that didn't arrive
          </h2>
          <Card className="divide-y divide-border p-0">
            {failedTickets.map((t) => (
              <div
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm"
              >
                <div>
                  <p className="font-medium">{t.title}</p>
                  <p className="text-muted-foreground">{t.error}</p>
                </div>
                {canManage && <RetryButton ticketId={t.id} />}
              </div>
            ))}
          </Card>
        </section>
      )}

      {canManage && (
        <section aria-labelledby="dry" className="space-y-3">
          <h2 id="dry" className="font-semibold">
            Try it on recent chats
          </h2>
          <Card>
            <DryRunPanel automationId={automation.id} />
          </Card>
        </section>
      )}

      <section aria-labelledby="settings" className="space-y-3">
        <h2 id="settings" className="font-semibold">
          Ticket settings
        </h2>
        <Card>
          <SettingsForm
            automationId={automation.id}
            initial={{
              includeSourceLink: automation.settings.includeSourceLink,
              includeCustomerNames: automation.settings.includeCustomerNames,
              minConfidence: automation.settings.minConfidence,
              quietWindowSec: automation.settings.quietWindowSec,
              timezone: automation.settings.timezone,
              language: automation.settings.language,
            }}
            canManage={canManage}
          />
        </Card>
      </section>
    </div>
  );
}
