import { CRISP_WEBSITE_ID } from "@triagefox/connectors";
import { NextResponse } from "next/server";
import { createLinkTicket } from "@/lib/crisp-link";
import { env } from "@/lib/env";
import { json, sameOrigin } from "@/lib/guards";
import { ipFromHeaders } from "@/lib/ip";
import { createRateLimiter } from "@/lib/rate-limit";
import { rpc } from "@/lib/rpc";

const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });

/** Re-verifies the Crisp token (never trusts hidden form fields), then issues a one-time link ticket. */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "Bad request origin." }, 403);
  if (!limiter.allow(ipFromHeaders(req.headers)))
    return json({ ok: false, error: "Too many attempts." }, 429);

  const form = await req.formData().catch(() => null);
  const websiteId = String(form?.get("website_id") ?? "");
  const token = String(form?.get("token") ?? "");
  if (!CRISP_WEBSITE_ID.test(websiteId) || !token)
    return json({ ok: false, error: "Invalid request." }, 400);

  try {
    const res = await rpc().call("crisp.verifyWebsite", { websiteId, token });
    if (!res.valid)
      return json({ ok: false, error: "Open this from inside your Crisp inbox." }, 403);
    const ticket = await createLinkTicket(websiteId, res.websiteName);
    return NextResponse.redirect(
      new URL(`/app/connections/crisp/link?ticket=${ticket}`, env().APP_URL),
      303,
    );
  } catch {
    return json({ ok: false, error: "We couldn't check this with Crisp right now." }, 503);
  }
}
