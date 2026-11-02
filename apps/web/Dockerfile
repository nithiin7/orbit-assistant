# syntax=docker/dockerfile:1
#
# Orbit web image. Build from the repository root, which holds the pnpm workspace:
#
#   docker build -f apps/web/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://orbit.example.com -t orbit-web .
#
# NEXT_PUBLIC_API_URL is inlined into the browser bundle at build time, so it must be the API's
# address as the browser reaches it. It is public; never pass secrets as build arguments.

ARG NODE_VERSION=24

FROM node:${NODE_VERSION}-slim AS base
ENV PNPM_HOME=/pnpm \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    NEXT_TELEMETRY_DISABLED=1 \
    HUSKY=0
ENV PATH="${PNPM_HOME}:${PATH}"
# The pnpm version comes from `packageManager` in the root package.json.
RUN corepack enable
WORKDIR /repo


FROM base AS deps
# Manifests first, so dependencies are reused until the lock file or a manifest changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/contracts/package.json packages/contracts/
COPY packages/eslint-config/package.json packages/eslint-config/
COPY packages/typescript-config/package.json packages/typescript-config/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@orbit/web..."


FROM deps AS build
COPY packages packages
COPY apps/web apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:8000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
RUN pnpm --filter @orbit/web build


FROM node:${NODE_VERSION}-slim AS runtime

LABEL org.opencontainers.image.title="Orbit web" \
      org.opencontainers.image.description="Web app for Orbit, a privacy-first personal assistant." \
      org.opencontainers.image.licenses="Apache-2.0"

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    HOSTNAME=0.0.0.0 \
    PORT=3000

WORKDIR /app

# The standalone server and only the dependencies it traced, plus static assets it serves.
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./apps/web/.next/static

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]

CMD ["node", "apps/web/server.js"]
