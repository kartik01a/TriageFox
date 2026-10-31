import { applyBillingEvent, WebhookError } from "@triagefox/billing";
import { billingProvider } from "@/lib/billing";
import { db } from "@/lib/db";
import { ipFromHeaders } from "@/lib/ip";
import { allowRequest, tooMany } from "@/lib/limits";
import { logger } from "@/lib/logger";

const MAX_BODY = 256 * 1024;

/**
 * Payment provider webhooks. Every verification failure answers the same bare 401. A genuine event we
 * cannot place (unknown workspace, unknown type) gets 200, since a retry would not help. Only real faults
 * answer 500, so the provider retries.
 */
export async function POST(req: Request) {
  const provider = billingProvider();
  if (!provider) return new Response(null, { status: 404 });
  if (!(await allowRequest(`billing-hook:${ipFromHeaders(req.headers)}`, 600, 60)))
    return tooMany();
  const raw = await req.text();
  if (raw.length > MAX_BODY) return new Response(null, { status: 401 });
  let event: ReturnType<typeof provider.parseWebhook>;
  try {
    event = provider.parseWebhook(req.headers, raw);
  } catch (err) {
    if (err instanceof WebhookError) return new Response(null, { status: 401 });
    throw err;
  }
  try {
    const result = await applyBillingEvent(db(), provider.name, event);
    if (!result.handled && result.reason === "unknown_workspace")
      logger.warn({ type: event.rawType }, "billing event for an unknown workspace");
    return Response.json({ ok: true });
  } catch (err) {
    logger.error({ err: (err as Error).message, type: event.rawType }, "billing event failed");
    return new Response(null, { status: 500 });
  }
}
