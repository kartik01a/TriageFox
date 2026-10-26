import * as Sentry from "@sentry/node";
import { CrispPluginClient } from "@triagefox/connectors";
import { createDb } from "@triagefox/db";
import { PIPELINE_QUEUE, scheduleDelivery, scheduleUpdate } from "@triagefox/pipeline";
import { startRpcServer } from "@triagefox/rpc/server";
import { createLogger } from "@triagefox/shared";
import { Queue, UnrecoverableError, Worker } from "bullmq";
import { Redis } from "ioredis";
import { createBillingHooks } from "./billing";
import { describeProviders, loadConfig, verifyKeyring } from "./config";
import { createNotifier } from "./notify";
import { createDeliver } from "./pipeline/deliver";
import { createTriage } from "./pipeline/triage";
import { createUpdate } from "./pipeline/update";
import { registerSchedulers, startPipelineWorker } from "./pipeline/worker";
import { JOBS, QUEUES } from "./queues";
import { createHandlers } from "./rpc/handlers";

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
const providers = describeProviders(config);
log.info({ ...providers, warnings: undefined }, "providers");
for (const w of providers.warnings) log.warn(w);

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

// Requests from the web app that need decrypted credentials (docs/security.md §3).
const rpc = startRpcServer({
  connection,
  log,
  handlers: createHandlers({ db, config, keyring: config.keyring, redis: connection, log }),
});
rpc.on("error", (err) => log.error({ err: err.message }, "rpc server error"));

// Conversation pipeline: debounced evaluations, reconcile and cleanup (Phase 3).
const pipelineQueue = new Queue(PIPELINE_QUEUE, { connection });
const crisp = () => {
  const {
    CRISP_PLUGIN_ID: identifier,
    CRISP_PLUGIN_KEY: key,
    CRISP_PLUGIN_UUID: pluginId,
  } = config;
  if (!identifier || !key || !pluginId)
    throw new UnrecoverableError("Crisp is not configured on this server");
  return new CrispPluginClient({ identifier, key, pluginId });
};
const pipeline = startPipelineWorker(
  {
    db,
    redis: connection,
    queue: pipelineQueue,
    crisp,
    log,
    triage: createTriage({
      db,
      config,
      keyring: config.keyring,
      log,
      billing:
        config.APP_MODE === "hosted"
          ? createBillingHooks({ db, notifier: createNotifier({ db, config, log }) })
          : undefined,
      enqueueDelivery: (p) => scheduleDelivery(pipelineQueue, p),
      enqueueUpdate: (p) => scheduleUpdate(pipelineQueue, p),
    }),
    deliver: createDeliver({
      ctx: { db, config, keyring: config.keyring, redis: connection, log },
      crisp,
    }),
    applyUpdate: createUpdate({
      ctx: { db, config, keyring: config.keyring, redis: connection, log },
      crisp,
      enqueueDelivery: (p) => scheduleDelivery(pipelineQueue, p),
    }),
  },
  { lookbackMs: config.RECONCILE_LOOKBACK_MIN * 60 * 1000 },
);
await registerSchedulers(pipelineQueue);

// Self-check: prove the queue round-trips before declaring ready.
await systemQueue.add(JOBS.ping, {}, { removeOnComplete: true, removeOnFail: 20 });
log.info({ mode: config.APP_MODE }, "worker ready");

async function shutdown(signal: string) {
  log.info({ signal }, "shutting down");
  await worker.close();
  await rpc.close();
  await pipeline.close();
  await pipelineQueue.close();
  await systemQueue.close();
  await connection.quit();
  await db.$client.end();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
