import { jiraAuthorizeUrl } from "@triagefox/connectors";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { managerGuard } from "@/lib/guards";
import { issueFlowCookie } from "@/lib/oauth-cookie";
import { appRedirect } from "@/lib/redirect";

export async function GET(req: Request) {
  const guard = await managerGuard(req, { checkOrigin: false });
  if (!guard.ok) return appRedirect("/login?next=/app/connections");
  const clientId = env().ATLASSIAN_CLIENT_ID;
  if (!clientId) return appRedirect("/app/connections?error=jira_not_configured");
  const state = await issueFlowCookie("tf_jira_state");
  return NextResponse.redirect(
    jiraAuthorizeUrl({
      clientId,
      redirectUri: `${env().APP_URL}/api/connections/jira/callback`,
      state,
    }),
  );
}
