import { buildServer } from "./server.js";

const port = Number(process.env.ZATCA_SIM_PORT ?? 4010);

buildServer()
  .listen({ port, host: "0.0.0.0" })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
