# 0010 — Security architecture: sealed secrets, no transcript storage, Cloudflare in front
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
Customers trust us with Jira/Trello tokens, Crisp conversation access and OpenAI keys. The code is public, the server is a single VM, and the team is one person, so protections must be built into the design, not depend on hidden code or constant monitoring.

## Decision
1. **Sealed-box envelope encryption:** the web app holds only a public key (can store secrets, can't read them); only the worker holds the private key, kept in Oracle Vault if free, otherwise a root-only file mounted into the worker only.
2. **No chat transcripts stored:** fetch on demand; keep IDs, tickets, encrypted summaries and decisions. Webhook events store IDs only.
3. **Cloudflare (free) in front**, with the origin firewall accepting traffic only from Cloudflare.
4. **2FA:** required for platform admins; optional for customers with strong prompts, plus a workspace "Require 2FA" setting; step-up re-auth for sensitive actions.
5. **Postgres row-level security** in addition to the org-scoped data layer.

## Alternatives considered
- **Single symmetric master key in the web + worker env:** simpler, but any web-route bug could expose every secret.
- **Store transcripts for debugging:** convenient, but turns a breach into a leak of customers' customer conversations.
- **Mandatory 2FA for all customers:** most secure, but adds sign-up friction before the product has proven its value.

## Consequences
- Wizard calls that need decrypted tokens go through the worker (internal RPC), which adds a little latency and code.
- Debugging needs a re-fetch from Crisp.
- Key rotation needs a re-seal job (documented runbook).
