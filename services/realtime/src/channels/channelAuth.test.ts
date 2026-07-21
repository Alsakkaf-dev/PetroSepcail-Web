import { describe, expect, it } from "vitest";
import type { AccessTokenClaims } from "@petrospecial/auth-shared";
import { authorizeChannel, registerChannel } from "./channelAuth.js";

function actor(role: AccessTokenClaims["role"], sub = "00000000-0000-0000-0000-000000000001"): AccessTokenClaims {
  return { sub, role, locale: "ar" };
}

describe("channelAuth", () => {
  it("allows admin/super_admin on admin:alerts", () => {
    expect(authorizeChannel("admin:alerts", actor("admin"))).toBe(true);
    expect(authorizeChannel("admin:alerts", actor("super_admin"))).toBe(true);
  });

  it("denies non-admin roles and anonymous connections on admin:alerts", () => {
    expect(authorizeChannel("admin:alerts", actor("customer"))).toBe(false);
    expect(authorizeChannel("admin:alerts", null)).toBe(false);
  });

  it("default-denies an unregistered channel", () => {
    expect(authorizeChannel("orders:123:status", actor("admin"))).toBe(false);
    expect(authorizeChannel("totally-made-up-channel", actor("super_admin"))).toBe(false);
  });

  it("extracts path parameters from a registered pattern and passes them to the authorizer", () => {
    let seenParams: Record<string, string> | undefined;
    registerChannel("test:{entity_id}:demo", (_actor, params) => {
      seenParams = params;
      return true;
    });
    expect(authorizeChannel("test:abc-123:demo", actor("customer"))).toBe(true);
    expect(seenParams).toEqual({ entity_id: "abc-123" });
  });
});
