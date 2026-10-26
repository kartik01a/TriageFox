import "server-only";
import { schema } from "@triagefox/db";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { db } from "./db";
import { env } from "./env";
import { sameOrigin } from "./guards";
import { getSession } from "./session";

export const adminEmails = () =>
  env()
    .PLATFORM_ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

/** Platform admin: hosted mode, an email on the allowlist, and two-factor sign-in. Anyone else gets "not found". */
export async function currentAdmin() {
  if (env().APP_MODE !== "hosted") return null;
  const session = await getSession();
  if (!session) return null;
  const email = session.user.email.toLowerCase();
  if (!adminEmails().includes(email) || session.user.twoFactorEnabled !== true) return null;
  return { email, userId: session.user.id };
}

/** For admin pages: anything but a real admin is a plain 404, not a hint that /admin exists. */
export async function requireAdmin() {
  const admin = await currentAdmin();
  if (!admin) notFound();
  return admin;
}

/** For admin API routes (same-origin for writes). Non-admins get the same 404 as an unknown route. */
export async function adminGuard(req: Request) {
  const notFoundResponse = () => new NextResponse(null, { status: 404 });
  if (req.method !== "GET" && !sameOrigin(req))
    return { ok: false as const, response: notFoundResponse() };
  const admin = await currentAdmin();
  if (!admin) return { ok: false as const, response: notFoundResponse() };
  return { ok: true as const, admin };
}

/** Every admin change is recorded with who, what, and before/after. */
export async function adminAudit(
  admin: { email: string },
  action: string,
  target: string | null,
  before: unknown,
  after: unknown,
) {
  await db()
    .insert(schema.adminAuditLog)
    .values({ adminEmail: admin.email, action, target, before, after });
}
