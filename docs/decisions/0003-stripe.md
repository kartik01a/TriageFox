# 0003 — Stripe for billing
- **Status:** Accepted (revisit before public launch)
- **Date:** 2026-10-25

## Context
Users must pay before enabling automations. During development we need a realistic test mode.

## Decision
Stripe Checkout + Customer Portal + webhooks, test mode for MVP, behind a `packages/billing` interface.

## Alternatives considered
- **Paddle / Lemon Squeezy (merchant of record)** — handle global VAT/GST/sales tax and invoicing; higher fees. Strong candidates for launch if selling worldwide as a solo founder.
- **Razorpay** etc. — regional; consider if Stripe isn't available for the business's country.

## Consequences
- Fast to build and test.
- Before launch: confirm Stripe availability for the business's country and decide on MoR based on tax obligations.
