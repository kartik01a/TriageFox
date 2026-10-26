import { z } from "zod";
import { json, managerGuard, rpcErrorResponse } from "@/lib/guards";
import { rpc } from "@/lib/rpc";

export const maxDuration = 120;

/** Runs the AI on the latest Crisp chats and reports what it would do. Creates nothing. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) return json({ ok: false, error: "Not found." }, 404);
  try {
    const res = await rpc().call(
      "automation.dryRun",
      { orgId: guard.ctx.workspace.id, automationId: id.data },
      { timeoutMs: 110_000 },
    );
    return json({ ok: true, ...res });
  } catch (err) {
    return rpcErrorResponse(err);
  }
}
