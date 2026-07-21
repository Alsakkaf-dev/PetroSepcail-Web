import { ApiError } from "../errors.js";

// FR-PC04-001: cursor pagination (?cursor=&limit=, default 20 max 100);
// 05-api-specification.md §9: "pagination returns {items, nextCursor}".
// No concrete paginated resource exists yet (catalog/orders land S07+) —
// this is the shared, tested utility they'll all build on.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export interface PaginationParams {
  cursor?: string;
  limit: number;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function parsePagination(query: { cursor?: unknown; limit?: unknown }): PaginationParams {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new ApiError("VALIDATION_ERROR", { field: "limit", reason: "must be a positive integer" });
    }
    limit = Math.min(MAX_LIMIT, parsed);
  }
  const cursor = typeof query.cursor === "string" && query.cursor.length > 0 ? query.cursor : undefined;
  return { cursor, limit };
}

// Opaque cursor: base64url JSON of whatever sort-key fields the caller's
// query needs (e.g. {createdAt, id} for a stable created_at+id ordering).
export function encodeCursor(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

export function decodeCursor<T = Record<string, unknown>>(cursor: string): T {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    throw new ApiError("VALIDATION_ERROR", { field: "cursor", reason: "malformed cursor" });
  }
}

export function buildPage<T>(items: T[], nextCursor: string | null): Page<T> {
  return { items, nextCursor };
}
