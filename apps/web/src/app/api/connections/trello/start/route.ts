import { trelloAuthorizeUrl } from "@triagefox/connectors";
import { env } from "@/lib/env";
import { managerGuard } from "@/lib/guards";
import { issueFlowCookie } from "@/lib/oauth-cookie";
import { appRedirect } from "@/lib/redirect";

export async function GET(req: Request) {
  const guard = await managerGuard(req, { checkOrigin: false });
  if (!guard.ok) return appRedirect("/login?next=/app/connections");
  const apiKey = env().TRELLO_API_KEY;
  if (!apiKey) return appRedirect("/app/connections?error=trello_not_configured");
  await issueFlowCookie("tf_trello_flow");
  return NextResponse.redirect(
    trelloAuthorizeUrl({ apiKey, returnUrl: `${env().APP_URL}/app/connections/trello/callback` }),
  );
}

import { NextResponse } from "next/server";
