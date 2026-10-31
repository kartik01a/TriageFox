import { eq, schema, withOrg } from "@triagefox/db";
import {
  clearOldAiOutputs,
  deliverPayload,
  evaluatePayload,
  JOBS,
  PIPELINE_QUEUE,
  purgeOldSourceEvents,
  updatePayload,
} from "@triagefox/pipeline";
import { type Job, Worker } from "bullmq";
import type { PipelineDeps } from "./deps";
import { evaluateThread } from "./evaluate";
import { reconcileCrisp } from "./reconcile";

export interface PipelineWorkerOptions {
  queueName?: string;
  concurrency?: number;
  lookbackMs?: number;
  retentionDays?: number;
}

/** Exponential by default (15 s, 30 s, 60 s…, capped at 15 min); the provider's Retry-After when it sent one. */
export function retryDelayMs(attempts: number, err?: Error & { retryAfterSec?: number }) {
  const asked = err?.retryAfterSec;
  if (typeof asked === "number" && asked > 0) return Math.min(asked, 3600) * 1000 + 500;
  return Math.min(15 * 60_000, 15_000 * 2 ** Math.max(0, attempts - 1));
}

export const RECONCILE_EVERY_MS = 10 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Processes evaluate / reconcile / cleanup jobs. */
export function startPipelineWorker(deps: PipelineDeps, opts: PipelineWorkerOptions = {}) {
  const worker = new Worker(
    opts.queueName ?? PIPELINE_QUEUE,
    async (job: Job, token?: string) => {
      switch (job.name) {
        case JOBS.evaluate: {
          const payload = evaluatePayload.parse(job.data);
          return evaluateThread(deps, payload, job, token);
        }
        case JOBS.reconcile:
          return reconcileCrisp(deps, { lookbackMs: opts.lookbackMs ?? 3 * 60 * 60 * 1000 });
        case JOBS.deliver: {
          const payload = deliverPayload.parse(job.data);
          await deps.deliver(payload, {
            finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
          });
          return { delivered: true };
        }
        case JOBS.update: {
          const payload = updatePayload.parse(job.data);
          await deps.applyUpdate(payload, {
            finalAttempt: job.attemptsMade + 1 >= (job.opts.attempts ?? 1),
          });
          return { applied: true };
        }
        case JOBS.reminders:
          return (await deps.reminders?.()) ?? { skipped: true };
        case JOBS.cleanup: {
          const days = opts.retentionDays ?? 30;
          return {
            purged: await purgeOldSourceEvents(deps.db, days),
            clearedAiOutputs: await clearOldAiOutputs(deps.db, days),
          };
        }
        default:
          throw new Error(`Unknown job: ${job.name}`);
      }
    },
    {
      connection: deps.redis,
      concurrency: opts.concurrency ?? 5,
      // A provider's Retry-After wins over our own schedule: hammering a rate-limited API only makes it longer.
      settings: {
        backoffStrategy: (attempts: number, _type?: string, err?: Error) =>
          retryDelayMs(attempts, err),
      },
    },
  );

  // A job that used up its retries leaves a visible trace on the thread (the job itself is removed).
  worker.on("failed", (job, err) => {
    deps.log.error({ jobId: job?.id, name: job?.name, err: err.message }, "pipeline job failed");
    const finalAttempt = job && job.attemptsMade >= (job.opts.attempts ?? 1);
    // A job that ran out of retries is a problem somebody should hear about, once an hour per kind of job.
    if (finalAttempt && job && err.name !== "UnrecoverableError")
      void deps
        .alert?.({
          key: `job-failed:${job.name}`,
          subject: `TriageFox: ${job.name} jobs are failing`,
          text: `A ${job.name} job ran out of retries: ${err.message.slice(0, 200)}`,
        })
        .catch(() => undefined);
    const parsed = job?.name === JOBS.evaluate ? evaluatePayload.safeParse(job.data) : null;
    if (parsed?.success && (finalAttempt || err.name === "UnrecoverableError")) {
      void withOrg(deps.db, parsed.data.orgId, (tx) =>
        tx
          .update(schema.threads)
          .set({ lastError: err.message.slice(0, 300) })
          .where(eq(schema.threads.id, parsed.data.threadId)),
      ).catch(() => {});
    }
  });
  worker.on("error", (err) => deps.log.error({ err: err.message }, "pipeline worker error"));
  return worker;
}

/** Recurring jobs (idempotent: safe to call on every start). */
export async function registerSchedulers(queue: PipelineDeps["queue"]) {
  await queue.upsertJobScheduler(
    "crisp-reconcile",
    { every: RECONCILE_EVERY_MS },
    { name: JOBS.reconcile },
  );
  await queue.upsertJobScheduler("billing-reminders", { every: DAY_MS }, { name: JOBS.reminders });
  await queue.upsertJobScheduler("cleanup-daily", { every: DAY_MS }, { name: JOBS.cleanup });
}
