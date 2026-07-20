# syntax=docker/dockerfile:1
# Build context is ./db — self-contained, not an npm workspace (plain SQL migrations).
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY migrations ./migrations
ENTRYPOINT ["npx", "node-pg-migrate", "-m", "migrations", "--migration-file-language", "sql"]
CMD ["up"]
