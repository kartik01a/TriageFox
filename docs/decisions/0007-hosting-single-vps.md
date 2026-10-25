# 0007 — Hosting on one server with Docker Compose
- **Status:** Accepted
- **Date:** 2026-10-25
- **Supersedes:** the hosting line of [0001](0001-typescript-stack.md) (Railway)

## Context
Budget is about ₹1,000/month. We need always-on processes (webhook endpoint, worker, Redis). Self-hosters also need a simple install.

## Decision
Run everything on **one server with Docker Compose**: web, worker, Postgres (+pgvector), Redis, and Caddy for automatic HTTPS.
- First choice: **Oracle Cloud Always Free** ARM VM (₹0).
- Fallback: a small VPS such as Hetzner (~₹450/month).
- Nightly `pg_dump` backups to free object storage.
- The **same Compose file** is the self-host package.

## Alternatives considered
- **Railway / Render / Fly:** easy, but usage-based costs grow beyond the budget once web, worker, Postgres and Redis run all the time.
- **Vercel + managed DB/Redis:** splits the system across vendors, free-tier limits on Redis commands hurt BullMQ, and it doesn't help self-hosters.

## Consequences
- Near-zero cost; one deploy target for hosted and self-hosted.
- We handle server updates, backups and monitoring ourselves (uptime check with a free monitor).
- A single server is a single point of failure. Acceptable at MVP scale; move to managed services once there's revenue.
