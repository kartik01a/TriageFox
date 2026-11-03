import { clearScheduledChange, getSubscription, recordScheduledChange } from "@triagefox/billing";
import { billingProvider } from "@/lib/billing";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";
import { prepareChange } from "./shared";

/**
 * Changes the plan of a paying workspace (ADR 0015). A bigger plan or yearly billing happens now and the
 * provider charges the difference to the saved payment method; the plan in TriageFox follows the
 * provider's webhook, so a failed charge changes nothing. A smaller plan or monthly billing is scheduled
 * for the next billing date and remembered here so it can be shown and undone.
 */
export async function POST(req: Request) {
  const c = await prepareChange(req);
  if ("response" in c) return c.response;
  const { plan, provider, guard } = c;
  const orgId = guard.ctx.workspace.id;
  try {
    await provider.changePlan({
      subscriptionId: plan.subscriptionId,
      productId: plan.productId,
      request: plan.request,
    });
  } catch {
    return json(
      {
        ok: false,
        error:
          "The plan could not be changed. Nothing was charged. Please try again or contact support.",
      },
      502,
    );
  }
  if (plan.kind === "at_renewal")
    await recordScheduledChange(db(), orgId, {
      planId: plan.targetPlan.id,
      interval: plan.interval,
      at: plan.effectiveAt,
    });
  else await clearScheduledChange(db(), orgId); // an upgrade replaces any scheduled downgrade
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action: plan.kind === "now" ? "billing.plan_upgraded" : "billing.plan_change_scheduled",
    target: plan.targetPlan.slug,
    metadata: { interval: plan.interval },
  });
  return json({ ok: true, kind: plan.kind });
}

/** Undoes a change scheduled for the next billing date: the current plan simply renews. */
export async function DELETE(req: Request) {
  const guard = await managerGuard(req, { ownerOnly: true });
  if (!guard.ok) return guard.response;
  const provider = billingProvider();
  if (!provider) return json({ ok: false, error: "Billing isn't set up on this server yet." }, 501);
  const orgId = guard.ctx.workspace.id;
  const { subscription } = await getSubscription(db(), orgId);
  if (!subscription?.scheduledPlanId || !subscription.providerSubscriptionId)
    return json({ ok: false, error: "No plan change is scheduled." }, 400);
  try {
    await provider.cancelScheduledPlanChange(subscription.providerSubscriptionId);
  } catch {
    return json({ ok: false, error: "The change could not be undone. Please try again." }, 502);
  }
  await clearScheduledChange(db(), orgId);
  await audit({
    orgId,
    actorUserId: guard.ctx.session.user.id,
    action: "billing.plan_change_cancelled",
    target: null,
  });
  return json({ ok: true });
}
