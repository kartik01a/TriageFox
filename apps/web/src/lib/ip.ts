import "server-only";
import { headers } from "next/headers";

/** Client address for rate limiting. Production trusts only Cloudflare's header (clients can forge X-Forwarded-For). */
export function ipFromHeaders(h: Headers): string {
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf;
  if (process.env.NODE_ENV === "production") return "unknown";
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

export async function currentIp() {
  return ipFromHeaders(await headers());
}
