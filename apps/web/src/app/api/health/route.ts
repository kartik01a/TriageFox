import { sql } from "@triagefox/db";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** For container health checks and uptime monitors. Says nothing about the installation beyond up/down. */
export async function GET() {
  try {
    await db().execute(sql`select 1`);
    return Response.json({ ok: true });
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
