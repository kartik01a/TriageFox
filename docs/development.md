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

## Tests
- Unit/integration: Vitest per package (db tests need `pnpm infra:up`).
- Browser: Playwright in `apps/web/e2e` (reads emails from Mailpit).
