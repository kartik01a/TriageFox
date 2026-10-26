# Data Model

Postgres + pgvector, managed with Drizzle migrations. All tenant data is scoped by `org_id`, and every query must filter by it.

## Entity overview

```
organizations ─┬─ memberships ── users
               ├─ subscriptions            (hosted only)
               ├─ ai_settings              (bring-your-own key)
               ├─ connections ─────────────┐
               └─ automations ─┬─ automation_destinations ── connections
                               ├─ threads ─┬─ issues ─┬─ destination_tickets
                               │           │          └─ issue_reports
                               │           └─ ai_runs
                               └─ activity_log
source_events (raw hooks, per connection)
```

## Tables

### Tenancy
| Table | Key columns |
|---|---|
| `organizations` | id, name, timezone, created_at |
| `users` | id, email, name (managed by Better Auth) |
| `memberships` | org_id, user_id, role (`owner` \| `admin` \| `member`) |

### Billing (hosted mode)
| Table | Key columns |
|---|---|
| `subscriptions` | org_id, provider (`dodo` \| `lemonsqueezy`), provider_customer_id, provider_subscription_id, plan_id, plan_version, interval (`monthly` \| `yearly`), status (`trialing` \| `active` \| `past_due` \| `canceled` \| `comped`), trial_ends_at, current_period_end |
| `usage_counters` | org_id, period_start, conversations_analysed, tickets_created, ai_runs, ai_cost_usd, trial_ai_cost_usd |

### Platform configuration (hosted mode, edited via admin routes; see [decisions/0009](decisions/0009-config-in-db-admin-routes.md))
| Table | Key columns |
|---|---|
| `plans` | id, slug, version, name, prices jsonb (minor units per currency: `{ USD: { monthly: 900, yearly: 9000 }, INR: { monthly: 69900, yearly: 699000 } }`), conversation_limit (null = unlimited), fair_use_cap, inbox_limit (null = unlimited), byok_required, support_level, provider_price_ids jsonb (`{ dodo: { USD: { monthly, yearly }, INR: { monthly, yearly } } }`), is_public, is_active, is_popular, sort_order, created_at. **UNIQUE (slug, version)** |
| `platform_settings` | key (PK), value jsonb, updated_by, updated_at. Keys: `trial` `{ days, conversationCap, cardRequired, unlimitedWithOwnKey }`, `budgets` `{ trialAiUsdMonthly, platformAiUsdMonthly }`, `signupEnabled` |
| `admin_audit_log` | id, admin_email, action, target, before jsonb, after jsonb, created_at |

| `comp_grants` | id, org_id, plan_id, starts_at, ends_at (null = indefinite), reason, granted_by, revoked_at |
| `invite_codes` | id, code_hash (**hashed, never stored plain**), email, plan_id, comp_months, expires_at, redeemed_by_org, redeemed_at, created_by |

`platform_settings` also holds `reminders` `{ monthlyDaysBefore: 3, yearlyDaysBefore: 7 }`.

Seed data inserts the launch plans and settings, so a fresh install works immediately.

### Own support (platform only, see [own-support.md](own-support.md))
| Table | Key columns |
|---|---|
| `support_items` | id, thread_id, category (`bug` \| `feature` \| `billing` \| `refund_request` \| `account` \| `complaint` \| `question` \| `praise`), priority, title, summary, customer_email, identity_verified, matched_user_id, matched_org_id, status (`new` \| `in_progress` \| `done`), notes jsonb, testimonial_approved, crisp_url, created_at, updated_at |

`connections.provider` also allows `internal_inbox` (platform automation only). `platform_settings` also holds `supportInbox` `{ capturedCategories, alertCategories, alertPriorityMin: 4, unansweredAfterHours: 4 }`.

### Security
| Table | Key columns |
|---|---|
| `audit_log` | id, org_id, actor_user_id, action, target, metadata jsonb, ip, created_at |
| `secrets` metadata on each encrypted column | key_version, sealed blob (sealed box containing the value + `org_id` + `connection_id`) |

**Not stored anywhere:** chat transcripts, attachments, card details.

### AI settings
| Table | Key columns |
|---|---|
| `ai_settings` | org_id, provider (`openai`), api_key_encrypted (nullable; null = use platform key, hosted only), key_verified_at. **No model fields**: models are server config only |

### Connections (built in Phase 2)
| Table | Key columns |
|---|---|
| `connections` | id (uuid), org_id, provider (`crisp` \| `trello` \| `jira`, check constraint), auth_type (`plugin_install` \| `oauth` \| `token`), **credentials_sealed** (text, sealed box `v1:…`, null for Crisp; write-only for the web app), metadata jsonb, status (`pending` \| `active` \| `error` \| `revoked`, check constraint), status_detail, last_verified_at, created_by, created_at, updated_at. **RLS on org_id.** |
| `ai_settings` | org_id (PK), provider, key_sealed, key_hint (`sk-…1234`), key_verified_at, updated_by, updated_at. **RLS.** No model fields. |
| `crisp_link_tickets` | id, ticket_hash (UNIQUE, sha256), website_id, website_name, expires_at (15 min), used_at, created_at. Not tenant data (no workspace yet); only accessed by server code. |

Sealed credential shapes (opened only by the worker, binding = org id + connection id + `connection.credentials`): Trello `{ token }`; Jira pending `{ code }`, active `{ accessToken, refreshToken, expiresAt }`; Crisp none. The OpenAI key is sealed with binding org id + org id + `ai.key`.

`metadata` by provider:
- Crisp: `{ websiteId, websiteName }`. **Unique index** `connections_crisp_website_unique` on `metadata->>'websiteId'` where provider = crisp: a website links to one workspace across all workspaces.
- Trello: `{ memberId, username, fullName, defaults?: { boardId, boardName, listId, listName } }`
- Jira: `{ sites: [{id,name,url}], cloudId, siteName, siteUrl, defaults?: { cloudId, projectKey, projectName, issueTypeMap, priorityMap, setupOk } }`

`defaults` are the per-connection chosen targets (set in Phase 2). In Phase 7 the setup wizard copies them into `automation_destinations.config`, which can then override per automation.

### Automations (table built in Phase 3; setup UI in Phase 7)
| Table | Key columns |
|---|---|
| `automations` | id, org_id, source_connection_id (FK → connections, **ON DELETE CASCADE**), name, enabled (default false), settings jsonb. **RLS.** |
| `automation_destinations` (Phase 5) | id, org_id, automation_id (FK, cascade), connection_id (FK, cascade), config jsonb (tagged `kind: trello \| jira`), enabled, created_at. UNIQUE (automation_id, connection_id). **RLS.** |

Deleting a source connection deletes its automations and, through them, their threads and events. Phase 7 puts a clear warning in front of that.

`automations.settings` (defaults in `defaultAutomationSettings`):
```json
{
  "includeSourceLink": false,
  "includeCustomerNames": false,
  "minConfidence": 0.7,
  "quietWindowSec": 180,
  "timezone": "UTC",
  "language": "en"
}
```

`automation_destinations.config`:
- Trello: `{ boardId, listId, labelIds: { types: {...}, priorities: {...} } }`
- Jira: `{ projectKey, issueTypeMap: { bug, feature, ... }, priorityMap: { "5": id, ... }, extraLabels: ["from-chat"] }`

### Ingestion & triage
| Table | Key columns |
|---|---|
| `source_events` (Phase 3) | id, org_id, connection_id (FK, cascade), dedupe_key **UNIQUE**, topic, meta jsonb (**IDs only**: websiteId, sessionId, event, fingerprint, state, messageType, from, timestamp; no message content), status (`received` \| `ignored`, check constraint), received_at. **RLS.** |
| `threads` (Phase 3) | id, org_id, automation_id (FK, cascade), source_type (`conversation`), source_id (Crisp `session_id`), state (`open` \| `resolved`), last_event_at, **last_processed_message_id** (a message fingerprint: our position, never the text), last_evaluated_state, last_evaluated_at, source_updated_at (the conversation's own `updated_at` at our last fetch; reconcile compares against it), evaluation_count, last_error, rolling_summary (**encrypted**, Phase 4), created_at, updated_at. **UNIQUE (automation_id, source_type, source_id).** **RLS.** |
| `issues` (Phase 5) | id, org_id, automation_id, origin_thread_id (FK, cascade), ai_run_id, title, summary, body_md (the finished ticket text), type, priority (1–5, check), due_date, due_date_quote, confidence, report_count, attachment_ids jsonb (Crisp message ids only; files are fetched at delivery), status (`active` \| `pending_review` \| `dismissed`), created_at. `embedding vector(1536)` (Phase 6, HNSW cosine index; null until computed). **RLS.** Tickets are the product's output and are stored in plain columns, unlike `ai_runs`/`activity_log`. |
| `issue_reports` | issue_id, thread_id, customer_ref, reported_at |
| `issue_reports` (Phase 6) | id, org_id, issue_id (FK, cascade), thread_id (FK, cascade), customer_ref (a name, stored only when the automation allows names), reported_at. **UNIQUE (issue_id, thread_id)**: one report per conversation. **RLS.** |
| `issue_updates` (Phase 6) | id, org_id, issue_id (FK, cascade), thread_id (FK, cascade), kind (`update` \| `duplicate` \| `resolved_in_chat`), content_sealed (**sealed**, binding `issue_update.content`), attachment_ids (Crisp message ids), new_priority, new_due_date, customer_ref, applied_to (destination ids already told), created_at. **RLS.** |
| `destination_tickets` (Phase 5) | id, org_id, issue_id (FK, cascade), automation_destination_id (FK, cascade), external_id, external_key, url, last_error, last_pushed_at, last_remote_updated_at, status (`pending` \| `ok` \| `failed` \| `broken`), **UNIQUE (issue_id, automation_destination_id)**. **RLS.** |
| `ai_runs` (Phase 4) | id, org_id, thread_id (FK, cascade), model, escalated, key_source (`platform` \| `byok`), input_tokens, output_tokens, **cost_micro_usd** (millionths of a dollar, exact sums), decision jsonb (kinds/types/priorities/confidence only, no AI-written text), **raw_output_sealed** (sealed box, binding `ai_run.output`; cleared to NULL after 30 days), created_at. **RLS.** |
| `activity_log` (Phase 4) | id, org_id, automation_id, thread_id, kind (`ai_create`, `ai_no_action`, `ai_limit`, `ai_key_problem`, `ai_unavailable`…), message (plain language, never message text), refs jsonb, created_at. **RLS.** |

Migration 0006 also adds `clear_old_ai_outputs(days)` (SECURITY DEFINER, runtime role may execute) used by the daily cleanup job.

**Routing functions** (migration 0005, `SECURITY DEFINER`, executable only by the runtime role, identifiers only): a hook knows just the Crisp website id and the runtime role cannot read across workspaces, so `crisp_routes(website_id)` returns `(org_id, connection_id, automation_id, quiet_window_sec)` for active connections with enabled automations, `crisp_reconcile_targets()` lists the same for every website, and `purge_old_source_events(days)` applies retention.

**`dedupe_key`:** each connector computes it. Crisp hooks have no event id, so we use `sha256(website_id | event | data.fingerprint ?? data.session_id | timestamp)`.

## Constraints that keep things correct

- `source_events.dedupe_key` UNIQUE → duplicate hooks do nothing.
- `threads (automation_id, source_type, source_id)` UNIQUE → one thread per conversation per automation.
- `destination_tickets (issue_id, automation_destination_id)` UNIQUE → a ticket can never be created twice in the same destination.
- `connections (provider, metadata->>'websiteId')` UNIQUE for Crisp.
- HNSW index on `issues.embedding`, filtered by `automation_id` and `status = 'active'`.

## Retention

- `source_events`: 30 days, enforced by the daily `maintenance.cleanup` job (`purge_old_source_events`).
- `ai_runs.raw_output`: 30 days (encrypted), then cleared; counters kept.
- Full retention and deletion rules: [security.md](security.md#4-store-as-little-as-possible).
