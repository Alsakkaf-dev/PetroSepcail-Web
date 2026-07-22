import http from "node:http";
import { verifyAccessToken, type AccessTokenClaims } from "@petrospecial/auth-shared";
import { WebSocketServer, type WebSocket } from "ws";
import { authorizeChannel } from "./channels/channelAuth.js";
import type { EventEnvelope } from "./events.js";
import { logger } from "./logger.js";
import { metrics } from "./metrics.js";

export interface MinimalRequest {
  url?: string;
}

export interface MinimalResponse {
  writeHead(statusCode: number, headers?: Record<string, string>): void;
  end(chunk?: string): void;
}

export function handleRequest(req: MinimalRequest, res: MinimalResponse): void {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "realtime" }));
    return;
  }
  if (req.url === "/metrics") {
    void metrics.registry.metrics().then((body) => {
      res.writeHead(200, { "content-type": metrics.registry.contentType });
      res.end(body);
    });
    return;
  }
  res.writeHead(404);
  res.end();
}

interface Connection {
  socket: WebSocket;
  actor: AccessTokenClaims | null;
  channels: Set<string>;
}

export type BroadcastToChannelFn = (channel: string, payload: unknown) => void;

export interface RealtimeServer {
  server: http.Server;
  wss: WebSocketServer;
  broadcast: (event: EventEnvelope) => void;
  broadcastToChannel: BroadcastToChannelFn;
}

// PC-EV-3 / TC-PC05-004: connect with `?token=` (browsers can't set custom
// headers on a WS handshake), then send {"type":"subscribe","channel":"..."}
// per channel of interest — each checked against channelAuth.ts, mirroring
// RLS exactly as 06-integration-contracts §4 requires. A missing/invalid
// token still gets a connection (actor: null) so the server can reply with a
// clear per-channel denial rather than refusing the handshake outright —
// public/no-auth channels could exist later even if none do yet.
export function buildServer(): RealtimeServer {
  const server = http.createServer((req, res) => handleRequest(req, res));
  const wss = new WebSocketServer({ server, path: "/realtime" });
  const connections = new Set<Connection>();

  wss.on("error", (err) => {
    logger.error({ err }, "websocket server error");
  });

  wss.on("connection", (socket, request) => {
    void (async () => {
      // Query string only (no URL object): avoids the WHATWG URL
      // constructor's required base-URL argument, which would otherwise be
      // a throwaway absolute-URL literal that parity-grep (correctly, in
      // every other case) treats as a hardcoded host.
      const [, queryString] = (request.url ?? "").split("?");
      const token = new URLSearchParams(queryString ?? "").get("token");
      let actor: AccessTokenClaims | null = null;
      if (token) {
        try {
          actor = await verifyAccessToken(token);
        } catch {
          actor = null;
        }
      }

      const connection: Connection = { socket, actor, channels: new Set() };
      connections.add(connection);
      logger.info({ actorSub: actor?.sub ?? null }, "ws connection opened");
      socket.send(JSON.stringify({ type: "welcome" }));

      socket.on("error", (err) => {
        logger.error({ err }, "ws connection error");
      });

      socket.on("message", (raw) => {
        let msg: { type?: string; channel?: string };
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          socket.send(JSON.stringify({ type: "error", reason: "invalid_message" }));
          return;
        }

        if (msg.type === "subscribe" && typeof msg.channel === "string") {
          if (!authorizeChannel(msg.channel, connection.actor)) {
            socket.send(JSON.stringify({ type: "subscribe_denied", channel: msg.channel }));
            return;
          }
          connection.channels.add(msg.channel);
          socket.send(JSON.stringify({ type: "subscribed", channel: msg.channel }));
        } else if (msg.type === "unsubscribe" && typeof msg.channel === "string") {
          connection.channels.delete(msg.channel);
          socket.send(JSON.stringify({ type: "unsubscribed", channel: msg.channel }));
        }
      });

      socket.on("close", () => {
        connections.delete(connection);
        logger.info({ actorSub: actor?.sub ?? null }, "ws connection closed");
      });
    })();
  });

  // Generic: any consumer (e.g. the welcome-notification consumer pushing to
  // identity:{sub}:notifications) can push arbitrary payloads to a channel
  // without the WS layer knowing anything about notifications specifically.
  function broadcastToChannel(channel: string, payload: unknown): void {
    const message = JSON.stringify({ type: "event", channel, event: payload });
    for (const connection of connections) {
      if (connection.channels.has(channel)) {
        connection.socket.send(message);
      }
    }
  }

  function broadcast(event: EventEnvelope): void {
    broadcastToChannel(`events:${event.name}`, event);
  }

  return { server, wss, broadcast, broadcastToChannel };
}
