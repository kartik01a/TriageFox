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
import { buildTicketBody, CRISP_FILE_HOSTS } from "@triagefox/connectors";
import { openSecret, type PrivateKeyring, sealSecret } from "@triagefox/crypto";
import { and, eq, gte, inArray, schema, sql, withOrg } from "@triagefox/db";
import type { DeliverPayload } from "@triagefox/pipeline";
import type { Priority, WorkerEnv } from "@triagefox/shared";
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
  /** Queues one delivery job (issue x destination). */
  enqueueDelivery: (payload: DeliverPayload) => Promise<unknown>;
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
      // Phase 6 fills this in (similar tickets from other conversations).
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
    const deliveries: DeliverPayload[] = [];
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
      const entries: { kind: string; message: string; refs: Record<string, unknown> }[] =
        result.actions.length > 0
          ? result.actions.map((a) => ({
              kind: `ai_${a.kind}`,
              message: activityMessage(a),
              refs: { aiRunId: runId } as Record<string, unknown>,
            }))
          : [{ kind: "ai_no_action", message: "No ticket needed.", refs: { aiRunId: runId } }];

      const destinations = await tx
        .select({ id: schema.automationDestinations.id })
        .from(schema.automationDestinations)
        .where(
          and(
            eq(schema.automationDestinations.automationId, automation.id),
            eq(schema.automationDestinations.enabled, true),
          ),
        );

      for (const a of result.actions) {
        if (a.kind !== "create" || !a.type || !a.priority) continue;
        const [issue] = await tx
          .insert(schema.issues)
          .values({
            orgId,
            automationId: automation.id,
            originThreadId: thread.id,
            aiRunId: runId,
            title: a.title,
            summary: a.summary,
            bodyMd: buildTicketBody(
              { ...a, type: a.type, priority: a.priority },
              {
                reportedBy:
                  automation.settings.includeCustomerNames && conversation.customer.nickname
                    ? conversation.customer.nickname
                    : "1 customer",
                sourceUrl: automation.settings.includeSourceLink
                  ? `https://app.crisp.chat/website/${conversation.websiteId}/inbox/${conversation.sessionId}/`
                  : undefined,
              },
            ),
            type: a.type,
            priority: a.priority,
            dueDate: a.dueDate,
            dueDateQuote: a.dueDateQuote,
            confidence: a.confidence,
            attachmentIds: a.relevantAttachmentIds,
            status: a.needsReview ? "pending_review" : "active",
          })
          .returning({ id: schema.issues.id });
        if (!issue || a.needsReview) continue;
        if (destinations.length === 0)
          entries.push({
            kind: "no_destination",
            message: "A ticket was prepared, but no Trello or Jira destination is set up yet.",
            refs: { issueId: issue.id },
          });
        for (const d of destinations)
          deliveries.push({ orgId, issueId: issue.id, destinationId: d.id });
      }
      await tx.insert(schema.activityLog).values(
        entries.map((e) => ({
          orgId,
          automationId: automation.id,
          threadId: thread.id,
          ...e,
        })),
      );
    });
    // After commit, so a job never runs before its issue exists.
    for (const d of deliveries) await deps.enqueueDelivery(d);
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
