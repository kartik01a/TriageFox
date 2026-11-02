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
| International cards (**any card issued outside the US**: Japan, Thailand, Philippines, EU, …) | +1.5% |
| Subscriptions | +0.5% |
| PayPal / BNPL | +3% (off at launch) |
| India domestic (INR, e.g. UPI) | 4% + $0.15 |
| Refund / dispute (chargeback) | $1 / $30 |
| Payout under $1,000 | $5 (free at $1,000+; Dodo's page is inconsistent, so confirm) |
| USD → INR payout conversion | "standard FX rates" (spread not published; assume ~1–2%, confirm) |

Effective for us: **≈ 6% + $0.40** per international subscription payment, **plus ~1–2% FX** when converting payouts to INR. That's ~10–12% on a $9 monthly plan and ~7–8% on a $90 yearly plan.

**Card network fees (Visa/Mastercard/Amex interchange):** with a merchant of record we never get a separate card-network bill. Dodo is the seller and pays the card networks out of its fee; the +1.5% international surcharge is its pass-through for cross-border card costs. Dodo's pricing page doesn't spell this out, and doesn't mention Amex, so **confirm both with Dodo before launch**. Our cost model already includes the international and subscription surcharges.

## As built in Phase 9

- **Code:** `packages/billing` (provider-neutral). `DodoProvider` creates checkouts (`POST /checkouts`, with `metadata.org_id` so the webhook knows the workspace and `billing_currency` set explicitly), opens the customer portal (`POST /customers/{id}/customer-portal/session`) and verifies webhooks (Standard Webhooks: HMAC-SHA256 over `{webhook-id}.{webhook-timestamp}.{body}`, `whsec_` secret, 5-minute tolerance, several `v1,` signatures allowed). `FakeProvider` signs webhooks the same way for tests. Dodo's event and field names are read defensively (unknown event types are ignored, never guessed at) and **must be checked once against Dodo's test mode** (a Phase 9 owner task: see below).
- **Web:** `POST /api/webhooks/billing` (bare 401 on any verification failure, 200 for genuine events we cannot place, 500 only for real faults), `POST /api/billing/checkout|portal|redeem` (owner only), public `/pricing` and in-app `/app/billing` (Monthly/Yearly, USD/INR via `CF-IPCountry` with a manual switch, usage bar, plan chooser, portal button, invite-code redemption), a banner at 80% / 100% / trial ending. All of it exists only when `APP_MODE=hosted`.
- **Trial:** every new workspace gets a `subscriptions` row `trialing` (days from `platform_settings.trial`). Trial limits: the conversation cap, or unlimited with the workspace's own key; platform-wide trial AI spend is capped by `budgets.trialAiUsdMonthly` (beyond it a trial needs its own key). One connected inbox during the trial.
- **Limits** (`evaluate`, pure and tested): checked in the worker before every AI analysis. Blocked states: no plan, paused, trial ended, trial budget, plan ended, payment failed (after `grace.pastDueDays`), own key required, over limit. A conversation counts once per period (`usage_conversations`), so follow-ups never use more room. The unlimited plan's fair-use ceiling is only flagged. Warning emails at 80% and 100% (once per period). Blocked conversations are not analysed: the worker records `billing_blocked` once a day; the reconcile job only re-checks the last few hours, so chats from a longer gap are not ticketed later, and the banner and Billing page say so. A plan cancelled mid-period keeps working until `currentPeriodEnd` and then stops even without the provider's "ended" event. When the trial or plan has ended, the Overview page redirects to Billing (`?ended=1`); every other page stays open.
- **Webhook handling:** `applyBillingEvent` is idempotent on the provider's event id (`billing_events`); the workspace comes from `metadata.org_id`, or from the stored subscription/customer id through `billing_org_for_subscription()`. A cancellation keeps access until the period ends; an expiry ends it; a failed payment starts the grace period; a success clears it.
- **Plans:** stored versioned. Changing a price, a limit or the own-key flag creates a new version **without** the old product ids (so nobody can buy the new price at the old one); it is offered once product ids are entered and it is published, and until then the old version stays on sale. A plan cannot be public without product ids. Plan prices are seeded from the git-ignored `docs/private/plans.seed.json` (`pnpm db:seed`), as hidden plans.
- **Free access:** `comped` subscriptions (N months or open-ended, with a reason, limits still apply) and single-use invite codes (24-character random, bound to one email, 7 days, only a SHA-256 hash stored, redemption claimed atomically).
- **Reminders** (daily worker job): an email 3 days (monthly) / 7 days (yearly) before renewal, including what TriageFox did that period, once per period; a notice 3 days before a trial ends.
- **Provider set-up** (owner): [setup/providers.md](setup/providers.md) "Dodo Payments".

## Currency (agreed 2026-10-25)
| Visitor | What they see | What they pay in |
|---|---|---|
| **India** | Real rupee prices (round numbers, e.g. ₹699/month), + GST added at checkout | **INR**: UPI, RuPay and Indian cards (Dodo India domestic fee: 4% + $0.15) |
| **Everyone else** | USD price + an approximate local hint, e.g. "$9/month (≈ ¥1,350)" | **USD** (cards, Apple Pay, Google Pay) |

- The currency is chosen automatically from Cloudflare's free `CF-IPCountry` header; visitors can switch manually (USD ↔ INR).
- Hint conversion rates come from a free daily source (e.g. Frankfurter / ECB rates), cached for 24 h, and labelled "approximate".
- Rupee prices are stored per plan alongside USD (admin-editable, versioned like USD prices).
- Dodo's **adaptive currency** (customer pays a 2–4% FX fee) stays **off**.
- Phase 9 check: Dodo supports a fixed INR price per product/plan.

### Keeping fees down
1. **Yearly-first pricing page:** the toggle defaults to *Yearly (2 months free)*. One payment a year means one $0.40 fee instead of twelve.
2. **PayPal off at launch** (+3%). Turn it on only if customers ask for it.
3. **Let payouts reach $1,000** before withdrawing (avoids the $5 fee) once cash flow allows.
4. **Avoid chargebacks** ($30 each, and a high rate can get the seller account suspended): no-card trial, clear limits, easy cancel, annual renewal reminders (see the refund policy).

## Refund policy
**No refunds.** The 7-day free trial is the "try before you buy".
- **Cancel anytime:** cancelling stops the next renewal; access continues until the end of the paid period. No partial or pro-rated refunds.
- **Only these exceptions**, each decided by the owner after checking the evidence:
  - a duplicate or mistaken charge (our or Dodo's billing error)
  - an outage on our side that made the service unusable for more than 72 hours in the billing period
  - where the law requires it (e.g. EU/UK consumer rules, if an individual rather than a business buys)
- "Didn't use it", "forgot to cancel", or "changed my mind" are **not** reasons for a refund.
- **Renewal reminders** (cut down "I forgot it renews" disputes): an email **3 days before each monthly** renewal and **7 days before each yearly** renewal. The email doubles as a value summary ("TriageFox created 23 tickets and merged 4 duplicates for you this month"). The number of days is an admin setting. If Dodo also sends renewal emails, keep only one.
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
- **Trial settings:** days (launch: 7, ADR 0012), conversation cap (50), card required (false), monthly trial AI budget ($10), unlimited with own key (true).
- **Platform settings:** monthly platform AI spend ceiling, sign-ups open/closed.

The pricing page reads active plans from the DB (cached ~5 min). **Price changes create a new plan version**: existing subscribers keep their price unless deliberately moved. The matching price must exist in the MoR first (created in its dashboard or API, IDs saved on the plan).

Launch values: [docs/private pricing doc](private/) (not pushed).

## Free access for testers, friends and you (no public coupon codes)
A permanent secret "100% off" code is risky: one screenshot or forwarded message and anyone can use it forever. Instead:
- **Complimentary (comp) grants:** from the admin routes, give any workspace any plan for N months or indefinitely, with a reason ("owner testing", "beta tester"). No payment, no code to leak, and you can revoke it any time. Usage limits and the AI budget still apply, so a comped workspace can't run up unlimited AI costs.
- **Invite codes** (when you'd rather send something than set it up yourself): generated by an admin route, **random 20+ characters, single-use, tied to one email address, expiring in 7 days**, granting a comp plan for N months. Stored **hashed**, so even a database leak doesn't reveal working codes. Redeemed on the billing page.
- **Testing the real payment flow in production:** use Dodo's test mode for most checks. For one final live check, buy Starter with your own card, then cancel. If Dodo supports it, use a **single-use, 1-day** discount code created in the Dodo dashboard just for that test, then delete it.
- Codes are never written in docs, git, chat or code.

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
- Checked in the worker before each evaluation: at 80% → warning email; at 100% → new conversations are not turned into tickets until the next period (or an upgrade, or adding their own key), with a dashboard banner. Conversations from the gap are not processed later (the reconcile job only looks back a few hours); the banner says so. **No surprise overage charges.**
- **Unlimited (own key)** has a fair-use ceiling (an admin setting) to protect the server.
- `usage_counters` per org per period: conversations analysed, tickets created, AI runs, AI cost.
- Trials: one per connected inbox (`websiteId` can only be linked once).
- Only the `owner` role can manage billing.

## Tax and paperwork (India)
- To start: PAN and a bank account. The MoR handles customer-side taxes.
- Once revenue grows: talk to a chartered accountant about GST registration and an LUT for exporting services.
