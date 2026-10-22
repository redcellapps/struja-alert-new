# Build from the repository root:  docker build -f apps/server/Dockerfile -t struja-server .
# The server runs its TypeScript directly with Node's type stripping (no build step).
FROM node:24-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# pg_dump has to match the server's major version (PostgreSQL 18); Debian ships an older one.
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
 && install -d /usr/share/keyrings \
 && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/pgdg.gpg \
 && echo "deb [signed-by=/usr/share/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client-18 \
 && apt-get purge -y --auto-remove curl gnupg \
 && rm -rf /var/lib/apt/lists/*

FROM base AS deps
WORKDIR /app
RUN npm install -g pnpm@12.14.0
COPY . .
# Production dependencies of the server and the workspace packages it uses (hoisted linker).
RUN pnpm install --frozen-lockfile --prod --filter "@struja/server..."

FROM base AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=deps /app /app
# Dumps land here (a volume in compose.prod.yaml).
RUN mkdir -p /backups && chown node:node /backups
ENV BACKUP_DIR=/backups
USER node
EXPOSE 3000
CMD ["node", "apps/server/src/main.ts"]
