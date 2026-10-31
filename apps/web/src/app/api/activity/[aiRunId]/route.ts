import { z } from "zod";
import { json, rpcErrorResponse } from "@/lib/guards";
import { allowRequest, tooMany } from "@/lib/limits";
import { rpc } from "@/lib/rpc";
import { resolveWorkspace } from "@/lib/workspace";

/** The AI's own explanation for one run. Any member of the workspace may read it. */
export async function GET(_req: Request, { params }: { params: Promise<{ aiRunId: string }> }) {
  const ctx = await resolveWorkspace();
  if (!ctx) return json({ ok: false, error: "Please sign in." }, 401);
  if (!(await allowRequest(`org:${ctx.workspace.id}:explain`, 120, 60))) return tooMany();
  const id = z.uuid().safeParse((await params).aiRunId);
  if (!id.success) return json({ ok: false, error: "Not found." }, 404);
  try {
    const res = await rpc().call("ai.explain", { orgId: ctx.workspace.id, aiRunId: id.data });
    return json({ ok: true, ...res });
  } catch (err) {
    return rpcErrorResponse(err);
  }
}
