import { getSubscription } from "@triagefox/billing";
import { billingProvider } from "@/lib/billing";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { json, managerGuard } from "@/lib/guards";

/** Owner only: a one-time link to the payment provider's portal (payment method, plan, cancel, invoices). */
export async function POST(req: Request) {
  const guard = await managerGuard(req, { ownerOnly: true });
  if (!guard.ok) return guard.response;
  const provider = billingProvider();
  if (!provider) return json({ ok: false, error: "Billing isn't set up on this server yet." }, 501);
  const { subscription } = await getSubscription(db(), guard.ctx.workspace.id);
  if (!subscription?.providerCustomerId)
    return json({ ok: false, error: "There is no payment to manage yet." }, 400);
  try {
    const { url } = await provider.createPortalSession({
      customerId: subscription.providerCustomerId,
      returnUrl: `${env().APP_URL}/app/billing`,
    });
    return json({ ok: true, url });
  } catch {
    return json(
      { ok: false, error: "The payment portal could not be opened. Please try again." },
      502,
    );
  }
}
