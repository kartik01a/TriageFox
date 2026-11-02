import { JiraClient, markdownToAdf, type SafeDownloadOptions } from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { type DeliverPayload, withLock } from "@triagefox/pipeline";
import { type Priority, TICKET_TYPE_LABELS, type TicketType } from "@triagefox/shared";
import { UnrecoverableError } from "bullmq";
import { type Ctx, openCredentials, updateConnection } from "../rpc/context";
import { jiraAccessToken, trello } from "../rpc/handlers";
import type { CrispSource } from "./deps";
import {
  classify,
  dueIso,
  ensureTrelloLabels,
  fileTools,
  isLinkable,
  type JiraConfig,
  jiraLabels,
  type TrelloConfig,
} from "./shared";

type Issue = typeof schema.issues.$inferSelect;
type Destination = typeof schema.automationDestinations.$inferSelect;
type Connection = typeof schema.connections.$inferSelect;

export interface DeliverDeps {
  ctx: Ctx;
  crisp: () => CrispSource;
  /** Tests inject the file host / resolver here. */
  download?: Partial<SafeDownloadOptions>;
}

export function createDeliver(deps: DeliverDeps) {
  const { ctx } = deps;
  const { filesFor, download } = fileTools(deps);
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
            const labels = await ensureTrelloLabels(
              ctx,
              p.orgId,
              client,
              dest,
              config,
              issue.priority as Priority,
              issue.type as TicketType,
            );
            const card = await client.createCard({
              listId: config.listId,
              name: issue.title.slice(0, 250),
              desc: issue.bodyMd.slice(0, 16_000),
              due: dueIso(issue.dueDate),
              labelIds: [...new Set([labels.priority, labels.type])].filter(
                (id): id is string => !!id,
              ),
            });
            created = { id: card.id, key: null, url: card.shortUrl ?? card.url };
            afterCreate = async () => {
              const files = await filesFor(issue.attachmentIds, source, thread.sourceId);
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
              labels: jiraLabels(config, issue.type as TicketType),
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
              const files = await filesFor(issue.attachmentIds, source, thread.sourceId);
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
