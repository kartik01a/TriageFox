# Featurebase (Source)

## Auth
- **API key** from the customer's Featurebase dashboard, pasted into our Connections page.
- On save: verify with a cheap authenticated call, then encrypt and store.

## Webhooks
- **One webhook per Featurebase connection**, shared by all automations that use the connection. Featurebase limits organizations to **10 webhooks by default**, so never create one per automation.
- Endpoint: `POST /api/webhooks/featurebase/:connectionId`.
- Verify the signature with the webhook's signing secret (stored encrypted). Reject on failure.
- Pin the API version (newer endpoints are versioned, e.g. `2026-01-01.nova`).

### Topics we subscribe to
| Topic | Use |
|---|---|
| `conversation.user.created` | New conversation → start thread |
| `conversation.user.replied` | Customer added info → re-evaluate (debounced) |
| `conversation.admin.replied` | Context (e.g. "known bug", "fixed for you") |
| `conversation.admin.noted` | Internal note context |
| `conversation.admin.closed` | Evaluate immediately |
| `conversation.admin.opened` | Reopened → re-evaluate |
| `post.created` | New feedback post → evaluate |
| comment events on posts | Extra detail → update |

## Data we fetch
- Full conversation messages (role, body, timestamp, attachments).
- Post title, content, category/tags, author, comments.
- Attachments: stream download → upload to destination.

## Open questions (Phase 0 spike)
- [ ] Can webhooks be **created** via the API (docs show list / update / delete / rotate-secret)? If not, show the user our URL to paste manually + secret field.
- [ ] Exact payload shape for each topic; is a stable event id included for dedupe?
- [ ] Endpoint to fetch a conversation's full message list (pagination?).
- [ ] Are attachment URLs public, signed, or authenticated?
- [ ] Deep-link URL format for a conversation / post (for `includeSourceLink`).
- [ ] Rate limits.
- [ ] Customer identity fields available (name, email, company) and timezone if any.

Save real payload samples as fixtures in `packages/connectors/featurebase/__fixtures__/`.

## References
- https://docs.featurebase.app/rest-api/webhooks
- https://docs.featurebase.app/guides/webhooks/topics
