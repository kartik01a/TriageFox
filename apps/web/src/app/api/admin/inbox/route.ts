import { and, desc, eq, schema } from "@triagefox/db";
import { adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

/** Our own support inbox. Filters: ?status=new|in_progress|done, ?category=..., ?testimonials=1 */
export async function GET(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const q = new URL(req.url).searchParams;
  const status = q.get("status");
  const category = q.get("category");
  const rows = await db()
    .select()
    .from(schema.supportItems)
    .where(
      and(
        status === "new" || status === "in_progress" || status === "done"
          ? eq(schema.supportItems.status, status)
          : undefined,
        q.get("testimonials") === "1"
          ? eq(schema.supportItems.category, "praise")
          : category
            ? eq(schema.supportItems.category, category as "bug")
            : undefined,
      ),
    )
    .orderBy(desc(schema.supportItems.createdAt))
    .limit(200);
  return json({ ok: true, items: rows });
}
