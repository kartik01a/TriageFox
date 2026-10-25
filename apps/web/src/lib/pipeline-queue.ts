import "server-only";
import { createPipelineQueue, type PipelineQueue } from "@triagefox/pipeline";
import { env } from "./env";

const g = globalThis as unknown as { __triagefoxPipelineQueue?: PipelineQueue };

/** Producer handle for scheduling conversation evaluations from the hook route. */
export function pipelineQueue(): PipelineQueue {
  g.__triagefoxPipelineQueue ??= createPipelineQueue(env().REDIS_URL);
  return g.__triagefoxPipelineQueue;
}
