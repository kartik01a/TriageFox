import {
  JiraClient,
  linearFileMarkdown,
  linearPriority,
  markdownToAdf,
  ProviderError,
} from "@triagefox/connectors";
import { openSecret } from "@triagefox/crypto";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { type DeliverPayload, type UpdatePayload, withLock } from "@triagefox/pipeline";
import type { Priority, TicketType } from "@triagefox/shared";
import { UnrecoverableError } from "bullmq";
import { openCredentials, updateConnection } from "../rpc/context";
import { jiraAccessToken, linearClient, trello } from "../rpc/handlers";
import type { DeliverDeps } from "./deliver";
import {
  classify,
  dueIso,
  ensureTrelloLabels,
  fileTools,
  isLinkable,
  type JiraConfig,
  type TrelloConfig,
  trelloPriorityLabelIds,
} from "./shared";

export interface UpdateDeps extends DeliverDeps {
  /** Queues delivery of a brand new issue (used for a regression of a closed ticket). */
  enqueueDelivery: (payload: DeliverPayload) => Promise<unknown>;
}

const HEADINGS = {
  update: "Customer added:",
  duplicate: "Another customer reported this:",
  resolved_in_chat: "Possibly resolved in chat:",
} as const;

/**
 * Tells one destination about an update: a comment, new files, a changed priority or due date, and a
 * refreshed footer when no person has edited the description. Safe to run twice (`applied_to`).
 */
export function createUpdate(deps: UpdateDeps) {
  const { ctx } = deps;
  const { filesFor, download } = fileTools(deps);

  return async function applyUpdate(p: UpdatePayload, opts: { finalAttempt?: boolean } = {}) {
    const one = async <T>(fn: (tx: Parameters<Parameters<typeof withOrg>[2]>[0]) => Promise<T[]>) =>
      (await withOrg(ctx.db, p.orgId, fn))[0];

    const update = await one((tx) =>
      tx.select().from(schema.issueUpdates).where(eq(schema.issueUpdates.id, p.updateId)),
    );
    if (!update || update.appliedTo.includes(p.destinationId)) return;
    const issue = await one((tx) =>
      tx.select().from(schema.issues).where(eq(schema.issues.id, update.issueId)),
    );
    const dest = await one((tx) =>
      tx
        .select()
        .from(schema.automationDestinations)
        .where(eq(schema.automationDestinations.id, p.destinationId)),
    );
    if (!issue || !dest || !dest.enabled) return;
    const connection = await one((tx) =>
      tx.select().from(schema.connections).where(eq(schema.connections.id, dest.connectionId)),
    );
    const thread = await one((tx) =>
      tx.select().from(schema.threads).where(eq(schema.threads.id, update.threadId)),
    );
    const automation = await one((tx) =>
      tx.select().from(schema.automations).where(eq(schema.automations.id, issue.automationId)),
    );
    const source = automation
      ? await one((tx) =>
          tx
            .select()
            .from(schema.connections)
            .where(eq(schema.connections.id, automation.sourceConnectionId)),
        )
      : undefined;
    const ticket = await one((tx) =>
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
    if (!connection || !thread || !automation || !source) return;
    const where = ({ crisp: "Crisp", trello: "Trello", jira: "Jira", linear: "Linear" } as const)[
      connection.provider
    ];
    const say = (kind: string, message: string, refs: Record<string, unknown> = {}) =>
      withOrg(ctx.db, p.orgId, (tx) =>
        tx.insert(schema.activityLog).values({
          orgId: p.orgId,
          automationId: automation.id,
          threadId: thread.id,
          kind,
          message,
          refs: { issueId: issue.id, updateId: update.id, destinationId: dest.id, ...refs },
        }),
      );
    const markApplied = () =>
      withOrg(ctx.db, p.orgId, async (tx) => {
        const [fresh] = await tx
          .select({ appliedTo: schema.issueUpdates.appliedTo })
          .from(schema.issueUpdates)
          .where(eq(schema.issueUpdates.id, update.id));
        await tx
          .update(schema.issueUpdates)
          .set({ appliedTo: [...new Set([...(fresh?.appliedTo ?? []), dest.id])] })
          .where(eq(schema.issueUpdates.id, update.id));
      });

    // The ticket is created by a separate job; wait for it (retry with backoff) instead of losing the update.
    if (!ticket || ticket.status === "pending") {
      if (opts.finalAttempt) {
        await markApplied();
        await say(
          "update_skipped",
          `The ${where} ticket was never created, so a follow-up was not sent.`,
        );
        return;
      }
      throw new Error("ticket not delivered yet");
    }
    if (ticket.status !== "ok" || !ticket.externalId) {
      await markApplied();
      return;
    }
    if (connection.status !== "active") {
      await markApplied();
      await say("update_skipped", `${where} is not connected, so a follow-up was not sent.`);
      return;
    }

    await withLock(
      ctx.redis,
      `update:${update.id}:${dest.id}`,
      async () => {
        const text = JSON.parse(
          await openSecret(
            update.contentSealed,
            { orgId: p.orgId, recordId: update.id, purpose: "issue_update.content" },
            ctx.keyring,
          ),
        ) as { text: string };
        let comment = `**${HEADINGS[update.kind]}**\n\n${text.text}`;
        if (update.kind === "duplicate" && update.customerRef)
          comment = `**Another customer (${update.customerRef}) reported this:**\n\n${text.text}`;

        let extras: (() => Promise<void>) | undefined;
        try {
          if (dest.config.kind === "trello") {
            const config = dest.config as TrelloConfig;
            const { token } = await openCredentials<{ token: string }>(ctx, connection);
            const client = trello(ctx, token);
            const card = await client.getCard(ticket.externalId as string);

            if ((card.closed || card.dueComplete) && update.kind === "duplicate") {
              await regression(issue, ticket.url, update, comment, "Trello");
              await markApplied();
              return;
            }
            await client.addComment(ticket.externalId as string, comment);
            await markApplied();
            await say("ticket_updated", "Added a comment to the Trello card.", { url: ticket.url });

            extras = async () => {
              const cardId = ticket.externalId as string;
              if (update.newPriority) {
                const { priority: priorityId } = await ensureTrelloLabels(
                  ctx,
                  p.orgId,
                  client,
                  dest,
                  config,
                  update.newPriority as Priority,
                  issue.type as TicketType,
                );
                const old = trelloPriorityLabelIds(config);
                const labels = card.idLabels.filter((id) => !old.has(id) || id === priorityId);
                const next = [...new Set([...labels, ...(priorityId ? [priorityId] : [])])];
                if (next.join() !== card.idLabels.join())
                  await client.updateCard(cardId, { idLabels: next });
              }
              if (update.newDueDate)
                await client.updateCard(cardId, { due: dueIso(update.newDueDate) });
              for (const f of await filesFor(update.attachmentIds, source, thread.sourceId)) {
                try {
                  await client.uploadAttachment(cardId, await download(f.url), f.name);
                } catch (err) {
                  if (isLinkable(err)) await client.attachUrl(cardId, f.url, f.name);
                }
              }
              if (
                update.kind !== "resolved_in_chat" &&
                !(await humanEdited(
                  () => client.descriptionEdits(cardId),
                  (e) => e.byMemberId !== String(connection.metadata.memberId ?? ""),
                  ticket.lastPushedAt,
                ))
              ) {
                await client.updateCard(cardId, { desc: issue.bodyMd.slice(0, 16_000) });
                await touch(ticket.id);
              } else if (update.kind !== "resolved_in_chat") {
                await say(
                  "description_kept",
                  "Someone edited the Trello card description, so it was left as it is.",
                );
              }
            };
          } else if (dest.config.kind === "linear") {
            const client = await linearClient(ctx, connection);
            const id = ticket.externalId as string;
            const current = await client.getIssue(id);
            if (!current || current.trashed)
              throw new ProviderError("linear", "not_found", "linear issue is gone");
            const done = ["completed", "canceled"].includes(current.state?.type ?? "");
            if (update.kind === "duplicate" && done) {
              await regression(issue, ticket.url, update, comment, "Linear");
              await markApplied();
              return;
            }
            await client.addComment(id, comment);
            await markApplied();
            await say(
              "ticket_updated",
              `Added a comment to ${ticket.externalKey ?? "the Linear issue"}.`,
              {
                url: ticket.url,
              },
            );

            extras = async () => {
              const patch: { priority?: number; dueDate?: string } = {};
              if (update.newPriority) patch.priority = linearPriority(update.newPriority);
              if (update.newDueDate) patch.dueDate = update.newDueDate;
              if (patch.priority !== undefined || patch.dueDate)
                await client.updateIssue(id, patch);
              const lines: string[] = [];
              for (const f of await filesFor(update.attachmentIds, source, thread.sourceId)) {
                try {
                  const blob = await download(f.url);
                  lines.push(
                    linearFileMarkdown(f.name, await client.uploadFile(blob, f.name), blob.type),
                  );
                } catch (err) {
                  if (isLinkable(err)) lines.push(`[${f.name.replace(/[[\]()]/g, " ")}](${f.url})`);
                }
              }
              if (lines.length)
                await client.addComment(
                  id,
                  `**New files from the customer**\n\n${lines.join("\n\n")}`,
                );
              if (update.kind === "resolved_in_chat") return;
              // TriageFox's own app user may rewrite; anyone else's edit is kept.
              const me = String(connection.metadata.appUserId ?? "");
              if (
                !(await humanEdited(
                  () => client.descriptionEdits(id),
                  (e) => !e.bot && (!me || e.byUserId !== me),
                  ticket.lastPushedAt,
                ))
              ) {
                await client.updateIssue(id, { description: issue.bodyMd.slice(0, 100_000) });
                await touch(ticket.id);
              } else {
                await say(
                  "description_kept",
                  "Someone edited the Linear description, so it was left as it is.",
                );
              }
            };
          } else {
            const config = dest.config as JiraConfig;
            const client = new JiraClient({
              accessToken: await jiraAccessToken(ctx, connection),
              cloudId: config.cloudId,
              fetch: ctx.fetch,
            });
            const key = ticket.externalKey as string;
            if (update.kind === "duplicate" && (await client.isDone(key))) {
              await regression(issue, ticket.url, update, comment, "Jira");
              await markApplied();
              return;
            }
            await client.addComment(key, markdownToAdf(comment));
            await markApplied();
            await say("ticket_updated", `Added a comment to ${key}.`, { url: ticket.url });

            extras = async () => {
              if (update.newPriority) {
                const id = config.priorityMap[String(update.newPriority)];
                if (id) await client.editIssue(key, { fields: { priority: { id } } });
              }
              if (update.newDueDate)
                await client.editIssue(key, { fields: { duedate: update.newDueDate } });
              for (const f of await filesFor(update.attachmentIds, source, thread.sourceId)) {
                try {
                  await client.uploadAttachment(key, await download(f.url), f.name);
                } catch (err) {
                  if (isLinkable(err))
                    await client.addComment(
                      key,
                      markdownToAdf(`Customer file: [${f.name}](${f.url})`),
                    );
                }
              }
              if (update.kind === "resolved_in_chat") return;
              const me = (await client.myself()).accountId;
              if (
                !(await humanEdited(
                  () => client.descriptionEdits(key),
                  (e) => e.byAccountId !== me,
                  ticket.lastPushedAt,
                ))
              ) {
                await client.editIssue(key, {
                  fields: { description: markdownToAdf(issue.bodyMd) },
                });
                await touch(ticket.id);
              } else {
                await say(
                  "description_kept",
                  "Someone edited the Jira description, so it was left as it is.",
                );
              }
            };
          }
        } catch (err) {
          const outcome = classify(err);
          if (outcome === "retry" && !opts.finalAttempt) throw err;
          if (outcome === "auth")
            await updateConnection(ctx, connection, {
              status: "revoked",
              statusDetail: `${where} no longer accepts this connection. Please reconnect.`,
            });
          await markApplied();
          await say(
            "update_failed",
            outcome === "gone"
              ? `The ${where} ticket no longer exists, so a follow-up was not sent.`
              : `A follow-up could not be sent to ${where}.`,
          );
          ctx.log.warn(
            { issueId: issue.id, outcome, err: (err as Error).message },
            "ticket update failed",
          );
          if (outcome === "retry") throw new UnrecoverableError("update failed");
          return;
        }

        try {
          await extras?.();
        } catch (err) {
          ctx.log.warn(
            { issueId: issue.id, err: (err as Error).message },
            "ticket update extras failed",
          );
          await say(
            "extras_failed",
            `The comment reached ${where}, but some details (priority, due date, files) could not be updated.`,
          );
        }
      },
      { ttlMs: 120_000, waitMs: 10_000 },
    );

    /** Records that we just wrote to the ticket, so later human edits are told apart from ours. */
    async function touch(ticketId: string) {
      await withOrg(ctx.db, p.orgId, (tx) =>
        tx
          .update(schema.destinationTickets)
          .set({ lastPushedAt: new Date() })
          .where(eq(schema.destinationTickets.id, ticketId)),
      );
    }

    /** A duplicate of a ticket that is already closed is probably a regression: open a new ticket that points to the old one. */
    async function regression(
      old: typeof schema.issues.$inferSelect,
      oldUrl: string | null,
      u: typeof schema.issueUpdates.$inferSelect,
      _comment: string,
      tool: string,
    ) {
      const [created] = await withOrg(ctx.db, p.orgId, async (tx) => {
        const rows = await tx
          .insert(schema.issues)
          .values({
            orgId: p.orgId,
            automationId: old.automationId,
            originThreadId: u.threadId,
            title: `${old.title.slice(0, 100)} (again)`,
            summary: old.summary,
            bodyMd: `${old.bodyMd}\n\nPossible regression: ${oldUrl ?? "an earlier ticket"} was already closed.`,
            type: old.type,
            priority: old.priority,
            dueDate: null,
            confidence: old.confidence,
            attachmentIds: u.attachmentIds,
            status: "active",
          })
          .returning({ id: schema.issues.id });
        if (rows[0])
          await tx.insert(schema.issueReports).values({
            orgId: p.orgId,
            issueId: rows[0].id,
            threadId: u.threadId,
            customerRef: u.customerRef,
          });
        return rows;
      });
      if (created)
        await deps.enqueueDelivery({
          orgId: p.orgId,
          issueId: created.id,
          destinationId: p.destinationId,
        });
      await say(
        "regression",
        `The matching ${tool} ticket was already closed, so a new ticket was opened that points to it.`,
      );
    }
  };
}

/** True when someone other than us changed the description after our last write. If we cannot tell, assume yes. */
async function humanEdited<T extends { at: string }>(
  load: () => Promise<T[]>,
  byOther: (e: T) => boolean,
  since: Date | null,
): Promise<boolean> {
  try {
    const edits = await load();
    return edits.some((e) => byOther(e) && (!since || Date.parse(e.at) > since.getTime()));
  } catch {
    return true;
  }
}
