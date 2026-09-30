# syntax=docker/dockerfile:1
# Backend image: one image for the API and the worker (different commands),
# plus a "tools" target for migrations and scripts.
# Build from the repository root: docker build -f backend/Dockerfile .

# Full install (dev dependencies included) and TypeScript build. The full
# node image already has OpenSSL, which Prisma's migration engine needs.
FROM node:22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
COPY backend/prisma backend/prisma
COPY backend/prisma.config.ts backend/
# postinstall generates the Prisma client from the schema.
RUN npm ci --workspace backend
COPY backend/tsconfig.json backend/tsconfig.build.json backend/
COPY backend/src backend/src
RUN npm run build --workspace backend

# Migrations and one-off scripts (seed:senders, search:reindex):
#   docker compose -f docker-compose.prod.yml run --rm migrate npm run seed:senders -- --verify
FROM build AS tools
WORKDIR /app/backend
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:22-slim AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace backend --omit=dev --ignore-scripts && mkdir -p backend/node_modules

# API (default) or worker (command: node dist/worker.js).
# The API and worker only talk to MySQL through the JS driver: no OpenSSL needed.
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules node_modules
COPY --from=prod-deps /app/backend/node_modules backend/node_modules
COPY --from=build /app/backend/dist backend/dist
COPY backend/package.json backend/
WORKDIR /app/backend
USER node
EXPOSE 4000
CMD ["node", "dist/server.js"]
