import { PlanError, patchPlanInput, updatePlan } from "@triagefox/billing";
import { eq, schema } from "@triagefox/db";
import { z } from "zod";
import { adminAudit, adminGuard } from "@/lib/admin";
import { db } from "@/lib/db";
import { json } from "@/lib/guards";

/** Edits the newest version. A price or limit change creates a new version; subscribers keep theirs. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await adminGuard(req);
  if (!guard.ok) return guard.response;
  const id = z.uuid().safeParse((await params).id);
  const patch = patchPlanInput.safeParse(await req.json().catch(() => null));
  if (!id.success || !patch.success)
    return json(
      { ok: false, error: patch.success ? "Not found." : z.prettifyError(patch.error) },
      400,
    );
  const [before] = await db().select().from(schema.plans).where(eq(schema.plans.id, id.data));
  try {
    const { plan, versioned } = await updatePlan(db(), id.data, patch.data);
    await adminAudit(
      guard.admin,
      versioned ? "plan.versioned" : "plan.updated",
      plan.slug,
      before,
      plan,
    );
    return json({ ok: true, plan, versioned });
  } catch (err) {
    if (err instanceof PlanError) return json({ ok: false, error: err.message }, 400);
    throw err;
  }
}
