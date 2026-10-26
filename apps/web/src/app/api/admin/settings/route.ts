import { getSettings, type PlatformSettingKey, platformSettingsSchemas } from "@triagefox/billing";
import { schema } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

const body = z.object({
  key: z.enum(
    Object.keys(platformSettingsSchemas) as [PlatformSettingKey, ...PlatformSettingKey[]],
  ),
  value: z.unknown(),
});

export async function GET(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  return json({ ok: true, settings: await getSettings(db()) });
}

/** One setting at a time, validated by its own schema. A bad value is refused, never half-saved. */
export async function PUT(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: "Unknown setting." }, 400);
  const parsed = platformSettingsSchemas[input.data.key].safeParse(input.data.value);
  if (!parsed.success) return json({ ok: false, error: z.prettifyError(parsed.error) }, 400);
  const before = (await getSettings(db()))[input.data.key];
  await db()
    .insert(schema.platformSettings)
    .values({ key: input.data.key, value: parsed.data, updatedBy: guard.admin.email })
    .onConflictDoUpdate({
      target: schema.platformSettings.key,
      set: { value: parsed.data, updatedBy: guard.admin.email, updatedAt: new Date() },
    });
  await adminAudit(guard.admin, "settings.updated", input.data.key, before, parsed.data);
  return json({ ok: true, value: parsed.data });
}
