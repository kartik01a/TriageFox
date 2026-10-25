# Architecture Decision Records

One file per significant decision: `NNNN-short-name.md`. Accepted ADRs are not edited — write a new one that supersedes it.

| # | Decision | Status |
|---|---|---|
| [0001](0001-typescript-stack.md) | TypeScript monorepo stack | Accepted |
| [0002](0002-openai.md) | OpenAI as AI provider | Accepted |
| [0003](0003-stripe.md) | Stripe for billing | Accepted (revisit before launch) |
| [0004](0004-per-provider-auth.md) | Per-provider auth method | Accepted |

## Template

```md
# NNNN — Title
- **Status:** Proposed | Accepted | Superseded by NNNN
- **Date:** YYYY-MM-DD

## Context
What problem or force requires a decision.

## Decision
What we chose.

## Alternatives considered
Option — why not.

## Consequences
What this makes easier / harder; follow-ups.
```
