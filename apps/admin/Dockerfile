# syntax=docker/dockerfile:1
# Build context is the repo root (npm workspaces) — see docker-compose.yml.
FROM node:20-alpine AS deps
WORKDIR /workspace
COPY package.json package-lock.json* ./
COPY apps/store/package.json apps/store/package.json
COPY apps/admin/package.json apps/admin/package.json
COPY apps/driver/package.json apps/driver/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY services/api/package.json services/api/package.json
COPY services/realtime/package.json services/realtime/package.json
COPY services/zatca-sim/package.json services/zatca-sim/package.json
COPY workers/package.json workers/package.json
RUN npm ci --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build -w @petrospecial/admin

FROM node:20-alpine AS runner
RUN apk update && apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production
# Docker sets HOSTNAME to the container ID; Next's standalone server binds to
# that instead of 0.0.0.0 when set, which breaks loopback (healthchecks).
ENV HOSTNAME=0.0.0.0
# The standalone server only reads the generic PORT var, not ADMIN_PORT.
ENV PORT=3001
COPY --from=build /workspace/apps/admin/.next/standalone ./
COPY --from=build /workspace/apps/admin/.next/static ./apps/admin/.next/static
COPY --from=build /workspace/apps/admin/public ./apps/admin/public
EXPOSE 3001
CMD ["node", "apps/admin/server.js"]
