import type { CrispConversation, CrispConversationRef } from "@triagefox/connectors";
import type { Db, schema } from "@triagefox/db";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";

/** The slice of the Crisp client the pipeline needs (so tests can supply a fake). */
export interface CrispSource {
  fetchConversation(websiteId: string, sessionId: string): Promise<CrispConversation>;
  listConversations(websiteId: string, page: number): Promise<CrispConversationRef[]>;
}

type Thread = typeof schema.threads.$inferSelect;
type Automation = typeof schema.automations.$inferSelect;

export interface TriageInput {
  orgId: string;
  thread: Thread;
  automation: Automation;
  /** Held in memory for this call only. Never persisted, never logged. */
  conversation: CrispConversation;
}

/** Phase 4 plugs the AI analysis in here. Until then evaluation fetches and records progress only. */
export type Triage = (input: TriageInput) => Promise<void>;

/** Creates one issue in one destination (Trello card / Jira issue). */
export type Deliver = (
  payload: import("@triagefox/pipeline").DeliverPayload,
  opts?: { finalAttempt?: boolean },
) => Promise<void>;

/** Applies one update (comment, files, priority, due date) to one destination. */
export type ApplyUpdate = (
  payload: import("@triagefox/pipeline").UpdatePayload,
  opts?: { finalAttempt?: boolean },
) => Promise<void>;

export interface PipelineLogger {
  info(o: object, m: string): void;
  warn(o: object, m: string): void;
  error(o: object, m: string): void;
}

export interface PipelineDeps {
  db: Db;
  redis: Redis;
  /** Producer for follow-up scheduling (reconcile). */
  queue: Queue;
  /** Returns the Crisp client, or throws when the platform has no Crisp credentials. */
  crisp: () => CrispSource;
  triage: Triage;
  deliver: Deliver;
  applyUpdate: ApplyUpdate;
  /** Called once when a connection turns `revoked`. */
  onRevoked?: (c: {
    orgId: string;
    id: string;
    provider: string;
    detail: string | null;
  }) => Promise<void>;
  /** A real, deduplicated alert to the operator (a job that kept failing, a platform key problem). */
  alert?: (a: { key: string; subject: string; text: string }) => Promise<void>;
  /** Daily billing reminders (hosted only). */
  reminders?: () => Promise<unknown>;
  /** Daily refresh of OAuth tokens that expire when unused. */
  keepAlive?: () => Promise<unknown>;
  log: PipelineLogger;
  now?: () => Date;
}
