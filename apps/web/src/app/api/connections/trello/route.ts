import { RpcError } from "@triagefox/rpc";
import { z } from "zod";
import { audit, createPendingConnection, deletePendingConnection } from "@/lib/connections";
import { json, managerGuard, rpcErrorResponse } from "@/lib/guards";
import { takeFlowCookie } from "@/lib/oauth-cookie";
import { rpc } from "@/lib/rpc";

const body = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{20,200}$/, "Invalid token") });

/** Receives the token the browser got from Trello's redirect fragment. Sealed immediately. */
export async function POST(req: Request) {
  const guard = await managerGuard(req);
  if (!guard.ok) return guard.response;
  const { ctx } = guard;

  // The connect flow must have been started from here (one-time cookie from /start).
  if (!(await takeFlowCookie("tf_trello_flow"))) {
    return json({ ok: false, error: "This connection attempt expired. Please start again." }, 400);
  }
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success)
    return json({ ok: false, error: "That doesn't look like a Trello token." }, 400);

  const orgId = ctx.workspace.id;
  const connectionId = await createPendingConnection({
    orgId,
    userId: ctx.session.user.id,
    provider: "trello",
    authType: "token",
    credentials: { token: parsed.data.token },
  });
  try {
    const me = await rpc().call("trello.verify", { orgId, connectionId });
    await audit({
      orgId,
      actorUserId: ctx.session.user.id,
      action: "connection.created",
      target: connectionId,
      metadata: { provider: "trello" },
    });
    return json({ ok: true, connectionId, username: me.username });
  } catch (err) {
    if (err instanceof RpcError && err.code === "unavailable")
      await deletePendingConnection(orgId, connectionId);
    return rpcErrorResponse(err);
  }
}
