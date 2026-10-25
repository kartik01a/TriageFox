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

### Connections
| Table | Key columns |
|---|---|
| `connections` | id, org_id, provider (`crisp` \| `trello` \| `jira`), auth_type (`plugin_install` \| `oauth` \| `token` \| `api_key`), credentials_encrypted (bytea, nullable), metadata jsonb, status (`active` \| `error` \| `revoked`), last_verified_at |

`metadata` by provider:
- Crisp: `{ websiteId, websiteName }`. No customer secret is stored: our plugin token can access every website that installed the plugin. **UNIQUE (provider, websiteId)** so a Crisp website can only be linked to one workspace.
- Jira: `{ cloudId, siteUrl }`
- Trello: `{ memberId, username }`

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
| `source_events` | id, connection_id, dedupe_key **UNIQUE**, topic, meta jsonb (**IDs only**: website_id, session_id, event, fingerprint, timestamp; no message content), status (`received` \| `processed` \| `ignored` \| `failed`), received_at |
| `threads` | id, automation_id, source_type (`conversation`), source_id (**UNIQUE per automation**; Crisp `session_id`), state (`open` \| `resolved`), last_processed_message_id, rolling_summary (**encrypted**), updated_at |
| `issues` | id, automation_id, origin_thread_id, title, body_md, type, priority (1–5), due_date, due_date_quote, confidence, embedding vector(1536), report_count, status (`active` \| `pending_review` \| `dismissed`), created_at |
| `issue_reports` | issue_id, thread_id, customer_ref, reported_at |
| `destination_tickets` | id, issue_id, automation_destination_id, external_id, external_key, url, last_pushed_at, last_remote_updated_at, status (`ok` \| `failed` \| `broken`), **UNIQUE (issue_id, automation_destination_id)** |
| `ai_runs` | id, thread_id, model, key_source (`platform` \| `byok`), input_tokens, output_tokens, cost_usd, decision jsonb, raw_output (**encrypted**, cleared after 30 days), created_at |
| `activity_log` | id, org_id, automation_id, kind, message, refs jsonb, created_at |

**`dedupe_key`:** each connector computes it. Crisp hooks have no event id, so we use `sha256(website_id | event | data.fingerprint ?? data.session_id | timestamp)`.

## Constraints that keep things correct

- `source_events.dedupe_key` UNIQUE → duplicate hooks do nothing.
- `threads (automation_id, source_type, source_id)` UNIQUE → one thread per conversation per automation.
- `destination_tickets (issue_id, automation_destination_id)` UNIQUE → a ticket can never be created twice in the same destination.
- `connections (provider, metadata->>'websiteId')` UNIQUE for Crisp.
- HNSW index on `issues.embedding`, filtered by `automation_id` and `status = 'active'`.

## Retention

- `source_events`: 30 days (at least 7 days while a connection is paused, so events can be replayed).
- `ai_runs.raw_output`: 30 days (encrypted), then cleared; counters kept.
- Full retention and deletion rules: [security.md](security.md#4-store-as-little-as-possible).
