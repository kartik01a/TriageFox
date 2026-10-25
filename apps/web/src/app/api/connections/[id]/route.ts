import { z } from "zod";
import { audit, getConnectionView } from "@/lib/connections";
import { json, managerGuard, rpcErrorResponse } from "@/lib/guards";
import { rpc } from "@/lib/rpc";

const idSchema = z.uuid();

/** Disconnect: the worker revokes the token where the provider allows it, then deletes our copy. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const id = idSchema.safeParse((await params).id);
  if (!id.success) return json({ ok: false, error: "Not found." }, 404);
  const orgId = guard.ctx.workspace.id;
  const conn = await getConnectionView(orgId, id.data);
  if (!conn) return json({ ok: false, error: "Not found." }, 404);
  try {
    const { revoked } = await rpc().call("connection.disconnect", { orgId, connectionId: id.data });
    await audit({
      orgId,
      actorUserId: guard.ctx.session.user.id,
      action: "connection.removed",
      target: id.data,
      metadata: { provider: conn.provider, revoked },
    });
    return json({ ok: true, revoked });
  } catch (err) {
    return rpcErrorResponse(err);
  }
}
