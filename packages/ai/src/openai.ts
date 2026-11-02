import {
  AiError,
  type AiProvider,
  type CompletionRequest,
  type CompletionResult,
  type TranscribeRequest,
  type TranscribeResult,
} from "./provider";

interface ChatResponse {
  choices?: {
    message?: { content?: string | null; refusal?: string | null };
    finish_reason?: string;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
    completion_tokens_details?: { reasoning_tokens?: number };
  };
  error?: { message?: string; code?: string; type?: string };
}

export class OpenAiProvider implements AiProvider {
  constructor(
    private readonly opts: {
      apiKey: string;
      baseUrl?: string;
      fetch?: typeof fetch;
      maxAttempts?: number;
      timeoutMs?: number;
    },
  ) {}

  async embed(model: string, texts: string[]): Promise<number[][]> {
    const f = this.opts.fetch ?? fetch;
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl ?? "https://api.openai.com/v1"}/embeddings`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.opts.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ model, input: texts }),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 30_000),
      });
    } catch {
      throw new AiError("unavailable", "OpenAI could not be reached.");
    }
    const json = (await res.json().catch(() => ({}))) as {
      data?: { index: number; embedding: number[] }[];
      error?: { code?: string };
    };
    if (res.status === 401 || res.status === 403)
      throw new AiError("auth", "OpenAI rejected the API key.");
    if (res.status === 429)
      throw new AiError(
        json.error?.code === "insufficient_quota" ? "no_quota" : "rate_limited",
        "OpenAI is limiting requests.",
      );
    if (!res.ok)
      throw new AiError(
        res.status >= 500 ? "unavailable" : "invalid_request",
        "OpenAI could not create embeddings.",
      );
    const data = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== texts.length)
      throw new AiError("bad_output", "Unexpected embeddings answer.");
    return data.map((d) => d.embedding);
  }

  async transcribe(req: TranscribeRequest): Promise<TranscribeResult> {
    const f = this.opts.fetch ?? fetch;
    const form = new FormData();
    form.append("file", req.audio, req.fileName);
    form.append("model", req.model);
    form.append("response_format", "json");
    let res: Response;
    try {
      res = await f(`${this.opts.baseUrl ?? "https://api.openai.com/v1"}/audio/transcriptions`, {
        method: "POST",
        headers: { authorization: `Bearer ${this.opts.apiKey}` },
        body: form,
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
      });
    } catch {
      throw new AiError("unavailable", "OpenAI could not be reached.");
    }
    const json = (await res.json().catch(() => ({}))) as {
      text?: string;
      usage?: { type?: string; seconds?: number };
      error?: { code?: string };
    };
    if (res.status === 401 || res.status === 403)
      throw new AiError("auth", "OpenAI rejected the API key.");
    if (res.status === 429)
      throw new AiError(
        json.error?.code === "insufficient_quota" ? "no_quota" : "rate_limited",
        "OpenAI is limiting requests.",
      );
    if (!res.ok)
      throw new AiError(
        res.status >= 500 ? "unavailable" : "invalid_request",
        "OpenAI could not transcribe the voice message.",
      );
    if (typeof json.text !== "string")
      throw new AiError("bad_output", "Unexpected transcription answer.");
    return {
      text: json.text,
      ...(json.usage?.type === "duration" && typeof json.usage.seconds === "number"
        ? { seconds: json.usage.seconds }
        : {}),
    };
  }

  async complete(req: CompletionRequest): Promise<CompletionResult> {
    const f = this.opts.fetch ?? fetch;
    const url = `${this.opts.baseUrl ?? "https://api.openai.com/v1"}/chat/completions`;
    const content: unknown[] = [
      { type: "text", text: req.text },
      ...req.images.map((i) => ({ type: "image_url", image_url: { url: i.url, detail: "auto" } })),
    ];
    const body = JSON.stringify({
      model: req.model,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: req.schemaName, strict: true, schema: req.schema },
      },
      max_completion_tokens: req.maxOutputTokens,
      ...(req.reasoningEffort ? { reasoning_effort: req.reasoningEffort } : {}),
    });

    const attempts = this.opts.maxAttempts ?? 3;
    let lastError: AiError | undefined;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let res: Response;
      try {
        res = await f(url, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.opts.apiKey}`,
            "content-type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.opts.timeoutMs ?? 120_000),
        });
      } catch {
        lastError = new AiError("unavailable", "OpenAI could not be reached.");
        if (attempt < attempts) await sleep(backoff(attempt));
        continue;
      }
      const json = (await res.json().catch(() => ({}))) as ChatResponse;
      if (res.ok) return parse(json);

      const message = json.error?.message ?? `HTTP ${res.status}`;
      const retryAfter = Number(res.headers.get("retry-after")) || undefined;
      if (res.status === 401 || res.status === 403)
        throw new AiError("auth", "OpenAI rejected the API key.");
      if (res.status === 429) {
        // "insufficient_quota" will not fix itself by retrying; plain rate limits will.
        if (json.error?.code === "insufficient_quota")
          throw new AiError("no_quota", "The OpenAI account has no remaining credit.");
        lastError = new AiError("rate_limited", "OpenAI is rate limiting requests.", retryAfter);
      } else if (res.status >= 500) {
        lastError = new AiError("unavailable", "OpenAI is having problems.");
      } else if (/image/i.test(message) && /(url|download|fetch|invalid)/i.test(message)) {
        throw new AiError("invalid_image", "OpenAI could not load an attached image.");
      } else {
        throw new AiError("invalid_request", "OpenAI rejected the request.");
      }
      if (attempt < attempts) await sleep(Math.max(backoff(attempt), (retryAfter ?? 0) * 1000));
    }
    throw lastError ?? new AiError("unavailable", "OpenAI could not be reached.");
  }
}

function parse(json: ChatResponse): CompletionResult {
  const choice = json.choices?.[0];
  if (choice?.message?.refusal) throw new AiError("refusal", "The model declined to answer.");
  const raw = choice?.message?.content;
  const finishReason = choice?.finish_reason ?? "unknown";
  if (!raw)
    throw new AiError(
      "bad_output",
      finishReason === "length"
        ? "The answer was cut off before it finished."
        : "The model returned no content.",
    );
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiError(
      "bad_output",
      finishReason === "length"
        ? "The answer was cut off before it finished."
        : "The model returned invalid JSON.",
    );
  }
  const u = json.usage ?? {};
  return {
    json: parsed,
    finishReason,
    usage: {
      inputTokens: u.prompt_tokens ?? 0,
      cachedInputTokens: u.prompt_tokens_details?.cached_tokens ?? 0,
      outputTokens: u.completion_tokens ?? 0,
      reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    },
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt: number) => Math.min(30_000, 1000 * 2 ** (attempt - 1));
