import { and, eq, schema, withOrg } from "@triagefox/db";
import { z } from "zod";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";

const body = z.object({ enabled: z.boolean() });

/** Turns one destination (a Trello board or Jira project) on or off for this automation. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; destId: string }> },
) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const p = await params;
  const ids = z.object({ id: z.uuid(), destId: z.uuid() }).safeParse(p);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!ids.success || !input.success) return json({ ok: false, error: "Bad request." }, 400);
  const orgId = guard.ctx.workspace.id;
  const rows = await withOrg(db(), orgId, (tx) =>
    tx
      .update(schema.automationDestinations)
      .set({ enabled: input.data.enabled })
      .where(
        and(
          eq(schema.automationDestinations.id, ids.data.destId),
          eq(schema.automationDestinations.automationId, ids.data.id),
        ),
      )
      .returning({ id: schema.automationDestinations.id }),
  );
  if (rows.length === 0) return json({ ok: false, error: "Not found." }, 404);
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action: input.data.enabled ? "destination.enabled" : "destination.disabled",
    target: ids.data.destId,
  });
  return json({ ok: true });
}
