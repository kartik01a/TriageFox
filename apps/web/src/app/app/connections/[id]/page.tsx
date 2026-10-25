import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { StatusBadge } from "@/components/status-badge";
import { Card } from "@/components/ui/card";
import { getConnectionView } from "@/lib/connections";
import { requireWorkspace } from "@/lib/workspace";
import { ConnectionActions } from "../connection-actions";
import { JiraPicker } from "./jira-picker";
import { TrelloPicker } from "./trello-picker";

export const metadata: Metadata = { title: "Connection" };

export default async function ConnectionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ connected?: string }>;
}) {
  const { workspace, canManage } = await requireWorkspace();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const conn = await getConnectionView(workspace.id, id.data);
  if (!conn) notFound();
  const { connected } = await searchParams;
  const meta = conn.metadata as {
    username?: string;
    siteName?: string;
    websiteName?: string;
    websiteId?: string;
    sites?: { id: string; name: string; url: string }[];
    defaults?: Record<string, unknown>;
  };
  const title =
    conn.provider === "trello"
      ? `Trello${meta.username ? ` · @${meta.username}` : ""}`
      : conn.provider === "jira"
        ? `Jira · ${meta.siteName ?? ""}`
        : `Crisp · ${meta.websiteName ?? meta.websiteId ?? ""}`;
  const d = meta.defaults as
    | {
        boardId?: string;
        listId?: string;
        cloudId?: string;
        projectKey?: string;
        issueTypeMap?: Record<string, string>;
        priorityMap?: Record<string, string>;
      }
    | undefined;

  return (
    <div className="space-y-6">
      <Link href="/app/connections" className="text-sm font-medium text-primary hover:underline">
        ← Connections
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        <StatusBadge status={conn.status} />
      </div>
      {connected && (
        <p className="rounded-lg bg-success/10 px-4 py-3 text-sm text-success" role="status">
          Connected.{" "}
          {conn.provider === "crisp"
            ? "Chats from this website can now feed an automation."
            : "Next, choose where new tickets should go."}
        </p>
      )}
      {conn.statusDetail && conn.status !== "active" && (
        <p className="rounded-lg bg-danger/10 px-4 py-3 text-sm text-danger" role="alert">
          {conn.statusDetail}
        </p>
      )}

      {canManage && conn.status === "active" && conn.provider === "trello" && (
        <Card>
          <h2 className="mb-4 font-semibold">Where should new cards go?</h2>
          <TrelloPicker
            id={conn.id}
            current={d?.boardId && d.listId ? { boardId: d.boardId, listId: d.listId } : undefined}
          />
        </Card>
      )}
      {canManage && conn.status === "active" && conn.provider === "jira" && (
        <Card>
          <h2 className="mb-4 font-semibold">Where should new issues go?</h2>
          <JiraPicker id={conn.id} sites={meta.sites ?? []} current={d} />
        </Card>
      )}

      {canManage && <ConnectionActions id={conn.id} label={title} redirectAfterDelete />}
    </div>
  );
}
