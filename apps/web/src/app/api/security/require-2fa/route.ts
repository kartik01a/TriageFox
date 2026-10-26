import { schema, withOrg } from "@triagefox/db";
import { z } from "zod";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";

const body = z.object({ enabled: z.boolean() });

/** Owner only: every member needs two-factor sign-in to use the workspace. */
export async function PUT(req: Request) {
  const guard = await managerGuard(req, { fresh: true });
  if (!guard.ok) return guard.response;
  const { ctx } = guard;
  if (ctx.role !== "owner")
    return json({ ok: false, error: "Only the workspace owner can change this." }, 403);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: "Bad request." }, 400);
  // Locking yourself out would be a trap: the owner needs it on first.
  if (input.data.enabled && ctx.session.user.twoFactorEnabled !== true)
    return json({ ok: false, error: "Turn on two-factor for your own account first." }, 400);
  const orgId = ctx.workspace.id;
  await withOrg(db(), orgId, (tx) =>
    tx
      .insert(schema.workspaceSettings)
      .values({ orgId, require2fa: input.data.enabled })
      .onConflictDoUpdate({
        target: schema.workspaceSettings.orgId,
        set: { require2fa: input.data.enabled, updatedAt: new Date() },
      }),
  );
  await audit({
    orgId,
    actorUserId: ctx.session.user.id,
    action: input.data.enabled ? "security.require_2fa_on" : "security.require_2fa_off",
    target: orgId,
  });
  return json({ ok: true });
}
