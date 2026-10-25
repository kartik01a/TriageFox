# 0006 — Crisp as the MVP source (replaces Featurebase)
- **Status:** Accepted
- **Date:** 2026-10-25
- **Supersedes:** the Featurebase source in the original MVP plan and in [0004](0004-per-provider-auth.md)

## Context
Featurebase API and webhook access appears to need a paid plan (around $59/seat/month), which is too expensive for testing on our budget. Featurebase is also a small company with native Jira/Linear sync for posts, so its market is small and it could ship this feature itself.

## Decision
The MVP source is **Crisp**:
- **Free to build against:** a free Marketplace developer signup; the development token works on our own Crisp website.
- **Signed plugin hooks** (`message:send`, `message:received`, `session:set_state`) plus a REST API.
- Large small-business customer base that already pays for tools.
- **Crisp Marketplace** brings users to us for free.
- An existing competitor plugin (Jira Boss AI, Jira-only) shows demand. We add Trello, ticket updates, duplicate merging and open source.

Connection works by **installing our plugin** (no API key from the user). The fallback if a free Crisp workspace can't test plugins is **Chatwoot** (free, self-hosted).

Featurebase moves to the integrations roadmap ([roadmap.md](../roadmap.md#integrations-roadmap)).

## Alternatives considered
- **Featurebase:** paid API access, small market.
- **Chatwoot first:** free and open source, but its users pay less. Planned as the second source.
- **tawk.to:** free and huge, but very price-sensitive users and a REST API in private beta.
- **Intercom / Zendesk / Freshdesk:** already have native Jira apps; harder to stand out.

## Consequences
- Pipeline changes: one hook endpoint routed by `website_id`; no event id, so a computed dedupe key; a reconcile job because Crisp can drop hooks after repeated failures.
- Self-hosters must create their own Crisp plugin (documented), which is another reason to choose hosted.
- Plugin must pass Crisp Marketplace review before the hosted launch.
