# Acadex web app — static build served by nginx, which also proxies /api to the API.
#   docker build -f apps/web/Dockerfile -t acadex-web .
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @acadex/web --include-workspace-root
COPY packages/shared packages/shared
COPY apps/web apps/web
ARG VITE_API_URL=/api
ARG VITE_SENTRY_DSN=
RUN npm run build -w @acadex/web

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 80
