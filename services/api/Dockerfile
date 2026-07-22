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
COPY packages/auth-shared/package.json packages/auth-shared/package.json
COPY packages/observability/package.json packages/observability/package.json
COPY services/api/package.json services/api/package.json
COPY services/realtime/package.json services/realtime/package.json
COPY services/zatca-sim/package.json services/zatca-sim/package.json
COPY workers/package.json workers/package.json
RUN npm ci --ignore-scripts

FROM node:20-alpine AS build
WORKDIR /workspace
COPY --from=deps /workspace/node_modules ./node_modules
COPY . .
RUN npm run build -w @petrospecial/contracts -w @petrospecial/auth-shared -w @petrospecial/observability -w @petrospecial/api

FROM node:20-alpine AS runner
RUN apk update && apk upgrade --no-cache
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /workspace/node_modules ./node_modules
COPY --from=build /workspace/services/api/package.json ./package.json
COPY --from=build /workspace/services/api/dist ./dist
COPY --from=build /workspace/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /workspace/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /workspace/packages/auth-shared/package.json ./packages/auth-shared/package.json
COPY --from=build /workspace/packages/auth-shared/dist ./packages/auth-shared/dist
COPY --from=build /workspace/packages/observability/package.json ./packages/observability/package.json
COPY --from=build /workspace/packages/observability/dist ./packages/observability/dist
RUN sed -i 's#"src/index.ts"#"dist/index.js"#' packages/contracts/package.json packages/auth-shared/package.json packages/observability/package.json
EXPOSE 4000
CMD ["node", "dist/index.js"]
