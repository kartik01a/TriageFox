import {
  CRISP_FILE_HOSTS,
  type CrispMessage,
  ProviderError,
  type SafeDownloadOptions,
  safeDownload,
  type TrelloClient,
  UnsafeUrlError,
} from "@triagefox/connectors";
import { eq, schema, withOrg } from "@triagefox/db";
import { RpcError } from "@triagefox/rpc";
import {
  PRIORITY_NAMES,
  type Priority,
  TICKET_TYPE_LABELS,
  type TicketType,
} from "@triagefox/shared";
import type { Ctx } from "../rpc/context";
import type { CrispSource } from "./deps";

type Destination = typeof schema.automationDestinations.$inferSelect;
type Connection = typeof schema.connections.$inferSelect;
export type TrelloConfig = Extract<Destination["config"], { kind: "trello" }>;
export type JiraConfig = Extract<Destination["config"], { kind: "jira" }>;

const MAX_ATTACHMENTS = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;

const PRIORITY_COLOR: Record<Priority, string> = {
  5: "red",
  4: "orange",
  3: "yellow",
  2: "lime",
  1: "green",
};
const TYPE_COLOR: Record<TicketType, string> = {
  bug: "blue",
  ui_ux: "sky",
  feature: "purple",
  improvement: "pink",
  performance: "sky",
  infra: "black",
  security: "black",
  data: "purple",
};
export const priorityLabelName = (p: Priority) => `P${p} ${PRIORITY_NAMES[p]}`;

export interface DeliverDeps {
  ctx: Ctx;
  crisp: () => CrispSource;
  /** Tests inject the file host / resolver here. */
  download?: Partial<SafeDownloadOptions>;
}

export type Outcome = "retry" | "auth" | "gone" | "invalid";
export function classify(err: unknown): Outcome {
  if (err instanceof ProviderError) {
    if (err.kind === "auth") return "auth";
    if (err.kind === "not_found") return "gone";
    if (err.kind === "invalid") return "invalid";
    return "retry";
  }
  if (err instanceof RpcError) {
    if (err.code === "auth_expired") return "auth";
    if (err.code === "not_found") return "gone";
    if (err.code === "invalid" || err.code === "not_configured") return "invalid";
    return "retry";
  }
  return "retry";
}

/** An oversize file is linked instead; a file from a disallowed or private address is dropped. */
export const isLinkable = (err: unknown) =>
  !(err instanceof UnsafeUrlError) || /too large/i.test(err.message);

export const dueIso = (d: string | null) => (d ? `${d}T12:00:00.000Z` : undefined);

/** Finds or creates the priority and type labels on the board; remembers their ids. */
export async function ensureTrelloLabels(
  ctx: Ctx,
  orgId: string,
  client: TrelloClient,
  dest: Destination,
  config: TrelloConfig,
  priority: Priority,
  type: TicketType,
) {
  const known = config.labelIds ?? {};
  const have = {
    priority: known.priorities?.[String(priority)],
    type: known.types?.[type],
  };
  if (have.priority && have.type) return [have.priority, have.type];

  const board = await client.listLabels(config.boardId);
  const find = (name: string) => board.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;
  const priorityId =
    have.priority ??
    find(priorityLabelName(priority)) ??
    (
      await client.createLabel(
        config.boardId,
        priorityLabelName(priority),
        PRIORITY_COLOR[priority],
      )
    ).id;
  const typeId =
    have.type ??
    find(TICKET_TYPE_LABELS[type]) ??
    (await client.createLabel(config.boardId, TICKET_TYPE_LABELS[type], TYPE_COLOR[type])).id;
  const next: TrelloConfig = {
    ...config,
    labelIds: {
      priorities: { ...known.priorities, [String(priority)]: priorityId },
      types: { ...known.types, [type]: typeId },
    },
  };
  await withOrg(ctx.db, orgId, (tx) =>
    tx
      .update(schema.automationDestinations)
      .set({ config: next })
      .where(eq(schema.automationDestinations.id, dest.id)),
  );
  return [priorityId, typeId];
}

export interface FileDeps {
  crisp: () => CrispSource;
  /** Tests inject the file host / resolver here. */
  download?: Partial<SafeDownloadOptions>;
}

/** Customer files for a ticket: looked up in the live conversation (never stored) and downloaded safely. */
export function fileTools(deps: FileDeps) {
  return {
    async filesFor(ids: string[], sourceConnection: Connection, sessionId: string) {
      if (ids.length === 0) return [];
      const websiteId = String(sourceConnection.metadata.websiteId ?? "");
      const conversation = await deps.crisp().fetchConversation(websiteId, sessionId);
      const wanted = new Set(ids);
      return conversation.messages
        .filter(
          (m): m is CrispMessage & { file: NonNullable<CrispMessage["file"]> } =>
            !!m.file && wanted.has(m.fingerprint),
        )
        .slice(0, MAX_ATTACHMENTS)
        .map((m) => m.file);
    },
    async download(url: string) {
      const d = await safeDownload(url, {
        allowedHosts: CRISP_FILE_HOSTS,
        maxBytes: MAX_FILE_BYTES,
        ...deps.download,
      });
      return new Response(d.stream, { headers: { "content-type": d.contentType } }).blob();
    },
  };
}
