# 0001 — TypeScript monorepo stack
- **Status:** Accepted
- **Date:** 2026-10-25

## Context
We need a dashboard, webhook endpoints, OAuth callbacks, a background worker with delayed/debounced jobs and retries, and several REST API clients. No heavy ML — the AI work is API calls. The user was open to any language.

## Decision
TypeScript everywhere in a pnpm + Turborepo monorepo: Next.js (web), Node worker with BullMQ + Redis, Postgres + pgvector via Drizzle, zod, Better Auth (orgs), pino + Sentry. Host on Railway initially.

## Alternatives considered
- **Python (FastAPI + Celery)** — fine for workers, but needs a separate frontend stack and duplicates schemas across two languages.
- **Postgres-only queue (pg-boss / Graphile Worker)** — fewer moving parts, but BullMQ's delayed jobs, deduplication, rate limiting, and bull-board UI fit debounce + per-connection limits better.
- **Clerk for auth** — fastest, but paid per MAU; Better Auth is free and has organizations.
- **Vercel for web** — webhook + worker split across hosts adds complexity for MVP.

## Consequences
- One language and shared zod schemas across API, UI, and AI output validation.
- Redis is an extra service to run.
- Revisit hosting when traffic justifies it.
