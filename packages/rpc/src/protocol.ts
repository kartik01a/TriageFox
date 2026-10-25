import { z } from "zod";

/**
 * The web app never holds decrypted credentials. Anything that needs a customer's token runs in the
 * worker, which the web app asks through this typed request/response protocol (docs/security.md §3).
 * Every result is parsed through its schema on the worker side, so unexpected fields (such as a
 * token) are stripped before they can reach the web app.
 */

const orgConn = { orgId: z.string().min(1), connectionId: z.uuid() };

export const rpcMethods = {
  "trello.verify": {
    input: z.object(orgConn),
    output: z.object({ username: z.string(), fullName: z.string() }),
  },
  "trello.listBoards": {
    input: z.object(orgConn),
    output: z.object({ boards: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  "trello.listLists": {
    input: z.object({ ...orgConn, boardId: z.string().min(1) }),
    output: z.object({ lists: z.array(z.object({ id: z.string(), name: z.string() })) }),
  },
  "jira.complete": {
    input: z.object(orgConn),
    output: z.object({
      sites: z.array(z.object({ id: z.string(), name: z.string(), url: z.string() })),
    }),
  },
  "jira.listProjects": {
    input: z.object({ ...orgConn, cloudId: z.string().min(1) }),
    output: z.object({
      projects: z.array(z.object({ id: z.string(), key: z.string(), name: z.string() })),
    }),
  },
  "jira.projectSetup": {
    input: z.object({ ...orgConn, cloudId: z.string().min(1), projectKey: z.string().min(1) }),
    output: z.object({
      issueTypes: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
          subtask: z.boolean(),
          blockingFields: z.array(z.object({ id: z.string(), name: z.string() })),
          hasPriority: z.boolean(),
          hasDueDate: z.boolean(),
        }),
      ),
      priorities: z.array(z.object({ id: z.string(), name: z.string() })),
    }),
  },
  "crisp.verifyWebsite": {
    input: z.object({ websiteId: z.string().min(1), token: z.string().min(1).max(200) }),
    output: z.object({ valid: z.boolean(), websiteName: z.string().optional() }),
  },
  "connection.check": {
    input: z.object(orgConn),
    output: z.object({
      status: z.enum(["pending", "active", "error", "revoked"]),
      detail: z.string().optional(),
    }),
  },
  "connection.disconnect": {
    input: z.object(orgConn),
    output: z.object({ revoked: z.boolean() }),
  },
} as const;

export type RpcMethod = keyof typeof rpcMethods;
export type RpcInput<M extends RpcMethod> = z.input<(typeof rpcMethods)[M]["input"]>;
export type RpcOutput<M extends RpcMethod> = z.output<(typeof rpcMethods)[M]["output"]>;

export const RPC_QUEUE = "rpc";

export type RpcErrorCode =
  | "auth_expired" // the provider no longer accepts the stored credentials
  | "not_found"
  | "rate_limited"
  | "unavailable"
  | "invalid"
  | "not_configured" // the platform has no credentials for this provider
  | "forbidden"
  | "internal";

export type RpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { code: RpcErrorCode; message: string } };

/** Thrown by handlers (worker side) and by the client when the worker reports a failure. */
export class RpcError extends Error {
  constructor(
    readonly code: RpcErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RpcError";
  }
}
