import {
  AiError,
  type TriageInput as AiInput,
  type AiProvider,
  modelConfig,
  OpenAiProvider,
  triage as runTriage,
  type TriageAction,
  type TriageMessage,
  type TriageResult,
} from "@triagefox/ai";
import { CRISP_FILE_HOSTS } from "@triagefox/connectors";
import { openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { and, eq, gte, schema, sql, withOrg } from "@triagefox/db";
import type { WorkerEnv } from "@triagefox/shared";
import { UnrecoverableError } from "bullmq";
import type { PipelineLogger, Triage, TriageInput } from "./deps";

export interface TriageDeps {
  db: Parameters<typeof withOrg>[0];
  config: Pick<
    WorkerEnv,
    | "AI_MODEL_DEFAULT"
    | "AI_MODEL_ESCALATION"
    | "AI_MODEL_EMBEDDING"
    | "OPENAI_API_KEY"
    | "AI_MAX_RUNS_PER_THREAD_PER_MONTH"
    | "AI_PLATFORM_DAILY_USD_PER_ORG"
  >;
  keyring: PrivateKeyring;
  log: PipelineLogger;
  /** Tests inject a fake model here. */
  providerFor?: (apiKey: string) => AiProvider;
  now?: () => Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Crisp message -> what the AI sees. Files are only shown when they live on Crisp's own storage host. */
export function toAiMessages(conversation: TriageInput["conversation"]): TriageMessage[] {
  return conversation.messages.map((m) => {
    const base = { id: m.fingerprint, role: m.role, at: m.timestamp };
    if (m.kind === "text") return { ...base, text: m.text };
    const file = m.file;
    if (file && isCrispFileUrl(file.url))
      return {
        ...base,
        attachment: { id: m.fingerprint, name: file.name, mime: file.mime, url: file.url },
      };
    return { ...base, text: `[file not shown: ${file?.name ?? "unknown"}]` };
  });
}

function isCrispFileUrl(raw: string) {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && CRISP_FILE_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

/** The decision as stored in plain columns: kinds, types, numbers. No free text written by the AI. */
function summariseDecision(actions: TriageAction[]) {
  return {
    actions: actions.map((a) => ({
      kind: a.kind,
      type: a.type ?? null,
      priority: a.priority ?? null,
      confidence: a.confidence,
      category: a.category ?? null,
      needsReview: a.needsReview,
      hasDueDate: a.dueDate !== null,
      issueId: a.issueId ?? null,
    })),
  };
}

function activityMessage(a: TriageAction) {
  switch (a.kind) {
    case "create":
      return a.needsReview
        ? `Ticket proposed (${a.type}, priority ${a.priority}); low confidence, goes to review.`
        : `Ticket proposed (${a.type}, priority ${a.priority}).`;
    case "update":
      return "Existing ticket should be updated.";
    case "duplicate_of":
      return "Matches an existing ticket.";
    default:
      return `No ticket needed (${a.category ?? "other"}).`;
  }
}

export function createTriage(deps: TriageDeps): Triage {
  const now = deps.now ?? (() => new Date());
  const models = modelConfig(deps.config);

  async function log(
    input: TriageInput,
    kind: string,
    message: string,
    refs: Record<string, unknown> = {},
  ) {
    await withOrg(deps.db, input.orgId, (tx) =>
      tx.insert(schema.activityLog).values({
        orgId: input.orgId,
        automationId: input.automation.id,
        threadId: input.thread.id,
        kind,
        message,
        refs,
      }),
    );
  }

  /** Own key first (write-only; opened only here); otherwise the platform key. */
  async function resolveKey(
    orgId: string,
  ): Promise<{ key: string; source: "byok" | "platform" } | null> {
    const [row] = await withOrg(deps.db, orgId, (tx) =>
      tx
        .select({ sealed: schema.aiSettings.keySealed })
        .from(schema.aiSettings)
        .where(eq(schema.aiSettings.orgId, orgId)),
    );
    if (row?.sealed) {
      const key = await openSecret(
        row.sealed,
        { orgId, recordId: orgId, purpose: "ai.key" },
        deps.keyring,
      );
      return { key, source: "byok" };
    }
    return deps.config.OPENAI_API_KEY
      ? { key: deps.config.OPENAI_API_KEY, source: "platform" }
      : null;
  }

  return async (input) => {
    const { orgId, thread, automation, conversation } = input;
    const since = new Date(now().getTime() - 30 * DAY_MS);

    const [counted] = await withOrg(deps.db, orgId, (tx) =>
      tx
        .select({ runs: sql<number>`count(*)::int` })
        .from(schema.aiRuns)
        .where(and(eq(schema.aiRuns.threadId, thread.id), gte(schema.aiRuns.createdAt, since))),
    );
    const runs = counted?.runs ?? 0;
    if (runs >= deps.config.AI_MAX_RUNS_PER_THREAD_PER_MONTH) {
      await log(
        input,
        "ai_limit",
        "Skipped: this conversation reached its monthly analysis limit.",
      );
      return;
    }

    const resolved = await resolveKey(orgId);
    if (!resolved) {
      await log(
        input,
        "ai_unavailable",
        "No OpenAI key is configured, so the conversation was not analysed.",
      );
      throw new UnrecoverableError("no_ai_key");
    }

    if (resolved.source === "platform") {
      const [sum] = await withOrg(deps.db, orgId, (tx) =>
        tx
          .select({ spent: sql<number>`coalesce(sum(${schema.aiRuns.costMicroUsd}), 0)::float8` })
          .from(schema.aiRuns)
          .where(
            and(
              eq(schema.aiRuns.keySource, "platform"),
              gte(schema.aiRuns.createdAt, new Date(now().getTime() - DAY_MS)),
            ),
          ),
      );
      const spent = sum?.spent ?? 0;
      if (spent / 1e6 >= deps.config.AI_PLATFORM_DAILY_USD_PER_ORG) {
        await log(input, "ai_limit", "Paused for today: the daily AI spend ceiling was reached.");
        throw new UnrecoverableError("spend_ceiling");
      }
    }

    const provider =
      deps.providerFor?.(resolved.key) ?? new OpenAiProvider({ apiKey: resolved.key });
    const aiInput: AiInput = {
      messages: toAiMessages(conversation),
      state: conversation.state,
      workspace: {
        language: automation.settings.language,
        timezone: automation.settings.timezone,
        now: now(),
      },
      // Phase 6 fills these in (linked tickets, duplicate candidates).
      existingIssues: [],
      duplicateCandidates: [],
      minConfidence: automation.settings.minConfidence,
    };

    let result: TriageResult;
    try {
      result = await runTriage(provider, aiInput, {
        models,
        reasoning: { default: "low", escalation: "low" },
      });
    } catch (err) {
      if (err instanceof AiError && (err.kind === "auth" || err.kind === "no_quota")) {
        const whose =
          resolved.source === "byok"
            ? "Your OpenAI key was rejected or is out of credit"
            : "The platform AI key was rejected";
        await log(input, "ai_key_problem", `${whose}; analysis is paused until it is fixed.`);
        throw new UnrecoverableError(`ai_${err.kind}`);
      }
      throw err; // rate limits, outages and bad output: retried with backoff
    }

    const runId = crypto.randomUUID();
    const rawOutputSealed = await sealSecret(
      JSON.stringify({ actions: result.actions }),
      { orgId, recordId: runId, purpose: "ai_run.output" },
      deps.keyring,
    );
    await withOrg(deps.db, orgId, async (tx) => {
      await tx.insert(schema.aiRuns).values({
        id: runId,
        orgId,
        threadId: thread.id,
        model: result.model,
        escalated: result.escalated ? 1 : 0,
        keySource: resolved.source,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        costMicroUsd: Math.round(result.costUsd * 1e6),
        decision: summariseDecision(result.actions),
        rawOutputSealed,
      });
      const entries =
        result.actions.length > 0
          ? result.actions.map((a) => ({ kind: `ai_${a.kind}`, message: activityMessage(a) }))
          : [{ kind: "ai_no_action", message: "No ticket needed." }];
      await tx.insert(schema.activityLog).values(
        entries.map((e) => ({
          orgId,
          automationId: automation.id,
          threadId: thread.id,
          ...e,
          refs: { aiRunId: runId },
        })),
      );
    });
    deps.log.info(
      {
        threadId: thread.id,
        model: result.model,
        escalated: result.escalated,
        actions: result.actions.map((a) => a.kind),
        costUsd: result.costUsd,
      },
      "conversation analysed",
    );
  };
}
