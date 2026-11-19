# Plan: Linear as a destination (and keeping OAuth connections alive)

Status: **proposed**, waiting on the owner's choices in "Decisions" below.

## Why Linear next

The roadmap orders integrations by: free to test, size of the user base, the gap we fill, and a marketplace that brings users ([roadmap.md](../roadmap.md#integrations-roadmap)). Linear wins the destination slot:
- It is the tracker of choice for the small software teams that use Crisp, our current buyers. Every existing Crisp customer can use it straight away, with no new source.
- A free Linear workspace has the full API, and OAuth apps are free to register.
- Linear has an integrations directory that lists third-party apps.
- The API is one GraphQL endpoint with markdown descriptions (no ADF conversion like Jira).

Bigger tools (GitHub Issues, Asana, ClickUp) stay next in line. **Chatwoot** stays the next *source*, after Linear.

## What Linear's API means for us (checked 2026-11-19)

| Topic | Linear | Our handling |
|---|---|---|
| Auth | OAuth 2.0 at `linear.app/oauth/authorize` → `api.linear.app/oauth/token`, PKCE supported | Same pattern as Jira: start route, callback, seal the one-time code, the worker exchanges it |
| Scopes | `read`, `issues:create` (issues, attachments, uploads), `comments:create` | Ask for exactly these; no `write`, no `admin` |
| Tokens | Access token 24 h. **Refresh tokens rotate and expire 30 days after issue, used or not**; a lost refresh response can be retried within 30 min | Refresh under the existing per-connection Redis lock (as Jira); plus the keep-alive job below |
| Revoke | `POST /oauth/revoke` | On disconnect, like Jira and Trello |
| Rate limit | 5,000 requests and 2,000,000 complexity points per hour per user/app; 429 with `RATELIMITED` and `Retry-After` | Map to our `rate_limited` error with retry-after |
| Issues | `issueCreate` (teamId, title, markdown description, priority, labelIds, dueDate, stateId, projectId) | Fields map 1:1 |
| Priority | 0 none, 1 Urgent, 2 High, 3 Medium, 4 Low | P5 → Urgent, P4 → High, P3 → Medium, P2 → Low, P1 → Low (Linear has no fifth level) |
| Files | `fileUpload` returns a signed URL; we PUT the file from the server with the returned headers; the `assetUrl` goes into markdown | Same `safeDownload` path as today; images embedded in the description, other files as links |
| Comments | `commentCreate` with markdown | Follow-ups, duplicates |
| Closed / deleted | Issue state type `completed` / `canceled`; trashed or missing issue → not found | Same rules as Jira: closed match → new ticket linking the old one; deleted → `broken` |

## What gets built

1. **Connection keep-alive job (also fixes Jira).** A daily worker job refreshes the tokens of every active Jira and Linear connection not refreshed in the last 7 days, under the same lock as a normal refresh. Today a Jira connection that creates no tickets for **90 days** silently dies (Atlassian's inactivity rule), and Linear's limit is 30 days. Atlassian also needs re-consent after **365 days**: the job emails the workspace owners from day 350 to reconnect. This ships first, on its own, because it protects existing Jira customers.
2. **`packages/connectors/src/linear.ts`:** OAuth exchange, refresh and revoke; a small GraphQL client (errors mapped to our typed errors: 401 → revoked, 404/not found → broken, 429 → retry-after); teams, projects, workflow states and labels lists; create issue, comment, update, upload file, get issue state. msw tests with recorded payloads.
3. **Database:** `linear` added to the connection providers and a `{ kind: "linear", teamId, projectId?, stateId?, labelIds… }` destination config. A migration only if a constraint needs it (the provider column is text).
4. **Worker:** RPC methods `linear.complete`, `linear.listTeams`, `linear.teamSetup` (projects, states, labels), `linear.createLabel`; the Linear branches in `deliver.ts` and `update.ts`; keep-alive above.
5. **Web:** Connect Linear button, `/api/connections/linear/start|callback`, the team / project / starting-state picker, label settings (ADR 0013), Connections page summary, the setup checklist.
6. **Human-edit check:** we store a hash of the description we last wrote; before rewriting we compare it with Linear's current description. Any difference means a person edited it, so we comment instead. This works however the connection was made.
7. **Public pages:** an `/integrations/crisp-to-linear` page, Linear in the landing page, footer, security and sub-processor pages, and the hero demo where it lists destinations.
8. **Docs:** `docs/integrations/linear.md`, providers setup (register the OAuth app), self-hosting variables, roadmap status, an ADR for the actor choice.
9. **Env:** `LINEAR_CLIENT_ID`, `LINEAR_CLIENT_SECRET` (worker only) in `.env.example`, `env.ts`, `deploy/.env.example` and the worker's compose list; the client id also on the web (public, for the authorize URL).

## Decisions (owner)

1. **Who the tickets come from in Linear.**
   - *As the TriageFox app (recommended):* issues show "TriageFox" as the creator, and the connection keeps working if the person who connected it leaves the company. Needs a Linear workspace **admin** to connect.
   - *As the person who connected:* any member can connect, but every ticket looks as if that person wrote it, and it breaks when they leave.
2. **P1 in Linear.** Linear has four levels, we have five. *Recommended:* P1 and P2 both become Low (the ticket body still says "Priority 1" with the reason). *Alternative:* P1 becomes "No priority", which in Linear often reads as "not looked at yet".
3. **Where new issues land.** *Recommended:* the team's **Triage** inbox when the team has triage switched on (it exists for exactly this), otherwise the team's default state; the customer can pick another starting state.

## Owner tasks (once built)

- Create a free Linear workspace for testing (a separate one from any real work, as Linear advises).
- Register an OAuth app there: name TriageFox, icon from `marketing/crisp/triagefox-logo-512.png`, redirect URIs `https://triagefox.com/api/connections/linear/callback` and `http://localhost:3000/api/connections/linear/callback`. Put the client id and secret in `.env` / the server's `deploy/.env` (never in chat).
- After testing: submit TriageFox to Linear's integrations directory.

## Tests

Unit (mapping, GraphQL error mapping, token refresh and rotation, keep-alive selection), msw connector tests, pipeline scenarios reusing the Trello/Jira ones (create, follow-up, duplicate, closed match, deleted issue, 401 → revoked, 429 → retry), RPC output schemas stripping tokens, e2e for the Connections page, a real end-to-end run against the free Linear workspace, and the security checklist in `docs/security.md` §15 for a new provider.
