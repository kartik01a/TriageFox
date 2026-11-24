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
  "trello.listLabels": {
    input: z.object({ ...orgConn, boardId: z.string().min(1) }),
    output: z.object({
      labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })),
    }),
  },
  "trello.createLabel": {
    input: z.object({
      ...orgConn,
      boardId: z.string().min(1),
      name: z.string().trim().min(1).max(100),
      // Checked against Trello's colour list by the web route.
      color: z.string().regex(/^[a-z_]{1,20}$/),
    }),
    output: z.object({ id: z.string(), name: z.string(), color: z.string().nullable() }),
  },
  "jira.listLabels": {
    input: z.object({ ...orgConn, cloudId: z.string().min(1) }),
    output: z.object({ labels: z.array(z.string()) }),
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
  "linear.complete": {
    input: z.object(orgConn),
    output: z.object({ workspaceName: z.string(), urlKey: z.string() }),
  },
  "linear.listTeams": {
    input: z.object(orgConn),
    output: z.object({
      teams: z.array(
        z.object({ id: z.string(), key: z.string(), name: z.string(), triageEnabled: z.boolean() }),
      ),
    }),
  },
  "linear.teamSetup": {
    input: z.object({ ...orgConn, teamId: z.string().min(1).max(100) }),
    output: z.object({
      triageEnabled: z.boolean(),
      states: z.array(z.object({ id: z.string(), name: z.string(), type: z.string() })),
      projects: z.array(z.object({ id: z.string(), name: z.string() })),
      labels: z.array(z.object({ id: z.string(), name: z.string(), color: z.string().nullable() })),
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
  "automation.dryRun": {
    input: z.object({ orgId: z.string().min(1), automationId: z.uuid() }),
    output: z.object({
      analysed: z.number(),
      results: z.array(
        z.object({
          when: z.number(),
          snippet: z.string(),
          conversationUrl: z.string(),
          decision: z.enum(["create", "update", "duplicate_of", "no_action"]),
          category: z.string().optional(),
          type: z.string().optional(),
          priority: z.number().optional(),
          title: z.string(),
          bodyPreview: z.string(),
          reason: z.string(),
          confidence: z.number(),
          needsReview: z.boolean(),
          dueDate: z.string().nullable(),
        }),
      ),
    }),
  },
  "ai.explain": {
    input: z.object({ orgId: z.string().min(1), aiRunId: z.uuid() }),
    output: z.object({
      actions: z.array(
        z.object({
          kind: z.string(),
          title: z.string(),
          summary: z.string(),
          reason: z.string(),
          priorityReason: z.string(),
          type: z.string().optional(),
          priority: z.number().optional(),
          confidence: z.number(),
        }),
      ),
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
