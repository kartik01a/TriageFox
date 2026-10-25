# Security & Privacy

We hold other companies' Featurebase, Trello, and Jira credentials. A leak would end the product — treat this as a top requirement.

## Credentials
- Encrypted at rest with **AES-256-GCM envelope encryption** (`packages/crypto`): random per-record data key, wrapped by a master key.
- Master key: env var for MVP → cloud KMS before launch. Support key rotation (store key version with each record).
- Decrypted only inside the worker / server route that needs them; never sent to the browser (UI shows `••••1234`).
- Never logged. pino redaction for `authorization`, `token`, `apiKey`, `secret`, `password` fields.
- Disconnecting a connection deletes the credentials and, where possible, the remote webhook / revokes the token.

## OAuth
- Request minimal scopes. Use `state` parameter (CSRF) and PKCE where supported.
- Refresh tokens stored encrypted; refresh failures → connection `revoked`.

## Webhooks
- Verify every inbound signature (Featurebase, Stripe). Reject unsigned/invalid with 401.
- Per-connection webhook URL + secret; rotate secret on reconnect.

## Tenant isolation
- Every table carries `org_id` (directly or via parent); all queries filter by it. Add integration tests that try cross-org access.
- Roles: owner (billing), admin (connections/automations), member (read + review queue).

## Customer data (PII)
- Customer names in tickets only if `includeCustomerNames` is on (default off).
- Strip emails / phone numbers from generated ticket text.
- Source link only if `includeSourceLink` is on.
- Transcripts are sent to OpenAI — disclose in privacy policy; use API settings that exclude data from training.
- Retention limits in [data-model.md](data-model.md#retention).

## AI-specific
- Prompt injection: customer text marked untrusted; output constrained by strict schema; rubric controls priority; `issueId`s validated against what we supplied.

## Before launch
- Privacy policy + terms, DPA template, security page.
- Dependency scanning, secret scanning in CI.
- Audit log for connection and automation changes.
