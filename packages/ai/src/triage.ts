import { z } from "zod";
import type { ModelConfig } from "./keys";
import { cleanOutput } from "./postprocess";
import { addUsage, costUsd, emptyUsage } from "./pricing";
import { buildPrompt } from "./prompt";
import { AiError, type AiProvider, type CompletionRequest } from "./provider";
import { modelOutputJsonSchema, modelOutputSchema } from "./schema";
import type { TriageInput, TriageResult, Usage } from "./types";

export interface TriageOptions {
  models: ModelConfig;
  reasoning?: {
    default?: CompletionRequest["reasoningEffort"];
    escalation?: CompletionRequest["reasoningEffort"];
  };
  /** A decision below this confidence is re-checked by the stronger model. */
  escalateBelowConfidence?: number;
  /** Conversations bigger than this go straight to the stronger model. */
  complexity?: { maxMessages: number; maxChars: number; maxImages: number };
  maxOutputTokens?: number;
}

const DEFAULT_COMPLEXITY = { maxMessages: 30, maxChars: 12_000, maxImages: 2 };

const jsonSchema = modelOutputJsonSchema();

async function run(
  provider: AiProvider,
  model: string,
  built: ReturnType<typeof buildPrompt>,
  opts: TriageOptions,
  effort: CompletionRequest["reasoningEffort"],
) {
  const res = await provider.complete({
    model,
    system: built.system,
    text: built.text,
    images: built.images,
    schema: jsonSchema,
    schemaName: "triage",
    maxOutputTokens: opts.maxOutputTokens ?? 6000,
    reasoningEffort: effort,
  });
  const parsed = modelOutputSchema.safeParse(res.json);
  if (!parsed.success)
    throw new AiError(
      "bad_output",
      `The answer did not match the expected format: ${z.prettifyError(parsed.error).slice(0, 200)}`,
    );
  return { output: parsed.data, usage: res.usage };
}

/**
 * Analyses one conversation and returns safe, validated actions.
 *
 * Model policy: the cheap model first; the stronger model straight away for large or image-heavy
 * conversations, and as a second opinion when the first answer is unsure or unusable.
 */
export async function triage(
  provider: AiProvider,
  input: TriageInput,
  opts: TriageOptions,
): Promise<TriageResult> {
  const complexity = opts.complexity ?? DEFAULT_COMPLEXITY;
  const threshold = opts.escalateBelowConfidence ?? 0.7;
  const { default: cheap, escalation: strong } = opts.models;

  let built = buildPrompt(input);
  const chars = built.messages.reduce((n, m) => n + (m.text?.length ?? 0), 0);
  const complex =
    built.messages.length > complexity.maxMessages ||
    chars > complexity.maxChars ||
    built.images.length > complexity.maxImages;

  let usage: Usage = emptyUsage();
  let cost = 0;
  const spend = (model: string, u: Usage) => {
    usage = addUsage(usage, u);
    cost += costUsd(model, u);
  };

  type Attempt = Awaited<ReturnType<typeof run>> & { model: string };
  const attempt = async (
    model: string,
    effort: CompletionRequest["reasoningEffort"],
  ): Promise<Attempt> => {
    try {
      const r = await run(provider, model, built, opts, effort);
      spend(model, r.usage);
      return { ...r, model };
    } catch (err) {
      // An image OpenAI cannot load should not lose the whole decision: retry the text alone.
      if (err instanceof AiError && err.kind === "invalid_image" && built.images.length > 0) {
        built = buildPrompt(input, { imagesAllowed: false });
        const r = await run(provider, model, built, opts, effort);
        spend(model, r.usage);
        return { ...r, model };
      }
      throw err;
    }
  };

  let escalated = false;
  let escalationReason: string | undefined;
  let first: Attempt;
  if (complex) {
    escalated = true;
    escalationReason = "large or image-heavy conversation";
    first = await attempt(strong, opts.reasoning?.escalation);
  } else {
    try {
      first = await attempt(cheap, opts.reasoning?.default);
    } catch (err) {
      if (!(err instanceof AiError && err.kind === "bad_output")) throw err;
      escalated = true;
      escalationReason = "the first answer was unusable";
      first = await attempt(strong, opts.reasoning?.escalation);
    }
  }

  let cleaned = cleanOutput(first.output, input, built.messages);
  let finalModel = first.model;

  const unsure = Math.min(...cleaned.actions.map((a) => a.confidence)) < threshold;
  if (!escalated && unsure) {
    try {
      const second = await attempt(strong, opts.reasoning?.escalation);
      const secondCleaned = cleanOutput(second.output, input, built.messages);
      escalated = true;
      escalationReason = "the first answer was unsure";
      cleaned = secondCleaned;
      finalModel = second.model;
    } catch (err) {
      // The second opinion is a bonus: keep the first answer if it fails (rate limits, outages).
      if (err instanceof AiError && (err.kind === "auth" || err.kind === "no_quota")) throw err;
    }
  }

  return {
    actions: cleaned.actions,
    model: finalModel,
    escalated,
    escalationReason,
    usage,
    costUsd: cost,
    cleanup: { ...cleaned.cleanup, redactions: built.redactions },
  };
}
