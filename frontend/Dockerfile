# syntax=docker/dockerfile:1
# Next.js standalone server. Build from the repository root:
#   docker build -f frontend/Dockerfile --build-arg BACKEND_URL=http://api:4000 .

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --workspace frontend --ignore-scripts
COPY frontend frontend
# Where the Next.js server reaches the API. The /api rewrites are fixed at
# build time, so this is a build argument.
ARG BACKEND_URL=http://api:4000
ENV BACKEND_URL=$BACKEND_URL NEXT_TELEMETRY_DISABLED=1
RUN npm run build --workspace frontend

FROM node:22-slim AS runtime
WORKDIR /app
ARG BACKEND_URL=http://api:4000
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0 \
  BACKEND_URL=$BACKEND_URL
COPY --from=build --chown=node /app/frontend/.next/standalone ./
COPY --from=build --chown=node /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=node /app/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
