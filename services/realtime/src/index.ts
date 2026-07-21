import { createListenerClient } from "./db.js";
import { startDispatcher } from "./dispatcher.js";
import { buildServer } from "./server.js";

const port = Number(process.env.REALTIME_PORT ?? 4001);
const { server, broadcast } = buildServer();

server.listen(port, "0.0.0.0");

const listenerClient = await createListenerClient();
startDispatcher(listenerClient, broadcast);
