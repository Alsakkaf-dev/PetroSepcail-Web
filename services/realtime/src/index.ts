import { registerWelcomeNotificationConsumer } from "./consumers/welcomeNotification.js";
import { createListenerClient } from "./db.js";
import { startDispatcher } from "./dispatcher.js";
import { logger } from "./logger.js";
import { buildServer } from "./server.js";

const port = Number(process.env.REALTIME_PORT ?? 4001);
const { server, broadcast, broadcastToChannel } = buildServer();

registerWelcomeNotificationConsumer(broadcastToChannel);

server.listen(port, "0.0.0.0", () => {
  logger.info({ port }, "realtime server listening");
});

const listenerClient = await createListenerClient();
startDispatcher(listenerClient, broadcast);
