import "server-only";
import { createRpcClient, type RpcClient } from "@triagefox/rpc";
import { env } from "./env";

const g = globalThis as unknown as { __triagefoxRpc?: RpcClient };

/** Asks the worker to do anything that needs a customer's decrypted credentials. */
export function rpc(): RpcClient {
  g.__triagefoxRpc ??= createRpcClient(env().REDIS_URL);
  return g.__triagefoxRpc;
}
