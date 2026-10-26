import { eq, schema, withOrg } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

const body = z.object({ orgId: z.string().min(1), enabled: z.boolean() });

/**
 * Marks one workspace's automation as TriageFox's own support automation: its conversations are also filed in
 * the admin inbox, and it is never limited by plans. That workspace is the platform's own, with the
 * "TriageFox Support" Crisp website connected.
 */
export async function POST(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: "Bad request." }, 400);
  const { orgId, enabled } = input.data;
  const [automation] = await withOrg(db(), orgId, (tx) =>
    tx.select().from(schema.automations).orderBy(schema.automations.createdAt).limit(1),
  );
  if (!automation)
    return json(
      {
        ok: false,
        error:
          "That workspace has no automation yet. Set it up with the Crisp support website first.",
      },
      400,
    );
  const settings = { ...automation.settings, supportInbox: enabled };
  await withOrg(db(), orgId, (tx) =>
    tx.update(schema.automations).set({ settings }).where(eq(schema.automations.id, automation.id)),
  );
  await adminAudit(
    guard.admin,
    "support_automation.set",
    orgId,
    { supportInbox: automation.settings.supportInbox ?? false },
    { supportInbox: enabled },
  );
  return json({ ok: true });
}
