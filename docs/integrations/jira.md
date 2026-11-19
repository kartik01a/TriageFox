# Jira Cloud (Destination)

## Auth
- **OAuth 2.0 (3LO)** app registered in the Atlassian developer console. "Connect Jira" button → consent → callback → access + refresh tokens (encrypted). Resolve `cloudId` via accessible-resources.
- Scopes: minimum needed to read projects/issue types and create/edit issues, comments, attachments (`read:jira-work`, `write:jira-work`, `read:jira-user`, `offline_access`).
- **Fallback:** site URL + email + API token for users who can't install OAuth apps.
- Jira Server / Data Center: out of scope.

## As built (Phase 2)
- `GET /api/connections/jira/start` sets a one-time `state` cookie and redirects to Atlassian (`audience=api.atlassian.com`, scopes below, `prompt=consent`). The callback `GET /api/connections/jira/callback` compares `state` in constant time (single use), then stores the one-time **code** as a sealed `pending` connection and asks the worker (`jira.complete`) to exchange it: **the Atlassian client secret exists only in the worker**, and the web app never sees a token.
- We use a confidential client with `state` (CSRF). PKCE is not used: it adds nothing for a server-side client with a secret, and Atlassian's 3LO documentation doesn't require it.
- The worker stores `{ accessToken, refreshToken, expiresAt }` sealed, and `metadata.sites` (all accessible sites), `cloudId` (first site), `siteName`, `siteUrl`. Refresh happens in the worker under a Redis lock per connection, re-reading the stored tokens after taking the lock (rotating refresh tokens must never be used twice); refusal marks the connection `revoked`. Sealed tokens also carry `refreshedAt`; the daily `connections.keepalive` job refreshes any token older than 7 days, because Atlassian drops refresh tokens unused for 90 days (Atlassian staff on the developer forum also describe a 365-day absolute limit needing re-consent; not in the official docs as of 2026-11-19, so we rely on the normal "reconnect" email if it happens).
- Pickers: site (when more than one) → project → issue types and priorities. `projectSetup` reads createmeta for every issue type; a type with **required fields we can't fill** (anything outside project, issuetype, summary, description, reporter, labels, duedate, priority, attachment, unless it has a default) is shown as unavailable and rejected on save with the field names. Suggested mappings: bug-like categories → Bug, feature/improvement → Story/Feature/Task; priorities by name (Highest…Lowest) or by position for custom schemes. Saved (after server-side re-validation) to `connections.metadata.defaults`: `cloudId, projectKey, projectName, issueTypeMap, priorityMap, setupOk`.
- Disconnect deletes our tokens (Atlassian offers no simple revoke call; customers can also remove the app in their Atlassian account).

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
- [x] **Markdown → ADF: a small in-house converter** (`packages/connectors/src/adf.ts`). Our ticket template only needs headings, paragraphs, ordered/bullet lists, rules, bold, inline code and links. It builds text nodes only (customer/AI text can never become markup) and links only `http(s)` URLs, which a general library would not guarantee.

## As built (Phase 5)
- Delivery job `ticket.deliver` (worker): create the issue with project, mapped issue type, summary (250 chars), ADF description and labels `from-chat` + the ticket type. The access token comes from the same locked refresh used by the Phase 2 pickers.
- **Priority and due date are set by editing** after creation (they are not on every create screen). If the priority edit is refused, a `priority-N` label is added and the activity log says so; a refused due date is skipped and logged.
- Attachments: re-fetched from Crisp, `safeDownload` (10 MB, Crisp storage host only), `POST …/attachments` with `X-Atlassian-Token: no-check`. Too large → a comment with the link.
- Issue type with no mapping → ticket `failed` with a clear message, Jira not called. 401 → connection `revoked`; 404 → `broken`; 429/5xx retried; 400 → `failed`.
- The issue URL is `<site url>/browse/<KEY>`.

## As built (Phase 6)
- Follow-ups: ADF comment, then best effort: priority edit, due date edit, new files, description rewrite (ADF) of the refreshed footer.
- Closed check: `GET /issue/{key}?fields=status`, `statusCategory.key === "done"`.
- Human-edit check: `GET /issue/{key}/changelog`, entries that changed `description` by an account other than `GET /myself`, dated after our last write. If the changelog cannot be read, the description is left alone.
