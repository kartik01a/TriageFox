import type { CrispHookEvent } from "@triagefox/connectors";
import { and, type Db, eq, schema, withOrg } from "@triagefox/db";
import type { Queue } from "bullmq";
import { findCrispRoutes } from "./routing";
import { scheduleEvaluation } from "./schedule";

export type IngestOutcome =
  | "ignored" // not an event we act on (system event, note, unrelated hook)
  | "no_route" // website not linked, connection not active, or no enabled automation
  | "duplicate" // this delivery was already handled
  | "recorded" // valid context-only event (operator message): stored, no work scheduled
  | "scheduled";

export interface IngestDeps {
  db: Db;
  queue: Queue;
  now?: () => Date;
}

/**
 * Turns one verified Crisp hook into scheduled work. Stores IDs only; the hook is just a signal that
 * "something changed". The worker always re-fetches the conversation from Crisp.
 */
export async function handleCrispHook(
  deps: IngestDeps,
  event: CrispHookEvent,
): Promise<{ outcome: IngestOutcome; threads: number }> {
  if (event.kind === "ignored" || !event.sessionId) return { outcome: "ignored", threads: 0 };

  const routes = await findCrispRoutes(deps.db, event.websiteId);
  const first = routes[0];
  if (!first) return { outcome: "no_route", threads: 0 };
  const now = (deps.now ?? (() => new Date()))();
  const sessionId = event.sessionId;
  const contextOnly = event.kind === "operator_message";

  // 1. Record the event and update the threads atomically. A duplicate delivery stops here.
  const threadIds = await withOrg(deps.db, first.orgId, async (tx) => {
    const inserted = await tx
      .insert(schema.sourceEvents)
      .values({
        orgId: first.orgId,
        connectionId: first.connectionId,
        dedupeKey: event.dedupeKey,
        topic: event.event,
        meta: event.meta,
        status: contextOnly ? "ignored" : "received",
      })
      .onConflictDoNothing()
      .returning({ id: schema.sourceEvents.id });
    if (inserted.length === 0) return "duplicate" as const;
    if (contextOnly) return [] as { id: string; automationId: string; quietWindowSec: number }[];

    const touched: { id: string; automationId: string; quietWindowSec: number }[] = [];
    for (const route of routes) {
      const where = and(
        eq(schema.threads.automationId, route.automationId),
        eq(schema.threads.sourceType, "conversation"),
        eq(schema.threads.sourceId, sessionId),
      );
      const state =
        event.kind === "resolved" ? "resolved" : event.kind === "reopened" ? "open" : undefined;
      if (event.kind === "visitor_message") {
        // A customer message creates the conversation's thread the first time we see it.
        const [t] = await tx
          .insert(schema.threads)
          .values({
            orgId: route.orgId,
            automationId: route.automationId,
            sourceId: sessionId,
            lastEventAt: now,
          })
          .onConflictDoUpdate({
            target: [
              schema.threads.automationId,
              schema.threads.sourceType,
              schema.threads.sourceId,
            ],
            set: { lastEventAt: now, updatedAt: now },
          })
          .returning({ id: schema.threads.id });
        if (t)
          touched.push({
            id: t.id,
            automationId: route.automationId,
            quietWindowSec: route.quietWindowSec,
          });
      } else {
        // State changes only matter for conversations we already follow.
        const [t] = await tx
          .update(schema.threads)
          .set({ lastEventAt: now, updatedAt: now, ...(state ? { state } : {}) })
          .where(where)
          .returning({ id: schema.threads.id });
        if (t)
          touched.push({
            id: t.id,
            automationId: route.automationId,
            quietWindowSec: route.quietWindowSec,
          });
      }
    }
    return touched;
  });

  if (threadIds === "duplicate") return { outcome: "duplicate", threads: 0 };
  if (contextOnly || threadIds.length === 0) return { outcome: "recorded", threads: 0 };

  // 2. Schedule after the commit, so the worker always finds the rows. If scheduling fails, undo the
  //    event record so Crisp's retry is processed instead of being dropped as a duplicate.
  try {
    for (const t of threadIds) {
      await scheduleEvaluation(
        deps.queue,
        { orgId: first.orgId, threadId: t.id },
        event.kind === "resolved" ? 0 : t.quietWindowSec * 1000,
      );
    }
  } catch (err) {
    await withOrg(deps.db, first.orgId, (tx) =>
      tx.delete(schema.sourceEvents).where(eq(schema.sourceEvents.dedupeKey, event.dedupeKey)),
    ).catch(() => {});
    throw err;
  }
  return { outcome: "scheduled", threads: threadIds.length };
}
