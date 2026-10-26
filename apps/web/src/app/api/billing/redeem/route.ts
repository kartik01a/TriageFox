import { redeemInviteCode } from "@triagefox/billing";
import { z } from "zod";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";
import { createRateLimiter } from "@/lib/rate-limit";

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
const body = z.object({ code: z.string().trim().min(10).max(80) });

const MESSAGES = {
  invalid: "That code isn't valid.",
  wrong_email: "That code was made for a different email address.",
  used: "That code has already been used.",
  expired: "That code has expired.",
} as const;

/** Owner only: redeem a single-use invite code for free access. Attempts are limited per workspace. */
export async function POST(req: Request) {
  const guard = await managerGuard(req, { ownerOnly: true });
  if (!guard.ok) return guard.response;
  const { workspace, session } = guard.ctx;
  if (!limiter.allow(workspace.id))
    return json({ ok: false, error: "Too many attempts. Please wait a minute." }, 429);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: MESSAGES.invalid }, 400);
  const result = await redeemInviteCode(db(), {
    code: input.data.code,
    email: session.user.email,
    orgId: workspace.id,
  });
  if (!result.ok) return json({ ok: false, error: MESSAGES[result.reason] }, 400);
  await audit({
    orgId: workspace.id,
    actorUserId: session.user.id,
    action: "billing.invite_redeemed",
    target: result.planName,
  });
  return json({ ok: true, planName: result.planName });
}
