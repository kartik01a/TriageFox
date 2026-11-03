import "server-only";
import { planChangePlan } from "@triagefox/billing";
import { z } from "zod";
import { billingProvider, currencyFor, formatPrice, visitorCountry } from "@/lib/billing";
import { db } from "@/lib/db";
import { json, managerGuard } from "@/lib/guards";

const body = z.object({ planId: z.uuid(), interval: z.enum(["monthly", "yearly"]) });

/** Owner only. Validates the request and works out the change from the database (ADR 0015). */
export async function prepareChange(req: Request) {
  const guard = await managerGuard(req, { ownerOnly: true });
  if (!guard.ok) return { response: guard.response } as const;
  const provider = billingProvider();
  if (!provider)
    return {
      response: json({ ok: false, error: "Billing isn't set up on this server yet." }, 501),
    } as const;
  const input = body.safeParse(await req.json().catch(() => null));
  if (!input.success)
    return { response: json({ ok: false, error: "Choose a plan." }, 400) } as const;
  const plan = await planChangePlan(db(), {
    orgId: guard.ctx.workspace.id,
    provider: provider.name,
    planId: input.data.planId,
    interval: input.data.interval,
    fallbackCurrency: currencyFor(visitorCountry(req.headers)),
  });
  if (!plan.ok) return { response: json({ ok: false, error: plan.error }, 400) } as const;
  return { guard, provider, plan } as const;
}

export const money = (minor: number, currency: string) => formatPrice(minor, currency);
