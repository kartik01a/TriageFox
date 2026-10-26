# syntax=docker/dockerfile:1.7
# Builds the two TriageFox images from one monorepo checkout:
#   docker build -f deploy/Dockerfile --target web    -t triagefox/web .
#   docker build -f deploy/Dockerfile --target worker -t triagefox/worker .
# The worker image also contains the database migration tool and the secret generator.

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile
# Git does not keep empty folders: make sure the (possibly empty) public folder exists to copy later.
RUN mkdir -p apps/web/public
RUN pnpm --filter @triagefox/web build
RUN pnpm --filter @triagefox/worker build
# Production dependencies only, for the worker (workspace packages are bundled into dist/).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @triagefox/worker deploy --prod --legacy /out/worker

# ---- worker: the only container that holds the private key -----------------------------------
FROM node:22-bookworm-slim AS worker
ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/drizzle
WORKDIR /app
COPY --from=build /out/worker/node_modules ./node_modules
COPY --from=build /repo/apps/worker/dist ./dist
COPY --from=build /repo/packages/db/drizzle ./drizzle
USER node
CMD ["node", "dist/index.js"]

# ---- web: Next.js standalone server (public keys only) --------------------------------------
FROM node:22-bookworm-slim AS web
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build /repo/apps/web/.next/standalone ./
COPY --from=build /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /repo/apps/web/public ./apps/web/public
USER node
CMD ["node", "apps/web/server.js"]
