# TriageFox

Open-source AI that turns customer chats into Jira and Trello tickets, with priority, steps to reproduce and screenshots attached.

> **Status:** under active development (pre-launch). Licensed under [AGPL-3.0](LICENSE).

<!-- Demo: add the recording as docs/assets/demo.gif, then replace this line with:  ![TriageFox turning a Crisp chat into a Trello card and a Jira issue](docs/assets/demo.gif) -->

## Self-host

Run TriageFox on your own server with Docker Compose: free, your own OpenAI key and developer apps, no billing.

```bash
git clone https://github.com/kartik01a/TriageFox.git && cd TriageFox
./deploy/setup.sh                                   # asks for your domain, generates every secret
# fill in your Crisp / Trello / Jira / OpenAI / email settings in deploy/.env
docker compose -f deploy/docker-compose.yml up -d
```

Step by step, including registering the Crisp, Trello and Atlassian apps, backups and a hardening checklist: **[docs/self-hosting.md](docs/self-hosting.md)**. Prefer not to run servers? The hosted version at triagefox.com does all of that for you.

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
