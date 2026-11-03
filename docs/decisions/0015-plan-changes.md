# 0015 — Changing plans: upgrades now and prorated, downgrades at renewal
- **Status:** Accepted
- **Date:** 2026-11-03

## Context
A workspace that already paid could only "choose a plan" again, which opened a new checkout: it paid the full new price with no credit for the old plan, and ended up with two subscriptions billing side by side. The owner asked for proper upgrades and downgrades before going live: an upgrade mid-month must be charged only the difference, and a downgrade must keep the bigger plan until the end of the paid cycle.

## Decision
- A workspace with a live paid subscription never opens a second checkout (`hasPaidSubscription`; the checkout route answers 409). Its Billing page offers **Upgrade now** or **Switch at renewal** on the other plans.
- **When a change happens** (`changeKind`, pure, in `packages/billing`): a **bigger plan** (higher monthly list price) or **switching to yearly** happens **now**; a **smaller plan** or **switching to monthly** happens **at the next billing date**.
- **How it is billed** (Dodo change-plan, `changeRequest`):
  - Now, same billing period: `prorated_immediately_keep_cycle`: only the difference for the days left is charged, the renewal date stays.
  - Now, different billing period: `prorated_immediately`: the unused time is credited and the new period starts today.
  - At renewal: `full_immediately` with `effective_at: next_billing_date`: nothing today; the next renewal is the new plan.
  - Always `on_payment_failure: prevent_change` (a failed charge leaves the plan as it was) and `cancel_scheduled_change_plan: true` (a new choice replaces a scheduled one).
- **Before confirming**, the provider's preview shows the exact amount charged today.
- **The plan in TriageFox follows the provider's webhook**, never the button: an upgrade's bigger limit applies when Dodo confirms the change (seconds). A scheduled downgrade is remembered on the subscription (`scheduled_plan_id`, `scheduled_interval`, `scheduled_at`), shown on Billing ("… on 3 December. Until then you keep …") and can be undone ("Keep my current plan", which cancels it at Dodo). A webhook naming the smaller product before its date does not shrink the plan early.
- Changes stay in the subscription's currency (now stored on the subscription). Owner only, like checkout. Each change is in the workspace audit log.
- Not possible while a payment has failed (update the card first) or while the plan is set to end (resume it in the portal first).

## Alternatives considered
- **Leave plan changes to Dodo's customer portal:** the portal applies its own rules (a scheduled change there always uses full billing), shows no TriageFox limits, and the double-checkout trap would remain.
- **Charge the full new price on upgrade:** simpler, but the customer pays twice for the same days.
- **Downgrade immediately with a credit:** the customer loses the bigger plan they already paid for.

## Consequences
- Migration 0012 adds `currency` and the three `scheduled_*` columns to `subscriptions`.
- The browser tests use a stand-in provider (`E2E_FAKE_BILLING=true`, never in production) so the whole flow is tested without real payments. One real check in Dodo's test mode remains, as for checkout: preview amount, a prorated upgrade, a scheduled downgrade arriving at renewal.
