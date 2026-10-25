import { audit, createPendingConnection } from "@/lib/connections";
import { managerGuard } from "@/lib/guards";
import { constantTimeEqual, takeFlowCookie } from "@/lib/oauth-cookie";
import { appRedirect } from "@/lib/redirect";
import { rpc } from "@/lib/rpc";

const CODE = /^[A-Za-z0-9_\-.~]{10,2048}$/;

export async function GET(req: Request) {
  const url = new URL(req.url);
  const expected = await takeFlowCookie("tf_jira_state");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");

  if (url.searchParams.get("error")) return appRedirect("/app/connections?error=jira_denied");
  // Anti-forgery: the state we issued must come back unchanged.
  if (!expected || !state || !constantTimeEqual(expected, state))
    return appRedirect("/app/connections?error=jira_state");
  if (!code || !CODE.test(code)) return appRedirect("/app/connections?error=jira_failed");

  const guard = await managerGuard(req, { checkOrigin: false });
  if (!guard.ok) return appRedirect("/login?next=/app/connections");
  const { ctx } = guard;
  const orgId = ctx.workspace.id;

  // The one-time code is sealed for the worker; the Atlassian client secret never reaches this app.
  const connectionId = await createPendingConnection({
    orgId,
    userId: ctx.session.user.id,
    provider: "jira",
    authType: "oauth",
    credentials: { code },
  });
  try {
    await rpc().call("jira.complete", { orgId, connectionId }, { timeoutMs: 30_000 });
  } catch {
    return appRedirect("/app/connections?error=jira_failed");
  }
  await audit({
    orgId,
    actorUserId: ctx.session.user.id,
    action: "connection.created",
    target: connectionId,
    metadata: { provider: "jira" },
  });
  return appRedirect(`/app/connections/${connectionId}?connected=jira`);
}
