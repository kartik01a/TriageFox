# Billing

## Provider
- **Stripe**, test mode during development ([decisions/0003-stripe.md](decisions/0003-stripe.md)).
- Wrapped in `packages/billing` so the provider can be swapped.
- Before public launch, evaluate a **merchant of record** (Paddle, Lemon Squeezy) — they handle global VAT/GST/sales tax for you. Also confirm Stripe's availability for your business's country.

## Flow
1. User browses, connects tools, and configures an automation for free.
2. Clicking **Enable** without an active subscription → Stripe Checkout.
3. `checkout.session.completed` webhook → create/update `subscriptions` → automation can be enabled.
4. Plan changes, card updates, cancellation → **Stripe Customer Portal**.

## Stripe webhooks handled
| Event | Action |
|---|---|
| `checkout.session.completed` | activate subscription |
| `customer.subscription.updated` | sync plan/status/period |
| `customer.subscription.deleted` | status canceled → pause all automations |
| `invoice.payment_failed` | mark past_due → notify owner; pause after grace period |
| `invoice.paid` | clear past_due |

Verify Stripe signatures; dedupe on Stripe event id.

## Gating & usage
- Automations can only be `enabled` when subscription status is `active` or `trialing`.
- `usage_counters` per org per period: tickets created, AI runs, AI cost.
- Plan limits (e.g. tickets/month, number of automations, destinations) enforced in the worker before creating tickets. Limit reached → pause + email + dashboard banner.
- Only `owner` role can manage billing.

## Pricing
TBD — decided in the market analysis (tiers, trial policy, annual discount). The code only needs plan → limits config.
