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
| [billing.md](billing.md) | Merchant of record, fees, payment methods, trial, limits, admin-managed plans (hosted only) |
| [setup/providers.md](setup/providers.md) | Registering the Trello, Atlassian and Crisp apps (owner / self-host checklist) |
| [development.md](development.md) | How to run, test and extend the codebase locally |
| [security.md](security.md) | **Full security plan**: threats, encryption, data minimisation, 2FA, infra, incident runbook, phase checklist, public Security page copy |
| [edge-cases.md](edge-cases.md) | What can go wrong and how each case is handled |
| [testing.md](testing.md) | Test strategy, scenarios, acceptance criteria |
| [roadmap.md](roadmap.md) | Build phases, **integrations roadmap**, future updates |
| [plans/](plans/) | Dated implementation plans |
| [ui-ux.md](ui-ux.md) | Landing page, pricing page, onboarding and app UI plan |
| [own-support.md](own-support.md) | Our own support: Crisp widget, admin inbox, email + Slack alerts |
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
- 2026-10-25: Planning complete (ADRs 0001–0011, pricing, security, UI, own support). `CLAUDE.md` added for implementation. Repo private until launch-ready. **Next: Phase 0 (API spike).**
- 2026-10-25: **Phase 0 (API spike) done**: findings recorded in `docs/integrations/*.md`.
- 2026-10-26: **Phase 1 (Foundation) done**: monorepo, dev infra, database + row-level security, sealed-box crypto, auth + workspaces + invitations, landing v0 with waitlist and Crisp support widget, worker skeleton, CI. See [development.md](development.md). **Next: Phase 2 (Connections).**
- 2026-10-26: **Phase 2 (Connections) done**: Crisp, Trello and Jira connections, pickers, OpenAI key entry, worker request channel; verified live against the real providers. **Next: Phase 3 (Ingest + queue).**
- 2026-10-26: **Phase 3 (Ingest + queue) done**: signed Crisp hook route, IDs-only event store, debounced per-conversation evaluation with locking, reconcile, SSRF-safe file downloads; verified live against real Crisp conversations. **Next: Phase 4 (AI triage).**
