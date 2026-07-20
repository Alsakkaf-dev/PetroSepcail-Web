import { buildServer } from "./server.js";

const port = Number(process.env.API_PORT ?? 4000);

buildServer()
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
