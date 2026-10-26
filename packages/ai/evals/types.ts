import type { Priority, TicketType } from "@triagefox/shared";
import type { ActionKind, DuplicateCandidate, ExistingIssue, NoActionCategory } from "../src/types";

export interface EvalMessage {
  role: "customer" | "operator" | "note";
  text: string;
  /** Minutes before the conversation's `now`. Defaults to evenly spaced messages ending 2 minutes ago. */
  minutesAgo?: number;
  attachment?: { id: string; name: string; mime: string; url: string };
}

/** What a careful human reviewer expects from the AI. These labels define the rubric in practice. */
export interface Expect {
  /** Should this conversation produce any ticket work (create/update/duplicate)? */
  positive: boolean;
  /** The primary action kind, when it matters. */
  kind?: ActionKind;
  /** Acceptable ticket type(s) for the primary create. Several are listed when reasonable people disagree. */
  type?: TicketType | TicketType[];
  /** The label priority. Scoring allows ±1. */
  priority?: Priority;
  /** Exact number of create actions, for multi-problem conversations. */
  creates?: number;
  /** Expected resolved due date (YYYY-MM-DD) or null when the customer gave no usable deadline. */
  dueDate?: string | null;
  category?: NoActionCategory | NoActionCategory[];
  /** For update / duplicate_of. */
  issueId?: string;
}

export interface EvalCase {
  id: string;
  tags: string[];
  /** Why the case exists / what makes it tricky. Shown with failures. */
  note?: string;
  messages: EvalMessage[];
  state?: "open" | "resolved";
  /** ISO time of "now". Default: Monday 2026-10-26 10:00 UTC. */
  now?: string;
  timezone?: string;
  language?: string;
  existingIssues?: ExistingIssue[];
  duplicateCandidates?: DuplicateCandidate[];
  expect: Expect;
}
