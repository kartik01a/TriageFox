import { eq, schema, withOrg } from "@triagefox/db";
import { z } from "zod";
import { enableBlocker, syncDestinations } from "@/lib/automations";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";

const isZone = (z: string) => {
  try {
    new Intl.DateTimeFormat("en", { timeZone: z });
    return true;
  } catch {
    return false;
  }
};

const settingsSchema = z
  .object({
    includeSourceLink: z.boolean(),
    includeCustomerNames: z.boolean(),
    minConfidence: z.number().min(0.3).max(0.95),
    quietWindowSec: z.number().int().min(30).max(1800),
    timezone: z.string().max(60).refine(isZone, "Unknown time zone."),
    language: z.string().regex(/^[a-z]{2}(-[A-Za-z]{2})?$/),
  })
  .partial();

const body = z.object({ enabled: z.boolean().optional(), settings: settingsSchema.optional() });

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!id.success || !input.success)
    return json(
      { ok: false, error: input.success ? "Not found." : "Check the values and try again." },
      400,
    );
  const orgId = guard.ctx.workspace.id;

  const [current] = await withOrg(db(), orgId, (tx) =>
    tx.select().from(schema.automations).where(eq(schema.automations.id, id.data)),
  );
  if (!current) return json({ ok: false, error: "Not found." }, 404);

  if (input.data.enabled === true) {
    await syncDestinations(orgId, current.id);
    const blocker = await enableBlocker(orgId, current.id);
    if (blocker) return json({ ok: false, error: blocker }, 400);
  }
  const settings = {
    ...schema.defaultAutomationSettings,
    ...current.settings,
    ...input.data.settings,
  };
  await withOrg(db(), orgId, (tx) =>
    tx
      .update(schema.automations)
      .set({
        settings,
        ...(input.data.enabled !== undefined ? { enabled: input.data.enabled } : {}),
      })
      .where(eq(schema.automations.id, current.id)),
  );
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action:
      input.data.enabled === undefined
        ? "automation.settings_changed"
        : input.data.enabled
          ? "automation.enabled"
          : "automation.paused",
    target: current.id,
  });
  return json({ ok: true, settings, enabled: input.data.enabled ?? current.enabled });
}
