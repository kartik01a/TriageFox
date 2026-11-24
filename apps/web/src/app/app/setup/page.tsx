import { eq, schema, withOrg } from "@triagefox/db";
import { PROVIDER_NAMES } from "@triagefox/shared";
import { Check } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AutoRefresh,
  CreateAutomationButton,
  EnableButton,
} from "@/components/app/automation-controls";
import { DryRunPanel } from "@/components/app/dry-run-panel";
import { SettingsForm } from "@/components/app/settings-form";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getAutomation, syncDestinations } from "@/lib/automations";
import { cn } from "@/lib/cn";
import { listConnections } from "@/lib/connections";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWorkspace } from "@/lib/workspace";

export const metadata: Metadata = { title: "Setup" };

type State = "done" | "current" | "todo";

function Step({
  n,
  title,
  state,
  summary,
  children,
}: {
  n: number;
  title: string;
  state: State;
  summary?: string;
  children?: React.ReactNode;
}) {
  return (
    <li>
      <Card
        className={cn(
          "space-y-3",
          state === "current" && "border-primary/50 ring-1 ring-primary/20",
        )}
      >
        <div className="flex items-center gap-3">
          <span
            aria-hidden
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold",
              state === "done" && "bg-success text-white",
              state === "current" && "bg-primary text-primary-foreground",
              state === "todo" && "bg-muted text-muted-foreground",
            )}
          >
            {state === "done" ? <Check className="size-4" /> : n}
          </span>
          <div>
            <h2 className="font-semibold">
              {title}
              <span className="sr-only">
                {" "}
                ({state === "done" ? "done" : state === "current" ? "next" : "later"})
              </span>
            </h2>
            {summary && state !== "current" && (
              <p className="text-sm text-muted-foreground">{summary}</p>
            )}
          </div>
        </div>
        {state === "current" && children && <div className="pl-10">{children}</div>}
      </Card>
    </li>
  );
}

export default async function SetupPage() {
  const { workspace, canManage } = await requireWorkspace();
  const orgId = workspace.id;
  const e = env();
  const [connections, automationRow, aiRow] = await Promise.all([
    listConnections(orgId),
    getAutomation(orgId),
    withOrg(db(), orgId, (tx) =>
      tx
        .select({ hint: schema.aiSettings.keyHint })
        .from(schema.aiSettings)
        .where(eq(schema.aiSettings.orgId, orgId)),
    ),
  ]);
  if (automationRow) await syncDestinations(orgId, automationRow.id);
  const automation = automationRow;

  const crisp = connections.find((c) => c.provider === "crisp" && c.status === "active");
  const tools = connections.filter((c) => c.provider !== "crisp" && c.status === "active");
  const withTarget = tools.filter((c) => c.metadata.defaults);
  const needTarget = tools.filter((c) => !c.metadata.defaults);

  const destinationCount = automation
    ? (
        await withOrg(db(), orgId, (tx) =>
          tx
            .select({ id: schema.automationDestinations.id })
            .from(schema.automationDestinations)
            .where(eq(schema.automationDestinations.automationId, automation.id)),
        )
      ).length
    : 0;

  const done = {
    crisp: !!crisp,
    tool: tools.length > 0,
    target: withTarget.length > 0,
    automation: !!automation && destinationCount > 0 && automation.settings.reviewed === true,
    ai: true,
    enabled: !!automation?.enabled,
  };
  const order = ["crisp", "tool", "target", "automation", "ai", "enabled"] as const;
  const firstOpen = order.find((k) => !done[k]) ?? "enabled";
  const state = (k: (typeof order)[number]): State =>
    done[k] && k !== firstOpen ? "done" : k === firstOpen ? "current" : "todo";
  const allDone = order.every((k) => done[k]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Set up TriageFox</h1>
        <p className="mt-1 text-muted-foreground">
          About five minutes. Every step saves as you go, so you can leave and come back.
        </p>
      </div>
      {!canManage && (
        <p className="rounded-lg bg-muted px-4 py-3 text-sm">
          Only owners and admins can set things up. Ask one of them to finish this.
        </p>
      )}
      <ol className="space-y-4">
        <Step n={1} title="Connect Crisp" state={state("crisp")} summary="Crisp is connected.">
          <p className="text-sm text-muted-foreground">
            Install the TriageFox plugin on your Crisp website, open it in your Crisp inbox and
            choose “Continue in TriageFox”. This page updates by itself when it's done.
          </p>
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <span
              aria-hidden
              className="inline-block size-2 animate-pulse rounded-full bg-primary"
            />
            Waiting for Crisp…
          </p>
          <Link
            href="/app/connections"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Connection help
          </Link>
          <AutoRefresh active={state("crisp") === "current"} />
        </Step>

        <Step
          n={2}
          title="Connect where tickets go"
          state={state("tool")}
          summary={`${tools.length} connected: ${tools.map((c) => PROVIDER_NAMES[c.provider]).join(", ")}.`}
        >
          <p className="text-sm text-muted-foreground">
            Choose Trello, Jira, Linear, or several. Each ticket goes to every tool you connect.
          </p>
          <div className="mt-3 flex flex-wrap gap-3">
            <a
              href={e.TRELLO_API_KEY ? "/api/connections/trello/start" : undefined}
              aria-disabled={!e.TRELLO_API_KEY}
              className={cn(
                buttonVariants({ size: "md" }),
                !e.TRELLO_API_KEY && "pointer-events-none opacity-50",
              )}
            >
              Connect Trello
            </a>
            <a
              href={e.ATLASSIAN_CLIENT_ID ? "/api/connections/jira/start" : undefined}
              aria-disabled={!e.ATLASSIAN_CLIENT_ID}
              className={cn(
                buttonVariants({ size: "md" }),
                !e.ATLASSIAN_CLIENT_ID && "pointer-events-none opacity-50",
              )}
            >
              Connect Jira
            </a>
            {e.LINEAR_CLIENT_ID && (
              <a href="/api/connections/linear/start" className={buttonVariants({ size: "md" })}>
                Connect Linear
              </a>
            )}
          </div>
        </Step>

        <Step
          n={3}
          title="Choose the board, project or team"
          state={state("target")}
          summary="Targets chosen."
        >
          <ul className="space-y-2 text-sm">
            {needTarget.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2">
                <span>{PROVIDER_NAMES[c.provider]}: no target chosen yet</span>
                <Link href={`/app/connections/${c.id}`} className={buttonVariants({ size: "sm" })}>
                  Choose
                </Link>
              </li>
            ))}
          </ul>
        </Step>

        <Step
          n={4}
          title="Ticket settings"
          state={state("automation")}
          summary="Review the settings on the Automation page any time."
        >
          {!automation ? (
            <CreateAutomationButton label="Continue to settings" />
          ) : (
            <SettingsForm
              automationId={automation.id}
              canManage={canManage}
              initial={{
                includeSourceLink: automation.settings.includeSourceLink,
                includeCustomerNames: automation.settings.includeCustomerNames,
                minConfidence: automation.settings.minConfidence,
                quietWindowSec: automation.settings.quietWindowSec,
                timezone: automation.settings.timezone,
                language: automation.settings.language,
              }}
            />
          )}
        </Step>

        <Step
          n={5}
          title="AI"
          state={state("ai")}
          summary={
            aiRow[0]?.hint
              ? `Using your own OpenAI key (${aiRow[0].hint}).`
              : "Using the included TriageFox AI."
          }
        >
          <p className="text-sm text-muted-foreground">
            {aiRow[0]?.hint
              ? `You're using your own OpenAI key (${aiRow[0].hint}).`
              : "TriageFox AI is included. You can also use your own OpenAI key to pay OpenAI directly."}
          </p>
          <Link
            href="/app/settings/ai"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "mt-3")}
          >
            Use my own key
          </Link>
        </Step>

        <Step
          n={6}
          title="Check it, then turn it on"
          state={state("enabled")}
          summary="The automation is on."
        >
          {automation && canManage ? (
            <div className="space-y-3">
              <DryRunPanel automationId={automation.id} />
              <p className="text-sm text-muted-foreground">
                We'll create your first ticket as soon as a customer reports a bug.
              </p>
              <EnableButton id={automation.id} enabled={automation.enabled} />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Finish the steps above first.</p>
          )}
        </Step>
      </ol>
      {allDone && (
        <Card className="border-success/40 bg-success/5 text-sm">
          <p className="font-semibold">You're all set.</p>
          <p className="mt-1 text-muted-foreground">
            Watch decisions appear on the{" "}
            <Link href="/app/activity" className="font-medium text-primary hover:underline">
              Activity page
            </Link>
            .
          </p>
        </Card>
      )}
    </div>
  );
}
