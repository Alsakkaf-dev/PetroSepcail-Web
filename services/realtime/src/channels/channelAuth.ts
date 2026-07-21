import type { AccessTokenClaims } from "@petrospecial/auth-shared";

// TC-PC05-004 / 06-integration-contracts.md §4 STREAM channels: "Channel JWT
// check mirrors RLS" — each channel PATTERN carries its own authorization
// rule, registered here rather than hardcoded into the WS server, so future
// sessions can add their own channels without touching this file's core
// matching logic.
export type ChannelAuthorizer = (actor: AccessTokenClaims | null, params: Record<string, string>) => boolean;

interface RegisteredChannel {
  regex: RegExp;
  paramNames: string[];
  authorize: ChannelAuthorizer;
}

const registry: RegisteredChannel[] = [];

// Turns "delivery:{task_id}:location" into a matching regex + param names.
function compilePattern(pattern: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = [];
  const escaped = pattern.replace(/[.*+?^$()|[\]\\]/g, "\\$&");
  const regexSource = escaped.replace(/\{(\w+)\}/g, (_match, name: string) => {
    paramNames.push(name);
    return "([^:]+)";
  });
  return { regex: new RegExp(`^${regexSource}$`), paramNames };
}

export function registerChannel(pattern: string, authorize: ChannelAuthorizer): void {
  const { regex, paramNames } = compilePattern(pattern);
  registry.push({ regex, paramNames, authorize });
}

export function authorizeChannel(channel: string, actor: AccessTokenClaims | null): boolean {
  for (const entry of registry) {
    const match = entry.regex.exec(channel);
    if (!match) continue;
    const params: Record<string, string> = {};
    entry.paramNames.forEach((name, i) => (params[name] = match[i + 1]!));
    return entry.authorize(actor, params);
  }
  return false; // unregistered channel: default-deny
}

// admin:alerts — the one channel with no forward table dependency, so it's
// real and testable now. The other three named channels
// (delivery:{task_id}:location, orders:{order_id}:status,
// driver:{driver_id}:tasks) need tables that don't exist until DL/SF land
// (S07/S11/S13) — same deferred-policy precedent as S01's
// `addr_driver_active` RLS policy. Those sessions register their own
// authorizer here; this file's matching logic doesn't need to change.
registerChannel("admin:alerts", (actor) => actor !== null && (actor.role === "admin" || actor.role === "super_admin"));
