import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["{apps,packages,services,workers}/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/.next/**", "**/dist/**"],
    environment: "node",
    environmentMatchGlobs: [["packages/ui/**/*.test.tsx", "jsdom"]],
    // *.e2e.test.ts files each boot a real embedded-postgres (+ minio, for
    // some) process in beforeAll. Running them in parallel across the
    // default threads pool starves out concurrent postgres/npx child-process
    // spawns and fails with an opaque "Unknown Error: undefined" — confirmed
    // reproducible with as few as 2 e2e suites together (S09 handover).
    // Route them to the forks pool, single-forked, so they run sequentially;
    // plain unit tests are untouched and keep the default parallel pool.
    poolMatchGlobs: [["**/*.e2e.test.ts", "forks"]],
    poolOptions: {
      forks: {
        singleFork: true
      }
    }
  }
});
