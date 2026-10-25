# Project Docs

Documentation for the Featurebase → Trello / Jira AI ticket automation SaaS: plans, specs, and decisions.

This folder **is pushed** with the code, except [`docs/private/`](private/), which is git-ignored. Business analysis, pricing, and personal notes go there. Because `docs/private/` is not pushed, keep a backup of it elsewhere.

## Index

| Doc | What's in it |
|---|---|
| [overview.md](overview.md) | Problem, vision, users, scope and non-scope |
| [requirements.md](requirements.md) | Every product decision agreed so far |
| [architecture.md](architecture.md) | Stack, components, pipeline, thread / update / duplicate logic |
| [data-model.md](data-model.md) | Database tables and relationships |
| [ai-triage.md](ai-triage.md) | Ticket rules, priority rubric, output schema, dates, evals |
| [integrations/featurebase.md](integrations/featurebase.md) | Source: Featurebase |
| [integrations/trello.md](integrations/trello.md) | Destination: Trello |
| [integrations/jira.md](integrations/jira.md) | Destination: Jira Cloud |
| [integrations/adding-a-connector.md](integrations/adding-a-connector.md) | How to add a new source/destination |
| [billing.md](billing.md) | Stripe, gating, usage limits |
| [security.md](security.md) | Credentials, scopes, PII, logging |
| [edge-cases.md](edge-cases.md) | Failure modes and how we handle each |
| [testing.md](testing.md) | Test strategy, scenarios, acceptance criteria |
| [roadmap.md](roadmap.md) | Build phases + future updates |
| [plans/](plans/) | Dated implementation plans |
| [decisions/](decisions/) | Architecture Decision Records (ADRs) |
| [private/](private/) | **Not pushed.** Business analysis, pricing, personal notes |

## Conventions

- **New plan or feature spec** → `docs/plans/YYYY-MM-DD-<short-name>.md`. Start with *Context*, then approach, phases, edge cases, verification.
- **A significant decision** (tech choice, trade-off) → new ADR in `docs/decisions/NNNN-<short-name>.md` using the template in [decisions/README.md](decisions/README.md). Never edit an accepted ADR's decision — supersede it with a new one.
- **Ideas for later** → add to "Future updates" in [roadmap.md](roadmap.md).
- **Business, pricing, or market material** → `docs/private/`, never the pushed docs.
- Nothing in `docs/` may contain secrets (API keys, tokens, real customer data).
- When a plan changes a topic doc (e.g. adds a table), update that topic doc too so the topic docs always reflect the current design.

## Status

- 2026-10-25 — MVP plan agreed ([plans/2026-10-25-mvp-plan.md](plans/2026-10-25-mvp-plan.md)). Repo initialised, no app code yet. Next: Phase 0 (API spike).
