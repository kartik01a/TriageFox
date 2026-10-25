# Architecture

## Stack

| Layer | Choice |
|---|---|
| Language | TypeScript everywhere |
| Monorepo | pnpm workspaces + Turborepo |
| Web app | Next.js (App Router) — dashboard, API routes, webhook endpoints, OAuth callbacks |
| Worker | Separate Node process running BullMQ processors |
| Queue | BullMQ on Redis |
| Database | Postgres + pgvector (duplicate search) |
| ORM / migrations | Drizzle |
| Validation | zod (shared by API, forms, and AI output) |
| Auth | Better Auth with organization plugin |
| AI | OpenAI behind a provider interface |
| Billing | Stripe behind a `billing` package |
| Dates | chrono-node |
| Observability | pino logs, Sentry, bull-board (admin only) |
| Hosting (initial) | Railway — web, worker, Postgres, Redis in one project |

Rationale: [decisions/0001-typescript-stack.md](decisions/0001-typescript-stack.md).

## Repo layout

```
apps/
  web/                    Next.js
    app/(auth)/                       sign in / sign up
    app/(dashboard)/automations/      list, setup wizard, detail, settings, activity
    app/(dashboard)/review/           review queue
    app/(dashboard)/connections/      connect / disconnect / health
    app/(dashboard)/billing/          plan, Stripe portal
    app/api/webhooks/featurebase/[connectionId]/route.ts
    app/api/webhooks/stripe/route.ts
    app/api/oauth/{trello,jira}/callback/route.ts
  worker/                 BullMQ processors
    thread.evaluate · ticket.deliver · ticket.update · attachment.copy
packages/
  db/                     Drizzle schema, migrations, pgvector
  connectors/             types.ts + featurebase/ trello/ jira/
  ai/                     provider interface, OpenAI impl, prompts, rubric, schema, date resolver, evals
  billing/                Stripe wrapper, plan limits
  crypto/                 credential encryption
  shared/                 types, logger, errors
```

## Pipeline

```
Featurebase ──webhook──▶ POST /api/webhooks/featurebase/:connectionId
                           │ verify signature → insert source_events (dedupe on provider event id) → 200 fast
                           ▼
                     queue: thread.evaluate   (jobId = thread → one pending job per conversation)
                           │ quiet window (~180s, resets on each new message); immediate on close
                           ▼
   Worker (per-thread lock)
     1. fetch full thread + attachment refs from Featurebase API (payload is only a trigger)
     2. load issues already linked to this thread
     3. pgvector: top-5 similar open issues in this automation (duplicate candidates)
     4. AI triage → strict JSON → zod validate
     5. plan actions: no_action | create | update(issueId) | duplicate_of(issueId)
           ▼
   queue: ticket.deliver / ticket.update — one job per (issue × destination), independent retries
     create card/issue · ensure labels · priority · due date · upload attachments · comments
           ▼
   persist destination_tickets, ai_runs, activity_log
```

### Why fetch the thread instead of trusting the webhook
Webhooks can arrive duplicated or out of order. Re-fetching the current conversation means every evaluation sees the true latest state, and the webhook becomes a simple "something changed" signal.

## Thread lifecycle (conversation ↔ tickets)

- Each Featurebase conversation or post = one **thread**. A thread can link to **many issues**.
- Every evaluation gives the AI: full transcript (or rolling summary + recent messages), the issues already created from this thread, and duplicate candidates.
- AI may return several actions in one go, e.g. update issue A + create issue B (a "side issue").
- **Update behaviour:**
  - Add a comment: "Customer added: …" (+ new attachments).
  - Adjust priority / due date / labels if new info changes them.
  - Rewrite description **only** if the remote ticket's `updatedAt` equals our stored `last_remote_updated_at` (i.e. no human edited it).
- **Resolved in chat** after a ticket exists → comment "Possibly resolved in chat". Never auto-delete.
- **Reopened** conversation → evaluated again like any new message.
- **Long threads** → keep a `rolling_summary` on the thread to stay within model context.

## Duplicate detection

1. Each issue stores an embedding of title + summary (pgvector).
2. On evaluation, fetch the top-5 nearest **open** issues in the same automation.
3. The AI confirms or rejects the match (embeddings alone produce false positives).
4. On confirmed duplicate:
   - comment on the existing ticket with the new report
   - `report_count++`, insert `issue_reports` row
   - attach new files
   - add customer name only if `includeCustomerNames` is on
5. If the matching ticket is **closed** remotely (checked via `getTicketState`) → create a new ticket that references the old one (likely regression).

## Fan-out to multiple destinations

- Canonical `issues` row is the source of truth; each destination gets a `destination_tickets` row.
- Delivery is one job per destination. Trello succeeding while Jira fails is fine — Jira retries alone; dashboard shows per-destination status.
- Idempotency: before creating, check for an existing `destination_tickets` row for (issue, destination).

## Connector interfaces

Detail in [integrations/adding-a-connector.md](integrations/adding-a-connector.md).

```ts
interface SourceConnector {
  verifyCredentials(); registerWebhook(); verifySignature(req);
  parseEvent(payload): NormalizedEvent;
  fetchThread(sourceId): Thread;
  fetchAttachment(ref): ReadableStream;
}
interface DestinationConnector {
  verifyCredentials(); listTargets(); ensureSetup(config);
  createTicket(issue, config): ExternalRef;
  updateTicket(ref, patch); addComment(ref, markdown);
  uploadAttachment(ref, stream, meta);
  getTicketState(ref);
}
```

## Dashboard surfaces

- **Setup wizard:** pick source → connect → pick destination(s) → connect → map (board/list, project/issue types/priorities) → settings → pay → enable.
- **Automation detail:** settings toggles, per-destination health, pause/resume.
- **Activity log:** every decision with its reason, e.g. "Conversation #123 → skipped: how-to question", "→ created KAN-42 + Trello card".
- **Review queue:** low-confidence candidates with Create / Dismiss.
- **Dry run:** run triage on the last 10 conversations without creating tickets.
- **Connections:** status, last verified, reconnect.
