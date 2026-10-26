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
import { and, eq, gte, inArray, schema, sql, withOrg } from "@triagefox/db";
import type { DeliverPayload, UpdatePayload } from "@triagefox/pipeline";
import type { Priority, WorkerEnv } from "@triagefox/shared";
import { UnrecoverableError } from "bullmq";
import { type BillingHooks, blockTitle } from "../billing";
import { resolveAiKey } from "./ai-key";
import { applyResult } from "./apply";
import type { PipelineLogger, Triage, TriageInput } from "./deps";
import { customerText, embedIssues, findDuplicateCandidates } from "./duplicates";

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
  /** Queues one delivery job (issue x destination). */
  enqueueDelivery: (payload: DeliverPayload) => Promise<unknown>;
  /** Queues one update job (update x destination). */
  enqueueUpdate: (payload: UpdatePayload) => Promise<unknown>;
  /** Plan and trial limits (hosted only). Without it nothing is limited, as in a self-hosted install. */
  billing?: BillingHooks;
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

    const resolved = await resolveAiKey(deps, orgId);
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

    let entitlement: Awaited<ReturnType<BillingHooks["check"]>> | null = null;
    if (deps.billing) {
      entitlement = await deps.billing.check({
        orgId,
        threadId: thread.id,
        hasOwnKey: resolved.source === "byok",
      });
      if (!entitlement.decision.allowed) {
        // Say so once a day, not on every retry: the conversation simply waits.
        const [recent] = await withOrg(deps.db, orgId, (tx) =>
          tx
            .select({ id: schema.activityLog.id })
            .from(schema.activityLog)
            .where(
              and(
                eq(schema.activityLog.kind, "billing_blocked"),
                gte(schema.activityLog.createdAt, new Date(now().getTime() - DAY_MS)),
              ),
            )
            .limit(1),
        );
        if (!recent)
          await log(
            input,
            "billing_blocked",
            `${blockTitle(entitlement.decision.reason)}. New conversations wait until this is sorted out.`,
            { reason: entitlement.decision.reason },
          );
        throw new UnrecoverableError(`billing_${entitlement.decision.reason}`);
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
      // Tickets already made from this conversation, so the AI updates instead of re-creating.
      existingIssues: (
        await withOrg(deps.db, orgId, (tx) =>
          tx
            .select()
            .from(schema.issues)
            .where(
              and(
                eq(schema.issues.originThreadId, thread.id),
                inArray(schema.issues.status, ["active", "pending_review"]),
              ),
            ),
        )
      ).map((i) => ({
        id: i.id,
        title: i.title,
        summary: i.summary,
        priority: i.priority as Priority,
        dueDate: i.dueDate,
      })),
      duplicateCandidates: [],
      minConfidence: automation.settings.minConfidence,
    };

    // Similar open tickets from other conversations (best effort; the AI confirms or rejects).
    aiInput.duplicateCandidates = await findDuplicateCandidates({
      db: deps.db,
      orgId,
      automationId: automation.id,
      threadId: thread.id,
      provider,
      model: models.embedding,
      text: customerText(aiInput.messages),
      log: deps.log,
    });

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
    const entries = (
      result.actions.length > 0
        ? result.actions.map((a) => ({
            kind: `ai_${a.kind}`,
            message: activityMessage(a),
            refs: { aiRunId: runId } as Record<string, unknown>,
          }))
        : [{ kind: "ai_no_action", message: "No ticket needed.", refs: { aiRunId: runId } }]
    ) as { kind: string; message: string; refs: Record<string, unknown> }[];

    await withOrg(deps.db, orgId, (tx) =>
      tx.insert(schema.aiRuns).values({
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
      }),
    );
    const applied = await applyResult({
      db: deps.db,
      keyring: deps.keyring,
      input,
      result,
      runId,
      entries,
    });
    // Count the conversation, its AI runs and cost against the plan (hosted only).
    if (deps.billing && entitlement)
      await deps.billing.after({
        orgId,
        threadId: thread.id,
        periodStart: entitlement.periodStart,
        trialing: entitlement.trialing,
        usingPlatformKey: resolved.source === "platform",
        costMicroUsd: Math.round(result.costUsd * 1e6),
        ticketsCreated: applied.created.length,
        limit: entitlement.decision.allowed ? entitlement.decision.limit : null,
      });
    await withOrg(deps.db, orgId, (tx) =>
      tx
        .insert(schema.activityLog)
        .values(
          entries.map((e) => ({ orgId, automationId: automation.id, threadId: thread.id, ...e })),
        ),
    );
    // After commit, so a job never runs before the rows it needs exist.
    for (const d of applied.deliveries) await deps.enqueueDelivery(d);
    for (const u of applied.updates) await deps.enqueueUpdate(u);
    await embedIssues({
      db: deps.db,
      orgId,
      provider,
      model: models.embedding,
      issues: applied.created,
      log: deps.log,
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
