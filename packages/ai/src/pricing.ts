import type { Usage } from "./types";

/** USD per 1M tokens (OpenAI list prices, Oct 2026). Used for cost tracking and limits, so keep it current. */
export const PRICES: Record<string, { input: number; cachedInput: number; output: number }> = {
  "gpt-6-luna": { input: 0.1, cachedInput: 0.01, output: 0.5 },
  "gpt-6.1-sol": { input: 2.0, cachedInput: 0.1, output: 10.0 },
};

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  cachedInputTokens: a.cachedInputTokens + b.cachedInputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  reasoningTokens: a.reasoningTokens + b.reasoningTokens,
});

export const emptyUsage = (): Usage => ({
  inputTokens: 0,
  cachedInputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
});

/** Cost of one call. Output tokens already include reasoning tokens. Unknown models cost 0 (and should be added above). */
export function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const uncached = Math.max(0, u.inputTokens - u.cachedInputTokens);
  return (
    (uncached * p.input + u.cachedInputTokens * p.cachedInput + u.outputTokens * p.output) /
    1_000_000
  );
}
