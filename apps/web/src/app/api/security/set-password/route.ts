import { z } from "zod";
import { getAuth } from "@/lib/auth";
import { json, sameOrigin } from "@/lib/guards";
import { allowRequest, tooMany } from "@/lib/limits";
import { getSession } from "@/lib/session";

const body = z.object({ newPassword: z.string().min(10).max(128) });

/**
 * For people who signed up with Google and have no password yet. Two-factor setup and "turn off" ask for a
 * password, so they add one here. Better Auth refuses if the account already has one.
 */
export async function POST(req: Request) {
  if (!sameOrigin(req)) return json({ ok: false, error: "Bad request origin." }, 403);
  const session = await getSession();
  if (!session) return json({ ok: false, error: "Please sign in." }, 401);
  if (!(await allowRequest(`set-password:${session.user.id}`, 5, 60))) return tooMany();
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: "Use at least 10 characters." }, 400);
  try {
    await getAuth().api.setPassword({
      headers: req.headers,
      body: { newPassword: input.data.newPassword },
    });
  } catch {
    return json({ ok: false, error: "This account already has a password." }, 400);
  }
  return json({ ok: true });
}
