# LangRoll API image. Build from the repo root, since the API is an npm workspace:
#   docker build -f apps/api/Dockerfile -t langroll-api .
#
# The same image runs migrations and the server:
#   docker run --env-file .env langroll-api node dist/migrate-cli.js
#   docker run --env-file .env -p 8787:8787 langroll-api

FROM node:22.14-slim AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# Only the API's dependencies, not the site's lint and browser-test tooling.
RUN npm ci --workspace @langroll/api --include-workspace-root=false
COPY apps/api apps/api
RUN npm run build --workspace @langroll/api

FROM node:22.14-slim AS deps
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --workspace @langroll/api --include-workspace-root=false --omit=dev

FROM node:22.14-slim
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8787
WORKDIR /app
COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY apps/api/migrations ./migrations
COPY apps/api/certs ./certs
COPY apps/api/package.json ./
# Run as the image's unprivileged user, not root.
USER node
EXPOSE 8787
CMD ["node", "dist/server.js"]
