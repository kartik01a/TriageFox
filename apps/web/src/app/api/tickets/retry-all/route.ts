import { eq, schema, withOrg } from "@triagefox/db";
import { scheduleDelivery } from "@triagefox/pipeline";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";
import { pipelineQueue } from "@/lib/pipeline-queue";

/** After reconnecting a tool: send every ticket that did not arrive again (up to 200 at a time). */
export async function POST(req: Request) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const orgId = guard.ctx.workspace.id;
  const failed = await withOrg(db(), orgId, (tx) =>
    tx
      .select({
        issueId: schema.destinationTickets.issueId,
        destinationId: schema.destinationTickets.destinationId,
      })
      .from(schema.destinationTickets)
      .where(eq(schema.destinationTickets.status, "failed"))
      .limit(200),
  );
  for (const f of failed) await scheduleDelivery(pipelineQueue().queue, { orgId, ...f });
  return json({ ok: true, count: failed.length });
}
