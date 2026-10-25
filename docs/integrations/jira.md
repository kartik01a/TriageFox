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

## Phase 0 findings (2026-10-25, verified on a free Jira Cloud site)
- [x] **3LO flow works**, including refresh. Refresh tokens **rotate**: every refresh returns a new refresh token, and we must **save the latest one every time** (store atomically; two workers refreshing at once could lose it → serialise refreshes per connection). Access token lifetime: 3600 s.
- [x] **Scopes must be added in the developer console first** (Permissions → Jira API → configure), otherwise the consent page fails with "app has requested Jira API scopes that have not been added". Used: `read:jira-work`, `write:jira-work`, `read:jira-user`, `offline_access`. Check if `read:jira-user` can be dropped to request less.
- [x] **createmeta:** `GET /rest/api/3/issue/createmeta/{project}/issuetypes` and `…/issuetypes/{id}` work. Required fields in the test project: `issuetype, project, reporter, summary`. Issue types: Epic, Subtask, Task, Story, Feature, Bug. Priorities: 1 Highest … 5 Lowest.
- [x] **`priority` is NOT on the create screen** of this (team-managed) project, though `duedate`, `labels`, `description`, `attachment` are. **Setting priority in a second call (`PUT /issue/{key}`) worked (204).** Design: create the issue, then set priority by edit; if that fails, add the priority as a label and log it.
- [x] **ADF description works** (heading, paragraph, ordered list).
- [x] **Attachments:** 1, 10 and **11 MB** all succeeded, so the limit is above 10 MB on this site. Use Jira's reported limit (`GET /rest/api/3/attachment/meta`) at setup, with 10 MB as the safe default.
- [x] **`updated` changes when a comment is added**, so it can't distinguish human description edits from our own comments. Use the issue **changelog** (`GET /issue/{key}/changelog`, look for `description` field changes by someone other than our app) instead.
- [ ] Markdown → ADF converter choice (library vs small in-house builder for our limited template). Decide in Phase 5.
