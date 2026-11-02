import type { Metadata } from "next";
import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { type ConnectionView, listConnections } from "@/lib/connections";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/workspace";
import { ConnectionActions } from "./connection-actions";

export const metadata: Metadata = { title: "Connections" };

const ERRORS: Record<string, string> = {
  trello_not_configured: "Trello isn't set up on this server yet.",
  jira_not_configured: "Jira isn't set up on this server yet.",
  jira_denied: "Jira access was not granted. Connect again and choose Accept.",
  jira_state: "That Jira connection attempt expired or was invalid. Please try again.",
  jira_failed: "We couldn't finish connecting Jira. Please try again.",
  crisp_ticket: "That link expired. Open the TriageFox plugin in Crisp and continue again.",
  crisp_taken: "That Crisp website is already linked to another workspace.",
  forbidden: "Only workspace owners and admins can connect tools.",
  inbox_limit:
    "Your plan includes one connected inbox. Upgrade on the Billing page to connect another.",
};

function connectionLabel(c: ConnectionView) {
  const m = c.metadata as Record<string, string | undefined>;
  if (c.provider === "trello") return m.username ? `@${m.username}` : "Trello account";
  if (c.provider === "jira") return m.siteName ?? "Jira site";
  return m.websiteName ?? m.websiteId ?? "Crisp website";
}

function targetSummary(c: ConnectionView) {
  const d = (c.metadata as { defaults?: Record<string, string> }).defaults;
  if (!d) return c.provider === "crisp" ? null : "No target chosen yet";
  if (c.provider === "trello") return `${d.boardName} › ${d.listName}`;
  if (c.provider === "jira") return `Project ${d.projectName} (${d.projectKey})`;
  return null;
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; disconnected?: string }>;
}) {
  const { workspace, canManage } = await requireWorkspace();
  const { error, disconnected } = await searchParams;
  const all = await listConnections(workspace.id);
  const e = env();
  const providers = [
    {
      key: "crisp" as const,
      name: "Crisp",
      role: "Where customers chat",
      blurb:
        "Install the TriageFox plugin on your Crisp website, open it in your Crisp inbox and choose “Continue in TriageFox”.",
      connectHref: null as string | null,
      enabled: true,
    },
    {
      key: "trello" as const,
      name: "Trello",
      role: "Create cards",
      blurb: "Approve access on Trello. You'll then choose the board and list for new cards.",
      connectHref: "/api/connections/trello/start",
      enabled: !!e.TRELLO_API_KEY,
    },
    {
      key: "jira" as const,
      name: "Jira Cloud",
      role: "Create issues",
      blurb:
        "Approve access on Atlassian. You'll then choose the project and map issue types and priorities.",
      connectHref: "/api/connections/jira/start",
      enabled: !!e.ATLASSIAN_CLIENT_ID,
    },
  ];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Connections</h1>
        <p className="mt-1 text-muted-foreground">
          Connect where chats come from and where tickets should go.
        </p>
      </div>

      {error && (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {ERRORS[error] ?? "Something went wrong."}
        </p>
      )}
      {disconnected && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm" role="status">
          Disconnected.
        </p>
      )}
      {!canManage && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm">
          Only owners and admins can add or change connections.
        </p>
      )}

      {providers.map((p) => {
        const mine = all.filter((c) => c.provider === p.key);
        return (
          <section key={p.key} aria-labelledby={`${p.key}-title`} className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div>
                <h2 id={`${p.key}-title`} className="text-lg font-semibold">
                  {p.name}{" "}
                  <span className="text-sm font-normal text-muted-foreground">· {p.role}</span>
                </h2>
                <p className="max-w-xl text-sm text-muted-foreground">{p.blurb}</p>
              </div>
              {canManage && p.connectHref && (
                // A full page navigation (not client routing): it leaves for the provider's consent screen.
                <a
                  href={p.enabled ? p.connectHref : undefined}
                  aria-disabled={!p.enabled}
                  className={cn(
                    buttonVariants({ variant: mine.length ? "outline" : "primary", size: "sm" }),
                    !p.enabled && "pointer-events-none opacity-50",
                  )}
                >
                  {mine.length ? `Connect another ${p.name}` : `Connect ${p.name}`}
                </a>
              )}
            </div>
            {!p.enabled && (
              <p className="text-sm text-muted-foreground">
                Not configured on this server. See the setup guide.
              </p>
            )}
            {mine.length === 0 ? (
              <Card className="text-sm text-muted-foreground">Not connected yet.</Card>
            ) : (
              mine.map((c) => (
                <Card key={c.id} className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{connectionLabel(c)}</p>
                      <p className="text-sm text-muted-foreground">{targetSummary(c)}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <StatusBadge status={c.status} />
                      {c.status === "active" && p.key !== "crisp" && (
                        <Link
                          href={`/app/connections/${c.id}`}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          {c.metadata.defaults
                            ? p.key === "trello"
                              ? "Board, list & labels"
                              : "Project, mappings & labels"
                            : "Choose target"}
                        </Link>
                      )}
                      {c.status !== "active" && canManage && p.connectHref && p.enabled && (
                        // Same consent flow as connecting; the old, broken connection can be removed afterwards.
                        <a
                          href={p.connectHref}
                          className="text-sm font-medium text-primary hover:underline"
                        >
                          Reconnect
                        </a>
                      )}
                    </div>
                  </div>
                  {c.statusDetail && c.status !== "active" && (
                    <p className="text-sm text-danger" role="alert">
                      {c.statusDetail}
                    </p>
                  )}
                  {canManage && <ConnectionActions id={c.id} label={connectionLabel(c)} />}
                </Card>
              ))
            )}
          </section>
        );
      })}
    </div>
  );
}
