# Jira Cloud (Destination)

## Auth
- **OAuth 2.0 (3LO)** app registered in the Atlassian developer console. "Connect Jira" button → consent → callback → access + refresh tokens (encrypted). Resolve `cloudId` via accessible-resources.
- Scopes: minimum needed to read projects/issue types and create/edit issues, comments, attachments (`read:jira-work`, `write:jira-work`, `read:jira-user`, `offline_access`).
- **Fallback:** site URL + email + API token for users who can't install OAuth apps.
- Jira Server / Data Center: out of scope.

## Setup (wizard)
1. Pick site (if several) → pick project.
2. Fetch issue types → map our types (bug → Bug, feature → Story/Task, …).
3. Fetch priorities → map 5→Highest … 1→Lowest (user can override if the project uses a custom scheme).
4. **createmeta check:** if the project/issue type has **required fields we can't fill**, block enabling and explain which fields.
5. Check whether `priority` and `duedate` are on the create screen; skip silently if not.

## Issue mapping
| Our field | Jira |
|---|---|
| title | `summary` |
| body (markdown) | `description` in **ADF** (Atlassian Document Format) — convert markdown → ADF |
| type | issue type (mapped) + label |
| priority | `priority` (mapped id) |
| due_date | `duedate` |
| extra | labels: `from-chat`, type |
| attachments | `POST /rest/api/3/issue/{key}/attachments` with header `X-Atlassian-Token: no-check` |
| updates / duplicates | comments (ADF) |

## Limits & errors
- 429 with `Retry-After` → respect it; per-connection limiter.
- Refresh token on 401; if refresh fails → connection `revoked`, pause, email.
- 404 → `broken`, do not recreate.
- 400 on create → surface Jira's field errors in the activity log.

## Phase 0 checks
- [ ] 3LO flow + token refresh on a free Jira Cloud site.
- [ ] Markdown → ADF converter choice (library vs small in-house builder for our limited template).
- [ ] Attachment size limits.
- [ ] `updated` field reliable for "human edited?" check.
