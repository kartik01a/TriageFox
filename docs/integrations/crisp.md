# Crisp (Source, MVP)

Why Crisp first: [decisions/0006](../decisions/0006-crisp-as-mvp-source.md).

## How connecting works

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

## Plugin hooks (webhooks)

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
| `session:request:initiated` | Conversation started → create the thread |

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
- [x] **Operator-side file/image/audio sending is disabled on the free plan** (greyed out in the inbox). Whether *visitors* can attach files in the widget on the free plan is unverified.

### Still open (verify when convenient; none blocks Phase 1)
- [ ] **Visitor events** (`message:send`, `session:request:initiated`): not yet captured; the test messages so far were typed as the operator. To capture: send from the chat widget in a private window.
- [ ] **File/image messages from visitors:** shape (`type: file`, `content: { name, url, type }` per docs) and whether `content.url` is public, signed or expiring. The design already copes with both (re-fetch the conversation for a fresh URL; fall back to a link). Test on a paid trial or with a visitor upload if the free widget allows it.
- [ ] **Private notes:** shape and whether hooks fire (needs a note typed in the inbox).
- [ ] How the plugin **settings page** identifies the website and user (signed parameters?), so a website can't be linked by someone who doesn't own it. Examine when building the settings page (Phase 2).
- [ ] REST quotas for production tokens, and **Marketplace review requirements** (launch task).
- [ ] Crisp **identity verification** on the free plan, and how many websites a free account can have (Phase 7 / Phase 9, for own support).

Save real payload samples as fixtures in `packages/connectors/crisp/__fixtures__/`.

## References
- https://docs.crisp.chat/guides/web-hooks/
- https://docs.crisp.chat/references/web-hooks/v1/
- https://docs.crisp.chat/guides/rest-api/quickstart
- https://docs.crisp.chat/guides/plugins/settings/
