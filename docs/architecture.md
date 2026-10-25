# Architecture

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces + Turborepo |
| Web app | Next.js (App Router): dashboard, API routes, webhook endpoints, OAuth callbacks |
| Worker | Separate Node process running BullMQ processors |
| Queue | BullMQ on Redis |
| Database | Postgres + pgvector (duplicate search) |
| ORM / migrations | Drizzle |
| Validation | zod (shared by API, forms and AI output) |
| Auth | Better Auth with organization plugin |
| AI | OpenAI behind a provider interface, with bring-your-own key |
| Billing | Merchant of record (Dodo Payments / Lemon Squeezy) behind a `billing` package; hosted mode only |
| Dates | chrono-node |
| Observability | pino logs, Sentry (free tier), bull-board (admin only) |
| Email | Mailpit locally (catches all mail); Resend (free tier) in production, needs the domain |
| Tests | Vitest (+ msw), Playwright, AI eval runner |
| Hosting | One server running Docker Compose: web, worker, Postgres, Redis, Caddy (HTTPS) |

Rationale: [decisions/0001](decisions/0001-typescript-stack.md), [0007](decisions/0007-hosting-single-vps.md).

## Hosted vs self-hosted

One codebase, switched by `APP_MODE=hosted|selfhost`.

| | Hosted | Self-hosted |
|---|---|---|
| Billing & plan limits | On | Off |
| OpenAI key | Ours (or the user's own) | Must use their own |
| Crisp plugin | Our published Marketplace plugin | They register their own Crisp plugin (development token) |
| Trello app key / Jira OAuth app | Ours | Their own (setup guide provided) |
| Sign-up | Open | First user becomes admin; sign-up can be disabled |

The amount of setup in the self-hosted column is the main reason teams pay for the hosted version.

## Repo layout

```
apps/
  web/                    Next.js
    app/(marketing)/                  landing, pricing, integrations, SEO guide pages, legal
    app/(auth)/                       sign in / sign up
    app/(dashboard)/automations/      list, setup wizard, detail, settings, activity
    app/(dashboard)/review/           review queue
    app/(dashboard)/connections/      connect / disconnect / health
    app/(dashboard)/billing/          plan, payment portal (hosted only)
    app/admin/                        simple platform-admin UI (plans, trial & platform settings, workspaces, AI spend)
    app/api/admin/                    platform-admin routes (2FA + email allowlist, audit-logged)
    app/api/webhooks/crisp/route.ts   single plugin-hook endpoint, routed by website_id
    app/api/webhooks/billing/route.ts
    app/api/oauth/{trello,jira}/callback/route.ts
    app/crisp/settings/               Crisp plugin settings page (links a Crisp website to a workspace)
  worker/                 BullMQ processors
    thread.evaluate · ticket.deliver · ticket.update · attachment.copy · crisp.reconcile
packages/
  db/                     Drizzle schema, migrations, pgvector
  connectors/             types.ts + crisp/ trello/ jira/
  ai/                     provider interface, OpenAI impl, prompts, rubric, schema, date resolver, evals
  billing/                merchant-of-record wrapper, plan limits
  crypto/                 credential encryption
  shared/                 types, logger, errors
deploy/
  docker-compose.yml      production / self-host stack
  Caddyfile
LICENSE                   AGPL-3.0
```

## Pipeline

```
Crisp ──plugin hook──▶ POST /api/webhooks/crisp
                         │ verify X-Crisp-Signature → route by website_id → connection(s)
                         │ insert source_events (dedupe key) → reply 200 fast
                         ▼
                   queue: thread.evaluate   (jobId = thread → one pending job per conversation)
                         │ quiet window (~180s, restarts on each new message); immediate on resolved
                         ▼
   Worker (per-thread lock)
     1. fetch full conversation + file refs from the Crisp REST API (the hook is only a trigger)
     2. load issues already linked to this thread
     3. pgvector: top-5 similar open issues in this automation (duplicate candidates)
     4. AI triage → strict JSON → zod validate
     5. plan actions: no_action | create | update(issueId) | duplicate_of(issueId)
           ▼
   queue: ticket.deliver / ticket.update, one job per (issue × destination), retried independently
     create card/issue · ensure labels · priority · due date · upload attachments · comments
           ▼
   save destination_tickets, ai_runs, activity_log

   crisp.reconcile (every ~10 min): list recently updated conversations and enqueue any whose
   last message we haven't processed. Crisp can drop events after repeated delivery failures.
```

### Why fetch the conversation instead of trusting the hook
Hooks can arrive twice or out of order, and Crisp may drop some after repeated failures. Re-fetching the current conversation means every evaluation sees the real latest state. The hook becomes a simple "something changed" signal, and the reconcile job catches anything missed.

## Thread lifecycle (conversation ↔ tickets)

- Each Crisp conversation (`session_id`) = one **thread**. A thread can link to **many issues**.
- Every evaluation gives the AI the full transcript (or a running summary plus recent messages), the issues already created from this thread, and possible duplicates.
- The AI may return several actions at once, e.g. update issue A and create issue B (a "side issue").
- **What an update does:**
  - Adds a comment: "Customer added: …" (plus new attachments).
  - Adjusts priority, due date or labels if the new information changes them.
  - Rewrites the description **only** if the remote ticket's `updatedAt` equals our stored `last_remote_updated_at` (no person has edited it).
- **Resolved in chat** after a ticket exists → comment "Possibly resolved in chat". Never delete.
- **Reopened** (state back to unresolved, or new messages) → evaluated again.
- **Long threads** → a `rolling_summary` on the thread keeps the input within the model's limit.

## Duplicate detection

1. Each issue stores an embedding of its title and summary (pgvector).
2. Each evaluation fetches the 5 nearest **open** issues in the same automation.
3. The AI confirms or rejects the match (embeddings alone give false matches).
4. On a confirmed duplicate:
   - comment on the existing ticket with the new report
   - `report_count++`, plus an `issue_reports` row
   - attach new files
   - add the customer's name only if `includeCustomerNames` is on
5. If the matching ticket is **closed** remotely (checked with `getTicketState`) → create a new ticket that references the old one (likely a regression).

## Fan-out to multiple destinations

- The `issues` row is the source of truth. Each destination gets its own `destination_tickets` row.
- Delivery is one job per destination. If Trello succeeds and Jira fails, only Jira is retried, and the dashboard shows status for each destination.
- No double-creates: before creating, check for an existing `destination_tickets` row for (issue, destination).

## Connector interfaces

Details in [integrations/adding-a-connector.md](integrations/adding-a-connector.md). Sources and destinations implement shared `SourceConnector` / `DestinationConnector` interfaces, so new tools plug in without touching the pipeline.

## Admin routes (hosted)

Plans, trial and platform settings live in the DB, not in code ([decisions/0009](decisions/0009-config-in-db-admin-routes.md)).

| Route | Purpose |
|---|---|
| `GET/PUT /api/admin/settings` | Trial (days, conversation cap, card required, unlimited with own key), AI budgets, sign-ups on/off |
| `GET/POST /api/admin/plans` · `PATCH /api/admin/plans/:id` | List / create a plan / new version (prices, limits, MoR price IDs, visibility, badge, order). Archive instead of delete |
| `GET /api/admin/workspaces` | Search workspaces; plan, usage, trial status |
| `POST /api/admin/workspaces/:id/extend-trial` · `/pause` · `/resume` | Support actions |
| `GET /api/admin/usage` | AI spend this month (platform, trials, by workspace) |
| `POST /api/admin/workspaces/:id/comp` · `DELETE …/comp` | Give or revoke a complimentary plan (N months or indefinite, with a reason) |
| `POST /api/admin/invite-codes` · `GET /api/admin/invite-codes` | Create single-use, email-bound, 7-day invite codes (stored hashed; shown once at creation) |
| `GET /api/admin/inbox` · `PATCH /api/admin/inbox/:id` | Own-support inbox: list/filter items, change status, add notes, approve testimonials ([own-support.md](own-support.md)) |

Our own support runs on the same pipeline: a platform automation on the `TriageFox Support` Crisp website with the internal `internal_inbox` destination ([own-support.md](own-support.md)).

Access: signed-in user whose email is in `PLATFORM_ADMIN_EMAILS`, with 2FA. Every write goes to `admin_audit_log`. Input is validated with zod; a plan can't be made public without MoR price IDs.

## UI

Product, landing and dashboard design: [ui-ux.md](ui-ux.md).

## Dashboard pages

- **Setup wizard:** connect Crisp (install plugin → link website) → pick destination(s) → connect → map (board/list, project/issue types/priorities) → settings → plan (hosted) → enable.
- **Automation detail:** settings toggles, health of each destination, pause/resume.
- **Activity log:** every decision with its reason, e.g. "Conversation with Jane → skipped: how-to question", "→ created KAN-42 + Trello card".
- **Review queue:** low-confidence candidates with Create / Dismiss.
- **Dry run:** run triage on the last 10 conversations without creating tickets.
- **Connections:** status, last checked, reconnect.
