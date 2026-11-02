# Architecture Decision Records

One file per significant decision: `NNNN-short-name.md`. Don't edit an accepted ADR's decision; write a new one that supersedes it, and update the old one's status line.

| # | Decision | Status |
|---|---|---|
| [0001](0001-typescript-stack.md) | TypeScript monorepo stack | Accepted (hosting → 0007) |
| [0002](0002-openai.md) | OpenAI as AI provider | Accepted |
| [0003](0003-stripe.md) | Stripe for billing | Superseded by 0008 |
| [0004](0004-per-provider-auth.md) | Per-provider auth method | Accepted (Featurebase → 0006) |
| [0005](0005-open-core-agpl.md) | Open source (AGPL) + paid hosted version | Accepted |
| [0006](0006-crisp-as-mvp-source.md) | Crisp as MVP source, replacing Featurebase | Accepted |
| [0007](0007-hosting-single-vps.md) | One server with Docker Compose | Accepted |
| [0008](0008-billing-merchant-of-record.md) | Global billing through a merchant of record | Accepted |
| [0009](0009-config-in-db-admin-routes.md) | Plans, trial and platform settings in the DB, managed via admin routes | Accepted |
| [0010](0010-security-architecture.md) | Security architecture: sealed secrets, no transcripts, Cloudflare | Accepted |
| [0011](0011-own-support-admin-inbox.md) | Own support via Crisp, triaged into an admin inbox | Accepted |
| [0012](0012-seven-day-trial.md) | The free trial is 7 days | Accepted |
| [0013](0013-customer-label-mapping.md) | Customers choose the labels on their tickets | Accepted |

## Template

```md
# NNNN — Title
- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
What problem or constraint calls for a decision.

## Decision
What we chose.

## Alternatives considered
Each option, and why we didn't pick it.

## Consequences
What this makes easier or harder; follow-ups.
```
