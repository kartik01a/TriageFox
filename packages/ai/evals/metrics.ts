import type { TicketType } from "@triagefox/shared";
import type { TriageResult } from "../src/types";
import type { EvalCase } from "./types";

export interface CaseScore {
  id: string;
  tags: string[];
  /** Pass/fail per dimension. `null` = not applicable to this case. */
  ticketDecision: boolean;
  kind: boolean | null;
  type: boolean | null;
  priority: boolean | null;
  creates: boolean | null;
  dueDate: boolean | null;
  category: boolean | null;
  issueId: boolean | null;
  resolvedInChat: boolean | null;
  /** Personal data (email, phone, card) appeared in what the AI wrote. */
  piiLeak: boolean;
  /** A due date was produced for a case that has no usable deadline: the failure we must never have. */
  falseDueDate: boolean;
  /** The model quoted words the customer never wrote (caught and discarded by code). */
  hallucinatedQuote: boolean;
  escalated: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  summary: string;
}

/** Exactly the expected kind of ticket work: no more, no less. A spurious extra update counts as a miss. */
function kindsMatch(expected: string, produced: string[]) {
  const set = new Set(produced);
  return expected === "no_action" ? set.size === 0 : set.size === 1 && set.has(expected);
}

const PII = /[A-Z0-9._%+-]+@[A-Z0-9-]+\.[A-Z]{2,}|\b(?:\d[ -]?){13,19}\b|\+\d[\d\s().-]{8,}\d/i;
const asArray = <T>(v: T | T[]) => (Array.isArray(v) ? v : [v]);

export function scoreCase(testCase: EvalCase, result: TriageResult): CaseScore {
  const e = testCase.expect;
  const real = result.actions.filter((a) => a.kind !== "no_action");
  const primary = result.actions.find((a) => a.kind === "create") ?? real[0] ?? result.actions[0];
  const predictedPositive = real.length > 0;
  const creates = result.actions.filter((a) => a.kind === "create");
  const created = creates[0];

  const type =
    e.type && e.positive
      ? created?.type
        ? asArray(e.type).includes(created.type as TicketType)
        : false
      : null;
  const priority =
    e.priority && e.positive
      ? created?.priority
        ? Math.abs(created.priority - e.priority) <= 1
        : false
      : null;
  const expectsDate = e.dueDate !== undefined;
  const gotDate = real.map((a) => a.dueDate).find(Boolean) ?? null;

  return {
    id: testCase.id,
    tags: testCase.tags,
    ticketDecision: predictedPositive === e.positive,
    kind: e.kind
      ? kindsMatch(
          e.kind,
          real.map((a) => a.kind),
        )
      : null,
    type,
    priority,
    creates: e.creates !== undefined ? creates.length === e.creates : null,
    dueDate: expectsDate ? gotDate === e.dueDate : null,
    category:
      e.category && !e.positive
        ? asArray(e.category).includes((primary?.category ?? "") as never)
        : null,
    issueId: e.issueId ? real.some((a) => a.issueId === e.issueId) : null,
    resolvedInChat:
      e.resolvedInChat === undefined
        ? null
        : real.some((a) => a.kind === "update" && a.resolvedInChat) === e.resolvedInChat,
    piiLeak: PII.test(JSON.stringify(result.actions)),
    falseDueDate: (e.dueDate === null || !e.positive) && gotDate !== null,
    hallucinatedQuote: result.cleanup.discardedDueDates > 0 && gotDate === null,
    escalated: result.escalated,
    costUsd: result.costUsd,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    summary: describe(result),
  };
}

function describe(r: TriageResult): string {
  return r.actions
    .map((a) =>
      a.kind === "no_action"
        ? `no_action${a.category ? `(${a.category})` : ""}`
        : `${a.kind}:${a.type ?? "?"}:P${a.priority ?? "?"}${a.dueDate ? ` due ${a.dueDate}` : ""}${a.issueId ? ` #${a.issueId}` : ""} @${a.confidence.toFixed(2)}`,
    )
    .join(" + ");
}

export interface Report {
  cases: number;
  /** Accuracy (0-1) per dimension, over the cases where the dimension applies. */
  accuracy: Record<
    | "ticketDecision"
    | "kind"
    | "type"
    | "priority"
    | "creates"
    | "dueDate"
    | "category"
    | "issueId"
    | "resolvedInChat",
    { passed: number; total: number; rate: number }
  >;
  falseDueDates: number;
  piiLeaks: number;
  hallucinatedQuotes: number;
  escalationRate: number;
  totalCostUsd: number;
  costPerCaseUsd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
}

export const TARGETS = {
  ticketDecision: 0.9,
  type: 0.85,
  priority: 0.85,
  falseDueDates: 0,
} as const;

export function summarize(scores: CaseScore[]): Report {
  const dim = (k: keyof Report["accuracy"]) => {
    const applicable = scores.filter((s) => s[k] !== null);
    const passed = applicable.filter((s) => s[k] === true).length;
    return {
      passed,
      total: applicable.length,
      rate: applicable.length ? passed / applicable.length : 1,
    };
  };
  const n = scores.length || 1;
  const cost = scores.reduce((t, s) => t + s.costUsd, 0);
  return {
    cases: scores.length,
    accuracy: {
      ticketDecision: dim("ticketDecision"),
      kind: dim("kind"),
      type: dim("type"),
      priority: dim("priority"),
      creates: dim("creates"),
      dueDate: dim("dueDate"),
      category: dim("category"),
      issueId: dim("issueId"),
      resolvedInChat: dim("resolvedInChat"),
    },
    falseDueDates: scores.filter((s) => s.falseDueDate).length,
    piiLeaks: scores.filter((s) => s.piiLeak).length,
    hallucinatedQuotes: scores.filter((s) => s.hallucinatedQuote).length,
    escalationRate: scores.filter((s) => s.escalated).length / n,
    totalCostUsd: cost,
    costPerCaseUsd: cost / n,
    avgInputTokens: scores.reduce((t, s) => t + s.inputTokens, 0) / n,
    avgOutputTokens: scores.reduce((t, s) => t + s.outputTokens, 0) / n,
  };
}

/** Which of the documented targets are met. */
export function checkTargets(r: Report) {
  const checks = [
    {
      name: "ticket vs no-ticket accuracy ≥ 90%",
      ok: r.accuracy.ticketDecision.rate >= TARGETS.ticketDecision,
      value: pct(r.accuracy.ticketDecision.rate),
    },
    {
      name: "type accuracy ≥ 85%",
      ok: r.accuracy.type.rate >= TARGETS.type,
      value: pct(r.accuracy.type.rate),
    },
    {
      name: "priority within ±1 ≥ 85%",
      ok: r.accuracy.priority.rate >= TARGETS.priority,
      value: pct(r.accuracy.priority.rate),
    },
    {
      name: "false due dates = 0",
      ok: r.falseDueDates === TARGETS.falseDueDates,
      value: String(r.falseDueDates),
    },
  ];
  return { checks, allMet: checks.every((c) => c.ok) };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
