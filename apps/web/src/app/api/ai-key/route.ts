import { keyHint, modelConfig, validateOpenAiKey } from "@triagefox/ai";
import { sealSecret } from "@triagefox/crypto";
import { eq, schema, withOrg } from "@triagefox/db";
import { z } from "zod";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { json, managerGuard } from "@/lib/guards";
import { publicKeyring } from "@/lib/keyring";
import { createRateLimiter } from "@/lib/rate-limit";

// Every attempt calls OpenAI with the supplied key, so attempts are limited per workspace.
const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

const body = z.object({ key: z.string().trim().min(20).max(300) });

/**
 * Bring-your-own OpenAI key. Write-only: it is validated against the models we use, sealed for the
 * worker, and only a hint (sk-…1234) is ever readable again. Models are never customer choices.
 */
export async function POST(req: Request) {
  const guard = await managerGuard(req, { fresh: true });
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  const orgId = ctx.workspace.id;
  if (!limiter.allow(orgId))
    return json({ ok: false, error: "Too many attempts. Please wait a minute." }, 429);

  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return json({ ok: false, error: "Paste your OpenAI API key." }, 400);
  const key = parsed.data.key;

  const check = await validateOpenAiKey(key, { models: modelConfig(env()) });
  if (!check.ok)
    return json(
      { ok: false, error: check.message, reason: check.reason },
      check.reason === "unavailable" ? 503 : 400,
    );

  const keySealed = await sealSecret(
    key,
    { orgId, recordId: orgId, purpose: "ai.key" },
    publicKeyring(),
  );
  const now = new Date();
  await withOrg(db(), orgId, (tx) =>
    tx
      .insert(schema.aiSettings)
      .values({
        orgId,
        keySealed,
        keyHint: keyHint(key),
        keyVerifiedAt: now,
        updatedBy: ctx.session.user.id,
      })
      .onConflictDoUpdate({
        target: schema.aiSettings.orgId,
        set: {
          keySealed,
          keyHint: keyHint(key),
          keyVerifiedAt: now,
          updatedBy: ctx.session.user.id,
          updatedAt: now,
        },
      }),
  );
  await audit({
    orgId,
    actorUserId: ctx.session.user.id,
    action: "ai_key.replaced",
    target: orgId,
  });
  return json({ ok: true, hint: keyHint(key) });
}

export async function DELETE(req: Request) {
  const guard = await managerGuard(req, { fresh: true });
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.workspace.id;
  await withOrg(db(), orgId, (tx) =>
    tx.delete(schema.aiSettings).where(eq(schema.aiSettings.orgId, orgId)),
  );
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action: "ai_key.removed",
    target: orgId,
  });
  return json({ ok: true });
}
