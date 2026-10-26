export interface ModelConfig {
  /** Cheap model used for most conversations. */
  default: string;
  /** Stronger model for long, ambiguous or image-heavy conversations. */
  escalation: string;
  embedding: string;
}

/** Models are server configuration. Customers can bring their own key but never choose models. */
export function modelConfig(env: {
  AI_MODEL_DEFAULT: string;
  AI_MODEL_ESCALATION: string;
  AI_MODEL_EMBEDDING: string;
}): ModelConfig {
  return {
    default: env.AI_MODEL_DEFAULT,
    escalation: env.AI_MODEL_ESCALATION,
    embedding: env.AI_MODEL_EMBEDDING,
  };
}

export type KeyCheck =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "malformed"
        | "invalid_key"
        | "missing_models"
        | "no_quota"
        | "rate_limited"
        | "unavailable";
      /** Safe to show to the customer. Never contains the key. */
      message: string;
    };

const OPENAI = "https://api.openai.com/v1";

/**
 * Checks a customer-supplied key against the exact models we use, before it is stored:
 * the key works, can see our models, and has quota for a tiny request.
 */
export async function validateOpenAiKey(
  key: string,
  opts: { models: ModelConfig; fetch?: typeof fetch; baseUrl?: string },
): Promise<KeyCheck> {
  const f = opts.fetch ?? fetch;
  const base = opts.baseUrl ?? OPENAI;
  if (!/^sk-[A-Za-z0-9_-]{20,}$/.test(key)) {
    return {
      ok: false,
      reason: "malformed",
      message: "That doesn't look like an OpenAI API key (it should start with sk-).",
    };
  }
  const headers = { authorization: `Bearer ${key}`, "content-type": "application/json" };
  const unavailable: KeyCheck = {
    ok: false,
    reason: "unavailable",
    message: "We couldn't reach OpenAI to check the key. Please try again in a moment.",
  };

  let list: Response;
  try {
    list = await f(`${base}/models`, { headers, signal: AbortSignal.timeout(15_000) });
  } catch {
    return unavailable;
  }
  if (list.status === 401 || list.status === 403)
    return {
      ok: false,
      reason: "invalid_key",
      message: "OpenAI rejected this key. Check that it is correct and still active.",
    };
  if (list.status === 429)
    return {
      ok: false,
      reason: "rate_limited",
      message: "OpenAI is rate limiting this key. Try again shortly.",
    };
  if (!list.ok) return unavailable;

  const ids = new Set(
    ((await list.json()) as { data?: { id: string }[] }).data?.map((m) => m.id) ?? [],
  );
  const needed = [opts.models.default, opts.models.escalation, opts.models.embedding];
  const missing = needed.filter((m) => !ids.has(m));
  if (missing.length > 0) {
    return {
      ok: false,
      reason: "missing_models",
      message: `This key can't use the models TriageFox needs (${missing.join(", ")}). Use a key from an organisation with access to them.`,
    };
  }

  let probe: Response;
  try {
    probe = await f(`${base}/chat/completions`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({
        model: opts.models.default,
        messages: [{ role: "user", content: "Reply with: ok" }],
        max_completion_tokens: 32,
      }),
    });
  } catch {
    return unavailable;
  }
  if (probe.status === 429)
    return {
      ok: false,
      reason: "no_quota",
      message:
        "This key has no remaining credit or its rate limit is too low. Add billing credit at OpenAI and try again.",
    };
  if (probe.status === 401 || probe.status === 403)
    return {
      ok: false,
      reason: "invalid_key",
      message: "OpenAI rejected this key for the model we use.",
    };
  if (!probe.ok) return unavailable;
  return { ok: true };
}

/** `sk-…1234`: the only form of a stored key that is ever shown again. */
export function keyHint(key: string): string {
  return `${key.startsWith("sk-") ? "sk-" : ""}…${key.slice(-4)}`;
}
