import "server-only";
import { NextResponse } from "next/server";
import { env } from "./env";
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

export const json = (body: unknown, status = 200) => NextResponse.json(body, { status });

/** Signed in, same origin (state-changing requests), and owner/admin of the active workspace. */
export async function managerGuard(req: Request, opts: { checkOrigin?: boolean } = {}) {
  if ((opts.checkOrigin ?? true) && !sameOrigin(req))
    return { ok: false as const, response: json({ ok: false, error: "Bad request origin." }, 403) };
  const ctx = await resolveWorkspace();
  if (!ctx)
    return { ok: false as const, response: json({ ok: false, error: "Please sign in." }, 401) };
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
