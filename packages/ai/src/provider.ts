import type { Usage } from "./types";

export type AiErrorKind =
  | "auth"
  | "no_quota"
  | "rate_limited"
  | "unavailable"
  | "invalid_image"
  | "invalid_request"
  | "refusal"
  | "bad_output";

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    message: string,
    readonly retryAfterSec?: number,
  ) {
    super(message);
    this.name = "AiError";
  }
}

export interface CompletionRequest {
  model: string;
  system: string;
  text: string;
  images: { url: string }[];
  /** JSON Schema for strict structured output. */
  schema: Record<string, unknown>;
  schemaName: string;
  maxOutputTokens: number;
  reasoningEffort?: "none" | "low" | "medium" | "high" | "xhigh";
}

export interface CompletionResult {
  /** The parsed JSON the model returned. */
  json: unknown;
  usage: Usage;
  finishReason: string;
}

/** The AI backend. OpenAI today; another provider can implement this later. */
export interface AiProvider {
  complete(req: CompletionRequest): Promise<CompletionResult>;
  /** Text embeddings (duplicate search). Optional: without it, duplicate detection is simply off. */
  embed?(model: string, texts: string[]): Promise<number[][]>;
  /** Speech to text for voice messages. Optional: without it, voice messages are not transcribed. */
  transcribe?(req: TranscribeRequest): Promise<TranscribeResult>;
}

export interface TranscribeRequest {
  model: string;
  audio: Blob;
  fileName: string;
}

export interface TranscribeResult {
  text: string;
  /** Audio length the provider billed, when it says (for cost tracking). */
  seconds?: number;
}
