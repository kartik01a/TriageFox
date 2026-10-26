import { createPlan, createPlanInput, PlanError } from "@triagefox/billing";
import { asc, desc, schema } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

/** Every plan and every version (admins need to see old versions that subscribers are still on). */
export async function GET(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const plans = await db()
    .select()
    .from(schema.plans)
    .orderBy(asc(schema.plans.sortOrder), asc(schema.plans.slug), desc(schema.plans.version));
  return json({ ok: true, plans });
}

export async function POST(req: Request) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const input = createPlanInput.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: z.prettifyError(input.error) }, 400);
  try {
    const plan = await createPlan(db(), input.data);
    await adminAudit(guard.admin, "plan.created", plan.slug, null, plan);
    return json({ ok: true, plan });
  } catch (err) {
    if (err instanceof PlanError) return json({ ok: false, error: err.message }, 400);
    if ((err as { cause?: { code?: string } }).cause?.code === "23505")
      return json({ ok: false, error: "A plan with that slug already exists." }, 409);
    throw err;
  }
}
