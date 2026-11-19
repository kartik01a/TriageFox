# Development

## Layout
```
apps/web        Next.js 16 app: landing, auth, workspaces, API routes (per-request CSP via src/proxy.ts)
apps/worker     Node worker (BullMQ). Only the worker can decrypt stored secrets
packages/db     Drizzle schema + migrations, withOrg() (row-level security), seed
packages/crypto Sealed-box secret storage with key versions and owner binding
packages/shared Env validation (zod), logger with redaction
deploy/         compose.dev.yml (Postgres+pgvector, Redis, Mailpit), postgres init (roles)
scripts/        secret-scan.mjs (pre-commit + CI)
spikes/         Phase 0 throwaway API probes (kept for reference)
```

## First run
`pnpm install` → `pnpm keys:generate` → `pnpm infra:up` → `pnpm db:migrate && pnpm db:seed` → `pnpm dev`.

Ports are offset to avoid clashes: Postgres **54320**, Redis **63790**, Mailpit SMTP 1025 / UI **8025**, web **3000**.

## Database roles (important)
- `triagefox` (owner): runs migrations only. Bypasses row-level security. Variable: `DATABASE_MIGRATION_URL`.
- `triagefox_app`: used by the web app and worker. Does **not** own tables, so RLS always applies. Variable: `DATABASE_URL`.

Tenant tables must be enabled for RLS in their migration and queried through `withOrg(db, orgId, tx => ...)` (see `packages/db/src/rls.test.ts`). Better Auth's own tables (user, session, organization, ...) are managed by Better Auth and are not RLS tables.

New migration: edit `packages/db/src/schema/*`, then `pnpm db:generate`, review the SQL, `pnpm db:migrate`. For RLS or other raw SQL: `pnpm --filter @triagefox/db exec drizzle-kit generate --custom --name <name>`.

## Secrets & keys
- `pnpm keys:generate` fills missing values in `.env` (never overwrites, never prints secrets).
- The web app only gets `CRYPTO_PUBLIC_KEYS`. **`CRYPTO_PRIVATE_KEYS` belongs to the worker only.**
- Rotation: add a new key version to both key maps, bump `CRYPTO_CURRENT_VERSION`; old values stay readable until resealed (`needsReseal`).
- A pre-commit hook (`.githooks`, enabled by `pnpm install`) blocks commits containing secrets or values from your `.env`. Mark deliberate fake keys in tests with a `secret-scan:ignore` comment. Install `gitleaks` for deeper local scanning.

## Notes on the web app
- Every page renders per request (`dynamic = "force-dynamic"` in the root layout). Required: the nonce-based CSP needs a fresh nonce in the HTML, and it keeps `next build` free of runtime secrets.
- Auth is created lazily (`getAuth()`), so builds don't need env.
- In production, client IP for rate limiting comes only from `CF-Connecting-IP` (Cloudflare).
- Crisp's widget skips headless/bot user agents; test it with a normal user-agent string.

## Connections need the worker
Anything that needs a customer's token runs in the worker, so `pnpm dev` (web + worker) is required for the Connections pages. Provider setup (Trello key, Atlassian app, Crisp plugin): [setup/providers.md](setup/providers.md).

## Pipeline notes
- `CRISP_HOOK_SECRET` (web) must equal the signing secret in the Crisp plugin; the worker needs `CRISP_PLUGIN_ID/KEY/UUID`. `RECONCILE_LOOKBACK_MIN` (worker, default 180) widens or narrows what the reconcile job re-checks.
- To try the hook path by hand with the dev Crisp website: run `pnpm dev`, point the Crisp development web hook at your ngrok domain (`/api/webhooks/crisp`), create a linked Crisp connection and an enabled automation (the UI for automations arrives in Phase 7; tests create rows directly), then chat from the Crisp chat page.
- Jobs: BullMQ queue `pipeline` (`thread.evaluate`, `crisp.reconcile`, `ticket.deliver`, `ticket.update`, `billing.reminders`, `maintenance.cleanup`, `connections.keepalive`). Tests use their own random queue names so they never collide with a running worker.

## AI notes
- Set `OPENAI_API_KEY` in `.env` (platform key; a workspace's own key entered in the app takes priority).
- Evals call the real API (about $0.03, 2 minutes): `pnpm --filter @triagefox/ai eval` (`-- --model sol`, `-- --filter injection`). Run after any prompt, rubric or model change.
- Unit tests use a fake provider and need no key.

## Trying it by hand
1. `pnpm infra:up`, `pnpm dev` (the worker must run too; `pnpm dev` starts it); sign in and open **Setup** (`/app/setup`). It walks through connecting Crisp, Trello/Jira, choosing the board/project, settings, a dry run on your last chats, and the on switch. (`pnpm db:dev-automation <orgId>` still works as a shortcut for scripts.)
2. Chat as a visitor in Crisp (a screenshot is a good test), wait for the quiet window (3 min; resolving the chat runs it at once) and watch the card/issue appear.

## Pre-launch checks (run by hand)
- **Dependencies:** `pnpm audit --prod` (CI fails on high or critical).
- **Secrets in history:** `docker run --rm -v "$PWD:/repo" zricethezav/gitleaks:latest detect --source /repo --redact --no-banner`.
- **Lighthouse** (Lighthouse is a pinned dev dependency): build and start the production server (`pnpm --filter @triagefox/web build`, then `next start` with the `.env` values exported), then `CHROME_PATH=<a Chrome or Chromium binary> pnpm exec lighthouse http://localhost:3100/ --only-categories=performance,accessibility,best-practices,seo --chrome-flags="--headless=new --no-sandbox"`. Playwright's Chromium works (`~/Library/Caches/ms-playwright/…`).
- **OWASP ZAP baseline:** `docker run --rm -v /tmp:/zap/wrk ghcr.io/zaproxy/zaproxy:stable zap-baseline.py -t http://host.docker.internal:3100 -r zap-report.html -I`.
- **Self-host stack:** `./deploy/smoke-test.sh` (also run in CI).

## Tests
- Billing in the browser tests uses a stand-in payment provider (`E2E_FAKE_BILLING=true`, set by `playwright.config.ts`; ignored in production), so checkout, webhooks and plan changes run without real payments.
- End-to-end specs sign up real users; the sign-up route allows 5 per minute per IP, so when running the whole Playwright suite right after other specs a sign-up can be refused. Re-run the failing spec on its own.
- Unit/integration: Vitest per package (db tests need `pnpm infra:up`).
- Browser: Playwright in `apps/web/e2e` (reads emails from Mailpit). The test setup starts the worker itself (set `E2E_NO_WORKER=1` to use your own).
- **Live checks**: when real credentials are in `.env` the e2e suite also runs against the real Crisp, Trello, Jira and OpenAI APIs and skips those tests otherwise (e.g. in CI). They clean up after themselves and never revoke your tokens. Jira's rotating refresh token is kept in `spikes/.tokens.json` (git-ignored); if it is ever lost, re-run `pnpm --filter triagefox-spikes jira` to authorize again.
