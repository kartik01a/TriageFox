import { type AiProvider, modelConfig, OpenAiProvider, redact, triage } from "@triagefox/ai";
import {
  buildTicketBody,
  type CrispConversation,
  type CrispPluginClient,
} from "@triagefox/connectors";
import { and, eq, schema, withOrg } from "@triagefox/db";
import type { RpcOutput } from "@triagefox/rpc";
import { RpcError } from "@triagefox/rpc";
import { resolveAiKey } from "../pipeline/ai-key";
import { toAiMessages } from "../pipeline/triage";
import type { Ctx } from "./context";

const HOW_MANY = 10;
const PER_HOUR = 3;

/**
 * "What would TriageFox do with my recent chats?" Reads the newest conversations, runs the same AI
 * step as the live pipeline and returns what it would do, creating nothing. The conversations are
 * held in memory for this call only; the answer goes to the person who asked and is not stored.
 */
export async function dryRun(
  ctx: Ctx,
  crisp: CrispPluginClient,
  input: { orgId: string; automationId: string },
  providerFor?: (key: string) => AiProvider,
): Promise<RpcOutput<"automation.dryRun">> {
  const { orgId } = input;
  const [automation] = await withOrg(ctx.db, orgId, (tx) =>
    tx
      .select()
      .from(schema.automations)
      .where(
        and(eq(schema.automations.id, input.automationId), eq(schema.automations.orgId, orgId)),
      ),
  );
  if (!automation) throw new RpcError("not_found", "Automation not found.");
  const [source] = await withOrg(ctx.db, orgId, (tx) =>
    tx
      .select()
      .from(schema.connections)
      .where(eq(schema.connections.id, automation.sourceConnectionId)),
  );
  const websiteId = String(source?.metadata.websiteId ?? "");
  if (source?.status !== "active" || !websiteId)
    throw new RpcError("invalid", "Connect Crisp first.");

  const key = await resolveAiKey(ctx, orgId);
  if (!key) throw new RpcError("not_configured", "No OpenAI key is configured.");

  // A few trial runs an hour are plenty and keep a stuck button from running up the AI bill.
  const counter = `dryrun:${orgId}`;
  const used = await ctx.redis.incr(counter);
  if (used === 1) await ctx.redis.expire(counter, 3600);
  if (used > PER_HOUR)
    throw new RpcError("rate_limited", "You've tried this a few times already. Please wait a bit.");

  const refs = (await crisp.listConversations(websiteId, 1)).slice(0, HOW_MANY);
  const provider = providerFor?.(key.key) ?? new OpenAiProvider({ apiKey: key.key });
  const models = modelConfig(ctx.config);
  const settings = automation.settings;

  const results: RpcOutput<"automation.dryRun">["results"] = [];
  let analysed = 0;
  const queue = [...refs];
  async function worker() {
    for (let ref = queue.shift(); ref; ref = queue.shift()) {
      let conversation: CrispConversation;
      try {
        conversation = await crisp.fetchConversation(websiteId, ref.sessionId);
      } catch {
        continue;
      }
      const firstCustomer = conversation.messages.find((m) => m.role === "customer" && m.text);
      if (!firstCustomer) continue; // nothing a customer wrote: the live pipeline skips these too
      analysed++;
      const out = await triage(
        provider,
        {
          messages: toAiMessages(conversation),
          state: conversation.state,
          workspace: { language: settings.language, timezone: settings.timezone, now: new Date() },
          existingIssues: [],
          duplicateCandidates: [],
          minConfidence: settings.minConfidence,
        },
        { models, reasoning: { default: "low", escalation: "low" } },
      );
      const a = out.actions.find((x) => x.kind !== "no_action") ?? out.actions[0];
      if (!a) continue;
      results.push({
        when: conversation.updatedAt,
        snippet: redact((firstCustomer.text ?? "").replace(/\s+/g, " ").slice(0, 120)).text,
        conversationUrl: `https://app.crisp.chat/website/${websiteId}/inbox/${conversation.sessionId}/`,
        decision: a.kind,
        category: a.category,
        type: a.type,
        priority: a.priority,
        title: a.title,
        bodyPreview:
          a.kind === "create" && a.type && a.priority
            ? buildTicketBody(
                { ...a, type: a.type, priority: a.priority },
                { reportedBy: "1 customer" },
              )
            : "",
        reason: a.reason,
        confidence: a.confidence,
        needsReview: a.needsReview,
        dueDate: a.dueDate,
      });
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  results.sort((x, y) => y.when - x.when);
  return { analysed, results };
}
