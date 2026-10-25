# Billing (hosted mode only)

Self-hosted installs (`APP_MODE=selfhost`) have no billing and no plan limits.

## Provider
- A **merchant of record (MoR)** sells to customers on our behalf, handles worldwide sales tax/VAT, and pays out to an Indian bank account ([decisions/0008](decisions/0008-billing-merchant-of-record.md)).
  - First choice: **Dodo Payments** (built for Indian founders selling globally, ~4% + $0.40)
  - Backup: **Lemon Squeezy** (~5% + $0.50)
- **Stripe isn't used**: new Indian Stripe accounts have been invite-only since May 2024.
- **Razorpay** can be added later if Indian customers want UPI/INR pricing.
- Wrapped in `packages/billing`, so the provider can be swapped.
- **Global launch**, priced in USD.

## Flow
1. The user signs up, connects tools and configures an automation for free.
2. Clicking **Enable** → the free tier is used (within its limits), or the user picks a paid plan → MoR checkout.
3. The MoR webhook confirms the subscription → `subscriptions` updated → higher limits apply.
4. Plan changes, card updates and cancellation happen in the MoR's customer portal.

## Webhooks handled (names vary by provider; map them in `packages/billing`)
| Meaning | Action |
|---|---|
| subscription created/activated | activate the plan |
| subscription updated | sync plan, status, period |
| subscription cancelled/expired | drop to the free tier; pause automations that go over its limits |
| payment failed | mark past_due → notify the owner; downgrade after a grace period |
| payment succeeded | clear past_due |

Verify signatures, and ignore repeat deliveries based on the provider's event id.

## Limits & usage
- `usage_counters` per org per period: tickets created, AI runs, AI cost.
- Plans are measured in **conversations analysed per month** (the AI cost driver) and the number of **connected Crisp websites**. Every plan includes every feature.
- Checked in the worker before each evaluation: at 80% → warning email; at 100% → new conversations wait until the next period (or an upgrade), with a dashboard banner. **No surprise overage charges.**
- Plan types: monthly and yearly, each with and without the customer's own OpenAI key (cheaper; the key only, never the model).
- Workspaces using **their own OpenAI key** cost us almost nothing in AI. Plans can reflect that.
- Only the `owner` role can manage billing.

## Pricing
To be decided in the pricing discussion (tiers, free-tier caps, bring-your-own-key discount, launch offers). It goes in `docs/private/`, since pricing strategy isn't pushed. The code only needs a plan → limits config.

## Tax and paperwork (India)
- To start: PAN and a bank account. The MoR handles customer-side taxes.
- Once revenue starts: talk to a chartered accountant about GST registration and an LUT for exporting services.
