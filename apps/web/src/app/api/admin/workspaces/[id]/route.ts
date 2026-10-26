import { getSubscription, grantComp, revokeComp, startTrial } from "@triagefox/billing";
import { eq, schema, withOrg } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

const body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("extend-trial"), days: z.number().int().min(1).max(90) }),
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({
    action: z.literal("comp"),
    planId: z.uuid(),
    months: z.number().int().min(1).max(60).nullable(),
    reason: z.string().trim().min(3).max(200),
  }),
  z.object({ action: z.literal("revoke-comp") }),
]);

/** Support actions on one workspace. Every one is audit-logged with the before and after state. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const orgId = (await params).id;
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: z.prettifyError(input.error) }, 400);
  const [org] = await db()
    .select()
    .from(schema.organization)
    .where(eq(schema.organization.id, orgId));
  if (!org) return json({ ok: false, error: "Workspace not found." }, 404);

  const before = (await getSubscription(db(), orgId)).subscription;
  const a = input.data;
  switch (a.action) {
    case "extend-trial": {
      if (!before) await startTrial(db(), orgId);
      await withOrg(db(), orgId, async (tx) => {
        const [cur] = await tx
          .select()
          .from(schema.subscriptions)
          .where(eq(schema.subscriptions.orgId, orgId));
        if (!cur || (cur.status !== "trialing" && cur.status !== "canceled")) return;
        const from = cur.trialEndsAt && cur.trialEndsAt > new Date() ? cur.trialEndsAt : new Date();
        await tx
          .update(schema.subscriptions)
          .set({
            status: "trialing",
            trialEndsAt: new Date(from.getTime() + a.days * 86_400_000),
            reminderSentForPeriodEnd: null,
          })
          .where(eq(schema.subscriptions.orgId, orgId));
      });
      break;
    }
    case "pause":
    case "resume":
      await withOrg(db(), orgId, (tx) =>
        tx
          .update(schema.subscriptions)
          .set({ pausedByAdmin: a.action === "pause" })
          .where(eq(schema.subscriptions.orgId, orgId)),
      );
      break;
    case "comp":
      await grantComp(db(), { orgId, planId: a.planId, months: a.months, reason: a.reason });
      break;
    case "revoke-comp":
      await revokeComp(db(), orgId);
      break;
  }
  const after = (await getSubscription(db(), orgId)).subscription;
  await adminAudit(guard.admin, `workspace.${a.action}`, orgId, before, after);
  return json({ ok: true });
}
