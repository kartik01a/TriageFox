import { ProviderError } from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { listReconcileTargets, scheduleEvaluation } from "@triagefox/pipeline";
import type { PipelineDeps } from "./deps";

export interface ReconcileOptions {
  /** How far back to look for recently active conversations. */
  lookbackMs: number;
  /** Safety cap on conversation pages per website per run (20 conversations each). */
  maxPages?: number;
}

export interface ReconcileSummary {
  websites: number;
  scheduled: number;
  failedWebsites: number;
}

/**
 * Crisp can drop hooks (after repeated failures). Every few minutes, look at recently active
 * conversations and schedule an evaluation for any whose latest activity we have not processed.
 * Idempotent: a conversation we already evaluated (same `updated_at`) is left alone, and one that is
 * already waiting for its quiet window is not postponed.
 */
export async function reconcileCrisp(
  deps: PipelineDeps,
  opts: ReconcileOptions,
): Promise<ReconcileSummary> {
  const now = (deps.now ?? (() => new Date()))();
  const since = now.getTime() - opts.lookbackMs;
  const maxPages = opts.maxPages ?? 10;
  const targets = await listReconcileTargets(deps.db);
  const byWebsite = new Map<string, typeof targets>();
  for (const t of targets)
    byWebsite.set(t.connectionId, [...(byWebsite.get(t.connectionId) ?? []), t]);

  const summary: ReconcileSummary = { websites: byWebsite.size, scheduled: 0, failedWebsites: 0 };
  for (const [connectionId, automations] of byWebsite) {
    const first = automations[0];
    if (!first) continue;
    try {
      const crisp = deps.crisp();
      for (let page = 1; page <= maxPages; page++) {
        const refs = await crisp.listConversations(first.websiteId, page);
        if (refs.length === 0) break;
        for (const ref of refs.filter((r) => r.updatedAt >= since)) {
          for (const a of automations) {
            const wanted = await withOrg(deps.db, a.orgId, async (tx) => {
              const [thread] = await tx
                .select()
                .from(schema.threads)
                .where(
                  and(
                    eq(schema.threads.automationId, a.automationId),
                    eq(schema.threads.sourceType, "conversation"),
                    eq(schema.threads.sourceId, ref.sessionId),
                  ),
                );
              if (thread?.sourceUpdatedAt && ref.updatedAt <= thread.sourceUpdatedAt.getTime())
                return null; // already processed
              if (thread) return thread.id;
              const [created] = await tx
                .insert(schema.threads)
                .values({
                  orgId: a.orgId,
                  automationId: a.automationId,
                  sourceId: ref.sessionId,
                  lastEventAt: now,
                  state: ref.state,
                })
                .onConflictDoNothing()
                .returning({ id: schema.threads.id });
              return created?.id ?? null;
            });
            if (!wanted) continue;
            const r = await scheduleEvaluation(
              deps.queue,
              { orgId: a.orgId, threadId: wanted },
              a.quietWindowSec * 1000,
              { restart: false },
            );
            if (r === "created") summary.scheduled++;
          }
        }
        // Conversations come newest first: once a whole page is older than the window, stop paging.
        if (refs.every((r) => r.updatedAt < since)) break;
      }
    } catch (err) {
      summary.failedWebsites++;
      if (err instanceof ProviderError && err.kind === "auth") {
        await withOrg(deps.db, first.orgId, (tx) =>
          tx
            .update(schema.connections)
            .set({
              status: "revoked",
              statusDetail:
                "Crisp no longer allows access. Reinstall the TriageFox plugin to reconnect.",
            })
            .where(eq(schema.connections.id, connectionId)),
        );
      }
      deps.log.warn(
        { connectionId, err: (err as Error).message },
        "reconcile failed for a website",
      );
    }
  }
  return summary;
}
