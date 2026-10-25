# Plan v2: Crisp → Trello / Jira AI Ticket Automation (open source + hosted)

> Agreed 2026-10-25. Supersedes [2026-10-25-mvp-plan.md](2026-10-25-mvp-plan.md) (the Featurebase version).
> The topic docs in `docs/` hold the current design; this file is a snapshot of the plan as approved.

## Context

Small teams get bug reports, UI complaints and feature requests in **Crisp** live chat, then create Trello cards or Jira issues by hand. We're building an **open-source (AGPL)** tool, with a **paid hosted version**, that:
- uses AI to decide whether a chat needs a code change, and skips how-tos, greetings and issues solved in chat
- creates a ticket with type, priority 1–5, clear title/description, repro steps, attachments, and a due date **only if the customer stated one**
- keeps updating the same ticket as the chat continues, supports several tickets per chat, and merges duplicates across customers
- sends the same ticket to every connected destination (Trello and/or Jira)

What changed from v1, and why:
- **Featurebase → Crisp**: Featurebase API access needs a paid plan ([0006](../decisions/0006-crisp-as-mvp-source.md)).
- **Open source + hosted business model** ([0005](../decisions/0005-open-core-agpl.md)).
- **One-server Docker Compose hosting** within a ₹1,000/month budget ([0007](../decisions/0007-hosting-single-vps.md)).
- **Global launch with a merchant of record** instead of Stripe ([0008](../decisions/0008-billing-merchant-of-record.md)).

## Key decisions

- **Stack:** TypeScript monorepo (pnpm + Turborepo), Next.js, Node worker on BullMQ + Redis, Postgres + pgvector, Drizzle, zod, Better Auth (orgs), pino + Sentry.
- **Modes:** `APP_MODE=hosted|selfhost`. Self-host turns billing off and requires your own OpenAI key and your own Crisp plugin, Trello key and Atlassian app.
- **AI:** OpenAI (images, strict JSON, embeddings). Small model by default, stronger model when needed. Bring-your-own key in v1.
- **Connections:** Crisp = install our Marketplace plugin, then link the website on our settings page. Trello = authorize flow. Jira Cloud = OAuth 3LO (API-token fallback).
- **Priority:** 5 Critical/red/Highest · 4 High/orange/High · 3 Medium/yellow/Medium · 2 Low/lime/Low · 1 Lowest/green/Lowest, set by a rubric.
- **Due date:** the AI returns the exact quote; chrono-node turns it into a date; no quote means no date.
- **Attachments:** always streamed from Crisp into Trello/Jira; fall back to a link.
- **Toggles:** `includeSourceLink` (off), `includeCustomerNames` (off).
- **Billing (hosted):** Dodo Payments (Lemon Squeezy backup), USD, global. Pricing to be decided separately.

## Pipeline

1. `POST /api/webhooks/crisp` → check `X-Crisp-Signature` (HMAC-SHA256 over `[timestamp;body]`) → route by `website_id` → insert `source_events` (computed dedupe key) → 200.
2. Queue `thread.evaluate` per conversation (`session_id`), with a quiet window (~180s); immediate on `session:set_state` = resolved.
3. Worker (per-thread lock): fetch the conversation + files from the Crisp REST API; load linked issues; pgvector top-5 duplicate candidates.
4. AI triage → strict JSON → zod → actions `no_action | create | update | duplicate_of`.
5. `ticket.deliver` / `ticket.update` jobs per destination, with no double-creates.
6. Updates as comments; the description is rewritten only if no person edited it. Duplicates add a comment and raise the count. A match to a closed ticket creates a new linked ticket.
7. `crisp.reconcile` every ~10 min catches dropped hooks.

## Phases

0. **API spike:** confirm Crisp is free to test (fallback: Chatwoot), REST routes, file URLs, settings-page linking; Trello authorize; Jira 3LO + createmeta.
1. **Foundation:** monorepo, Docker Compose dev environment, schema, auth + workspaces, crypto, CI, AGPL licence.
2. **Connections:** Crisp, Trello, Jira, OpenAI key.
3. **Ingest + queue:** hook route, dedupe, threads, debounce, lock, fetch, reconcile.
4. **AI triage:** schema, prompt, rubric, images, dates, bring-your-own key, eval set.
5. **Ticket creation:** Trello + Jira, labels, priority, ADF, attachments, fan-out.
6. **Updates + duplicates.**
7. **Dashboard:** wizard, activity log, review queue, dry run.
8. **Self-host package:** production Compose + Caddy, setup script, guide, README.
9. **Billing (hosted):** MoR, free tier, limits.
10. **Hardening + launch:** limits, alerts, legal pages, `SECURITY.md`, Crisp Marketplace submission.

Detail per phase: [roadmap.md](../roadmap.md).

## Verification

See [testing.md](../testing.md). Highlights:
- Same hook ×3 → 1 ticket.
- 5 quick messages → 1 evaluation.
- Follow-up → comment.
- 2nd customer → duplicate comment.
- Dropped hook → recovered by reconcile.
- Jira down → Trello OK, Jira retried.
- Eval targets: ≥90% ticket vs no ticket, ≥85% type, ≥85% priority within ±1, 0 made-up dates.
- End to end: real Crisp chat → Trello card + Jira issue.
- Self-host: `docker compose up` on a fresh VM.

## After the MVP

Integrations are added one at a time: Chatwoot → tawk.to → Featurebase → Freshdesk → Intercom → Zendesk; destinations Linear → GitHub Issues → ClickUp → … ([roadmap.md](../roadmap.md#integrations-roadmap)).
