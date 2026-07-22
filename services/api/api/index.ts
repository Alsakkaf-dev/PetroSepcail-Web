import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../src/server.js";

// Vercel Serverless (S09 Docker->managed migration): a function instance is
// reused across invocations within the same warm container, so the Fastify
// app (and its `pg` Pool in db.ts) is built once per cold start, not once
// per request — `.ready()` (not `.listen()`) is Fastify's own documented
// serverless entry point; it finishes plugin/route registration without
// binding a port. See db.ts: DATABASE_URL must be the Transaction-pooler
// (port 6543) connection string here, since each invocation's DB usage is
// brief and isolated, matching Supabase's own guidance for that pooler mode.
let appPromise: Promise<FastifyInstance> | undefined;

function getApp(): Promise<FastifyInstance> {
  if (!appPromise) {
    appPromise = buildServer().then(async (app) => {
      await app.ready();
      return app;
    });
  }
  return appPromise;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const app = await getApp();
  app.server.emit("request", req, res);
}
