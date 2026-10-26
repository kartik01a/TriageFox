import {
  CRISP_FILE_HOSTS,
  type CrispMessage,
  JiraClient,
  markdownToAdf,
  ProviderError,
  type SafeDownloadOptions,
  safeDownload,
  type TrelloClient,
  UnsafeUrlError,
} from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { type DeliverPayload, withLock } from "@triagefox/pipeline";
import { RpcError } from "@triagefox/rpc";
import {
  PRIORITY_NAMES,
  type Priority,
  TICKET_TYPE_LABELS,
  type TicketType,
} from "@triagefox/shared";
import { UnrecoverableError } from "bullmq";
import { type Ctx, openCredentials, updateConnection } from "../rpc/context";
import { jiraAccessToken, trello } from "../rpc/handlers";
import type { CrispSource } from "./deps";

type Issue = typeof schema.issues.$inferSelect;
type Destination = typeof schema.automationDestinations.$inferSelect;
type Connection = typeof schema.connections.$inferSelect;
type TrelloConfig = Extract<Destination["config"], { kind: "trello" }>;
type JiraConfig = Extract<Destination["config"], { kind: "jira" }>;

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

type Outcome = "retry" | "auth" | "gone" | "invalid";
function classify(err: unknown): Outcome {
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
const isLinkable = (err: unknown) =>
  !(err instanceof UnsafeUrlError) || /too large/i.test(err.message);

const dueIso = (d: string | null) => (d ? `${d}T12:00:00.000Z` : undefined);

/**
 * Delivers one issue to one destination. Safe to run twice: the unique (issue, destination) row is
 * claimed first and a ticket that already exists is never created again.
 */
export function createDeliver(deps: DeliverDeps) {
  const { ctx } = deps;

  async function activity(
    p: DeliverPayload,
    automationId: string,
    threadId: string,
    kind: string,
    message: string,
    refs: Record<string, unknown> = {},
  ) {
    await withOrg(ctx.db, p.orgId, (tx) =>
      tx.insert(schema.activityLog).values({
        orgId: p.orgId,
        automationId,
        threadId,
        kind,
        message,
        refs: { issueId: p.issueId, destinationId: p.destinationId, ...refs },
      }),
    );
  }

  /** Finds or creates the priority and type labels on the board; remembers their ids. */
  async function trelloLabelIds(
    client: TrelloClient,
    p: DeliverPayload,
    dest: Destination,
    config: TrelloConfig,
    issue: Issue,
  ) {
    const priority = issue.priority as Priority;
    const type = issue.type as TicketType;
    const known = config.labelIds ?? {};
    const have = {
      priority: known.priorities?.[String(priority)],
      type: known.types?.[type],
    };
    if (have.priority && have.type) return [have.priority, have.type];

    const board = await client.listLabels(config.boardId);
    const find = (name: string) =>
      board.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;
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
    await withOrg(ctx.db, p.orgId, (tx) =>
      tx
        .update(schema.automationDestinations)
        .set({ config: next })
        .where(eq(schema.automationDestinations.id, dest.id)),
    );
    return [priorityId, typeId];
  }

  async function filesFor(issue: Issue, sourceConnection: Connection, sessionId: string) {
    if (issue.attachmentIds.length === 0) return [];
    const websiteId = String(sourceConnection.metadata.websiteId ?? "");
    const conversation = await deps.crisp().fetchConversation(websiteId, sessionId);
    const wanted = new Set(issue.attachmentIds);
    return conversation.messages
      .filter(
        (m): m is CrispMessage & { file: NonNullable<CrispMessage["file"]> } =>
          !!m.file && wanted.has(m.fingerprint),
      )
      .slice(0, MAX_ATTACHMENTS)
      .map((m) => m.file);
  }

  async function download(url: string) {
    const d = await safeDownload(url, {
      allowedHosts: CRISP_FILE_HOSTS,
      maxBytes: MAX_FILE_BYTES,
      ...deps.download,
    });
    return new Response(d.stream, { headers: { "content-type": d.contentType } }).blob();
  }

  return async function deliver(p: DeliverPayload, opts: { finalAttempt?: boolean } = {}) {
    const [loaded] = await withOrg(ctx.db, p.orgId, (tx) =>
      tx
        .select({ issue: schema.issues, dest: schema.automationDestinations })
        .from(schema.issues)
        .innerJoin(
          schema.automationDestinations,
          and(
            eq(schema.automationDestinations.id, p.destinationId),
            eq(schema.automationDestinations.automationId, schema.issues.automationId),
          ),
        )
        .where(eq(schema.issues.id, p.issueId)),
    );
    if (!loaded || loaded.issue.status !== "active" || !loaded.dest.enabled) return;
    const { issue, dest } = loaded;

    const [thread] = await withOrg(ctx.db, p.orgId, (tx) =>
      tx.select().from(schema.threads).where(eq(schema.threads.id, issue.originThreadId)),
    );
    const [automation] = await withOrg(ctx.db, p.orgId, (tx) =>
      tx.select().from(schema.automations).where(eq(schema.automations.id, issue.automationId)),
    );
    const [connection] = await withOrg(ctx.db, p.orgId, (tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, dest.connectionId)),
    );
    const [source] = automation
      ? await withOrg(ctx.db, p.orgId, (tx) =>
          tx
            .select()
            .from(schema.connections)
            .where(eq(schema.connections.id, automation.sourceConnectionId)),
        )
      : [];
    if (!thread || !automation || !connection || !source) return;
    const say = (kind: string, message: string, refs?: Record<string, unknown>) =>
      activity(p, automation.id, thread.id, kind, message, refs);
    const where = connection.provider === "trello" ? "Trello" : "Jira";

    await withLock(
      ctx.redis,
      `deliver:${p.issueId}:${p.destinationId}`,
      async () => {
        await withOrg(ctx.db, p.orgId, (tx) =>
          tx
            .insert(schema.destinationTickets)
            .values({ orgId: p.orgId, issueId: issue.id, destinationId: dest.id })
            .onConflictDoNothing(),
        );
        const [row] = await withOrg(ctx.db, p.orgId, (tx) =>
          tx
            .select()
            .from(schema.destinationTickets)
            .where(
              and(
                eq(schema.destinationTickets.issueId, issue.id),
                eq(schema.destinationTickets.destinationId, dest.id),
              ),
            ),
        );
        if (!row || row.status === "ok" || row.status === "broken" || row.externalId) return;

        const mark = (patch: Partial<typeof schema.destinationTickets.$inferInsert>) =>
          withOrg(ctx.db, p.orgId, (tx) =>
            tx
              .update(schema.destinationTickets)
              .set(patch)
              .where(eq(schema.destinationTickets.id, row.id)),
          );

        if (connection.status !== "active") {
          await mark({ status: "failed", lastError: `${where} needs to be reconnected.` });
          await say(
            "delivery_failed",
            `${where} is not connected, so the ticket was not sent. Reconnect it and retry.`,
          );
          return;
        }

        let created: { id: string; key: string | null; url: string };
        let afterCreate: (() => Promise<void>) | undefined;
        try {
          if (dest.config.kind === "trello") {
            const config = dest.config;
            const { token } = await openCredentials<{ token: string }>(ctx, connection);
            const client = trello(ctx, token);
            const labelIds = await trelloLabelIds(client, p, dest, config, issue);
            const card = await client.createCard({
              listId: config.listId,
              name: issue.title.slice(0, 250),
              desc: issue.bodyMd.slice(0, 16_000),
              due: dueIso(issue.dueDate),
              labelIds,
            });
            created = { id: card.id, key: null, url: card.shortUrl ?? card.url };
            afterCreate = async () => {
              const files = await filesFor(issue, source, thread.sourceId);
              for (const f of files) {
                try {
                  await client.uploadAttachment(card.id, await download(f.url), f.name);
                } catch (err) {
                  if (!isLinkable(err)) continue; // never link an unsafe address
                  await client.attachUrl(card.id, f.url, f.name);
                  await say(
                    "attachment_linked",
                    `A file was too large to upload to Trello, so it was added as a link.`,
                  );
                }
              }
            };
          } else {
            const config = dest.config as JiraConfig;
            const issueTypeId = config.issueTypeMap[issue.type];
            if (!issueTypeId) {
              await mark({
                status: "failed",
                lastError: "No Jira issue type is mapped for this ticket type.",
              });
              await say(
                "delivery_failed",
                `No Jira issue type is mapped for "${TICKET_TYPE_LABELS[issue.type as TicketType]}" tickets.`,
              );
              return;
            }
            const accessToken = await jiraAccessToken(ctx, connection);
            const client = new JiraClient({
              accessToken,
              cloudId: config.cloudId,
              fetch: ctx.fetch,
            });
            const made = await client.createIssue({
              projectKey: config.projectKey,
              issueTypeId,
              summary: issue.title.slice(0, 250),
              description: markdownToAdf(issue.bodyMd),
              labels: ["from-chat", issue.type, ...(config.extraLabels ?? [])],
            });
            const sites =
              (connection.metadata.sites as { id: string; url: string }[] | undefined) ?? [];
            const siteUrl = sites.find((s) => s.id === config.cloudId)?.url ?? "";
            created = { id: made.id, key: made.key, url: `${siteUrl}/browse/${made.key}` };
            afterCreate = async () => {
              // Priority and due date are edits: they are not on every create screen (Phase 0).
              const priorityId = config.priorityMap[String(issue.priority)];
              if (priorityId) {
                try {
                  await client.editIssue(made.key, { fields: { priority: { id: priorityId } } });
                } catch {
                  await client
                    .editIssue(made.key, {
                      update: { labels: [{ add: `priority-${issue.priority}` }] },
                    })
                    .catch(() => {});
                  await say(
                    "priority_label",
                    "This Jira project does not allow setting priority, so it was added as a label.",
                  );
                }
              }
              if (issue.dueDate) {
                await client
                  .editIssue(made.key, { fields: { duedate: issue.dueDate } })
                  .catch(() =>
                    say(
                      "due_date_skipped",
                      "This Jira project does not have a due date field, so the date was skipped.",
                    ),
                  );
              }
              const files = await filesFor(issue, source, thread.sourceId);
              for (const f of files) {
                try {
                  await client.uploadAttachment(made.key, await download(f.url), f.name);
                } catch (err) {
                  if (!isLinkable(err)) continue;
                  await client.addComment(
                    made.key,
                    markdownToAdf(`Customer file (too large to upload): [${f.name}](${f.url})`),
                  );
                  await say(
                    "attachment_linked",
                    "A file was too large to upload to Jira, so it was added as a link.",
                  );
                }
              }
            };
          }
        } catch (err) {
          const outcome = classify(err);
          if (outcome === "retry" && !opts.finalAttempt) {
            await mark({ lastError: "Temporary problem, retrying." });
            throw err;
          }
          if (outcome === "auth") {
            await updateConnection(ctx, connection, {
              status: "revoked",
              statusDetail: `${where} no longer accepts this connection. Please reconnect.`,
            });
          }
          const status = outcome === "gone" ? "broken" : "failed";
          const reason =
            outcome === "auth"
              ? `${where} no longer accepts this connection.`
              : outcome === "gone"
                ? `The ${where} board, list or project could not be found.`
                : outcome === "invalid"
                  ? `${where} rejected the ticket.`
                  : `${where} did not respond after several tries.`;
          await mark({ status, lastError: reason });
          await say("delivery_failed", reason);
          ctx.log.warn(
            { issueId: issue.id, destinationId: dest.id, outcome, err: (err as Error).message },
            "ticket delivery failed",
          );
          if (outcome === "retry") throw new UnrecoverableError(reason);
          return;
        }

        // Saved before any extras, so a crash or retry from here on can never create a second ticket.
        await mark({
          status: "ok",
          externalId: created.id,
          externalKey: created.key,
          url: created.url,
          lastError: null,
          lastPushedAt: new Date(),
        });
        await say(
          "ticket_created",
          created.key ? `Created ${where} issue ${created.key}.` : `Created a ${where} card.`,
          {
            url: created.url,
          },
        );
        try {
          await afterCreate?.();
        } catch (err) {
          ctx.log.warn({ issueId: issue.id, err: (err as Error).message }, "ticket extras failed");
          await say(
            "extras_failed",
            `The ${where} ticket was created, but some details (attachments, priority or due date) could not be added.`,
          );
        }
      },
      { ttlMs: 120_000, waitMs: 10_000 },
    );
  };
}
