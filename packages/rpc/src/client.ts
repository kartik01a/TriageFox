import { Queue, QueueEvents } from "bullmq";
import { Redis } from "ioredis";
import {
  RPC_QUEUE,
  type RpcEnvelope,
  RpcError,
  type RpcInput,
  type RpcMethod,
  type RpcOutput,
  rpcMethods,
} from "./protocol";

export interface RpcClient {
  call<M extends RpcMethod>(
    method: M,
    input: RpcInput<M>,
    opts?: { timeoutMs?: number },
  ): Promise<RpcOutput<M>>;
  close(): Promise<void>;
}

/** Web-side client. Validates input before sending; maps worker failures to RpcError. */
export function createRpcClient(redisUrl: string): RpcClient {
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queue = new Queue(RPC_QUEUE, { connection });
  const events = new QueueEvents(RPC_QUEUE, {
    connection: new Redis(redisUrl, { maxRetriesPerRequest: null }),
  });

  return {
    async call(method, input, opts = {}) {
      const parsed = rpcMethods[method].input.safeParse(input);
      if (!parsed.success) throw new RpcError("invalid", `Invalid ${method} request`);
      const job = await queue.add(method, parsed.data, {
        removeOnComplete: { age: 60 },
        removeOnFail: { age: 300 },
        attempts: 1,
      });
      let result: RpcEnvelope<RpcOutput<typeof method>>;
      try {
        result = (await job.waitUntilFinished(events, opts.timeoutMs ?? 20_000)) as typeof result;
      } catch {
        throw new RpcError(
          "unavailable",
          "The background service did not answer in time. Please try again.",
        );
      }
      if (!result.ok) throw new RpcError(result.error.code, result.error.message);
      return result.data;
    },
    async close() {
      await events.close();
      await queue.close();
      await connection.quit();
    },
  };
}
