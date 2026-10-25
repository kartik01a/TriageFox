# 0005 — Open source (AGPL-3.0) + paid hosted version
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
Goals: resume, YouTube, and income. Solo developer with a ~₹1,000/month budget and no marketing money. A closed SaaS would need paid marketing to get noticed. A pure portfolio project earns nothing.

## Decision
- All code public on GitHub under **AGPL-3.0**.
- Anyone can self-host for free (Docker Compose, their own OpenAI key, their own developer apps).
- Revenue comes from a **hosted version** for teams that don't want to run servers or register Crisp, Trello and Atlassian developer apps.
- All features are in the open code for now. Paid-only extras (SSO, audit export, priority support) are an option for later, not a plan.
- Contributions need a simple **CLA**, so the owner keeps the right to relicense.

## Alternatives considered
- **Private SaaS:** needs a marketing budget we don't have, and the code can't be shown on YouTube.
- **Portfolio only (MIT):** no income, and any company could host a closed copy.
- **MIT/Apache + hosted:** allows closed hosted competitors; AGPL discourages that.

## Consequences
- Free distribution through GitHub, YouTube, Reddit and Hacker News; trust from public code (important when holding Jira/Trello access).
- Need a self-host package and docs (roadmap Phase 8), `APP_MODE=hosted|selfhost`, and bring-your-own AI key.
- Security must not rely on hidden code; all secrets in env vars.
- Some companies avoid AGPL software. That's acceptable, since they can use the hosted version.
