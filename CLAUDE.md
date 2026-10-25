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
- **Phase 0 (API spike) and Phase 1 (Foundation) are done.** Findings are in `docs/integrations/*.md`; how to run everything is in `docs/development.md`. **Phase 2 (Connections) is done too** (see `docs/setup/providers.md`, `docs/architecture.md` "Web ↔ worker request channel"). **Phase 3 (Ingest + queue) is done** (see `docs/architecture.md` "As built in Phase 3"). **Next: Phase 4 (AI triage):** `packages/ai` prompt + rubric, strict JSON schema (zod), image input, chrono-node due dates (quote must appear verbatim), bring-your-own key, eval runner + labelled set. Plug it into the `triage` seam in `apps/worker/src/pipeline/deps.ts`; transcripts stay in memory, only encrypted summaries/outputs may be stored.
- Work **one phase at a time**, in order. A phase is done only when its "Done when" (roadmap), its tests, and its security checklist items (`docs/security.md` §15) are all complete. Before starting a phase: summarise what you'll build. After: what was built, how it was tested, what's left, anything the owner must do.
- Phase 0 lessons that shape later phases (details in the integration docs): Crisp timestamps are ms and hooks can arrive out of order (always re-fetch); Crisp file URLs are public on `storage.crisp.chat`; Jira priority is set in a second call and refresh tokens rotate; "human edited?" uses Jira changelog / Trello actions, not `updated`/`dateLastActivity`; Trello attachment limit 10 MB.
- Phase 3 conventions: hooks are signals only (always re-fetch); `source_events`/`threads` hold identifiers and positions, never message text; cross-workspace lookups go through the narrow `SECURITY DEFINER` functions (add new ones in a migration, return IDs only); schedule evaluations only via `scheduleEvaluation`; customer-supplied URLs are fetched only with `safeDownload`; tests use random queue names.
- Phase 2 conventions: anything needing a decrypted credential goes through `@triagefox/rpc` to the worker (add the method to `packages/rpc/src/protocol.ts` with strict output schema); credentials are sealed under binding `{orgId, connectionId, "connection.credentials"}`; the web app never imports private keys; API routes use `managerGuard` (same-origin + owner/admin); chosen targets live in `connections.metadata.defaults`.
- Phase 1 conventions: tenant tables get RLS in their migration and are queried via `withOrg()`; the web app never holds private keys; every page is dynamic (CSP nonce); auth is created lazily; new env vars go in `.env.example` + `packages/shared/src/env.ts`.

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
- Local dev: `docker compose` for Postgres, Redis and Mailpit. For webhooks to localhost, use ngrok with a free static domain: `ngrok http --url=<your-domain> 3000` (Cloudflare quick tunnels change URL on every start).
- Config: `.env` (git-ignored, the owner fills in values) + a committed `.env.example` listing every variable with comments. **Never ask the owner to paste secrets into chat**; tell them which variable to set. In production, the worker private key goes **only** to the worker container.
- Code style: small modules, clear names, comments only where the "why" isn't obvious. Match existing patterns once they exist.

## Repo & git
- The repo is **private** until launch-ready, then made public (see the public-flip checklist in `docs/roadmap.md` Phase 10). Write everything as if it will be public: no secrets, no private notes in pushed files.
- `docs/` is pushed; **`docs/private/` (business, pricing strategy) and `marketing/` are git-ignored**. Never move content from them into pushed files.
- Secrets: gitleaks pre-commit hook from Phase 1. Never commit `.env`, keys or real customer data.
- **Commit and push straight to `main`** (the owner is the only developer, so no branches or PRs; authorised 2026-10-25). Commit after each meaningful piece of work and push. Before every push, check nothing secret is staged (`.env` is git-ignored; never print or commit secret values). The repo stays **private** until launch.
- Commit messages: imperative summary line + short body.

## Docs upkeep
- When implementation changes or clarifies the design, update the matching topic doc in the same commit.
- New feature/plan → `docs/plans/YYYY-MM-DD-<name>.md`; new decision → next ADR in `docs/decisions/` + index; ideas → `docs/roadmap.md` "Future updates".
- Update the Status section in `docs/README.md` at the end of each phase.

## Working with the owner
- Explain in plain, simple language; the owner likes to discuss options before big decisions and then decide.
- Before each phase: a short summary of what you'll build. After each phase: what was built, how it was tested, what's left, and anything the owner must do (accounts, env values).
