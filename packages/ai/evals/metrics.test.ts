import { describe, expect, it } from "vitest";
import type { TriageAction, TriageResult } from "../src/types";
import { cases } from "./cases";
import { checkTargets, scoreCase, summarize } from "./metrics";
import type { EvalCase } from "./types";

const act = (over: Partial<TriageAction> = {}): TriageAction => ({
  kind: "create",
  type: "bug",
  title: "t",
  summary: "s",
  stepsToReproduce: [],
  priority: 3,
  priorityReason: "",
  dueDate: null,
  dueDateQuote: null,
  relevantAttachmentIds: [],
  confidence: 0.9,
  reason: "",
  needsReview: false,
  resolvedInChat: false,
  ...over,
});
const result = (actions: TriageAction[], discarded = 0): TriageResult => ({
  actions,
  model: "m",
  escalated: false,
  usage: { inputTokens: 100, cachedInputTokens: 0, outputTokens: 20, reasoningTokens: 0 },
  costUsd: 0.001,
  cleanup: { droppedActions: 0, discardedDueDates: discarded, redactions: 0 },
});
const kase = (expect: EvalCase["expect"]): EvalCase => ({
  id: "x",
  tags: [],
  messages: [],
  expect,
});

describe("scoreCase", () => {
  it("scores a correct ticket on every dimension", () => {
    const s = scoreCase(
      kase({
        positive: true,
        kind: "create",
        type: "bug",
        priority: 4,
        creates: 1,
        dueDate: "2026-10-30",
      }),
      result([act({ priority: 5, dueDate: "2026-10-30" })]),
    );
    expect(s).toMatchObject({
      ticketDecision: true,
      kind: true,
      type: true,
      priority: true,
      creates: true,
      dueDate: true,
      falseDueDate: false,
    });
  });
  it("priority is judged within one level", () => {
    const e = kase({ positive: true, type: "bug", priority: 3 });
    expect(scoreCase(e, result([act({ priority: 4 })])).priority).toBe(true);
    expect(scoreCase(e, result([act({ priority: 5 })])).priority).toBe(false);
  });
  it("accepts any of several allowed types", () => {
    const e = kase({ positive: true, type: ["bug", "data"], priority: 3 });
    expect(scoreCase(e, result([act({ type: "data" })])).type).toBe(true);
    expect(scoreCase(e, result([act({ type: "feature" })])).type).toBe(false);
  });
  it("a spurious extra update next to the expected create is a miss", () => {
    const e = kase({ positive: true, kind: "create", type: "bug", priority: 3 });
    expect(scoreCase(e, result([act({ kind: "update", issueId: "iss_1" }), act()])).kind).toBe(
      false,
    );
    expect(scoreCase(e, result([act(), act()])).kind).toBe(true);
  });
  it("flags personal data in the AI's output", () => {
    const e = kase({ positive: true, type: "bug", priority: 3 });
    expect(scoreCase(e, result([act({ summary: "mail jane@acme.com" })])).piiLeak).toBe(true);
    expect(scoreCase(e, result([act({ summary: "card 4111 1111 1111 1111" })])).piiLeak).toBe(true);
    expect(scoreCase(e, result([act({ summary: "mail [email]" })])).piiLeak).toBe(false);
  });
  it("counts a missed ticket and a needless ticket as wrong decisions", () => {
    expect(
      scoreCase(
        kase({ positive: true, type: "bug", priority: 3 }),
        result([act({ kind: "no_action" })]),
      ).ticketDecision,
    ).toBe(false);
    expect(
      scoreCase(kase({ positive: false, kind: "no_action" }), result([act()])).ticketDecision,
    ).toBe(false);
    expect(
      scoreCase(
        kase({ positive: false, kind: "no_action" }),
        result([act({ kind: "no_action", category: "greeting" })]),
      ).ticketDecision,
    ).toBe(true);
  });
  it("flags a due date on a case that has no deadline: the failure that must never happen", () => {
    const s = scoreCase(
      kase({ positive: true, type: "bug", priority: 3, dueDate: null }),
      result([act({ dueDate: "2026-10-30" })]),
    );
    expect(s.falseDueDate).toBe(true);
    expect(s.dueDate).toBe(false);
    expect(
      scoreCase(kase({ positive: true, type: "bug", priority: 3, dueDate: null }), result([act()]))
        .falseDueDate,
    ).toBe(false);
  });
  it("records quotes the model invented that code then discarded", () => {
    expect(
      scoreCase(
        kase({ positive: true, type: "bug", priority: 3, dueDate: null }),
        result([act()], 1),
      ).hallucinatedQuote,
    ).toBe(true);
  });
  it("checks update/duplicate ids and ticket counts", () => {
    const s = scoreCase(
      kase({ positive: true, kind: "update", issueId: "iss_1" }),
      result([act({ kind: "update", issueId: "iss_1" })]),
    );
    expect(s).toMatchObject({ kind: true, issueId: true });
    expect(
      scoreCase(
        kase({ positive: true, type: "bug", priority: 3, creates: 2 }),
        result([act(), act()]),
      ).creates,
    ).toBe(true);
    expect(
      scoreCase(kase({ positive: true, type: "bug", priority: 3, creates: 2 }), result([act()]))
        .creates,
    ).toBe(false);
  });
  it("checks the no_action category", () => {
    const e = kase({ positive: false, kind: "no_action", category: ["billing", "refund_request"] });
    expect(
      scoreCase(e, result([act({ kind: "no_action", category: "refund_request" })])).category,
    ).toBe(true);
    expect(scoreCase(e, result([act({ kind: "no_action", category: "praise" })])).category).toBe(
      false,
    );
  });
});

describe("summarize and targets", () => {
  const good = scoreCase(kase({ positive: true, type: "bug", priority: 3 }), result([act()]));
  const bad = scoreCase(
    kase({ positive: true, type: "bug", priority: 3 }),
    result([act({ type: "feature", priority: 5 })]),
  );
  it("computes accuracy only over applicable cases", () => {
    const r = summarize([good, good, bad]);
    expect(r.accuracy.type).toEqual({ passed: 2, total: 3, rate: 2 / 3 });
    expect(r.cases).toBe(3);
    expect(r.totalCostUsd).toBeCloseTo(0.003);
  });
  it("reports which targets are met", () => {
    expect(checkTargets(summarize(Array(20).fill(good))).allMet).toBe(true);
    const missed = checkTargets(summarize([good, bad]));
    expect(missed.allMet).toBe(false);
    expect(missed.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(
      expect.arrayContaining([expect.stringMatching(/type/), expect.stringMatching(/priority/)]),
    );
  });
  it("any false due date fails the targets however good everything else is", () => {
    const falseDate = scoreCase(
      kase({ positive: true, type: "bug", priority: 3, dueDate: null }),
      result([act({ dueDate: "2026-10-30" })]),
    );
    expect(checkTargets(summarize([...Array(50).fill(good), falseDate])).allMet).toBe(false);
  });
});

describe("the labelled set itself", () => {
  it("is large and varied enough to mean something", () => {
    expect(cases.length).toBeGreaterThanOrEqual(100);
    const tags = new Set(cases.flatMap((k) => k.tags));
    for (const t of [
      "smalltalk",
      "howto",
      "billing",
      "bug",
      "ui",
      "feature",
      "infra",
      "security",
      "data",
      "resolved",
      "mixed",
      "injection",
      "dates",
      "no-date",
      "language",
      "duplicate",
      "existing",
      "long",
      "priority",
    ]) {
      expect(tags.has(t), `missing tag ${t}`).toBe(true);
    }
  });
  it("has well-formed cases", () => {
    for (const k of cases) {
      expect(k.messages.length, k.id).toBeGreaterThan(0);
      expect(
        k.messages.every((m) => m.text.length > 0),
        k.id,
      ).toBe(true);
      if (k.expect.positive && k.expect.kind === "create")
        expect(k.expect.type && k.expect.priority, `${k.id} needs type and priority`).toBeTruthy();
      if (k.expect.kind === "update" || k.expect.kind === "duplicate_of")
        expect(k.expect.issueId, k.id).toBeTruthy();
    }
  });
  it("has expected dates that are real calendar dates", () => {
    for (const k of cases)
      if (k.expect.dueDate) expect(Number.isNaN(Date.parse(k.expect.dueDate)), k.id).toBe(false);
  });
});
