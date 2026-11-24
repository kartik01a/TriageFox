import { and, eq, schema, withOrg } from "@triagefox/db";
import { scheduleDelivery } from "@triagefox/pipeline";
import { z } from "zod";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";
import { pipelineQueue } from "@/lib/pipeline-queue";

/** Sends a ticket that failed to reach Trello, Jira or Linear again. Only failed tickets can be retried. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return json({ ok: false, error: "Not found." }, 404);
  const orgId = guard.ctx.workspace.id;
  const [row] = await withOrg(db(), orgId, (tx) =>
    tx
      .select()
      .from(schema.destinationTickets)
      .where(
        and(
          eq(schema.destinationTickets.id, id.data),
          eq(schema.destinationTickets.status, "failed"),
        ),
      ),
  );
  if (!row) return json({ ok: false, error: "That ticket doesn't need a retry." }, 404);
  await scheduleDelivery(pipelineQueue().queue, {
    orgId,
    issueId: row.issueId,
    destinationId: row.destinationId,
  });
  return json({ ok: true });
}
