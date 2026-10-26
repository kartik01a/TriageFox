/**
 * Evaluation runner: scores the real AI against the labelled conversations.
 *
 *   pnpm --filter @triagefox/ai eval                     # production policy (cheap model, escalation)
 *   pnpm --filter @triagefox/ai eval -- --model luna     # cheap model only
 *   pnpm --filter @triagefox/ai eval -- --model sol      # strong model only
 *   pnpm --filter @triagefox/ai eval -- --filter dates,injection --effort low --check
 *
 * Calls the OpenAI API with OPENAI_API_KEY and costs real (small) money. `--check` exits with code 1
 * when a documented target is missed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { OpenAiProvider } from "../src/openai";
import { AiError } from "../src/provider";
import { type TriageOptions, triage } from "../src/triage";
import type { TriageInput } from "../src/types";
import { cases } from "./cases";
import { type CaseScore, checkTargets, scoreCase, summarize, TARGETS } from "./metrics";
import type { EvalCase } from "./types";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i] ?? "";
  if (a.startsWith("--")) {
    const next = process.argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(a.slice(2), next);
      i++;
    } else args.set(a.slice(2), "true");
  }
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error("OPENAI_API_KEY is not set (see .env.example).");
  process.exit(1);
}
const LUNA = process.env.AI_MODEL_DEFAULT ?? "gpt-6-luna";
const SOL = process.env.AI_MODEL_ESCALATION ?? "gpt-6.1-sol";
const EMBED = process.env.AI_MODEL_EMBEDDING ?? "text-embedding-3-small";

const variant = args.get("model") ?? "policy";
type Effort = NonNullable<NonNullable<TriageOptions["reasoning"]>["default"]>;
const effort = (args.get("effort") ?? "low") as Effort;
const effortStrong = (args.get("effort-strong") ?? "low") as Effort;
const NEVER = { maxMessages: 1e9, maxChars: 1e9, maxImages: 1e9 };
const options: TriageOptions =
  variant === "luna"
    ? {
        models: { default: LUNA, escalation: LUNA, embedding: EMBED },
        escalateBelowConfidence: 0,
        complexity: NEVER,
        reasoning: { default: effort, escalation: effort },
      }
    : variant === "sol"
      ? {
          models: { default: SOL, escalation: SOL, embedding: EMBED },
          escalateBelowConfidence: 0,
          complexity: NEVER,
          reasoning: { default: effortStrong, escalation: effortStrong },
        }
      : {
          models: { default: LUNA, escalation: SOL, embedding: EMBED },
          reasoning: { default: effort, escalation: effortStrong },
        };

const filter = args.get("filter")?.split(",");
const only = args.get("id")?.split(",");
let selected = cases.filter(
  (k) => (!filter || k.tags.some((t) => filter.includes(t))) && (!only || only.includes(k.id)),
);
if (args.get("limit")) selected = selected.slice(0, Number(args.get("limit")));
const concurrency = Number(args.get("concurrency") ?? 6);
const provider = new OpenAiProvider({ apiKey });

const DEFAULT_NOW = "2026-10-26T10:00:00Z";
function toInput(k: EvalCase): TriageInput {
  const now = new Date(k.now ?? DEFAULT_NOW);
  const n = k.messages.length;
  return {
    messages: k.messages.map((m, i) => ({
      id: `m${i}`,
      role: m.role,
      at: now.getTime() - (m.minutesAgo ?? 2 + (n - 1 - i) * 3) * 60_000,
      text: m.text,
      attachment: m.attachment,
    })),
    state: k.state ?? "open",
    workspace: { language: k.language ?? "en", timezone: k.timezone ?? "UTC", now },
    existingIssues: k.existingIssues ?? [],
    duplicateCandidates: k.duplicateCandidates ?? [],
    minConfidence: 0.7,
  };
}

async function runOne(k: EvalCase): Promise<{ score: CaseScore; error?: string }> {
  try {
    const r = await triage(provider, toInput(k), options);
    return { score: scoreCase(k, r) };
  } catch (err) {
    if (err instanceof AiError && (err.kind === "auth" || err.kind === "no_quota")) throw err;
    const message = err instanceof Error ? err.message : String(err);
    return {
      error: message,
      score: {
        id: k.id,
        tags: k.tags,
        ticketDecision: false,
        kind: k.expect.kind ? false : null,
        type: k.expect.type && k.expect.positive ? false : null,
        priority: k.expect.priority && k.expect.positive ? false : null,
        creates: null,
        dueDate: null,
        category: null,
        piiLeak: false,
        issueId: null,
        falseDueDate: false,
        hallucinatedQuote: false,
        escalated: false,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
        summary: `ERROR ${message}`,
      },
    };
  }
}

const started = Date.now();
const results: { score: CaseScore; error?: string }[] = new Array(selected.length);
let next = 0;
let done = 0;
await Promise.all(
  Array.from({ length: Math.min(concurrency, selected.length) }, async () => {
    while (next < selected.length) {
      const i = next++;
      results[i] = await runOne(selected[i] as EvalCase);
      process.stderr.write(`\r${++done}/${selected.length} cases`);
    }
  }),
);
process.stderr.write("\n");

const scores = results.map((r) => r.score);
const report = summarize(scores);
const pct = (x: { passed: number; total: number; rate: number }) =>
  `${(x.rate * 100).toFixed(1)}% (${x.passed}/${x.total})`;

// Failures first: what was expected, what we got.
const failures = selected
  .map((k, i) => ({ k, s: scores[i] as CaseScore, err: results[i]?.error }))
  .filter(
    ({ s }) =>
      [
        s.ticketDecision,
        s.kind,
        s.type,
        s.priority,
        s.creates,
        s.dueDate,
        s.category,
        s.issueId,
      ].some((v) => v === false) || s.falseDueDate,
  );
if (failures.length) {
  console.log(`\n── ${failures.length} case(s) with a miss ${"─".repeat(40)}`);
  for (const { k, s, err } of failures) {
    const wrong = (
      [
        "ticketDecision",
        "kind",
        "type",
        "priority",
        "creates",
        "dueDate",
        "category",
        "issueId",
      ] as const
    ).filter((d) => s[d] === false);
    const e = k.expect;
    const want = e.positive
      ? `${e.kind ?? "ticket"} ${[].concat((e.type ?? "") as never).join("|")} P${e.priority ?? "?"}${e.dueDate !== undefined ? ` due ${e.dueDate}` : ""}`
      : `no_action${e.category ? ` (${[].concat(e.category as never).join("|")})` : ""}`;
    console.log(`✗ ${k.id}  [${wrong.join(", ")}${s.falseDueDate ? ", FALSE DATE" : ""}]`);
    console.log(`    wanted: ${want}`);
    console.log(`    got:    ${err ? `ERROR ${err}` : s.summary}`);
    if (k.note) console.log(`    note:   ${k.note}`);
  }
}

console.log(
  `\n── ${variant} · effort ${effort}/${effortStrong} · ${report.cases} cases · ${((Date.now() - started) / 1000).toFixed(0)}s ${"─".repeat(20)}`,
);
console.log(
  `ticket vs no-ticket   ${pct(report.accuracy.ticketDecision)}   (target ≥ ${TARGETS.ticketDecision * 100}%)`,
);
console.log(
  `type                  ${pct(report.accuracy.type)}   (target ≥ ${TARGETS.type * 100}%)`,
);
console.log(
  `priority within ±1    ${pct(report.accuracy.priority)}   (target ≥ ${TARGETS.priority * 100}%)`,
);
console.log(`false due dates       ${report.falseDueDates}   (target = 0)`);
console.log(`personal data leaks   ${report.piiLeaks}   (target = 0)`);
console.log(`primary action kind   ${pct(report.accuracy.kind)}`);
console.log(`ticket count          ${pct(report.accuracy.creates)}`);
console.log(`due date correct      ${pct(report.accuracy.dueDate)}`);
console.log(`category (no_action)  ${pct(report.accuracy.category)}`);
console.log(`update/duplicate id   ${pct(report.accuracy.issueId)}`);
console.log(`quotes the model invented (caught by code): ${report.hallucinatedQuotes}`);
console.log(
  `escalated: ${(report.escalationRate * 100).toFixed(0)}%   avg tokens in/out: ${report.avgInputTokens.toFixed(0)}/${report.avgOutputTokens.toFixed(0)}`,
);
console.log(
  `cost: $${report.totalCostUsd.toFixed(4)} total, $${report.costPerCaseUsd.toFixed(5)} per conversation`,
);

const targets = checkTargets(report);
console.log("");
for (const t of targets.checks) console.log(`${t.ok ? "✔" : "✗"} ${t.name}: ${t.value}`);

const dir = join(import.meta.dirname, "results");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, `${variant}-${effort}-${Date.now()}.json`),
  JSON.stringify({ variant, effort, effortStrong, report, scores }, null, 2),
);
if (args.has("check") && !targets.allMet) process.exit(1);
