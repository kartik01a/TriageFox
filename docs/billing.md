# Billing (hosted mode only)

Self-hosted installs (`APP_MODE=selfhost`) have no billing and no plan limits.

## Provider
- A **merchant of record (MoR)** sells to customers on our behalf, handles worldwide sales tax and VAT (including B2B VAT-number reverse charge), fraud, chargebacks, invoices and receipts, and pays out to an Indian bank account ([decisions/0008](decisions/0008-billing-merchant-of-record.md)).
  - **Dodo Payments** (first choice). Based in India, has UPI for Indian customers, pays out to Indian banks.
  - **Lemon Squeezy** (backup).
- **Stripe isn't used**: new Indian Stripe accounts have been invite-only since May 2024.
- Wrapped in `packages/billing`, so the provider can be swapped.
- **Global launch**, priced in USD.

### Fees (Dodo, check the current pricing page)
| Item | Fee |
|---|---|
| Base (US cards & wallets) | 4% + $0.40 |
| International cards | +1.5% |
| Subscriptions | +0.5% |
| PayPal / BNPL | +3% (off at launch) |
| India domestic (INR, e.g. UPI) | 4% + $0.15 |
| Refund / dispute (chargeback) | $1 / $30 |
| Payout under $1,000 | $5 (free at $1,000+; Dodo's page is inconsistent, so confirm) |
| USD → INR payout conversion | "standard FX rates" (spread not published; assume ~1–2%, confirm) |

Effective for us: **≈ 6% + $0.40** per international subscription payment, **plus ~1–2% FX** when converting payouts to INR. That's ~10–12% on a $9 monthly plan and ~7–8% on a $90 yearly plan.

**Card network fees (Visa/Mastercard/Amex interchange):** with a merchant of record we never get a separate card-network bill. Dodo is the seller and pays the card networks out of its fee; the +1.5% international surcharge is its pass-through for cross-border card costs. Dodo's pricing page doesn't spell this out, and doesn't mention Amex, so **confirm both with Dodo before launch**. Our cost model already includes the international and subscription surcharges.

**Adaptive currency** (showing local prices) costs us 0%, but the customer pays a 2–4% FX fee. **Off at launch**: prices in USD.

### Keeping fees down
1. **Yearly-first pricing page:** the toggle defaults to *Yearly (2 months free)*. One payment a year means one $0.40 fee instead of twelve.
2. **PayPal off at launch** (+3%). Turn it on only if customers ask for it.
3. **Let payouts reach $1,000** before withdrawing (avoids the $5 fee) once cash flow allows.
4. **Avoid chargebacks** ($30 each, and a high rate can get the seller account suspended): no-card trial, clear limits, easy cancel, annual renewal reminders (see the refund policy).

## Refund policy
**No refunds as standard.** The 14-day free trial is the "try before you buy".
- **Cancel anytime:** cancelling stops the next renewal; access continues until the end of the paid period. No partial or pro-rated refunds.
- **Exceptions** (handled case by case from the Dodo dashboard):
  - duplicate or mistaken charges
  - a serious outage on our side that made the service unusable for an extended period
  - where the law requires it (e.g. EU/UK consumer rules, if an individual rather than a business buys)
- **Discretion rule:** if a customer is clearly upset and about to dispute, refunding (cost $1) beats a chargeback ($30 + the money is returned anyway + account risk).
- **Annual renewals:** email a reminder **7 days before** each yearly renewal. "I forgot it renews" is the most common reason for chargebacks on yearly plans.
- **Shown in:** Terms of Service, the pricing FAQ, and a short line at checkout ("Cancel anytime. Payments are non-refundable.").
- **Dodo is legally the seller**, so its buyer terms apply too. In Phase 9, check that Dodo allows a no-refund policy and match our Terms to its terms.

### Payment methods at launch
| Method | Status | Why |
|---|---|---|
| Cards (Visa, Mastercard, Amex) | ✅ On | Default for B2B SaaS |
| Apple Pay, Google Pay | ✅ On | Same base rate, faster checkout |
| UPI / Indian cards | ✅ On | For Indian customers (Dodo supports UPI) |
| PayPal | ⏸ Off | +3% fee; enable later if requested |
| Bank transfer / invoice | ⏸ Later | For Business or custom plans if requested |

### Alternatives reviewed (Oct 2026)
| Option | Fees | Why not now |
|---|---|---|
| Razorpay (payment gateway, not a merchant of record) | ~3% + 18% GST on the fee + FX markup, no fixed fee | Cheaper on small payments, but **we** become the seller: worldwide sales tax/VAT, export paperwork (LUT, FIRA), business registration, international activation. At our scale it saves ~$10/month for a lot of risk and paperwork. Good later for INR pricing |
| Paddle (merchant of record) | 5% + $0.50 all-inclusive (+FX spread) | Unclear whether Indian sellers are accepted; payouts not in INR ($15 SWIFT) |
| Lemon Squeezy (merchant of record) | 5% + $0.50 (+ surcharges) | Similar or higher than Dodo; kept as backup |
| Polar (merchant of record) | 4–5% + $0.40–0.50 | Payouts use Stripe Connect Express; India not confirmed |
| Creem (merchant of record) | 3.9% + $0.40, + payout fees | India payouts not confirmed; extra fees on add-ons |
| Stripe via a US company (Stripe Atlas) | 2.9% + $0.30 + extras | ~$500 setup + yearly US filings and agent fees; not worth it before real revenue |

Revisit at ~$2–3k MRR.

## Flow
1. The user signs up and starts the **trial** (no card by default).
2. They connect tools and enable automations within trial limits.
3. They choose a plan on the pricing/billing page (Monthly | Yearly toggle, with or without their own key) → MoR checkout.
4. The MoR webhook confirms the subscription → `subscriptions` updated → plan limits apply.
5. Plan changes, card updates and cancellation happen in the MoR's customer portal.

## Plans, trial and limits: stored in the database, not in code
All of these are rows in the DB, managed through **admin routes** ([decisions/0009](decisions/0009-config-in-db-admin-routes.md)):
- **Plans:** name, monthly/yearly price, conversation limit (or unlimited + fair-use cap), connected-inbox limit, own-key required, support level, MoR product/price IDs, visible/active, sort order, "most popular" badge.
- **Trial settings:** days (launch: 14), conversation cap (50), card required (false), monthly trial AI budget ($10), unlimited with own key (true).
- **Platform settings:** monthly platform AI spend ceiling, sign-ups open/closed.

The pricing page reads active plans from the DB (cached ~5 min). **Price changes create a new plan version**: existing subscribers keep their price unless deliberately moved. The matching price must exist in the MoR first (created in its dashboard or API, IDs saved on the plan).

Launch values: [docs/private pricing doc](private/) (not pushed).

## Webhooks handled (names vary by provider; map them in `packages/billing`)
| Meaning | Action |
|---|---|
| subscription created/activated | activate the plan |
| subscription updated | sync plan, interval, status, period |
| subscription cancelled/expired | end of period → automations paused (data kept 30 days) |
| payment failed | mark past_due → notify the owner; pause after the grace period |
| payment succeeded | clear past_due |

Verify signatures, and ignore repeat deliveries based on the provider's event id.

## Limits & usage
- Plans are measured in **conversations analysed per month** (the AI cost driver) and **connected inboxes** (Crisp websites now; Chatwoot inboxes, tawk.to properties later). Every plan includes every feature.
- A conversation counts once it reaches the AI. Free rule-based filtering skips greetings-only, operator/bot-only and spam conversations; those don't count.
- Checked in the worker before each evaluation: at 80% → warning email; at 100% → new conversations wait until the next period (or an upgrade, or adding their own key), with a dashboard banner. **No surprise overage charges.**
- **Unlimited (own key)** has a fair-use ceiling (an admin setting) to protect the server.
- `usage_counters` per org per period: conversations analysed, tickets created, AI runs, AI cost.
- Trials: one per connected inbox (`websiteId` can only be linked once).
- Only the `owner` role can manage billing.

## Tax and paperwork (India)
- To start: PAN and a bank account. The MoR handles customer-side taxes.
- Once revenue grows: talk to a chartered accountant about GST registration and an LUT for exporting services.
