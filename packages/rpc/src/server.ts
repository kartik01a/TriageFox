import { Worker } from "bullmq";
import type { Redis } from "ioredis";
import {
  RPC_QUEUE,
  type RpcEnvelope,
  RpcError,
  type RpcInput,
  type RpcMethod,
  type RpcOutput,
  rpcMethods,
} from "./protocol";

export type RpcHandlers = { [M in RpcMethod]: (input: RpcInput<M>) => Promise<RpcOutput<M>> };

export interface RpcLogger {
  error(obj: object, msg: string): void;
}

/** Runs the handlers. Input is re-validated, output is schema-parsed (stripping unknown fields). */
export async function dispatch(
  handlers: RpcHandlers,
  method: string,
  rawInput: unknown,
  log?: RpcLogger,
): Promise<RpcEnvelope<unknown>> {
  if (!(method in rpcMethods))
    return { ok: false, error: { code: "invalid", message: "Unknown method" } };
  const m = method as RpcMethod;
  const input = rpcMethods[m].input.safeParse(rawInput);
  if (!input.success) return { ok: false, error: { code: "invalid", message: "Invalid request" } };
  try {
    const handler = handlers[m] as (i: unknown) => Promise<unknown>;
    const out = await handler(input.data);
    return { ok: true, data: rpcMethods[m].output.parse(out) };
  } catch (err) {
    if (err instanceof RpcError)
      return { ok: false, error: { code: err.code, message: err.message } };
    // Anything else is unexpected: log details here, tell the caller nothing specific.
    log?.error({ method, err: (err as Error).message }, "rpc handler failed");
    return {
      ok: false,
      error: { code: "internal", message: "Something went wrong. Please try again." },
    };
  }
}

export function startRpcServer(opts: {
  connection: Redis;
  handlers: RpcHandlers;
  log?: RpcLogger;
  concurrency?: number;
}) {
  return new Worker(RPC_QUEUE, (job) => dispatch(opts.handlers, job.name, job.data, opts.log), {
    connection: opts.connection,
    concurrency: opts.concurrency ?? 10,
  });
}
