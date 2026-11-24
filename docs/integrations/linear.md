# Linear (destination)

Added 2026-11-24 ([plan](../plans/2026-11-19-linear-destination.md), [ADR 0016](../decisions/0016-linear-destination.md)). Code: `packages/connectors/src/linear.ts`; worker branches in `apps/worker/src/pipeline/deliver.ts` and `update.ts`.

## Auth
- **OAuth 2.0** at `linear.app/oauth/authorize` with **`actor=app`**: issues and comments appear as created by the TriageFox app, and the connection does not depend on the person who connected. Linear requires a **workspace admin** to approve an app-actor install; the Connections page says so, and a refusal returns `?error=linear_failed`.
- Scopes: `read`, `issues:create` (issues, labels, uploads), `comments:create`. No `write`, no `admin`.
- Flow (same as Jira): `/api/connections/linear/start` sets the anti-forgery `state` cookie → Linear → `/api/connections/linear/callback` seals the one-time code → RPC `linear.complete` (worker) exchanges it with the client secret, reads the workspace name and **its own app user id** (`viewer`), and stores tokens sealed. Metadata: `workspaceId`, `workspaceName`, `urlKey`, `appUserId`.
- Tokens: access 24 h; **refresh tokens rotate and expire 30 days after issue**, used or not. Refresh runs under the per-connection Redis lock (shared with Jira, `rotatingAccessToken`); the daily `connections.keepalive` job refreshes any token older than 7 days. Linear answers `400 invalid_grant` for a dead grant: we treat it as revoked access (connection `revoked`, owners emailed).
- Disconnect revokes the grant at `POST /oauth/revoke` (best effort) and deletes our copy.

## API (GraphQL, `https://api.linear.app/graphql`)
Field names checked against the live schema on 2026-11-24 (introspection).

| Need | Query / mutation |
|---|---|
| Workspace, own user | `organization { id name urlKey }`, `viewer { id }` |
| Pickers | `teams { id key name triageEnabled }`; `team(id) { triageEnabled states { id name type position } projects { id name status { type } } }`; `issueLabels { id name color isGroup team { id } }` (team's own + workspace labels, never groups) |
| Create | `issueCreate(input: { teamId, title, description (markdown), priority, labelIds, stateId?, projectId?, dueDate? })` → `{ id identifier url }` |
| Follow-ups | `commentCreate`, `issueUpdate(id, { priority, dueDate, description })`, `issue(id) { trashed archivedAt state { type } }` |
| Human-edit check | `issue(id) { history(first: 100) { createdAt actorId updatedDescription botActor } }` |
| Files | `fileUpload(contentType, filename, size)` → PUT to `uploadUrl` from the **server** with the returned headers → `assetUrl` in markdown |

Errors arrive as GraphQL `errors[].extensions.code`: `AUTHENTICATION_ERROR`/`FORBIDDEN` → revoked; `RATELIMITED` (HTTP 429 + `Retry-After`) → retry after; "Entity not found" → the ticket is `broken` / the follow-up reports the issue is gone. Rate limit: 5,000 requests and 2,000,000 complexity points per hour per app user.

## Mapping
- **Priority** (ADR 0016): P5 → 1 Urgent, P4 → 2 High, P3 → 3 Medium, P2 → 4 Low, **P1 → 4 Low**. The ticket text still says "Priority: 1 (Lowest)".
- **Starting state**: the customer's choice; otherwise the team's **Triage** state when triage is on; otherwise Linear's default for the team. A chosen state or project that no longer exists is skipped (the issue is still created).
- **Labels** (ADR 0013): `from-chat` plus the type's label, by **name**; the default type label is the type's display name ("Bug", "Feature request"…). A missing label is created on the team at delivery. The customer can rename or turn off the type label on the connection page.
- **Due date**: `dueDate` (YYYY-MM-DD) only when the customer named one.
- **Files**: uploaded after the issue is saved, posted as one comment ("Files from the customer"), images inline. Oversize files become links; unsafe addresses are dropped (`safeDownload`).
- **Closed**: state type `completed` or `canceled`. A duplicate report on a closed issue opens a new ticket linking the old one (as Jira/Trello). Trashed or missing → reported, never recreated.
- **Human edits**: a description change in the history whose actor is not TriageFox's own app user (and not a bot) since our last push means a person edited it: we comment and keep their text.

## Setup (operator)
1. In a Linear workspace (Linear advises a separate one: every admin there can see the app's settings): **Settings → API → OAuth applications → New**. Name TriageFox, icon, redirect URI **`APP_URL/api/connections/linear/callback`** (add `http://localhost:3000/...` for development).
2. `LINEAR_CLIENT_ID` → web and worker; `LINEAR_CLIENT_SECRET` → **worker only**.
3. Without these, Linear is hidden in the app.
4. Later: submit TriageFox to Linear's integrations directory.
