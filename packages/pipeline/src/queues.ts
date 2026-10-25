import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { z } from "zod";

export const PIPELINE_QUEUE = "pipeline";

export const JOBS = {
  /** Analyse one conversation (debounced: one pending job per thread). */
  evaluate: "thread.evaluate",
  /** Re-check recently active conversations to recover from dropped hooks. Repeatable. */
  reconcile: "crisp.reconcile",
  /** Delete expired records. Repeatable. */
  cleanup: "maintenance.cleanup",
} as const;

export const evaluatePayload = z.object({ orgId: z.string().min(1), threadId: z.uuid() });
export type EvaluatePayload = z.infer<typeof evaluatePayload>;

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
