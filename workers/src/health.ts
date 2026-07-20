import http from "node:http";

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
    res.end(JSON.stringify({ status: "ok", service: "workers" }));
    return;
  }
  res.writeHead(404);
  res.end();
}

export function buildHealthServer(): http.Server {
  return http.createServer((req, res) => handleRequest(req, res));
}
