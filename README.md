# TriageFox

Open-source AI that turns customer chats into Jira and Trello tickets, with priority, steps to reproduce and screenshots attached.

> **Status:** under active development (pre-launch). Licensed under [AGPL-3.0](LICENSE).

## Develop locally

Requirements: Node 22, pnpm 10, Docker.

```bash
pnpm install
pnpm keys:generate      # creates .env with local secrets (never printed)
pnpm infra:up           # Postgres (pgvector), Redis, Mailpit
pnpm db:migrate && pnpm db:seed
pnpm dev                # web on http://localhost:3000, worker alongside
```

Emails sent locally (verification, invitations) appear in Mailpit at http://localhost:8025.

```bash
pnpm lint && pnpm typecheck && pnpm test      # unit and database tests
pnpm --filter @triagefox/web e2e              # browser tests (needs `pnpm dev` or it starts one)
```

More: [docs/development.md](docs/development.md) · [docs/security.md](docs/security.md) · [SECURITY.md](SECURITY.md)
