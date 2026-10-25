import { z } from "zod";
import { getConnectionView } from "@/lib/connections";
import { json, managerGuard, rpcErrorResponse } from "@/lib/guards";
import { rpc } from "@/lib/rpc";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return json({ ok: false, error: "Not found." }, 404);
  const orgId = guard.ctx.workspace.id;
  if (!(await getConnectionView(orgId, id.data)))
    return json({ ok: false, error: "Not found." }, 404);
  try {
    const res = await rpc().call("connection.check", { orgId, connectionId: id.data });
    return json({ ok: true, ...res });
  } catch (err) {
    return rpcErrorResponse(err);
  }
}
