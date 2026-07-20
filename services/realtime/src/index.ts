import { buildServer } from "./server.js";

const port = Number(process.env.REALTIME_PORT ?? 4001);
const { server } = buildServer();

server.listen(port, "0.0.0.0");
