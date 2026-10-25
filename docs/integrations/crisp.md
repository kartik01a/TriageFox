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

## Open questions (Phase 0)
- [ ] Can a **free** Crisp workspace install our own plugin in development mode, and do plugin hooks fire on it? (Fallback: start with Chatwoot.)
- [ ] Exact REST routes and scopes for: conversation metadata, message list (pagination), recent conversations list (for reconcile).
- [ ] Are file `content.url`s publicly downloadable or signed/expiring?
- [ ] How private notes appear (message type `note`?) and whether hooks fire for them.
- [ ] How the plugin settings page identifies the website and user (signed parameters?), so a Crisp website can't be linked by someone who doesn't own it.
- [ ] Deep-link format for a conversation (for `includeSourceLink`), e.g. `https://app.crisp.chat/website/{website_id}/inbox/{session_id}/`.
- [ ] REST quotas for development vs production tokens.
- [ ] Marketplace submission and review requirements for publishing.
- [ ] Crisp identity verification (server-signed user email) for in-app support chats, and whether it works on the free plan.
- [ ] How many Crisp websites a free account can have (we need `TriageFox Dev` + `TriageFox Support`).

Save real payload samples as fixtures in `packages/connectors/crisp/__fixtures__/`.

## References
- https://docs.crisp.chat/guides/web-hooks/
- https://docs.crisp.chat/references/web-hooks/v1/
- https://docs.crisp.chat/guides/rest-api/quickstart
- https://docs.crisp.chat/guides/plugins/settings/
