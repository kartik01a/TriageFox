# Crisp (Source, MVP)

Why Crisp first: [decisions/0006](../decisions/0006-crisp-as-mvp-source.md).

## How connecting works (as built in Phase 2)

1. The user opens our plugin inside Crisp. Crisp shows our page `/crisp/link` in an **iframe widget** and appends `website_id`, `token` (a per-website secret) and `locale`.
2. The page asks the worker (`crisp.verifyWebsite`) to compare that token with the one from Crisp's API (`GET /v1/plugins/subscription/{website_id}/{plugin_uuid}/settings`, constant-time compare). Forged or unknown tokens show "Open this page from inside your Crisp inbox". The route is rate limited per IP.
3. A cross-site iframe has no session cookie, so linking continues in a normal tab: *Continue in TriageFox* posts to `/api/crisp/link-ticket`, which **re-verifies** the token (hidden form fields are never trusted) and stores a **single-use ticket** (random 256-bit value, only its hash stored, 15 minute expiry) in `crisp_link_tickets`.
4. `/app/connections/crisp/link?ticket=…` requires a signed-in **owner/admin**, shows which website will be linked to which workspace, and on confirmation consumes the ticket and inserts the connection **in one transaction**. A website already linked elsewhere is refused by a database unique index (`connections_crisp_website_unique`).
5. Only `{ websiteId, websiteName }` is stored; nothing secret. `connection.check` marks the link `revoked` when Crisp reports no subscription (plugin uninstalled).
6. `/crisp/link` is the only page allowed to be framed (CSP `frame-ancestors https://app.crisp.chat`); every other page is `frame-ancestors 'none'`.

Findings: the development token can read the subscription *settings* route (including the per-website token) for trusted websites; the *details* route returns `subscription_not_found` for them. The identity question from Phase 0 is answered by the iframe `token`.

Marketplace steps for the owner: [../setup/providers.md](../setup/providers.md).

## How connecting works (design notes)

- We register **one Crisp Marketplace plugin** for the platform (free developer signup).
- The user installs our plugin on their Crisp website (workspace). Crisp opens our **plugin settings page** (`/crisp/settings`), where the user signs in and links that Crisp website to their workspace.
- **No API key to paste.** Our plugin token can call the REST API for every website that installed the plugin, so we only store `websiteId`.
- Uninstalling the plugin → connection `revoked`, and the automation is paused.

### Tokens
| Token | Use |
|---|---|
| **Development token** | Free, every plugin route, lower quotas, **only works on our own trusted Crisp website**. Used for building and testing, at no cost. |
| **Production token** | Needs the list of scopes our plugin uses. Used by the hosted version once the plugin is published. |

Auth: HTTP Basic with `identifier:key` plus header `X-Crisp-Tier: plugin`.

Self-hosters create **their own** Crisp plugin and use a development or production token. The self-host guide covers this.

## Plugin hooks (webhooks): as built in Phase 3
- Endpoint: `POST /api/webhooks/crisp`. In the Marketplace, set the **Development Web Hook** URL to `<public URL>/api/webhooks/crisp` (for local work your ngrok domain; earlier spike URLs ended in `/crisp` and must be changed) and set the same signing secret as `CRISP_HOOK_SECRET` in `.env` (read by the **web app**).
- Subscribe to: `message:send`, `message:received`, `session:set_state`.
- Details of verification, routing, debounce, reconcile: [../architecture.md](../architecture.md) "As built in Phase 3".

## Plugin hooks (webhooks): design notes

- **One endpoint**: `POST /api/webhooks/crisp`. Each payload has `website_id`, `event`, `data`, `timestamp`; we route by `website_id`.
- **Signature (plugin hooks only):** headers `X-Crisp-Request-Timestamp` and `X-Crisp-Signature`. Compute `HMAC-SHA256(secret, "[" + timestamp + ";" + rawBody + "]")` (the brackets and semicolon are literal) and compare it with the signature. Reject if they don't match.
- **Retries:** anything other than `200` is retried (`X-Delivery-Attempt-Count` / `X-Delivery-Attempt-Limit` headers). After all attempts fail, delivery pauses for about a minute and **some events may never arrive**. So the endpoint must reply instantly, and the `crisp.reconcile` job fills the gaps.
- Website-level hooks (set up in Crisp settings) are **not signed and not retried**, so we don't use them.

### Events we subscribe to
| Event | Use |
|---|---|
| `message:send` | Visitor (customer) sent a message → re-evaluate (with the quiet window) |
| `message:received` | Operator sent a message → context ("known bug", "fixed for you") |
| `session:set_state` | `state` = `resolved` → evaluate immediately; back to `unresolved`/`pending` → reopened |
| `session:request:initiated` | Conversation started (not seen in Phase 0; do not depend on it. Create the thread on the first `message:send`) |

File messages have `type: "file"` with `content: { name, url, type }`.

## Data we fetch
- The conversation and its messages (role, type, content, timestamp, fingerprint), with pagination.
- Visitor info (nickname, email) for `customer_ref`. Shown in tickets only if `includeCustomerNames` is on.
- Files: streamed from `content.url` → uploaded to the destination.

## Reconcile job
`crisp.reconcile` runs every ~10 min for each connected website. It lists recently updated conversations and enqueues `thread.evaluate` for any whose latest message fingerprint differs from `threads.last_processed_message_id`.

## Phase 0 findings (2026-10-25)
- [x] **Free plan works for development.** The plugin development token works against a free workspace, **but only after the plugin is installed on that workspace** (Marketplace → plugin → "Install Plugin on Workspace" / trusted workspace). Before that, every call returned `404 not_subscribed: the website is not allowed on the plugin sandbox`. Chatwoot fallback not needed.
- [x] **REST (plugin tier, `X-Crisp-Tier: plugin`, Basic auth `identifier:key`) works:** `GET /v1/website/{id}`, `/conversations/{page}`, `/conversation/{session}`, `/conversation/{session}/meta`, `/conversation/{session}/messages` (paginate with `?timestamp_before=<oldest timestamp>`). **Timestamps are milliseconds.** Messages have `type`, `from` (`user`/`operator`), `origin`, `timestamp`, `fingerprint`, `content`. Conversation `state` seen: `pending`; created via email widget shows `meta.origin: "email"`.
- [x] **Plugin hooks fire and the signature verifies** with `HMAC-SHA256(secret, "[" + X-Crisp-Request-Timestamp + ";" + rawBody + "]")` (hex). **`X-Crisp-Request-Timestamp` is in milliseconds** (the replay check must use ms). Delivery limit headers: `X-Delivery-Attempt-Count` / `X-Delivery-Attempt-Limit` (observed 1 / 3). Also `X-Crisp-Hook-Origin`.
- [x] **Hook payload:** `{ website_id, event, data, timestamp }`. For `message:received` (operator message): `data` has `website_id, type, from, origin, content, fingerprint, user, mentions, timestamp, stamped, session_id, inbox_id`. Operator messages arrive as `message:received` (as documented). **Hooks carry the message content**; per ADR 0010 we must **not** persist it: store only IDs.
- [x] **Dev hook URL path matters:** the URL saved in the plugin must include our route (`…/crisp`), or Crisp calls the wrong path.
- [x] **Local development:** ngrok with the free **static domain** works well (stable URL, set once). Cloudflare quick tunnels change URL on every start.
- [x] **Deep link** format used: `https://app.crisp.chat/website/{website_id}/inbox/{session_id}/` (to click-verify).
- Plugin states seen: "private / deactivated" is fine for development with a development token; "Public" needs Crisp review; production hook and token need "Ask a production token" (a launch-phase task).

- [x] **`session:set_state` fires** with `{ website_id, session_id, state }` (seen: `resolved`). Resolving also emits a `message:received` with `type: "event"` and content `{namespace: "state:resolved"}`. **The pipeline must ignore non-content message types** (`event`, etc.) and only treat `text`/`file`/`picture`-like types as conversation content.
- [x] **Visitors CAN send files and images on the free plan** (operator-side attachments are disabled). A visitor file arrives as `message:send` with `type: "file"` and `content: { name, url, type }` (e.g. `image/png`), `from: "user"`.
- [x] **File URLs are public, unsigned and cached for years** (`https://storage.crisp.chat/users/upload-1/session/…`; unauthenticated `HEAD` returned 200 with `content-type`/`content-length`, `cache-control: public, max-age=315360000`). Anyone with the link can open it, but the path is unguessable. Consequences: **SSRF allowlist = `storage.crisp.chat`**; no need to re-fetch for fresh URLs; the "link to the Crisp file" fallback works for ticket readers but means that link is effectively public, so say so in the privacy docs.
- [x] **Visitor events captured:** `message:send` (text and file; `from: "user"`; includes `fingerprint`, `session_id`, `website_id`, `origin: "chat"`). A visitor message into a resolved conversation emits **`session:set_state` with `state: "unresolved"`** (our reopen trigger). **Event order is not guaranteed** (`set_state` arrived between the two `message:send` events), so the worker must always re-fetch the conversation and never rely on hook order.

### Still open (none blocks Phase 1)
- [ ] `session:request:initiated`: not seen yet (the first visitor message produced `message:send` + `session:set_state`). Don't rely on it; treat the first `message:send` as the conversation start. (Needs a brand-new visitor session to test; low priority.)
- [x] **Private notes are locked on the free Crisp plan** (the Note tab prompts to upgrade), so they can't be tested for free and **free-plan customers can't create them**. The AI input treats notes as optional context: handle `type: "note"` messages if they ever appear (to verify on a paid trial before launch), and never depend on them.
- [ ] How the plugin **settings page** identifies the website and user (signed parameters?), so a website can't be linked by someone who doesn't own it. Examine when building the settings page (Phase 2).
- [ ] REST quotas for production tokens, and **Marketplace review requirements** (launch task).
- [ ] Crisp **identity verification** on the free plan, and how many websites a free account can have (Phase 7 / Phase 9, for own support).

Save real payload samples as fixtures in `packages/connectors/crisp/__fixtures__/`.

## References
- https://docs.crisp.chat/guides/web-hooks/
- https://docs.crisp.chat/references/web-hooks/v1/
- https://docs.crisp.chat/guides/rest-api/quickstart
- https://docs.crisp.chat/guides/plugins/settings/
