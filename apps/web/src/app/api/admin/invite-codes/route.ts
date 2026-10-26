import { hashInviteCode, newInviteCode } from "@triagefox/billing";
import { desc, schema } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

const body = z.object({
  email: z.email(),
  planId: z.uuid(),
  months: z.number().int().min(1).max(36),
});

/** Codes are never listed in the clear: only a hash is stored, and the code is shown once at creation. */
export async function GET(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const rows = await db()
    .select({
      id: schema.inviteCodes.id,
      email: schema.inviteCodes.email,
      months: schema.inviteCodes.months,
      expiresAt: schema.inviteCodes.expiresAt,
      usedAt: schema.inviteCodes.usedAt,
      createdAt: schema.inviteCodes.createdAt,
    })
    .from(schema.inviteCodes)
    .orderBy(desc(schema.inviteCodes.createdAt))
    .limit(100);
  return json({ ok: true, codes: rows });
}

export async function POST(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: z.prettifyError(input.error) }, 400);
  const code = newInviteCode();
  const [row] = await db()
    .insert(schema.inviteCodes)
    .values({
      codeHash: hashInviteCode(code),
      email: input.data.email.toLowerCase(),
      planId: input.data.planId,
      months: input.data.months,
      expiresAt: new Date(Date.now() + 7 * 86_400_000),
      createdBy: guard.admin.email,
    })
    .returning({ id: schema.inviteCodes.id });
  // The code itself is deliberately not in the audit log.
  await adminAudit(guard.admin, "invite_code.created", row?.id ?? null, null, {
    email: input.data.email.toLowerCase(),
    months: input.data.months,
  });
  return json({ ok: true, code, expiresInDays: 7 });
}
