import "server-only";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { env } from "./env";

/**
 * One-time anti-forgery value for connect flows (Trello nonce, Jira OAuth `state`). Stored in an
 * httpOnly cookie; the flow only completes if the value comes back and matches.
 */
export async function issueFlowCookie(name: string): Promise<string> {
  const value = randomBytes(32).toString("base64url");
  (await cookies()).set(name, value, {
    httpOnly: true,
    sameSite: "lax",
    secure: env().NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  return value;
}

/** Reads and deletes the cookie. Returns the stored value, or null when absent. */
export async function takeFlowCookie(name: string): Promise<string | null> {
  const jar = await cookies();
  const value = jar.get(name)?.value ?? null;
  jar.delete(name);
  return value;
}

export function constantTimeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
