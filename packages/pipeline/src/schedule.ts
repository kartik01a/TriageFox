import type { Queue } from "bullmq";
import { type EvaluatePayload, JOBS } from "./queues";

export const evaluateJobId = (threadId: string) => `evaluate_${threadId}`;

/** Retry with growing delays: Crisp rate limits and short outages are normal. */
const JOB_OPTIONS = {
  attempts: 5,
  backoff: { type: "exponential", delay: 10_000 },
  // Finished jobs are removed so the same job id can be used for the next evaluation of this thread.
  // Failures are recorded on the thread itself (threads.last_error) by the worker.
  removeOnComplete: true,
  removeOnFail: true,
} as const;

/**
 * Debounce: at most ONE pending evaluation per thread.
 * - no job yet: create one that runs after `delayMs` (the quiet window, or 0 for "resolved")
 * - job waiting out its delay: push it back to `delayMs` from now (a newer message restarts the window),
 *   or run it now when `delayMs` is 0
 * - job already running: do nothing; the worker notices the newer `last_event_at` when it finishes
 *   and runs again, so nothing is lost
 */
export async function scheduleEvaluation(
  queue: Queue,
  target: EvaluatePayload,
  delayMs: number,
  opts: { restart?: boolean } = {},
) {
  const jobId = evaluateJobId(target.threadId);
  const existing = await queue.getJob(jobId);
  if (!existing) {
    await queue.add(JOBS.evaluate, target, { ...JOB_OPTIONS, jobId, delay: delayMs });
    return "created" as const;
  }
  if ((await existing.getState()) === "delayed") {
    // `restart: false` (reconcile) leaves a job that is already waiting as it is.
    if (opts.restart === false) return "already_pending" as const;
    if (delayMs === 0) await existing.promote();
    else await existing.changeDelay(delayMs);
    return "rescheduled" as const;
  }
  return "already_pending" as const;
}
