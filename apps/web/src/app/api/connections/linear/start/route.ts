import { linearAuthorizeUrl } from "@triagefox/connectors";
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { managerGuard } from "@/lib/guards";
import { issueFlowCookie } from "@/lib/oauth-cookie";
import { appRedirect } from "@/lib/redirect";

export async function GET(req: Request) {
  const guard = await managerGuard(req, { checkOrigin: false });
  if (!guard.ok) return appRedirect("/login?next=/app/connections");
  const clientId = env().LINEAR_CLIENT_ID;
  if (!clientId) return appRedirect("/app/connections?error=linear_not_configured");
  const state = await issueFlowCookie("tf_linear_state");
  return NextResponse.redirect(
    linearAuthorizeUrl({
      clientId,
      redirectUri: `${env().APP_URL}/api/connections/linear/callback`,
      state,
    }),
  );
}
