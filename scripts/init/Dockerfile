# syntax=docker/dockerfile:1
# Build context is ./scripts/init — self-contained, not an npm workspace.
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY . .
ENTRYPOINT ["node", "run-all.mjs"]
