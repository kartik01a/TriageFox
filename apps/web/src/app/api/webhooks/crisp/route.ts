import { parseCrispHook, verifyCrispSignature } from "@triagefox/connectors";
import { handleCrispHook } from "@triagefox/pipeline";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { json } from "@/lib/guards";
import { ipFromHeaders } from "@/lib/ip";
import { allowRequest, tooMany } from "@/lib/limits";
import { logger } from "@/lib/logger";
import { pipelineQueue } from "@/lib/pipeline-queue";

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Crisp plugin hook receiver. A hook is only a signal that something changed: we verify it came from
 * Crisp, record identifiers (never message content), schedule work, and answer quickly. Crisp retries
 * anything that is not a 200, so only genuine server faults answer 5xx.
 */
export async function POST(req: Request) {
  const secret = env().CRISP_HOOK_SECRET;
  if (!secret) return json({ ok: false, error: "Crisp hooks are not configured." }, 503);

  // Generous (one address carries many customers' hooks), but a flood from one address stops here.
  if (!(await allowRequest(`crisp-hook:${ipFromHeaders(req.headers)}`, 6000, 60))) return tooMany();
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ ok: false }, 413);
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return json({ ok: false }, 413);

  // Signature and freshness first, before anything else touches the payload.
  const verdict = verifyCrispSignature({
    secret,
    timestamp: req.headers.get("x-crisp-request-timestamp"),
    signature: req.headers.get("x-crisp-signature"),
    rawBody: raw,
  });
  if (verdict !== "ok") {
    logger.warn({ verdict }, "crisp hook rejected");
    return json({ ok: false }, 401); // the same answer for every reason: don't help an attacker
  }

  const event = parseCrispHook(raw);
  if (!event) return json({ ok: true }); // signed but not something we understand: acknowledge, nothing to retry

  try {
    const result = await handleCrispHook({ db: db(), queue: pipelineQueue().queue }, event);
    logger.info(
      { outcome: result.outcome, threads: result.threads, kind: event.kind },
      "crisp hook handled",
    );
    return json({ ok: true });
  } catch (err) {
    logger.error({ err: (err as Error).message }, "crisp hook failed");
    return json({ ok: false }, 500); // a real fault (database, Redis): ask Crisp to retry
  }
}
