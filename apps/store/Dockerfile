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
RUN npm ci

FROM node:20-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build -w @petrospecial/store

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /workspace/apps/store/.next/standalone ./
COPY --from=build /workspace/apps/store/.next/static ./apps/store/.next/static
COPY --from=build /workspace/apps/store/public ./apps/store/public
EXPOSE 3000
CMD ["node", "apps/store/server.js"]
