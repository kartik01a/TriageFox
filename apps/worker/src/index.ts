import * as Sentry from "@sentry/node";
import { createDb } from "@triagefox/db";
import { createLogger } from "@triagefox/shared";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { loadConfig, verifyKeyring } from "./config";
import { JOBS, QUEUES } from "./queues";

const log = createLogger("worker");
const config = loadConfig();

if (config.SENTRY_DSN) {
  Sentry.init({
    dsn: config.SENTRY_DSN,
    environment: config.NODE_ENV,
    // Never ship request bodies, cookies or headers (docs/security.md §11).
    beforeSend(event) {
      if (event.request) {
        event.request.data = undefined;
        event.request.cookies = undefined;
        event.request.headers = undefined;
      }
      return event;
    },
  });
}

await verifyKeyring(config.keyring);
log.info("sealed-box keys verified");

const db = createDb(config.DATABASE_URL, { max: 5 });
await db.$client`select 1`;
log.info("database reachable");

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null });
const systemQueue = new Queue(QUEUES.system, { connection });

const worker = new Worker(
  QUEUES.system,
  async (job) => {
    if (job.name === JOBS.ping) return { pong: true, at: new Date().toISOString() };
    throw new Error(`Unknown job: ${job.name}`);
  },
  { connection, concurrency: 5 },
);
worker.on("failed", (job, err) => log.error({ jobId: job?.id, err: err.message }, "job failed"));
worker.on("error", (err) => log.error({ err: err.message }, "worker error"));

// Self-check: prove the queue round-trips before declaring ready.
await systemQueue.add(JOBS.ping, {}, { removeOnComplete: true, removeOnFail: 20 });
log.info({ mode: config.APP_MODE }, "worker ready");

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  await worker.close();
  await systemQueue.close();
  await connection.quit();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
