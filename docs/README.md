# Project Docs

Documentation for **TriageFox**, an **open-source AI that turns customer chats into Trello and Jira tickets**. The MVP source is Crisp. This folder holds the plans, specs and decisions.

This folder **is pushed** with the code, except [`docs/private/`](private/), which is git-ignored and holds the business analysis, pricing and personal notes. The marketing plan lives in a separate, git-ignored `marketing/` folder at the repo root. Neither is backed up by git, so keep copies elsewhere.

## Index

| Doc | What's in it |
|---|---|
| [overview.md](overview.md) | Problem, vision, business model, scope |
| [requirements.md](requirements.md) | Every product decision agreed so far |
| [architecture.md](architecture.md) | Stack, hosted vs self-hosted, pipeline, thread / update / duplicate logic |
| [data-model.md](data-model.md) | Database tables and relationships |
| [ai-triage.md](ai-triage.md) | Ticket rules, priority rubric, output schema, dates, evals |
| [integrations/crisp.md](integrations/crisp.md) | Source (MVP): Crisp |
| [integrations/trello.md](integrations/trello.md) | Destination (MVP): Trello |
| [integrations/jira.md](integrations/jira.md) | Destination (MVP): Jira Cloud |
| [integrations/featurebase.md](integrations/featurebase.md) | Source (planned): Featurebase |
| [integrations/adding-a-connector.md](integrations/adding-a-connector.md) | How to add a new source or destination |
| [billing.md](billing.md) | Merchant of record, free tier, limits (hosted only) |
| [security.md](security.md) | Credentials, Crisp linking, PII, logging |
| [edge-cases.md](edge-cases.md) | What can go wrong and how each case is handled |
| [testing.md](testing.md) | Test strategy, scenarios, acceptance criteria |
| [roadmap.md](roadmap.md) | Build phases, **integrations roadmap**, future updates |
| [plans/](plans/) | Dated implementation plans |
| [decisions/](decisions/) | Architecture Decision Records (ADRs) |
| [private/](private/) | **Not pushed.** Business analysis, pricing, personal notes |

## Conventions

- **New plan or feature spec** → `docs/plans/YYYY-MM-DD-<short-name>.md`. Start with *Context*, then the approach, phases, edge cases and verification.
- **A significant decision** (tech choice, trade-off) → a new ADR in `docs/decisions/NNNN-<short-name>.md` using the template in [decisions/README.md](decisions/README.md). Don't edit an accepted ADR's decision; supersede it with a new one.
- **Ideas for later** → "Future updates" or the integrations table in [roadmap.md](roadmap.md).
- **Business, pricing or market material** → `docs/private/`, never the pushed docs.
- **Marketing content** (YouTube scripts, launch posts, outreach) → `marketing/` (git-ignored).
- Nothing in `docs/` may contain secrets (API keys, tokens, real customer data).
- When a plan changes a topic (e.g. adds a table), update that topic's doc too, so the topic docs always reflect the current design.

## Status

- 2026-10-25: MVP plan v1 agreed (Featurebase source). Repo initialised.
- 2026-10-25: **Plan v2** agreed ([plans/2026-10-25-mvp-plan-v2-crisp.md](plans/2026-10-25-mvp-plan-v2-crisp.md)): Crisp replaces Featurebase, open source (AGPL) + hosted model, one-server hosting, global billing through a merchant of record. Next: pricing discussion, then Phase 0 (API spike).
