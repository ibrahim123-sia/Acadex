# Acadex API — production image. Build from the repository root:
#   docker build -f apps/api/Dockerfile -t acadex-api .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @acadex/api --include-workspace-root
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @acadex/api

FROM node:22-alpine AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --workspace @acadex/api --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S acadex && adduser -S acadex -G acadex
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/api/drizzle ./drizzle
COPY --from=build /repo/apps/api/migrations ./migrations
COPY apps/api/package.json ./package.json
USER acadex
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:5000/api/health || exit 1
# apply pending migrations, then serve
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
