# Contributing to TriageFox

Thank you for wanting to help. TriageFox is open source (AGPL-3.0) and built mostly by one person, so a little structure keeps things moving.

## Before you start

- **Small fixes** (typos, bugs with a clear cause): open a pull request directly.
- **Anything bigger** (a new connector, a new feature, a change in how tickets look): open an issue first and describe what you want to do, so we agree before you spend time. The design is documented in [docs/](docs/): decisions live in `docs/decisions/` and changing one needs a discussion.
- **Security problems**: do not open an issue. See [SECURITY.md](SECURITY.md).

## The Contributor License Agreement (CLA)

By opening a pull request you agree to the short [CLA](CLA.md). It lets the project owner keep the right to offer the code under other licences later (for example for a hosted service), while you keep ownership of your work. Without it we cannot merge.

## Running it locally

See [docs/development.md](docs/development.md). In short: Node 22, pnpm 10, Docker, then `pnpm install`, `pnpm keys:generate`, `pnpm infra:up`, `pnpm db:migrate && pnpm db:seed`, `pnpm dev`.

## Before you open a pull request

```bash
pnpm lint && pnpm typecheck && pnpm test
pnpm --filter @triagefox/web e2e      # if you changed anything users can see
```

- Match the code around you: small modules, clear names, comments only where the *why* isn't obvious.
- New behaviour needs a test. A change to the AI prompt or rules needs the eval run (`pnpm --filter @triagefox/ai eval`) with results in the description.
- Update the matching page in `docs/` in the same pull request.
- Never commit secrets, real customer data or `.env` files. A scanner runs on every commit and in CI.
- Keep pull requests focused: one change, explained in plain words (what, why, how you tested it).

## Adding a connector

A new chat source or ticket tool follows [docs/integrations/adding-a-connector.md](docs/integrations/adding-a-connector.md).

## Conduct

Be kind and be useful. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
