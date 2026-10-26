import type { Priority, TicketType } from "@triagefox/shared";

/** One message of a conversation, as the AI step sees it (held in memory only, never stored). */
export interface TriageMessage {
  /** Stable id (the Crisp fingerprint). */
  id: string;
  role: "customer" | "operator" | "note";
  /** Milliseconds since epoch. */
  at: number;
  text?: string;
  attachment?: { id: string; name: string; mime: string; url: string };
}

export interface ExistingIssue {
  id: string;
  title: string;
  summary: string;
  priority: Priority;
  dueDate?: string | null;
}

export interface DuplicateCandidate {
  id: string;
  title: string;
  summary: string;
}

export interface TriageInput {
  messages: TriageMessage[];
  state: "open" | "resolved";
  workspace: { language: string; timezone: string; now: Date };
  /** Tickets already created from this conversation (Phase 6 fills these in). */
  existingIssues: ExistingIssue[];
  /** Similar open tickets from other conversations (Phase 6). */
  duplicateCandidates: DuplicateCandidate[];
  /** Below this a created ticket goes to the review queue instead of straight to the tracker. */
  minConfidence: number;
}

export type ActionKind = "create" | "update" | "duplicate_of" | "no_action";
export type NoActionCategory =
  | "question"
  | "billing"
  | "refund_request"
  | "account"
  | "complaint"
  | "praise"
  | "greeting"
  | "spam";

/** A validated, cleaned action. Everything here is safe to act on. */
export interface TriageAction {
  kind: ActionKind;
  issueId?: string;
  type?: TicketType;
  title: string;
  summary: string;
  stepsToReproduce: string[];
  expected?: string;
  actual?: string;
  environment?: { browser?: string; os?: string; device?: string; pageUrl?: string };
  priority?: Priority;
  priorityReason: string;
  /** Resolved by code from the customer's own words (null = the customer gave no usable deadline). */
  dueDate: string | null;
  /** The exact words the model quoted, kept for the audit trail. */
  dueDateQuote: string | null;
  relevantAttachmentIds: string[];
  confidence: number;
  reason: string;
  category?: NoActionCategory;
  /** update actions: support fixed it in the chat and the customer confirmed. */
  resolvedInChat: boolean;
  /** create actions below minConfidence. */
  needsReview: boolean;
}

export interface Usage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
}

export interface TriageResult {
  actions: TriageAction[];
  /** The model that produced the final answer. */
  model: string;
  escalated: boolean;
  escalationReason?: string;
  usage: Usage;
  costUsd: number;
  /** What the cleanup step changed, for diagnostics (counts only). */
  cleanup: { droppedActions: number; discardedDueDates: number; redactions: number };
}
