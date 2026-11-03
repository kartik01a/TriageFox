import { json } from "@/lib/guards";
import { money, prepareChange } from "../shared";

/** What the change would do and cost today, before the owner confirms (ADR 0015). */
export async function POST(req: Request) {
  const c = await prepareChange(req);
  if ("response" in c) return c.response;
  const { plan, provider } = c;
  try {
    const preview = await provider.previewPlanChange({
      subscriptionId: plan.subscriptionId,
      productId: plan.productId,
      request: plan.request,
    });
    return json({
      ok: true,
      kind: plan.kind,
      planName: plan.targetPlan.name,
      interval: plan.interval,
      chargeToday:
        plan.kind === "now" ? money(preview.amount, preview.currency || plan.currency) : null,
      effectiveAt: plan.effectiveAt?.toISOString() ?? null,
    });
  } catch {
    return json(
      { ok: false, error: "The payment provider could not price this change. Please try again." },
      502,
    );
  }
}
