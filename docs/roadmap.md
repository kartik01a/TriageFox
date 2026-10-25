# Roadmap

## MVP build phases

Each phase ends with something you can verify before moving on.

| # | Phase | Work | Done when |
|---|---|---|---|
| 0 | **API spike** | Confirm Featurebase webhook create-via-API, payloads, thread fetch, attachment auth; Trello authorize; Jira 3LO + createmeta. Open questions in [integrations/](integrations/). | Notes + real payload fixtures saved |
| 1 | **Foundation** | Monorepo, DB schema + migrations, Better Auth + orgs/invites, crypto package, CI, Sentry | Sign up, create workspace, invite member |
| 2 | **Connections** | Featurebase (verify key + register webhook), Trello (authorize + board/list picker), Jira (OAuth + project/types + required-field check) | All 3 connect; bad key = clear error; secrets never reach browser |
| 3 | **Ingest + queue** | Webhook route, signature check, idempotent event store, threads, debounce, per-thread lock, thread fetch | Same webhook ×3 → 1 evaluation; 5 rapid messages → 1 evaluation |
| 4 | **AI triage** | Schema, prompt + rubric, rules, vision, date resolver, eval harness + golden set | Eval targets met |
| 5 | **Ticket creation** | Trello + Jira destinations, labels, priority mapping, markdown→ADF, attachments, fan-out, idempotency | Real chat → Trello card **and** Jira issue, complete |
| 6 | **Updates + duplicates** | Linked updates/comments, human-edit check, embeddings, duplicate merge, toggles | Follow-up updates ticket; 2nd customer → comment |
| 7 | **Dashboard** | Setup wizard, settings, activity log, review queue, dry run, connection health | New user sets up without help |
| 8 | **Billing** | Stripe products, Checkout, Portal, webhooks, gating, usage limits | Can't enable without paying; cancel pauses |
| 9 | **Hardening** | Rate limiting, backoff, revoked-token handling, alerts, landing page, docs, privacy policy | Revoking Trello mid-run → clean pause, no lost events |

## Future updates

Not in v1. Add new ideas here.

- **Two-way sync** — ticket marked done → update Featurebase post status and/or notify the customer.
- **Routing rules** — e.g. bugs → Jira, features → Trello; filters by type/priority.
- **More destinations** — Linear, GitHub Issues, ClickUp, Asana, Notion, GitLab, Monday, Azure DevOps, Shortcut.
- **More sources** — Intercom, Crisp, Canny, Zendesk, email inbox, Slack channel, Typeform / Google Forms, GitHub Discussions.
- **Notifications** — Slack / Discord alert for P5 (Critical) tickets; email digest.
- **Priority auto-bump** from upvotes or duplicate report count.
- **Custom AI instructions** per workspace ("our checkout is critical", glossary of product areas).
- **Bring your own AI key**; DeepSeek as a cheaper text-only option.
- **Jira Server / Data Center** support.
- **Analytics** — top bugs, volume by type, time-to-ticket.
- **Backfill** historical conversations on enable.
- **Duplicate search across the whole destination backlog**, not just tickets we created.

## Business track

- Market & competitor analysis; decide open-source vs SaaS vs open-core; pricing. → future doc `docs/private/<date>-business-analysis.md` (not pushed).
