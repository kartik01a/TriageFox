import { schema } from "@triagefox/db";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { createRateLimiter } from "@/lib/rate-limit";
import { parseWaitlist } from "@/lib/waitlist";

const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });

function clientIp(req: Request) {
  // Production sits behind Cloudflare, which sets CF-Connecting-IP; clients can't forge it because
  // the origin only accepts Cloudflare traffic. X-Forwarded-For is client-controlled, so it is only
  // used outside production (local development and tests).
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf;
  if (process.env.NODE_ENV === "production") return "unknown";
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function POST(req: Request) {
  if (!limiter.allow(clientIp(req))) {
    return NextResponse.json(
      { ok: false, error: "Too many requests. Try again in a minute." },
      { status: 429 },
    );
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid request." }, { status: 400 });
  }

  const result = parseWaitlist(body);
  if (result.kind === "invalid") {
    return NextResponse.json(
      { ok: false, error: "Please enter a valid email address." },
      { status: 400 },
    );
  }
  if (result.kind === "store") {
    try {
      // Same answer whether or not the address was already on the list (no email enumeration).
      await db()
        .insert(schema.waitlistSignups)
        .values({ email: result.email, source: result.source })
        .onConflictDoNothing();
    } catch (err) {
      logger.error({ err: (err as Error).message }, "waitlist insert failed");
      return NextResponse.json(
        { ok: false, error: "Something went wrong. Please try again." },
        { status: 500 },
      );
    }
  }
  return NextResponse.json({ ok: true });
}
