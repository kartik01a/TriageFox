import type { TriageResult } from "@triagefox/ai";
import { buildTicketBody, refreshTicketFooter } from "@triagefox/connectors";
import { type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import type { Db } from "@triagefox/db";
import { and, eq, ne, schema, withOrg } from "@triagefox/db";
import type { DeliverPayload, UpdatePayload } from "@triagefox/pipeline";
import type { Priority } from "@triagefox/shared";
import type { TriageInput } from "./deps";

type Entry = { kind: string; message: string; refs: Record<string, unknown> };

export interface Applied {
  deliveries: DeliverPayload[];
  updates: UpdatePayload[];
  /** New issues, to be embedded after the transaction. */
  created: { id: string; title: string; summary: string }[];
}

export function reportedByText(count: number, refs: (string | null)[], allowNames: boolean) {
  if (allowNames && refs.length === count && refs.every(Boolean)) return refs.join(", ");
  return count === 1 ? "1 customer" : `${count} customers`;
}

/**
 * Saves what the AI decided: issues for new problems, updates for follow-ups, reports for duplicates.
 * Everything lands in one transaction; jobs are queued by the caller afterwards.
 */
export async function applyResult(args: {
  db: Db;
  keyring: PrivateKeyring;
  input: TriageInput;
  result: TriageResult;
  runId: string;
  entries: Entry[];
}): Promise<Applied> {
  const { db, keyring, input, result, runId, entries } = args;
  const { orgId, thread, automation, conversation } = input;
  const allowNames = automation.settings.includeCustomerNames;
  const customerName = allowNames ? (conversation.customer.nickname ?? null) : null;
  const out: Applied = { deliveries: [], updates: [], created: [] };

  await withOrg(db, orgId, async (tx) => {
    const destinations = await tx
      .select({ id: schema.automationDestinations.id })
      .from(schema.automationDestinations)
      .where(
        and(
          eq(schema.automationDestinations.automationId, automation.id),
          eq(schema.automationDestinations.enabled, true),
        ),
      );

    const queueUpdate = async (
      issue: typeof schema.issues.$inferSelect,
      kind: "update" | "duplicate" | "resolved_in_chat",
      text: string,
      extra: { attachmentIds: string[]; newPriority: number | null; newDueDate: string | null },
    ) => {
      if (issue.status !== "active") return; // nothing exists in the trackers yet
      const id = crypto.randomUUID();
      const contentSealed = await sealSecret(
        JSON.stringify({ text }),
        { orgId, recordId: id, purpose: "issue_update.content" },
        keyring,
      );
      await tx.insert(schema.issueUpdates).values({
        id,
        orgId,
        issueId: issue.id,
        threadId: thread.id,
        kind,
        contentSealed,
        attachmentIds: extra.attachmentIds,
        newPriority: extra.newPriority,
        newDueDate: extra.newDueDate,
        customerRef: kind === "duplicate" ? customerName : null,
      });
      for (const d of destinations) out.updates.push({ orgId, updateId: id, destinationId: d.id });
    };

    const reportedBy = async (issueId: string, count: number) => {
      const refs = await tx
        .select({ ref: schema.issueReports.customerRef })
        .from(schema.issueReports)
        .where(eq(schema.issueReports.issueId, issueId));
      return reportedByText(
        count,
        refs.map((r) => r.ref),
        allowNames,
      );
    };

    for (const a of result.actions) {
      if (a.kind === "create" && a.type && a.priority) {
        const [issue] = await tx
          .insert(schema.issues)
          .values({
            orgId,
            automationId: automation.id,
            originThreadId: thread.id,
            aiRunId: runId,
            title: a.title,
            summary: a.summary,
            bodyMd: buildTicketBody(
              { ...a, type: a.type, priority: a.priority },
              {
                reportedBy: customerName ?? "1 customer",
                sourceUrl: automation.settings.includeSourceLink
                  ? `https://app.crisp.chat/website/${conversation.websiteId}/inbox/${conversation.sessionId}/`
                  : undefined,
              },
            ),
            type: a.type,
            priority: a.priority,
            dueDate: a.dueDate,
            dueDateQuote: a.dueDateQuote,
            confidence: a.confidence,
            attachmentIds: a.relevantAttachmentIds,
            status: a.needsReview ? "pending_review" : "active",
          })
          .returning({ id: schema.issues.id });
        if (!issue) continue;
        await tx.insert(schema.issueReports).values({
          orgId,
          issueId: issue.id,
          threadId: thread.id,
          customerRef: customerName,
        });
        out.created.push({ id: issue.id, title: a.title, summary: a.summary });
        if (a.needsReview) continue;
        if (destinations.length === 0)
          entries.push({
            kind: "no_destination",
            message: "A ticket was prepared, but no Trello or Jira destination is set up yet.",
            refs: { issueId: issue.id },
          });
        for (const d of destinations)
          out.deliveries.push({ orgId, issueId: issue.id, destinationId: d.id });
      }

      if (a.kind === "update" && a.issueId) {
        const [issue] = await tx
          .select()
          .from(schema.issues)
          .where(
            and(
              eq(schema.issues.id, a.issueId),
              eq(schema.issues.originThreadId, thread.id),
              eq(schema.issues.automationId, automation.id),
            ),
          );
        if (!issue) continue;
        if (a.resolvedInChat) {
          await queueUpdate(issue, "resolved_in_chat", a.summary, {
            attachmentIds: [],
            newPriority: null,
            newDueDate: null,
          });
          continue;
        }
        const newPriority = a.priority && a.priority !== issue.priority ? a.priority : null;
        const newDueDate = a.dueDate && a.dueDate !== issue.dueDate ? a.dueDate : null;
        if (newPriority || newDueDate) {
          const refreshed = await reportedBy(issue.id, issue.reportCount);
          const next = {
            ...issue,
            priority: newPriority ?? issue.priority,
            bodyMd: refreshTicketFooter(issue.bodyMd, {
              priority: (newPriority ?? issue.priority) as Priority,
              reportedBy: refreshed,
            }),
          };
          await tx
            .update(schema.issues)
            .set({
              priority: next.priority,
              dueDate: newDueDate ?? issue.dueDate,
              bodyMd: next.bodyMd,
            })
            .where(eq(schema.issues.id, issue.id));
          await queueUpdate(next, "update", a.summary, {
            attachmentIds: a.relevantAttachmentIds,
            newPriority,
            newDueDate,
          });
        } else {
          await queueUpdate(issue, "update", a.summary, {
            attachmentIds: a.relevantAttachmentIds,
            newPriority: null,
            newDueDate: null,
          });
        }
      }

      if (a.kind === "duplicate_of" && a.issueId) {
        const [issue] = await tx
          .select()
          .from(schema.issues)
          .where(
            and(
              eq(schema.issues.id, a.issueId),
              eq(schema.issues.automationId, automation.id),
              eq(schema.issues.status, "active"),
              ne(schema.issues.originThreadId, thread.id),
            ),
          );
        if (!issue) continue;
        // One report per conversation: seeing the same duplicate again changes nothing.
        const inserted = await tx
          .insert(schema.issueReports)
          .values({ orgId, issueId: issue.id, threadId: thread.id, customerRef: customerName })
          .onConflictDoNothing()
          .returning({ id: schema.issueReports.id });
        if (inserted.length === 0) continue;
        const count = issue.reportCount + 1;
        const bodyMd = refreshTicketFooter(issue.bodyMd, {
          priority: issue.priority as Priority,
          reportedBy: await reportedBy(issue.id, count),
        });
        await tx
          .update(schema.issues)
          .set({ reportCount: count, bodyMd })
          .where(eq(schema.issues.id, issue.id));
        await queueUpdate(
          { ...issue, reportCount: count, bodyMd },
          "duplicate",
          a.summary || a.reason || "Another customer reported the same problem.",
          {
            attachmentIds: a.relevantAttachmentIds,
            newPriority: null,
            newDueDate: null,
          },
        );
      }
    }
  });
  return out;
}
