import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

/** How far a hook's timestamp may differ from our clock (replay protection). Crisp timestamps are milliseconds. */
export const HOOK_TOLERANCE_MS = 5 * 60 * 1000;

export type SignatureResult = "ok" | "missing" | "bad_signature" | "stale";

/**
 * Crisp plugin hooks are signed: HMAC-SHA256 over `[timestamp;body]` (literal brackets and semicolon)
 * with the plugin's signing secret (docs/integrations/crisp.md, verified in Phase 0).
 */
export function verifyCrispSignature(opts: {
  secret: string;
  timestamp: string | null | undefined;
  signature: string | null | undefined;
  rawBody: string;
  nowMs?: number;
  toleranceMs?: number;
}): SignatureResult {
  const { timestamp, signature } = opts;
  if (!timestamp || !signature) return "missing";
  const expected = createHmac("sha256", opts.secret)
    .update(`[${timestamp};${opts.rawBody}]`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return "bad_signature";
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return "bad_signature";
  const now = opts.nowMs ?? Date.now();
  return Math.abs(now - ts) <= (opts.toleranceMs ?? HOOK_TOLERANCE_MS) ? "ok" : "stale";
}

const hookSchema = z.object({
  website_id: z.string().min(1),
  event: z.string().min(1),
  data: z.record(z.string(), z.unknown()).default({}),
  timestamp: z.number(),
});

/** Message types that carry something a person wrote or sent. System events, notes etc. don't trigger work. */
const CONTENT_TYPES = new Set(["text", "file", "picture", "animation", "audio", "video"]);

export type CrispHookKind =
  | "visitor_message" // a customer wrote: re-evaluate after the quiet window
  | "operator_message" // context for the next evaluation, no work of its own
  | "resolved" // evaluate immediately
  | "reopened" // back to unresolved/pending: normal quiet window
  | "ignored"; // anything else

export interface CrispHookEvent {
  kind: CrispHookKind;
  websiteId: string;
  sessionId: string | null;
  event: string;
  fingerprint: string | null;
  state: string | null;
  messageType: string | null;
  timestamp: number;
  /** Stable across redeliveries of the same hook. */
  dedupeKey: string;
  /** IDs and flags only: this is what gets stored. Never message content. */
  meta: Record<string, unknown>;
}

export function parseCrispHook(rawBody: string): CrispHookEvent | null {
  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const parsed = hookSchema.safeParse(json);
  if (!parsed.success) return null;
  const { website_id: websiteId, event, data, timestamp } = parsed.data;

  const sessionId = typeof data.session_id === "string" ? data.session_id : null;
  const fingerprint = data.fingerprint != null ? String(data.fingerprint) : null;
  const state = typeof data.state === "string" ? data.state : null;
  const messageType = typeof data.type === "string" ? data.type : null;
  const from = typeof data.from === "string" ? data.from : null;

  let kind: CrispHookKind = "ignored";
  if (event === "message:send" && from === "user" && messageType && CONTENT_TYPES.has(messageType))
    kind = "visitor_message";
  else if (event === "message:received" && messageType && CONTENT_TYPES.has(messageType))
    kind = "operator_message";
  else if (event === "session:set_state") kind = state === "resolved" ? "resolved" : "reopened";

  const dedupeKey = createHash("sha256")
    .update([websiteId, event, fingerprint ?? sessionId ?? "", state ?? "", timestamp].join("|"))
    .digest("hex");

  return {
    kind,
    websiteId,
    sessionId,
    event,
    fingerprint,
    state,
    messageType,
    timestamp,
    dedupeKey,
    meta: { websiteId, sessionId, event, fingerprint, state, messageType, from, timestamp },
  };
}
