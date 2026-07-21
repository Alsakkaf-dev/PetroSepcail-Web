import Fastify, { type FastifyInstance } from "fastify";
import { ZodError } from "zod";
import { errorEnvelope } from "@petrospecial/contracts";
import { ApiError } from "./errors.js";
import { registerAuthRoutes } from "./routes/auth.js";

export function buildServer(): FastifyInstance {
  const app = Fastify({ logger: true });

  app.get("/health", async () => ({ status: "ok", service: "api" }));

  registerAuthRoutes(app);

  // D-09 error envelope {error:{code,message,details}} — the single
  // translation point from thrown errors to the wire format every EP-PC
  // endpoint promises. The full gateway error-code registry wiring
  // (FR-PC04-004) lives here until S03 owns request-context as a whole.
  app.setErrorHandler((err, _request, reply) => {
    if (err instanceof ApiError) {
      return reply.code(err.status).send(err.toEnvelope());
    }
    if (err instanceof ZodError) {
      return reply.code(422).send(
        errorEnvelope.parse({
          error: { code: "VALIDATION_ERROR", message: "Validation failed.", details: err.issues }
        })
      );
    }
    app.log.error(err);
    return reply.code(500).send(new ApiError("INTERNAL_ERROR").toEnvelope());
  });

  return app;
}
