# TriageFox

Open-source (AGPL-3.0) AI that turns customer chats into Trello and Jira tickets, plus a paid hosted version. MVP: **Crisp → Trello + Jira Cloud**. Solo owner in India; budget ~₹1,000/month.

The full design is already decided and documented. **Your job is to implement it, not redesign it.**

## Read first
| Need | Doc |
|---|---|
| The current plan | `docs/plans/2026-10-25-mvp-plan-v2-crisp.md` |
| Phases and "done when" | `docs/roadmap.md` |
| Product decisions | `docs/requirements.md` |
| System design, admin routes | `docs/architecture.md` |
| Tables | `docs/data-model.md` |
| AI rules, schema, models, evals | `docs/ai-triage.md` |
| Each integration (+ Phase 0 open questions) | `docs/integrations/*.md` |
| Security plan + **per-phase checklist** | `docs/security.md` (§15) |
| Billing, trial, currency, refunds, comp grants | `docs/billing.md` |
| UI plan | `docs/ui-ux.md` |
| Own support / admin inbox | `docs/own-support.md` |
| Failure handling | `docs/edge-cases.md` |
| Tests + acceptance criteria | `docs/testing.md` |
| Why things are the way they are | `docs/decisions/` (ADRs 0001–0011) |

## Current status
- Planning is complete. **Next: Phase 0, the API spike.** No app code exists yet.
- **Phase 0 rules:**
  - Throwaway scripts only, in `spikes/<crisp|trello|jira|openai>/`.
  - Answer every open-question checkbox in `docs/integrations/*.md` and in `docs/security.md` §15 Phase 0. Write the findings into those docs.
  - Save real (anonymised) payloads as fixtures under `spikes/fixtures/` (they move to `packages/connectors/*/__fixtures__/` in Phase 1).
  - **Don't start the monorepo until Phase 0 findings are written up and the owner has seen them.** If a finding breaks a decision (e.g. Crisp can't be tested on a free plan → fall back to Chatwoot), stop and ask.
- Work **one phase at a time**, in order. A phase is done only when its "Done when" (roadmap), its tests, and its security checklist items are all complete.

## Non-negotiables
- **Security comes first** (`docs/security.md`):
  - Sealed-box encryption: the **web app has only the public key**; only the **worker** has the private key and decrypts.
  - Calls needing decrypted tokens run in the worker (internal RPC).
  - **No chat transcripts stored**; webhook events store IDs only; summaries and `ai_runs.raw_output` are encrypted.
  - Every query is org-scoped through the data-access layer, **plus Postgres RLS**.
  - OpenAI keys are write-only (show `sk-…1234` only).
  - Verify every webhook signature and timestamp; SSRF guard on attachment downloads; never render chat/AI text as raw HTML.
  - The AI gets **no tools**; output must pass the zod schema; drop unknown IDs.
- **Nothing about plans, prices, limits or trial rules is hard-coded.** It lives in `plans` / `platform_settings` (DB, seeded), edited via admin routes (ADR 0009).
- **Bring-your-own-key = the OpenAI key only.** Models are server config (`gpt-6-luna` default, `gpt-6.1-sol` escalation); customers can never choose models.
- Due dates only from an exact customer quote resolved by chrono-node; no quote → no date.
- Hosted vs self-host via `APP_MODE=hosted|selfhost` (self-host: no billing, own keys).
- Never change an agreed decision silently. **Ask the owner first**, then record it as a new ADR and update the affected topic docs.

## Stack & conventions
- **TypeScript (strict)** everywhere; **pnpm** workspaces + **Turborepo**. Layout per `docs/architecture.md` (`apps/web`, `apps/worker`, `packages/*`, `deploy/`).
- **Next.js App Router** (web, API routes, webhooks, OAuth callbacks); **BullMQ + Redis** worker; **Postgres + pgvector** with **Drizzle**; **zod** for all validation; **Better Auth** (organizations, 2FA); **pino** logs (with redaction); Sentry.
- UI: **Tailwind + shadcn/ui + Motion**, Lucide icons; polished for customers, plain for `/admin`.
- Tests: **Vitest** (unit/integration, msw for HTTP), **Playwright** (E2E), AI eval runner in `packages/ai/evals/`.
- Email: **Mailpit** locally (Docker Compose), **Resend** in production (needs the domain).
- Local dev: `docker compose` for Postgres, Redis and Mailpit. For webhooks to localhost, use a Cloudflare quick tunnel: `cloudflared tunnel --url http://localhost:3000`.
- Config: `.env` (git-ignored, the owner fills in values) + a committed `.env.example` listing every variable with comments. **Never ask the owner to paste secrets into chat**; tell them which variable to set. In production, the worker private key goes **only** to the worker container.
- Code style: small modules, clear names, comments only where the "why" isn't obvious. Match existing patterns once they exist.

## Repo & git
- The repo is **private** until launch-ready, then made public (see the public-flip checklist in `docs/roadmap.md` Phase 10). Write everything as if it will be public: no secrets, no private notes in pushed files.
- `docs/` is pushed; **`docs/private/` (business, pricing strategy) and `marketing/` are git-ignored**. Never move content from them into pushed files.
- Secrets: gitleaks pre-commit hook from Phase 1. Never commit `.env`, keys or real customer data.
- **You may commit** in this project without asking. Use a branch per phase (`phase-0-spike`, `phase-1-foundation`, …). **Don't push or merge to `main`**: the owner reviews, merges and pushes.
- Commit messages: imperative summary line + short body.

## Docs upkeep
- When implementation changes or clarifies the design, update the matching topic doc in the same commit.
- New feature/plan → `docs/plans/YYYY-MM-DD-<name>.md`; new decision → next ADR in `docs/decisions/` + index; ideas → `docs/roadmap.md` "Future updates".
- Update the Status section in `docs/README.md` at the end of each phase.

## Working with the owner
- Explain in plain, simple language; the owner likes to discuss options before big decisions and then decide.
- Before each phase: a short summary of what you'll build. After each phase: what was built, how it was tested, what's left, and anything the owner must do (accounts, env values).
