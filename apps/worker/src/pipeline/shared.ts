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

/**
 * The labels a card gets for this priority and type. The customer's own choice (`labelMap`, ADR 0013)
 * wins: a label they picked, or none. Anything they left on default gets the default label, found or
 * created on the board, with its id remembered. A picked label that was deleted from the board since is
 * skipped rather than failing the card.
 */
export async function ensureTrelloLabels(
  ctx: Ctx,
  orgId: string,
  client: TrelloClient,
  dest: Destination,
  config: TrelloConfig,
  priority: Priority,
  type: TicketType,
): Promise<{ priority?: string; type?: string }> {
  const map = config.labelMap ?? {};
  const chosen = <K extends string>(m: Record<string, string | null> | undefined, key: K) =>
    m && Object.hasOwn(m, key)
      ? { set: true as const, id: m[key] ?? null }
      : { set: false as const };
  const pChoice = chosen(map.priorities, String(priority));
  const tChoice = chosen(map.types, type);

  const known = config.labelIds ?? {};
  const cachedP = pChoice.set ? undefined : known.priorities?.[String(priority)];
  const cachedT = tChoice.set ? undefined : known.types?.[type];
  const needBoard =
    (pChoice.set ? !!pChoice.id : !cachedP) || (tChoice.set ? !!tChoice.id : !cachedT);
  const board = needBoard ? await client.listLabels(config.boardId) : [];
  const exists = (id: string | null) => (id && board.some((l) => l.id === id) ? id : undefined);
  const find = (name: string) => board.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;

  const defaultP = async () =>
    find(priorityLabelName(priority)) ??
    (
      await client.createLabel(
        config.boardId,
        priorityLabelName(priority),
        PRIORITY_COLOR[priority],
      )
    ).id;
  const defaultT = async () =>
    find(TICKET_TYPE_LABELS[type]) ??
    (await client.createLabel(config.boardId, TICKET_TYPE_LABELS[type], TYPE_COLOR[type])).id;
  const priorityId = pChoice.set ? exists(pChoice.id) : (cachedP ?? (await defaultP()));
  const typeId = tChoice.set ? exists(tChoice.id) : (cachedT ?? (await defaultT()));

  // A default label that was just found or created is remembered, so the next card needs no lookup.
  const remember = (!pChoice.set && priorityId !== cachedP) || (!tChoice.set && typeId !== cachedT);
  if (remember) {
    const next: TrelloConfig = {
      ...config,
      labelIds: {
        priorities: {
          ...known.priorities,
          ...(!pChoice.set && priorityId ? { [String(priority)]: priorityId } : {}),
        },
        types: { ...known.types, ...(!tChoice.set && typeId ? { [type]: typeId } : {}) },
      },
    };
    await withOrg(ctx.db, orgId, (tx) =>
      tx
        .update(schema.automationDestinations)
        .set({ config: next })
        .where(eq(schema.automationDestinations.id, dest.id)),
    );
  }
  return { priority: priorityId, type: typeId };
}

/** Jira labels for a new issue: "from-chat", the type's label (the customer's choice, ADR 0013), extras. */
export function jiraLabels(config: JiraConfig, type: TicketType) {
  const chosen = config.typeLabels && Object.hasOwn(config.typeLabels, type);
  const typeLabel = chosen ? config.typeLabels?.[type] : type;
  return [
    ...new Set(["from-chat", ...(typeLabel ? [typeLabel] : []), ...(config.extraLabels ?? [])]),
  ];
}

/** Every label id that stands for a priority on this board (default or chosen), to swap on a change. */
export function trelloPriorityLabelIds(config: TrelloConfig) {
  return new Set(
    [
      ...Object.values(config.labelIds?.priorities ?? {}),
      ...Object.values(config.labelMap?.priorities ?? {}),
    ].filter((id): id is string => !!id),
  );
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
