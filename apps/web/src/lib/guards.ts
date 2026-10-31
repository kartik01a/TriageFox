import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";
import { allowRequest, tooMany } from "./limits";
import { resolveWorkspace } from "./workspace";

/**
 * State-changing requests must come from our own pages: the Origin header has to match APP_URL.
 * (Cookies are SameSite=Lax, this is the second line of defence against cross-site requests.)
 */
export function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(env().APP_URL).origin;
  } catch {
    return false;
  }
}

/** How recently the person must have signed in for sensitive actions. */
export const FRESH_MS = 15 * 60 * 1000;
export const isFresh = (signedInAt: Date | string, now = Date.now()) =>
  now - new Date(signedInAt).getTime() < FRESH_MS;

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Signed in, same origin (state-changing requests), and owner/admin of the active workspace. */
export async function managerGuard(
  req: Request,
  opts: { checkOrigin?: boolean; fresh?: boolean; ownerOnly?: boolean } = {},
) {
  if ((opts.checkOrigin ?? true) && !sameOrigin(req))
    return { ok: false as const, response: json({ ok: false, error: "Bad request origin." }, 403) };
  const ctx = await resolveWorkspace();
  if (!ctx)
    return { ok: false as const, response: json({ ok: false, error: "Please sign in." }, 401) };
  if (!ctx.twoFactorOk)
    return {
      ok: false as const,
      response: json(
        {
          ok: false,
          error: "This workspace requires two-factor sign-in.",
          code: "two_factor_required",
        },
        403,
      ),
    };
  // Step-up: sensitive actions need a sign-in from the last few minutes (the browser asks for the password).
  if (opts.fresh && !isFresh(ctx.session.session.createdAt))
    return {
      ok: false as const,
      response: json(
        { ok: false, error: "Please confirm your password to continue.", code: "step_up_required" },
        403,
      ),
    };
  // A runaway script or a stuck button cannot hammer the system: 300 changes a minute per workspace is far above real use.
  if (req.method !== "GET" && !(await allowRequest(`org:${ctx.workspace.id}:write`, 300, 60)))
    return { ok: false as const, response: tooMany() };
  if (opts.ownerOnly && ctx.role !== "owner")
    return {
      ok: false as const,
      response: json({ ok: false, error: "Only the workspace owner can manage billing." }, 403),
    };
  if (!ctx.canManage)
    return {
      ok: false as const,
      response: json({ ok: false, error: "Only workspace owners and admins can do this." }, 403),
    };
  return { ok: true as const, ctx };
}

/** Maps worker errors to safe messages and HTTP statuses. */
export function rpcErrorResponse(err: unknown) {
  const e = err as { code?: string; message?: string };
  const status =
    e.code === "not_found"
      ? 404
      : e.code === "forbidden"
        ? 403
        : e.code === "rate_limited"
          ? 429
          : e.code === "unavailable"
            ? 503
            : e.code === "not_configured"
              ? 501
              : 400;
  return json(
    { ok: false, error: e.message ?? "Something went wrong.", code: e.code ?? "internal" },
    status,
  );
}
