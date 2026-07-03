# syntax=docker/dockerfile:1.7
# ============================================================================
# Backend NestJS (@soe/api) para Fargate ARM.
# IMPORTANTE: el contexto de build es la RAÍZ del monorepo (ver sst.config.ts:
# image.context = "."), porque la API depende de los workspace packages
# @soe/db y @soe/types, que se consumen desde su `dist` compilado.
# Orden de build obligatorio: types -> db -> api.
# ============================================================================

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
# corepack respeta el packageManager (pnpm@10.x) declarado en package.json
RUN corepack enable
WORKDIR /repo

# ── Stage 1: dependencias (capa cacheable por manifiestos) ──────────────────
FROM base AS deps
# Manifiestos raíz + de cada workspace member (pnpm los necesita todos para
# resolver el grafo con --frozen-lockfile).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/db/package.json packages/db/
COPY packages/types/package.json packages/types/
COPY packages/ui/package.json packages/ui/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

# ── Stage 2: build (types -> db -> api) ─────────────────────────────────────
FROM deps AS build
COPY packages/types packages/types
COPY packages/db packages/db
COPY apps/api apps/api
RUN pnpm --filter @soe/types build \
 && pnpm --filter @soe/db build \
 && pnpm --filter @soe/api build
# Poda a un bundle self-contained con solo las deps de PRODUCCIÓN de la API
# (incluye el dist ya compilado de @soe/db y @soe/types como deps inyectadas).
# --legacy es necesario porque .npmrc no usa inject-workspace-packages.
RUN pnpm --filter @soe/api deploy --prod --legacy /app

# ── Stage 3: runtime mínimo ─────────────────────────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app ./
EXPOSE 4000
# main.ts lee API_PORT (default 4000) y hace app.listen() en 0.0.0.0.
CMD ["node", "dist/main.js"]
