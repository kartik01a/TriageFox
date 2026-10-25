import { ProviderError } from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import { type EvaluatePayload, withLock } from "@triagefox/pipeline";
import { DelayedError, type Job, UnrecoverableError } from "bullmq";
import type { PipelineDeps } from "./deps";

export type EvaluateResult =
  | { status: "evaluated"; messages: number }
  | { status: "unchanged" }
  | { status: "no_customer_messages" }
  | { status: "inactive" } // connection revoked, automation disabled or thread gone
  | { status: "gone" }; // the conversation no longer exists at Crisp

async function loadContext(deps: PipelineDeps, { orgId, threadId }: EvaluatePayload) {
  return withOrg(deps.db, orgId, async (tx) => {
    const [row] = await tx
      .select({
        thread: schema.threads,
        automation: schema.automations,
        connection: schema.connections,
      })
      .from(schema.threads)
      .innerJoin(schema.automations, eq(schema.automations.id, schema.threads.automationId))
      .innerJoin(
        schema.connections,
        eq(schema.connections.id, schema.automations.sourceConnectionId),
      )
      .where(eq(schema.threads.id, threadId));
    return row ?? null;
  });
}

async function markConnectionRevoked(
  deps: PipelineDeps,
  orgId: string,
  connectionId: string,
  detail: string,
) {
  await withOrg(deps.db, orgId, (tx) =>
    tx
      .update(schema.connections)
      .set({ status: "revoked", statusDetail: detail })
      .where(and(eq(schema.connections.id, connectionId), eq(schema.connections.orgId, orgId))),
  );
}

async function recordError(deps: PipelineDeps, p: EvaluatePayload, message: string) {
  await withOrg(deps.db, p.orgId, (tx) =>
    tx.update(schema.threads).set({ lastError: message }).where(eq(schema.threads.id, p.threadId)),
  );
}

/**
 * Analyses one conversation.
 *
 * One at a time per thread (lock), always from a fresh fetch (hooks are only signals), and without
 * ever storing the conversation: only the position reached (last message fingerprint) is saved.
 * If new activity arrives while we work, the job reschedules itself after the quiet window.
 */
export async function evaluateThread(
  deps: PipelineDeps,
  payload: EvaluatePayload,
  job?: Job,
  token?: string,
): Promise<EvaluateResult> {
  const now = deps.now ?? (() => new Date());
  const ctx = await loadContext(deps, payload);
  if (!ctx || ctx.connection.status !== "active" || !ctx.automation.enabled)
    return { status: "inactive" };
  const websiteId = String(ctx.connection.metadata.websiteId ?? "");
  if (!websiteId) return { status: "inactive" };

  // A busy lock throws LockBusyError, which BullMQ retries shortly.
  const { result, startedAt } = await withLock(
    deps.redis,
    `thread:${payload.threadId}`,
    async () => {
      const started = now();
      // Re-read inside the lock: another run may just have finished.
      const fresh = await loadContext(deps, payload);
      if (!fresh) return { result: { status: "inactive" } as EvaluateResult, startedAt: started };
      const { thread, automation } = fresh;

      let conversation: Awaited<ReturnType<ReturnType<PipelineDeps["crisp"]>["fetchConversation"]>>;
      try {
        conversation = await deps.crisp().fetchConversation(websiteId, thread.sourceId);
      } catch (err) {
        if (err instanceof ProviderError) {
          if (err.kind === "auth") {
            await markConnectionRevoked(
              deps,
              payload.orgId,
              fresh.connection.id,
              "Crisp no longer allows access. Reinstall the TriageFox plugin to reconnect.",
            );
            throw new UnrecoverableError("crisp_auth");
          }
          if (err.kind === "not_found") {
            await recordError(deps, payload, "The conversation no longer exists in Crisp.");
            return { result: { status: "gone" } as EvaluateResult, startedAt: started };
          }
        }
        throw err; // rate limits and outages: retried with backoff
      }

      const talk = conversation.messages.filter((m) => m.role !== "note");
      const latest = talk.at(-1)?.fingerprint ?? null;
      const base = {
        state: conversation.state,
        sourceUpdatedAt: new Date(conversation.updatedAt || started.getTime()),
        lastError: null,
      };

      if (!conversation.messages.some((m) => m.role === "customer")) {
        await withOrg(deps.db, payload.orgId, (tx) =>
          tx
            .update(schema.threads)
            .set({
              ...base,
              lastProcessedMessageId: latest,
              lastEvaluatedState: conversation.state,
            })
            .where(eq(schema.threads.id, thread.id)),
        );
        return {
          result: { status: "no_customer_messages" } as EvaluateResult,
          startedAt: started,
        };
      }

      if (
        thread.lastProcessedMessageId === latest &&
        thread.lastEvaluatedState === conversation.state
      ) {
        await withOrg(deps.db, payload.orgId, (tx) =>
          tx.update(schema.threads).set(base).where(eq(schema.threads.id, thread.id)),
        );
        return { result: { status: "unchanged" } as EvaluateResult, startedAt: started };
      }

      await deps.triage({ orgId: payload.orgId, thread, automation, conversation });

      await withOrg(deps.db, payload.orgId, (tx) =>
        tx
          .update(schema.threads)
          .set({
            ...base,
            lastProcessedMessageId: latest,
            lastEvaluatedState: conversation.state,
            lastEvaluatedAt: now(),
            evaluationCount: thread.evaluationCount + 1,
          })
          .where(eq(schema.threads.id, thread.id)),
      );
      return {
        result: { status: "evaluated", messages: conversation.messages.length } as EvaluateResult,
        startedAt: started,
      };
    },
    { ttlMs: 120_000, waitMs: 10_000 },
  );

  // Newer activity arrived while we worked? Run again after the quiet window instead of losing it.
  const after = await loadContext(deps, payload);
  if (after && job && token && after.thread.lastEventAt > startedAt) {
    await job.moveToDelayed(
      now().getTime() + after.automation.settings.quietWindowSec * 1000,
      token,
    );
    throw new DelayedError();
  }
  return result;
}

export { recordError };
