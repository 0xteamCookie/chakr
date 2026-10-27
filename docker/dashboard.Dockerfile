# syntax=docker/dockerfile:1
# Build context: repo root.
FROM node:22-bookworm-slim AS build
RUN npm i -g pnpm@12.4.2 --no-fund --no-audit
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json packages/core/
COPY packages/mcp-proxy/package.json packages/mcp-proxy/
COPY packages/sdk/package.json packages/sdk/
COPY apps/dashboard/package.json apps/dashboard/
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter @agentshield/dashboard...
COPY tsconfig.base.json ./
COPY apps/dashboard apps/dashboard
# Baked into the browser bundle: the URL the *browser* uses to reach core.
ARG NEXT_PUBLIC_API_URL=http://localhost:4317
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @agentshield/dashboard build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
WORKDIR /app/apps/dashboard
ENV PATH=/app/apps/dashboard/node_modules/.bin:$PATH NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
CMD ["next", "start", "-p", "3000"]
