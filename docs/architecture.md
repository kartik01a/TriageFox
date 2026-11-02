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

### As built in Phase 3

- **`packages/pipeline`** holds what both the web app and the worker need: queue names and payload schemas, `handleCrispHook` (record + schedule), `scheduleEvaluation` (debounce), `findCrispRoutes`, and `withLock`.
- **Hook route** `POST /api/webhooks/crisp` (web): reject bodies over 256 KB → verify `X-Crisp-Signature` + `X-Crisp-Request-Timestamp` (HMAC, ±5 min, milliseconds) → parse → `handleCrispHook`. Every verification failure returns the same bare `401`. A signed hook we don't understand, or for an unlinked website, gets `200` (nothing to retry). Only real faults (database, Redis) return `500` so Crisp retries.
- **`handleCrispHook`**: classify (visitor message / operator message / resolved / reopened / ignored) → look up routes → in **one transaction** insert the `source_events` row (unique `dedupe_key`: a duplicate stops here) and upsert/update the thread → schedule after commit. If scheduling fails the event row is deleted again, so Crisp's retry is not mistaken for a duplicate.
  - Visitor message: creates the thread the first time, sets `last_event_at`, schedules after the quiet window.
  - Operator message: stored as `ignored` (context only), schedules nothing.
  - Resolved: schedules immediately (delay 0). Reopened: normal quiet window. State changes for conversations we don't follow do nothing.
- **Debounce** (`scheduleEvaluation`): one BullMQ job per thread (`evaluate_<threadId>`). No job → create with the delay; job waiting out its delay → push it back (`changeDelay`) or run now (`promote`) for "resolved"; job already running → nothing.
- **`thread.evaluate`** (worker): load thread/automation/connection (skip if inactive) → **Redis lock per thread** (renewed while held, 120 s ttl) → fetch the full conversation from Crisp (all message pages) → if nothing new since `last_processed_message_id` and state, record and stop → call the **triage seam** (Phase 4 plugs the AI in here) → save the position → if `last_event_at` is newer than the run's start, `moveToDelayed` itself by the quiet window so nothing is lost. Auth failure from Crisp marks the connection `revoked` (not retried); a vanished conversation records `last_error`; outages/rate limits retry with exponential backoff (5 attempts); a job that exhausts its retries leaves `last_error` on the thread.
- **`crisp.reconcile`** (every 10 min): for each active Crisp connection with an enabled automation, list conversations newest first (≤10 pages, look-back `RECONCILE_LOOKBACK_MIN`, default 180), and for each whose `updated_at` is newer than the thread's `source_updated_at` (or has no thread) create the thread and schedule an evaluation **without** postponing one that is already waiting. Idempotent.
- **`maintenance.cleanup`** (daily): deletes hook records past retention.
- **Known small gap:** a hook that lands in the instant between a running evaluation's final check and its completion is not re-scheduled by the hook (the job is still "active"); the reconcile job picks it up within ~10 minutes.

### As built in Phase 5

- After the AI step, the worker saves the run, **issues** and activity in one transaction, and queues deliveries afterwards (so a job never starts before its issue exists). A `create` action becomes an `issues` row with the finished ticket body (`buildTicketBody`: the template in `docs/ai-triage.md`). `update` / `duplicate_of` actions are applied by Phase 6 (below).
- Tickets below the automation's `minConfidence` are saved as `pending_review` and **not sent**; the review queue UI arrives in Phase 7.
- The AI is shown the issues already created from the same conversation, so a re-evaluation does not create the ticket again.
- **`ticket.deliver`** (one job per issue x destination, job id `deliver_<issue>_<destination>`): claims the unique `destination_tickets (issue, destination)` row, creates the card/issue, saves the external id **before** attachments or priority edits, so a retry can never create a second ticket. Per-destination errors do not affect the other destination. Only the final failed attempt marks the ticket `failed`.
- Known small window: a crash in the instant after the remote create but before the row is saved can produce one duplicate on retry (neither tool offers idempotency keys).
- Destinations (`automation_destinations`) are created by the Phase 7 wizard; until then `pnpm db:dev-automation <orgId>` creates an enabled automation and copies each connected Trello/Jira target from `connections.metadata.defaults`.

### As built in Phase 6

- **Applying the AI's other actions** (`apply.ts`, one transaction with the run, issues and reports):
  - `update` (a ticket of *this* conversation): new priority / due date are saved on the issue and the footer lines refreshed; a sealed `issue_updates` row (kind `update`) carries the new information. `resolvedInChat` makes it kind `resolved_in_chat` (a comment only, nothing else changes).
  - `duplicate_of` (a candidate from another conversation): one `issue_reports` row per conversation (unique: seeing the same duplicate again changes nothing), `report_count + 1`, footer "Reported by N customers" (or the names, only when `includeCustomerNames` is on and every report has one), and a sealed `issue_updates` row (kind `duplicate`) with the new files.
  - A ticket still `pending_review` is changed in our database only; nothing exists in the trackers yet.
- **`ticket.update`** (one job per update x destination, up to 8 attempts): waits (retries) while the ticket is still being created; then adds the comment first and marks the destination as done (`issue_updates.applied_to`) before any extras, so a retry never comments twice. Extras, each best effort and logged: priority (Trello: swap the priority label; Jira: edit), due date, new files (same 10 MB / Crisp-host rules as delivery), and the description footer.
- **Human-edit check:** the description footer is rewritten only if nobody but us changed the description since our last write (Trello: `updateCard:desc` actions by another member; Jira: changelog entries by another account). If the check fails or someone edited, the description is left alone and the activity log says so. Comments, labels and priority are not gated.
- **Duplicate of a closed ticket:** if the matching Trello card is archived / due-complete, or the Jira issue is in a Done status category, nothing is added to it. A new issue "<title> (again)" is created that says "Possible regression: <old link>", and delivered to that destination only.
- **Embeddings:** every new issue gets an embedding of title + summary right after commit (best effort; failure only means it cannot be matched yet). Stored in `issues.embedding` (pgvector, HNSW cosine index).

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

## Web ↔ worker request channel (Phase 2)

The web app never holds decrypted credentials. When it needs something only a customer's token can provide (listing Trello boards, Jira projects, verifying a connection, token refresh, revoking on disconnect, verifying a Crisp website token), it sends a typed request through BullMQ (`packages/rpc`, queue `rpc`) and waits for the answer. No extra network port is opened; Redis is internal and password protected.
- Every method has a zod **input** and **output** schema (`packages/rpc/src/protocol.ts`). The worker parses results through the output schema, **stripping unknown fields**, so a token can never leak back to the web app by accident.
- Job data contains ids only. Secrets (a pasted Trello token, the Jira one-time code) are **sealed with the public key before they are stored**, and the worker opens them from the database.
- The worker re-checks the workspace on every call: a connection is loaded inside `withOrg(orgId)`, so another workspace's id is simply "not found".
- Errors are typed (`auth_expired`, `not_found`, `rate_limited`, `unavailable`, `invalid`, `not_configured`, `forbidden`, `internal`) with customer-safe messages; unexpected errors are logged in the worker and hidden from the caller.

### As built in Phase 7

- **Pages** (all server-rendered, dynamic): `/app` overview, `/app/setup`, `/app/automation`, `/app/activity`, `/app/review`, `/app/settings/security` (plus the earlier connections, members, AI key). `/two-factor` completes a 2FA sign-in.
- **API routes** (owner/admin, same-origin): `POST /api/automation` (create the paused automation on the Crisp connection and pick up connected destinations), `PATCH /api/automation/:id` (settings, on/off; switching on is refused with a plain reason unless Crisp is active and at least one enabled destination has an active connection), `PATCH /api/automation/:id/destinations/:destId`, `POST /api/automation/:id/dry-run`, `POST /api/review/:id` (create / dismiss; the row is locked and must still be `pending_review`), `POST /api/tickets/:id/retry`, `PUT /api/security/require-2fa`. `GET /api/activity/:aiRunId` is open to any member.
- **Destinations stay in step with targets:** saving a connection's board/project (`PUT /api/connections/:id/targets`) calls `syncDestinations`, which creates or updates the automation's destination from `connections.metadata.defaults` (keeping its label ids and on/off flag unless the target changed).
- **Worker RPC added:** `ai.explain` (opens a sealed AI output, returns reason / priority reason only) and `automation.dryRun` (reads the newest 10 Crisp chats, runs the same AI step with no existing tickets, returns what it would do; 3 runs per workspace per hour; nothing is stored, no `ai_runs` row, so its few cents are not metered).
- **Two-factor and step-up:** `workspace_settings.require_2fa`; `requireWorkspace` redirects members without 2FA to the security page and `managerGuard` answers `two_factor_required`. Sensitive actions (replace/remove the AI key, disconnect a tool, change the 2FA rule) need a sign-in from the last 15 minutes (`step_up_required`); the browser then asks for the password (and a code if 2FA is on) via a dialog and retries once. People who sign in only with Google are told to sign in again.

### As built in Phase 8 (self-host package)

- **Images:** one `deploy/Dockerfile` with two targets. `web` is the Next.js standalone server (`output: "standalone"`). `worker` is a tsup bundle (workspace packages bundled in, third-party packages installed with `pnpm deploy --prod`); it also holds `dist/migrate.js` (runs the SQL migrations from `MIGRATIONS_DIR`) and `dist/keys.js` (prints freshly generated secrets for `setup.sh`).
- **Stack** (`deploy/docker-compose.yml`): `caddy` (HTTPS, reverse proxy, 5 MB body limit) → `web`; `worker`; `postgres` (pgvector, the same init script creates the restricted runtime role); `redis` (password, AOF); a one-shot `migrate` service using only the owner password, which `web` and `worker` wait for. Optional `mailpit` under `--profile trial`. Networks: `backend` (internal, no internet) for Postgres/Redis, `edge` for Caddy↔web, `egress` for the worker's outbound calls.
- **`APP_MODE=selfhost`:** the home page redirects to sign-in (no marketing site or waitlist); the first account may sign up, then sign-up is invitation-only unless `SELFHOST_OPEN_SIGNUP=true`; billing arrives in Phase 9 and will be off in this mode. At start-up the worker logs which providers are configured and what is missing (`describeProviders`), never a secret value.
- **Operations:** `deploy/backup.sh` / `restore.sh` (optional passphrase encryption), `GET /api/health` (checks the database) for health checks. Guide: [self-hosting.md](self-hosting.md).

### As built in Phase 9 (billing and admin, hosted only)

- **Admin:** `/admin/*` pages and `/api/admin/*` routes. Access = hosted mode + an email in `PLATFORM_ADMIN_EMAILS` + two-factor sign-in; everyone else gets a plain 404 (pages and API). Writes are same-origin only and every change goes to `admin_audit_log` with before and after. Routes: `settings` (GET, PUT one key validated by its own schema), `plans` (GET, POST) and `plans/:id` (PATCH: new version when a price or limit changes), `workspaces` (GET search) and `workspaces/:id` (POST action: extend-trial, pause, resume, comp, revoke-comp), `invite-codes` (GET, POST), `usage` (GET), `inbox` (GET) and `inbox/:id` (PATCH), `support-automation` (POST). The UI is deliberately plain.
- **Cross-workspace reads without a bypass role:** admin actions on one workspace run through `withOrg(thatOrg)`; totals across workspaces come from narrow `SECURITY DEFINER` functions (`platform_ai_micro_usd`, `platform_trial_ai_micro_usd`, `admin_top_usage`, `billing_org_for_subscription`, `billing_due_reminders`, `billing_ending_trials`) that return numbers or ids only.
- **Worker:** limit check + usage counting inside the triage step (`apps/worker/src/billing.ts`), the notifier (owner emails, urgent alerts: `notify.ts`), the daily reminders job (`reminders.ts`) and the support recorder (`pipeline/support.ts`). The shared SMTP sender lives in `packages/mail`.

### As built in Phase 10 (hardening and launch)

- **Rate limits** (`apps/web/src/lib/limits.ts`): a Redis fixed-window counter shared by all web processes. 300 changes per minute per workspace (inside `managerGuard`, so every owner/admin route has it), 120 per minute per admin, 120 per minute for "why" lookups, per-address caps on the two public hook endpoints (Crisp 6,000, billing 600). Redis down means "allow", never an outage. Auth, the AI-key check, invite codes and the Crisp link page keep their own tighter limits.
- **Backoff:** deliveries, updates and evaluations retry with BullMQ's custom strategy (`retryDelayMs`): 15 s, 30 s, 60 s… capped at 15 minutes, or exactly the provider's `Retry-After` (plus half a second, capped at an hour) when it sent one.
- **Revoked tools:** when a connection first turns `revoked` (a 401/403 from Trello or Jira, a dropped Crisp subscription) the worker's `updateConnection` calls `onRevoked`, which emails the workspace owners once (what happened, what to do). Tickets already created stay; ones that did not arrive stay `failed`, and *Try again* / *Try all again* (`POST /api/tickets/retry-all`) sends them after reconnecting. Nothing is lost and nothing is created twice.
- **Alerts to the operator:** a job that runs out of retries and a rejected platform OpenAI key send an email (`ALERT_EMAIL`) and a Slack message (`SLACK_ALERTS_WEBHOOK_URL`), deduplicated per kind (Redis `SET NX EX`). The worker now has the SMTP settings in both modes.
- **Public site:** the landing page (all twelve sections of `docs/ui-ux.md`, animated with Motion and reduced-motion safe), `/pricing`, `/security`, `/legal/privacy`, `/legal/terms`, `/legal/subprocessors`, `/integrations` and two guide pages with FAQ structured data, `sitemap.xml`, `robots.txt`, a favicon and a share image. Operator name and contact live in `apps/web/src/lib/site.ts`. Trial length is read from the settings everywhere. The waitlist is gone.
- **Releases:** pushing a `v*` tag builds web and worker on native amd64 and arm64 runners and publishes multi-architecture images to GitHub's registry (`.github/workflows/release.yml`); `WEB_IMAGE` / `WORKER_IMAGE` / `TRIAGEFOX_PULL` select them in Compose.
- **Supply chain:** `pnpm audit --prod --audit-level high` runs in CI; the three moderate build-tool advisories found are fixed with pinned overrides in `pnpm-workspace.yaml`.

### After launch testing (owner's end-to-end test)

- **Attachments:** every file the customer sends (screenshots, documents, voice messages, videos) goes on the ticket (`apps/worker/src/pipeline/files.ts`, requirements §13). The AI's `relevantAttachmentIds` only decides which ticket a file goes on when a chat yields several tickets; unmatched files go on all of them; a new ticket skips files already on another ticket from the same chat; follow-ups and duplicates carry only files sent since the last analysis. Unnamed Crisp files get a readable name with an extension (`voice-message-2026-11-02-0905.webm`).
- **Label choice (ADR 0013):** `GET/POST/PUT /api/connections/[id]/labels` lists, creates (Trello) and saves the customer's labels via the worker (`trello.listLabels`, `trello.createLabel`, `jira.listLabels`). Saved in `defaults.labels` (Trello: label id or null per level and type) or `defaults.typeLabels` (Jira), copied into `automation_destinations.config` as `labelMap` / `typeLabels`. The worker's `ensureTrelloLabels` uses the choice, falls back to the default labels, and skips a chosen label that has left the board.
- **Voice messages (ADR 0014):** `apps/worker/src/pipeline/voice.ts` downloads the newest 3 customer voice messages (≤ 5 min, ≤ 25 MB, Crisp storage only) and transcribes them with `AI_MODEL_TRANSCRIBE` (default `gpt-transcribe`) through `AiProvider.transcribe`. `toAiMessages` gives the AI the text as "(voice message, transcribed) …"; the cost is added to the run. Nothing is stored; failures are logged as `voice_not_transcribed` and the analysis continues.
- **Linking Crisp before the plugin is activated:** `pnpm --filter @triagefox/worker dev:crisp-link` (development only) prints the page address Crisp's widget would open, using the development token.

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
