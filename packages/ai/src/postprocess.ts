import { PRIORITIES, type Priority } from "@triagefox/shared";
import { resolveDueDate } from "./dates";
import { redact } from "./redact";
import type { ModelAction, ModelOutput } from "./schema";
import type { NoActionCategory, TriageAction, TriageInput, TriageMessage } from "./types";

const MAX_TICKETS_PER_CONVERSATION = 5;
const MAX_STEPS = 15;

const isPriority = (n: unknown): n is Priority => PRIORITIES.includes(n as Priority);
const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export interface CleanResult {
  actions: TriageAction[];
  cleanup: { droppedActions: number; discardedDueDates: number; redactions: number };
}

/**
 * Turns the model's raw answer into actions that are safe to act on. The model is not trusted:
 * ids must be ones we supplied, attachment ids must exist, personal data is stripped again, a due date
 * exists only if the quoted words are really in the customer's text, and impossible combinations
 * (a ticket with no type, an update for an unknown ticket) are dropped.
 */
export function cleanOutput(
  raw: ModelOutput,
  input: TriageInput,
  seen: TriageMessage[],
): CleanResult {
  let redactions = 0;
  const scrub = (s: string | null | undefined, max = 4000) => {
    if (!s) return "";
    const r = redact(s.trim());
    redactions += r.count;
    return r.text.slice(0, max).trim();
  };
  const optional = (s: string | null | undefined, max = 600) => scrub(s, max) || undefined;

  const updatable = new Set(input.existingIssues.map((i) => i.id));
  const duplicatable = new Set(input.duplicateCandidates.map((i) => i.id));
  const attachmentIds = new Set(seen.flatMap((m) => (m.attachment ? [m.attachment.id] : [])));

  let droppedActions = 0;
  let discardedDueDates = 0;
  const actions: TriageAction[] = [];

  for (const a of raw.actions) {
    const cleaned = cleanOne(a);
    if (cleaned) actions.push(cleaned);
    else droppedActions++;
  }

  function cleanOne(a: ModelAction): TriageAction | null {
    let confidence = clamp01(a.confidence);
    const base = {
      stepsToReproduce: [] as string[],
      priorityReason: "",
      dueDate: null as string | null,
      dueDateQuote: null as string | null,
      relevantAttachmentIds: [] as string[],
      needsReview: false,
      resolvedInChat: false,
      reason: scrub(a.reason, 300),
      confidence,
    };

    if (a.kind === "no_action") {
      const category = a.category ?? undefined;
      return {
        ...base,
        kind: "no_action",
        title: "",
        summary: "",
        category: category as NoActionCategory | undefined,
      };
    }

    if (a.kind === "update" && !(a.issueId && updatable.has(a.issueId))) return null;
    if (a.kind === "duplicate_of" && !(a.issueId && duplicatable.has(a.issueId))) return null;
    if (a.kind === "create" && (!a.type || !scrub(a.title))) return null;
    if (a.kind === "update" && !scrub(a.summary)) return null;

    let priority: Priority | undefined = isPriority(a.priority) ? a.priority : undefined;
    if (a.kind === "create" && !priority) {
      priority = 3; // no usable priority: pick the middle and make sure a person looks at it
      confidence = Math.min(confidence, 0.5);
    }

    // Due date: only from the customer's own words, resolved by code.
    let dueDate: string | null = null;
    const quote = a.dueDateQuote?.trim() || null;
    if (quote && (a.kind === "create" || a.kind === "update")) {
      const r = resolveDueDate({ quote, messages: seen, timezone: input.workspace.timezone });
      if (r.ok) dueDate = r.date;
      else discardedDueDates++;
    }

    const env = a.environment;
    const environment = env
      ? Object.fromEntries(
          Object.entries({
            browser: optional(env.browser, 120),
            os: optional(env.os, 120),
            device: optional(env.device, 120),
            pageUrl: optional(env.pageUrl, 300),
          }).filter(([, v]) => v),
        )
      : undefined;

    return {
      kind: a.kind,
      issueId: a.issueId ?? undefined,
      type: a.type ?? undefined,
      title: scrub(a.title, 120),
      summary: scrub(a.summary, 4000),
      stepsToReproduce: a.stepsToReproduce
        .map((s) => scrub(s, 400))
        .filter(Boolean)
        .slice(0, MAX_STEPS),
      expected: optional(a.expected),
      actual: optional(a.actual),
      environment: environment && Object.keys(environment).length ? environment : undefined,
      priority,
      priorityReason: scrub(a.priorityReason, 300),
      dueDate,
      dueDateQuote: dueDate ? quote : null,
      relevantAttachmentIds: [
        ...new Set(a.relevantAttachmentIds.filter((id) => attachmentIds.has(id))),
      ],
      confidence,
      reason: scrub(a.reason, 300),
      category: undefined,
      resolvedInChat: a.kind === "update" && a.resolvedInChat === true,
      needsReview: a.kind === "create" && confidence < input.minConfidence,
    };
  }

  // Never flood a tracker from one conversation.
  const tickets = actions.filter((a) => a.kind === "create");
  const capped =
    tickets.length > MAX_TICKETS_PER_CONVERSATION
      ? actions.filter(
          (a) => a.kind !== "create" || tickets.indexOf(a) < MAX_TICKETS_PER_CONVERSATION,
        )
      : actions;
  droppedActions += actions.length - capped.length;

  if (capped.length === 0) {
    // Nothing usable. Say so with zero confidence so the caller treats the decision as uncertain.
    capped.push({
      kind: "no_action",
      title: "",
      summary: "",
      stepsToReproduce: [],
      priorityReason: "",
      dueDate: null,
      dueDateQuote: null,
      relevantAttachmentIds: [],
      confidence: 0,
      reason: "The AI returned no usable decision.",
      needsReview: false,
      resolvedInChat: false,
    });
  }
  return { actions: capped, cleanup: { droppedActions, discardedDueDates, redactions } };
}
