# Security & Privacy

**Security is the top priority.** Customers give us access to their Jira, Trello, Crisp conversations and OpenAI keys. If they don't trust us, the product fails. The code is public, so nothing may depend on secret code: security comes from design, encryption and process.

Decisions agreed 2026-10-25: no transcript storage, Cloudflare in front, sealed secrets readable only by the worker, 2FA policy below, master key in Oracle Vault (or a root-only file). See [decisions/0010](decisions/0010-security-architecture.md).

## 1. What we protect (most → least sensitive)
| Asset | Why it matters |
|---|---|
| **Crisp plugin token** (platform secret) | Can read conversations of **every** website that installed our plugin |
| Platform secrets (Trello app secret, Atlassian OAuth client secret, Dodo keys, OpenAI platform key, master key) | Let an attacker act as TriageFox |
| Customers' **Jira / Trello tokens** | Read/write access to their issue trackers |
| Customers' **OpenAI keys** (own-key plans) | Direct money cost to them |
| Customer conversation content (names, emails, messages) | Personal data (GDPR etc.) |
| Account data (emails, sessions, workspace settings) | Account takeover |

**Not held by us:** card details (Dodo), files/attachments (streamed straight to Jira/Trello), full chat transcripts (fetched on demand, never stored).

## 2. Threats and main defences
| Threat | Main defences |
|---|---|
| Database or backup stolen | Envelope encryption; master key not in DB/repo; encrypted backups; no transcripts stored |
| Web app compromised (bug in a route) | Web process **cannot decrypt** stored secrets (sealed boxes, see §3); tenant isolation; strict validation |
| Server compromised | Hardened VM, Cloudflare-only ingress, secrets in Vault, least-privilege containers, fast key rotation runbook |
| Cross-workspace data access (IDOR) | Org-scoped data layer + Postgres row-level security + tests |
| Account takeover | Strong password hashing, rate limits, 2FA, step-up re-auth for sensitive actions, session revocation |
| Admin account takeover | Email allowlist + mandatory 2FA + 404 for non-admins + audit log; admins can't read secrets |
| Secret leaked in public repo | gitleaks pre-commit + CI, GitHub push protection, no secrets in code or CI logs |
| Malicious dependency | Lockfile, Dependabot, `pnpm audit`, CodeQL, pinned GitHub Actions |
| Forged webhooks | HMAC signature + timestamp window, reject otherwise |
| SSRF via attachment URLs | Host allowlist + private-IP blocking + size/time limits |
| XSS via chat/AI text | Never render raw HTML; sanitised markdown; strict CSP |
| Prompt injection in chats | AI has no tools or data access; strict output schema; validated IDs |
| DDoS / brute force | Cloudflare (WAF, rate limits), app-level rate limits |

## 3. Encryption & the secret boundary
- **Sealed-box encryption** (libsodium `crypto_box_seal`: a fresh ephemeral key pair per value, so every secret is effectively under its own key; implemented in `packages/crypto`):
  - Each secret is encrypted with a random per-record key.
  - That key is sealed to the **worker's public key**.
  - The **web app only has the public key**: it can store new secrets (OAuth callbacks, pasted keys) but **can never read them back**.
  - Only the worker holds the private key.
- **Binding:** the sealed payload contains `org_id` + `connection_id`, checked after decryption, so a ciphertext copied into another row is rejected.
- **Master/private key location:** **Oracle Cloud Vault** if the free tier covers it (Phase 0 check). Otherwise a root-only file (`0400`) outside the repo, mounted only into the worker container. Never in the database, the repo, `.env` committed files, logs or the web container.
- **Key versions & rotation:** each record stores a key version. The rotation runbook re-seals all secrets under a new key without downtime.
- **Calls that need a decrypted secret** (listing Trello boards or Jira projects in the setup wizard, creating tickets) run **inside the worker**. The web app asks the worker over the internal Docker network (never exposed publicly).
- **Encrypted at rest too:** `threads.rolling_summary` and `ai_runs.raw_output` (they contain derived customer text).
- Passwords: hashed by Better Auth (scrypt). TLS everywhere (Cloudflare ↔ origin with Full (strict) mode).

**Implemented in Phase 1** (verified by tests): seal/open round trip, public-only keyring cannot open (also enforced by the type system), ciphertext moved to another org/record/purpose is rejected, tampering gives a generic error, key rotation keeps old values readable, worker refuses to start on a mismatched key pair. Row-level security is verified as the restricted database role (cross-workspace reads, writes and updates blocked; no workspace set means no rows). Security headers + per-request nonce CSP, Cloudflare-only client IP in production, pino redaction, and a secret-scanning pre-commit hook + CI job are in place.

**Implemented in Phase 2** (verified by unit tests and live end-to-end tests): provider tokens sealed on arrival and only ever opened by the worker; web → worker requests with output stripping; OAuth `state` (single use, constant-time compare) and a one-time Trello flow cookie; Jira code exchange in the worker so the client secret never reaches the web app; Crisp website proof via Crisp's per-website token (constant-time), single-use hashed link tickets, one workspace per Crisp website enforced by the database; write-only OpenAI key validated against our models (only `sk-…1234` readable); owner/admin gate and same-origin check on every state-changing route; disconnect revokes at Trello where possible and deletes our copy; row-level security on connections and ai_settings; audit entries (ids only) for connection and key changes.

**Implemented in Phase 3** (unit, integration and live tests): hook signature (HMAC over `[timestamp;body]`, constant-time) and millisecond timestamp window (±5 min, so replays and seconds-vs-ms mistakes are refused) before anything else touches the payload, a uniform bare 401, a 256 KB body cap; hooks store identifiers only (a test proves message text appears nowhere in the database) and never log content; workspace routing through narrow `SECURITY DEFINER` functions that return IDs only; row-level security on `automations`, `source_events` and `threads`; per-thread locking; and the **SSRF guard** for downloading customer-supplied file URLs (`safeDownload`): https only, exact host allowlist (`storage.crisp.chat`), no IP literals/credentials/odd ports, every resolved address must be public (loopback, private, link-local incl. cloud metadata, CGNAT, multicast, IPv6 and IPv4-mapped forms all blocked), redirects re-validated per hop, size cap enforced even when the server lies about it, timeout. A residual DNS-rebinding window exists between our lookup and the connection; the single trusted host allowlist is what contains it.

## 4. Store as little as possible
- **No chat transcripts are stored.** We fetch from Crisp, analyse in memory, and keep only IDs, the ticket we created, a short encrypted summary and the AI decision. Debugging re-fetches from Crisp.
- **Webhook events store IDs only** (website, session, event, fingerprint, timestamp), not message content.
- **OpenAI keys are write-only:** shown only as `sk-…1234`; replace or delete, never reveal.
- **Minimal OAuth scopes** (see each integration doc); tokens deleted immediately on disconnect.
- Ticket text is PII-stripped (emails, phone numbers removed); names only with the toggle on.

| Data | Kept for |
|---|---|
| Webhook event IDs | 30 days |
| `ai_runs.raw_output` (encrypted) | 30 days, then cleared |
| Rolling summaries (encrypted) | Until the thread closes + 30 days |
| Deleted workspace | Removed within 7 days; backups age out within 30 days |

## 5. Accounts & access
- **Sign-in:** email + password or Google. Email verification required. Login rate limits and temporary lockout after repeated failures.
- **Sessions:** httpOnly, Secure, SameSite=Lax cookies; "sign out everywhere"; sessions revoked on password change.
- **2FA (TOTP app + backup codes):**
  - **Platform admins: required.**
  - **Customers: optional at sign-up** (no friction), with a strong prompt after onboarding ("Protect the workspace that holds your Jira access").
  - **Workspace setting "Require 2FA for all members"** that owners can switch on.
  - Google sign-in users inherit Google's own 2FA.
- **Step-up re-authentication** (password/2FA again, valid 10 min) before sensitive actions: adding/replacing an OpenAI key, connecting/disconnecting tools, changing billing, removing members, deleting the workspace.
- **Roles:** owner (billing, delete), admin (connections, automations), member (read + review queue). Invite links expire after 7 days.

## 6. Tenant isolation
- A data-access layer where **every query requires `orgId`**; no raw queries outside it.
- **Postgres row-level security (RLS)** as a second lock: each request/job sets `app.current_org`; policies block rows from other orgs.
- Integration tests try cross-org reads and writes on every route.

## 7. Web application
- **Headers:**
  - strict nonce-based **CSP**
  - **HSTS**
  - `frame-ancestors 'none'`, **except** the Crisp plugin settings page, which allows only `app.crisp.chat`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - a restrictive `Permissions-Policy`
- **CSRF:** SameSite cookies + Origin/Host checks on every state-changing request.
- **XSS:** React escaping; **never** `dangerouslySetInnerHTML` with chat or AI text; markdown rendered through a sanitiser.
- **Validation:** zod on every input (API, forms, webhooks, AI output).
- **SSRF guard for attachment downloads:**
  - allowlist of Crisp file hosts (`storage.crisp.chat`, confirmed in Phase 0)
  - DNS resolved and checked against private/link-local ranges (including `169.254.169.254`)
  - max 25 MB, 20 s timeout, no redirects to other hosts
- **Webhooks:** HMAC signature + reject timestamps older than 5 minutes; dedupe.
- **OAuth:** `state` + PKCE; exact redirect URIs; no open redirects.
- **Rate limits:** Cloudflare rules on `/api/auth/*` and webhooks, plus per-user/IP limits in the app.

## 8. AI safety
- The model gets **no tools, no internet, no database access**; it only returns JSON matching our schema.
- Customer text is wrapped and labelled as untrusted data; instructions inside it are ignored.
- Output is validated: unknown `issueId`s are dropped, attachment IDs filtered, PII stripped.
- Tickets can only go to that workspace's own configured destinations.
- OpenAI API data is not used for training (default for API).

## 9. Infrastructure (Oracle VM)
- **Access:**
  - SSH keys only (no passwords, no root login), non-root deploy user, fail2ban
  - unattended security upgrades
- **Network:**
  - **Cloudflare (free) in front**: proxied DNS, Full (strict) TLS with an origin certificate, managed WAF rules, bot protection, rate-limit rules
  - The VM firewall (OCI security list + ufw) accepts **80/443 only from Cloudflare IP ranges**, so the origin can't be hit directly. SSH is restricted (your IP, or Cloudflare Tunnel / Tailscale).
- **Containers:**
  - Postgres and Redis on an internal Docker network only (no published ports)
  - Redis password; Postgres `scram-sha-256` with separate roles (app, migrator, read-only)
  - Non-root containers, read-only filesystems where possible, no Docker socket mounts
- **Backups:**
  - nightly `pg_dump`, **encrypted with `age`** (public key on the server, private key kept offline by you), uploaded to Oracle Object Storage
  - restore test monthly

## 10. Public repo & supply chain
- **gitleaks** pre-commit hook + CI job; GitHub **secret scanning + push protection** on.
- **Dependabot** (or Renovate) for updates; `pnpm audit` in CI; committed lockfile.
- **CodeQL** code scanning (free for public repos).
- GitHub Actions pinned by commit SHA; minimal `permissions`; no production secrets in GitHub Actions. Deploys run over SSH with a dedicated deploy key.
- Branch protection on `main` (CI must pass).
- `SECURITY.md` with a private reporting address (`security@triagefox.com`).
- **The repo is private until launch-ready.** GitHub's free CodeQL and secret scanning may not cover private repos, so **gitleaks (pre-commit + CI) is the guard from day one**. Before flipping to public: run gitleaks over the **entire git history** (deleted secrets stay in history), then turn on CodeQL, secret scanning and push protection.

## 11. Logging, monitoring & audit
- pino with redaction (`authorization`, `token`, `apiKey`, `secret`, `password`, `cookie`). **Chat content never logged.**
- Sentry with PII scrubbing and request-body stripping.
- **Audit logs:**
  - `audit_log` per workspace (connections added/removed, key replaced, members, settings, billing)
  - `admin_audit_log` for platform admins
- **Alerts** (email + Slack):
  - spike in failed logins
  - unusual number of decryptions
  - admin sign-in from a new location
  - many webhook signature failures
  - AI spend near the ceiling
  - uptime down

### Own-support specifics
- In-app support chats use **Crisp identity verification** (server-signed email). The admin inbox marks unsigned chats **Unverified**, and refund/account requests from them are never acted on without checking (anyone can type someone else's email into a public chat).
- The Slack alert webhook URL is a platform secret (env / Vault).

## 12. Incident response (runbook)
1. **Detect:** alert or report.
2. **Contain:**
   - rotate the worker key pair and re-seal secrets
   - rotate the Crisp plugin token and other platform secrets
   - invalidate all sessions
   - block traffic in Cloudflare if needed
3. **Assess:** what data and which workspaces were affected (audit logs).
4. **Notify** affected customers within **72 hours** (GDPR), with clear steps. We publish how customers can revoke TriageFox's access from Jira, Trello and Crisp on their side.
5. **Post-mortem** published on the changelog/blog.

## 13. Customer controls & privacy
- Toggles for conversation links and customer names (off by default).
- Delete the workspace (everything removed within 7 days); disconnect any tool at any time.
- Privacy policy, terms, DPA template, public **subprocessor list** (Oracle Cloud, Cloudflare, OpenAI, Dodo Payments, Sentry, email provider).

## 14. Self-hosted installs
- The setup script generates the worker key pair, database and Redis passwords; the guide includes a hardening checklist (firewall, backups, updates).
- Self-hosters are responsible for their own server; the app's protections (sealed secrets, RLS, headers) work the same.

## 15. Security checklist by build phase
| Phase | Must be done |
|---|---|
| 0 | Confirm Oracle Vault free-tier availability; confirm Crisp file hosts for the SSRF allowlist; confirm minimal Jira/Trello scopes |
| 1 | Crypto module (sealed boxes, key versions), data-access layer + RLS, security headers, gitleaks + push protection + Dependabot + CodeQL, pino redaction |
| 2 | OAuth `state` + PKCE, sealed storage of tokens, write-only key UI, worker-side calls for listing boards/projects, delete on disconnect |
| 3 | Webhook signature + timestamp, IDs-only event storage, SSRF guard |
| 4 | AI: no tools, strict schema, ID validation, PII stripping, encrypted summaries. **Done:** no tools are offered to the model; output passes the JSON schema + zod + `cleanOutput` (unknown ids dropped); emails/phones/cards are redacted before sending and the evals fail on any personal data in the output; the conversation is fenced as untrusted data and injection cases are in the eval set; the model's answer is stored sealed and cleared after 30 days, plain columns hold no AI-written text; own keys are opened only in the worker; images are shown only from `storage.crisp.chat` |
| 5 | Tokens opened only in the worker for delivery; downloads through `safeDownload` (Crisp host allowlist, 10 MB cap, private addresses refused); ADF/markdown built from text nodes only (no raw HTML, javascript: links not linked); `issues`, `automation_destinations` and `destination_tickets` have RLS; a revoked token pauses the connection; delivery errors shown to customers are plain wording with no provider response bodies |
| 6 | Follow-up and comment text is stored sealed (`issue_updates.content_sealed`) and opened only in the worker; embeddings are computed from redacted customer text; duplicate ids must come from the search results; a person's edits are never overwritten; new tables have RLS |
| 7 | 2FA, step-up re-auth, "Require 2FA" workspace setting, audit log UI, session management |
| 8 | Hardened Compose (internal networks, non-root, read-only), setup script key generation, self-host hardening guide |
| 9 | Admin 2FA + 404 + audit; billing webhooks verified |
| 10 | Cloudflare + origin lock, encrypted backups + restore test, alerts, OWASP ZAP scan, dependency review, **public Security page**, `SECURITY.md`, privacy policy, subprocessor list |

## 16. Public Security page: draft copy (triagefox.com/security)

> **Your data, handled carefully.**
> TriageFox connects to your Crisp, Jira and Trello so it can turn chats into tickets. Here's exactly how we protect that access.
>
> **What we store**: connection tokens for your tools (encrypted), the tickets we create, short encrypted summaries, and usage counts.
> **What we never store**: your chat transcripts (we read them from Crisp when needed and don't keep them), your files and screenshots (they go straight from Crisp to Jira/Trello), and your card details (handled by our payment provider).
>
> **Encryption**: every token and API key is encrypted with its own key. The part of our app that faces the internet can save your credentials but can't read them back; only our background worker can, and only when it needs to create a ticket.
> **Your OpenAI key** is write-only: after you save it, no one, including us, can view it again.
> **Open source**: every line of TriageFox is public on GitHub. You don't have to take our word for any of this.
> **Infrastructure**: protected by Cloudflare, encrypted backups, security updates applied automatically, and two-factor authentication on all admin access.
> **You're in control**: choose whether tickets include customer names or conversation links, disconnect any tool at any time, and delete your workspace and all its data whenever you want.
> **Subprocessors**: Oracle Cloud (hosting), Cloudflare (network), OpenAI (AI analysis), Dodo Payments (billing), Sentry (error tracking), [email provider].
> **Found a vulnerability?** Email security@triagefox.com. We respond within 48 hours.
