# 0007 — Hosting on one server with Docker Compose
- **Status:** Accepted
- **Date:** 2026-10-25
- **Supersedes:** the hosting line of [0001](0001-typescript-stack.md) (Railway)

## Context
Budget is about ₹1,000/month. We need always-on processes (webhook endpoint, worker, Redis). Self-hosters also need a simple install.

## Decision
Run everything on **one server with Docker Compose**: web, worker, Postgres (+pgvector), Redis, and Caddy for automatic HTTPS.
- **Development, demo and beta:** **Oracle Cloud Always Free** ARM VM (₹0). In 2026 the allowance was cut to 2 OCPU / 12 GB, which is still plenty for this stack.
- **Once paying customers arrive** (or if Oracle reclaims the VM or has no capacity): move to a small paid VPS such as Hetzner (~₹450/month). It's the same Compose file, so moving is just restoring a backup.
- Nightly `pg_dump` backups to free object storage.
- The **same Compose file** is the self-host package.

## Alternatives considered
- **Railway / Render / Fly:** easy, but usage-based costs grow beyond the budget once web, worker, Postgres and Redis run all the time.
- **Vercel + managed DB/Redis:** splits the system across vendors, free-tier limits on Redis commands hurt BullMQ, and it doesn't help self-hosters.
- **Google Cloud Run:** its free tier suits the web app, which only uses CPU while handling requests. But our **worker must run 24/7**: delayed jobs, debouncing, the reconcile job. One always-on vCPU is ~2.6M vCPU-seconds/month, about 11× the free allowance. Cloud Run also doesn't host Postgres or Redis. Cloud SQL and Memorystore cost money, and free outside services (Neon, Upstash) have limits that hurt an always-polling queue. Making it fit would mean rebuilding around Cloud Tasks and Cloud Scheduler, which locks us into Google and breaks the "same Compose file for self-hosters" idea.

## Consequences
- Near-zero cost; one deploy target for hosted and self-hosted.
- We handle server updates, backups and monitoring ourselves (uptime check with a free monitor).
- A single server is a single point of failure. Acceptable at MVP scale; move to managed services once there's revenue.
- **Oracle risk:** Always Free VMs can be **reclaimed if idle**: over 7 days, 95th-percentile CPU, network and memory all below 20%. A low-traffic MVP may count as idle. Mitigations: nightly off-server backups, keep the paid-VPS option ready, and consider upgrading the Oracle account to Pay-As-You-Go (verify Oracle's current rules first). Oracle also needs a card for sign-up, and free ARM capacity is sometimes unavailable in a region.
