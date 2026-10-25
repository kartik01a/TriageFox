# 0008 — Global billing through a merchant of record
- **Status:** Accepted
- **Date:** 2026-10-25
- **Supersedes:** [0003](0003-stripe.md)

## Context
The business runs from India. New Indian Stripe accounts have been invite-only since May 2024. We're launching globally (our free marketing channels and most paying buyers are outside India), and as a solo founder we can't handle sales tax and VAT in many countries.

## Decision
- **Global launch, priced in USD.**
- Use a **merchant of record**: **Dodo Payments** first (built for Indian founders, ~4% + $0.40), **Lemon Squeezy** as backup (~5% + $0.50).
- Behind `packages/billing`, so the provider can be swapped.
- Billing exists only in hosted mode; it's built in roadmap Phase 9.
- Add **Razorpay** later if Indian customers want UPI/INR pricing.

## Alternatives considered
- **Stripe:** invite-only for new Indian businesses.
- **India-only launch with Razorpay/Paytm:** smaller, more price-sensitive market, while our channels are global anyway. It wouldn't save work.
- **Paddle:** strong merchant of record, but stricter acceptance criteria for Indian sellers.

## Consequences
- Higher fees than a plain payment gateway, but no worldwide tax compliance burden.
- Payouts to an Indian bank; GST registration and an LUT become relevant once revenue grows (talk to a chartered accountant).
