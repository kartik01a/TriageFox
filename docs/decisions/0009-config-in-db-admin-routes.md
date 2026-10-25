# 0009 — Plans, trial and platform settings in the database, managed via admin routes
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
Prices will change over time (inflation, market feedback), and trial rules may too: trial length (14 → 7 days), conversation cap, card required or not. Changing code and redeploying for every tweak is slow and risky.

## Decision
- Store **plans**, **trial settings** and **platform settings** in Postgres (`plans`, `platform_settings`).
- Manage them through **platform-admin API routes** (`/api/admin/*`), plus a **simple admin UI** (plain forms and tables, no design polish).
- Platform admins = emails in the `PLATFORM_ADMIN_EMAILS` env var, signed in with **2FA**. Every change is written to `admin_audit_log`.
- The pricing page, trial logic and limit checks read from the DB (cached ~5 min, invalidated on change).
- **Plan changes are versioned**: editing a price creates a new version; existing subscribers stay on theirs. MoR price IDs are stored on each version.
- Self-hosted installs ignore billing settings; only `signupEnabled` applies.

## Alternatives considered
- **Hard-coded config file:** simple, but every change needs a deploy.
- **Prices only in the MoR dashboard:** limits and trial rules would still need code, and the pricing page would depend on the MoR API being up.
- **Full admin panel:** too much work for a solo MVP. Routes + basic forms are enough.

## Consequences
- Prices, trial days/cap, card-required and AI budgets change in seconds, with an audit trail.
- Seed data provides the launch values, so a fresh database works out of the box.
- Needs validation (zod) and tests so a bad admin edit can't break checkout (e.g. a plan with no MoR price ID can't be made visible).
