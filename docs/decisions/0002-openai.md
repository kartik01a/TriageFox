# 0002 — OpenAI as AI provider
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
Triage must be accurate (the product depends on it), read customer screenshots, return reliably structured output, and support duplicate detection. Available keys: OpenAI and DeepSeek (no Anthropic key).

## Decision
OpenAI: small model by default, stronger model for long/ambiguous/image-heavy threads, `text-embedding-3-small` for embeddings. Model names in config. All calls go through an `AiProvider` interface.

## Alternatives considered
- **DeepSeek** — cheaper, but (as of this decision) no image input and no embeddings API, so screenshots and duplicate search would need a second provider anyway. Kept as a possible text-only fallback.
- **Anthropic Claude** — strong option; no key currently. The provider interface keeps it pluggable.

## Consequences
- Vision + strict JSON structured outputs + embeddings from one vendor.
- Platform pays AI costs → per-org usage tracking and plan limits required.
- Customer transcripts go to OpenAI → disclose in privacy policy.
