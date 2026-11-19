import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

export const PIPELINE_QUEUE = "pipeline";

export const JOBS = {
  /** Analyse one conversation (debounced: one pending job per thread). */
  evaluate: "thread.evaluate",
  /** Re-check recently active conversations to recover from dropped hooks. Repeatable. */
  reconcile: "crisp.reconcile",
  /** Create (or finish creating) one issue in one destination. One job per issue x destination. */
  deliver: "ticket.deliver",
  /** Tell one destination about a follow-up, a duplicate report or a chat resolution. */
  update: "ticket.update",
  /** Renewal reminders and trial-ending notices (hosted only). Repeatable. */
  reminders: "billing.reminders",
  /** Delete expired records. Repeatable. */
  cleanup: "maintenance.cleanup",
  /** Refresh OAuth tokens that expire when unused (Jira, Linear). Repeatable. */
  keepalive: "connections.keepalive",
} as const;

export const evaluatePayload = z.object({ orgId: z.string().min(1), threadId: z.uuid() });
export type EvaluatePayload = z.infer<typeof evaluatePayload>;

export const deliverPayload = z.object({
  orgId: z.string().min(1),
  issueId: z.uuid(),
  destinationId: z.uuid(),
});
export type DeliverPayload = z.infer<typeof deliverPayload>;

export const updatePayload = z.object({
  orgId: z.string().min(1),
  updateId: z.uuid(),
  destinationId: z.uuid(),
});
export type UpdatePayload = z.infer<typeof updatePayload>;

export interface PipelineQueue {
  queue: Queue;
  close(): Promise<void>;
}

/** Producer handle used by the web app (hook route) and the worker (reconcile). */
export function createPipelineQueue(
  redisUrl: string,
  name: string = PIPELINE_QUEUE,
): PipelineQueue {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(name, { connection });
  return {
    queue,
    async close() {
      await queue.close();
      await connection.quit();
    },
  };
}
