# 0004 — Per-provider auth method
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
Not every tool supports the same auth. Asking SaaS users to create developer keys is poor UX where OAuth-style flows exist.

## Decision
Use the best method each provider offers:
- **Featurebase:** API key (pasted by user).
- **Trello:** platform-owned app key + Trello authorize flow ("Connect Trello" button) → user token.
- **Jira Cloud:** OAuth 2.0 (3LO) ("Connect Jira" button); fallback: site URL + email + API token.
- Future connectors: OAuth where available (Linear, GitHub App, ClickUp, Asana, Notion), API key otherwise.

All credentials encrypted per [security.md](../security.md).

## Alternatives considered
- **API keys everywhere** — simpler to build, but worse UX and users hand over broader-scoped personal tokens.

## Consequences
- Need registered apps (Atlassian developer console, Trello Power-Up/app key) and OAuth callback routes.
- Token refresh handling for Jira.
