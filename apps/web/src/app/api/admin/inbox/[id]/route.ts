import { eq, schema } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

const body = z.object({
  status: z.enum(["new", "in_progress", "done"]).optional(),
  note: z.string().trim().min(1).max(2000).optional(),
  testimonialApproved: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!id.success || !input.success) return json({ ok: false, error: "Bad request." }, 400);
  const [item] = await db()
    .select()
    .from(schema.supportItems)
    .where(eq(schema.supportItems.id, id.data));
  if (!item) return json({ ok: false, error: "Not found." }, 404);
  const notes = input.data.note
    ? [
        ...item.notes,
        { at: new Date().toISOString(), by: guard.admin.email, text: input.data.note },
      ]
    : item.notes;
  await db()
    .update(schema.supportItems)
    .set({
      ...(input.data.status ? { status: input.data.status } : {}),
      ...(input.data.testimonialApproved !== undefined
        ? { testimonialApproved: input.data.testimonialApproved }
        : {}),
      notes,
    })
    .where(eq(schema.supportItems.id, item.id));
  await adminAudit(
    guard.admin,
    "support_item.updated",
    item.id,
    { status: item.status },
    input.data,
  );
  return json({ ok: true });
}
