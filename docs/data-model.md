# Data Model

Postgres + pgvector, managed with Drizzle migrations. All tenant data is scoped by `org_id`; every query must filter by it.

## Entity overview

```
organizations ─┬─ memberships ── users
               ├─ subscriptions
               ├─ connections ─────────────┐
               └─ automations ─┬─ automation_destinations ── connections
                               ├─ threads ─┬─ issues ─┬─ destination_tickets
                               │           │          └─ issue_reports
                               │           └─ ai_runs
                               └─ activity_log
source_events (raw webhooks, per connection)
```

## Tables

### Tenancy
| Table | Key columns |
|---|---|
| `organizations` | id, name, timezone, created_at |
| `users` | id, email, name (managed by Better Auth) |
| `memberships` | org_id, user_id, role (`owner` \| `admin` \| `member`) |

### Billing
| Table | Key columns |
|---|---|
| `subscriptions` | org_id, stripe_customer_id, stripe_subscription_id, plan, status, current_period_end |
| `usage_counters` | org_id, period_start, tickets_created, ai_runs, ai_cost_usd |

### Connections
| Table | Key columns |
|---|---|
| `connections` | id, org_id, provider (`featurebase` \| `trello` \| `jira`), auth_type (`api_key` \| `oauth` \| `token`), credentials_encrypted (bytea), metadata jsonb (e.g. Jira cloud_id, site URL; Featurebase webhook id + signing secret ref), status (`active` \| `error` \| `revoked`), last_verified_at |

### Automations
| Table | Key columns |
|---|---|
| `automations` | id, org_id, source_connection_id, name, enabled, settings jsonb |
| `automation_destinations` | id, automation_id, connection_id, config jsonb |

`automations.settings`:
```json
{
  "includeSourceLink": false,
  "includeCustomerNames": false,
  "sources": { "conversations": true, "posts": true },
  "minConfidence": 0.7,
  "quietWindowSec": 180,
  "timezone": "UTC",
  "language": "en"
}
```

`automation_destinations.config`:
- Trello: `{ boardId, listId, labelIds: { types: {...}, priorities: {...} } }`
- Jira: `{ cloudId, projectKey, issueTypeMap: { bug, feature, ... }, priorityMap: { "5": id, ... }, extraLabels: ["featurebase"] }`

### Ingestion & triage
| Table | Key columns |
|---|---|
| `source_events` | id, connection_id, provider_event_id **UNIQUE**, topic, payload jsonb, status (`received` \| `processed` \| `ignored` \| `failed`), received_at |
| `threads` | id, automation_id, source_type (`conversation` \| `post`), source_id (**UNIQUE per automation**), state (`open` \| `closed`), last_processed_message_id, rolling_summary, updated_at |
| `issues` | id, automation_id, origin_thread_id, title, body_md, type, priority (1–5), due_date, due_date_quote, confidence, embedding vector(1536), report_count, status (`active` \| `pending_review` \| `dismissed`), created_at |
| `issue_reports` | issue_id, thread_id, customer_ref, reported_at |
| `destination_tickets` | id, issue_id, automation_destination_id, external_id, external_key, url, last_pushed_at, last_remote_updated_at, status (`ok` \| `failed` \| `broken`) — **UNIQUE (issue_id, automation_destination_id)** |
| `ai_runs` | id, thread_id, model, input_tokens, output_tokens, cost_usd, decision jsonb, raw_output jsonb, created_at |
| `activity_log` | id, org_id, automation_id, kind, message, refs jsonb, created_at |

## Constraints that enforce correctness

- `source_events.provider_event_id` UNIQUE → duplicate webhooks are no-ops.
- `threads (automation_id, source_type, source_id)` UNIQUE → one thread per conversation per automation.
- `destination_tickets (issue_id, automation_destination_id)` UNIQUE → a ticket can never be created twice in the same destination.
- HNSW index on `issues.embedding` filtered by `automation_id` and `status = 'active'`.

## Retention

- `source_events`: 30 days (7 days minimum while a connection is paused, for replay).
- `ai_runs.raw_output`: 90 days (debugging), then null the payload, keep the counters.
