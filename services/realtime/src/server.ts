import http from "node:http";
import { WebSocketServer } from "ws";

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
  res.writeHead(404);
  res.end();
}

export function buildServer(): { server: http.Server; wss: WebSocketServer } {
  const server = http.createServer((req, res) => handleRequest(req, res));
  const wss = new WebSocketServer({ server, path: "/realtime" });

  wss.on("connection", (socket) => {
    socket.send(JSON.stringify({ type: "welcome" }));
  });

  return { server, wss };
}
