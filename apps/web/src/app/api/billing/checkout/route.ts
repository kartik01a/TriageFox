import { getSubscription, hasPaidSubscription, listPlans } from "@triagefox/billing";
import { z } from "zod";
import { billingProvider, currencyFor, visitorCountry } from "@/lib/billing";
import { audit } from "@/lib/connections";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { json, managerGuard } from "@/lib/guards";

const body = z.object({
  planId: z.uuid(),
  interval: z.enum(["monthly", "yearly"]),
  currency: z.enum(["USD", "INR"]).optional(),
});

/** Owner only: starts a checkout for one of the public plans. Prices and product ids come from the database. */
export async function POST(req: Request) {
  const guard = await managerGuard(req, { ownerOnly: true });
  if (!guard.ok) return guard.response;
  const provider = billingProvider();
  if (!provider) return json({ ok: false, error: "Billing isn't set up on this server yet." }, 501);
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success) return json({ ok: false, error: "Choose a plan." }, 400);

  // A paying workspace changes its plan; a second checkout would start a second subscription (ADR 0015).
  const { subscription } = await getSubscription(db(), guard.ctx.workspace.id);
  if (hasPaidSubscription(subscription))
    return json(
      { ok: false, error: "You already have a plan. Change it from the Billing page." },
      409,
    );

  const plans = await listPlans(db(), { publicOnly: true });
  const plan = plans.find((p) => p.id === input.data.planId);
  const country = visitorCountry(req.headers);
  const currency = input.data.currency ?? currencyFor(country);
  const productId = plan?.providerPriceIds[provider.name]?.[currency]?.[input.data.interval];
  if (!plan || !productId)
    return json({ ok: false, error: "That plan isn't available in your currency yet." }, 400);

  const { workspace, session } = guard.ctx;
  try {
    const { url } = await provider.createCheckout({
      orgId: workspace.id,
      email: session.user.email,
      name: session.user.name,
      productId,
      currency,
      country: country && country !== "XX" ? country : undefined,
      returnUrl: `${env().APP_URL}/app/billing?checkout=done`,
    });
    await audit({
      orgId: workspace.id,
      actorUserId: session.user.id,
      action: "billing.checkout_started",
      target: plan.slug,
      metadata: { interval: input.data.interval, currency },
    });
    return json({ ok: true, url });
  } catch {
    return json(
      { ok: false, error: "The payment page could not be opened. Please try again." },
      502,
    );
  }
}
