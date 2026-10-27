# syntax=docker/dockerfile:1
# Build context: repo root.
# pnpm pinned to the version the lockfile/policy was verified with (corepack rejects packageManager "pnpm@10")
FROM node:22-bookworm-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* && npm i -g pnpm@12.4.2 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-proxy/package.json packages/mcp-proxy/
COPY packages/sdk/package.json packages/sdk/
COPY apps/dashboard/package.json apps/dashboard/
# prisma generate runs in core's postinstall, so the schema must exist first
COPY packages/core/prisma packages/core/prisma
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @agentshield/core...
COPY tsconfig.base.json ./
COPY packages/core packages/core

FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/* 
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/packages/core
ENV PATH=/app/packages/core/node_modules/.bin:$PATH NODE_ENV=production PORT=4317 AGENTSHIELD_DATA_DIR=/data DATABASE_URL=file:/data/agentshield.db
RUN mkdir /data && chown node:node /data
VOLUME /data
USER node
EXPOSE 4317
# first run: create/upgrade the SQLite schema, then start the server
CMD ["sh", "-c", "prisma db push --skip-generate && exec tsx src/server.ts"]
