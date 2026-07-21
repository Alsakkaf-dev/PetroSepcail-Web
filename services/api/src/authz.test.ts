import { describe, expect, it } from "vitest";
import { authorize } from "./authz.js";

// Representative assertions from 04-roles-and-permissions-matrix §3
// (TC-PC02-002..004 intent) — not exhaustive, but covers every role and the
// shape of every "own"/"—"/CRUD cell kind.
describe("authorize (PC-AUTHZ-1)", () => {
  it("customer can read catalog but not write it", () => {
    expect(authorize({ role: "customer" }, "read", "catalog")).toBe(true);
    expect(authorize({ role: "customer" }, "create", "catalog")).toBe(false);
  });

  it("admin/super_admin have full catalog CRUD", () => {
    for (const role of ["admin", "super_admin"] as const) {
      for (const action of ["create", "read", "update", "delete"] as const) {
        expect(authorize({ role }, action, "catalog")).toBe(true);
      }
    }
  });

  it("driver has no access to cart (— cell)", () => {
    expect(authorize({ role: "driver" }, "read", "cart")).toBe(false);
    expect(authorize({ role: "driver" }, "create", "cart")).toBe(false);
  });

  it("customer can CRUD their own cart/wishlist", () => {
    expect(authorize({ role: "customer" }, "delete", "cart")).toBe(true);
    expect(authorize({ role: "customer" }, "update", "wishlist")).toBe(true);
  });

  it("supplier — not customer — can create wholesale orders", () => {
    expect(authorize({ role: "supplier" }, "create", "wholesale_order")).toBe(true);
    expect(authorize({ role: "customer" }, "create", "wholesale_order")).toBe(false);
  });

  it("only admin/super_admin can read the audit log; nobody else can", () => {
    expect(authorize({ role: "admin" }, "read", "audit_log")).toBe(true);
    expect(authorize({ role: "super_admin" }, "read", "audit_log")).toBe(true);
    for (const role of ["customer", "supplier", "driver"] as const) {
      expect(authorize({ role }, "read", "audit_log")).toBe(false);
    }
  });

  it("only super_admin can write admin_account/platform_config", () => {
    expect(authorize({ role: "admin" }, "create", "admin_account")).toBe(false);
    expect(authorize({ role: "super_admin" }, "create", "admin_account")).toBe(true);
    expect(authorize({ role: "admin" }, "update", "platform_config")).toBe(false);
    expect(authorize({ role: "super_admin" }, "update", "platform_config")).toBe(true);
  });

  it("driver can read customer_pii (recipient contact) but not update it", () => {
    expect(authorize({ role: "driver" }, "read", "customer_pii")).toBe(true);
    expect(authorize({ role: "driver" }, "update", "customer_pii")).toBe(false);
  });

  it("customer can read/update but never delete their own PII resource", () => {
    expect(authorize({ role: "customer" }, "read", "customer_pii")).toBe(true);
    expect(authorize({ role: "customer" }, "update", "customer_pii")).toBe(true);
    expect(authorize({ role: "customer" }, "delete", "customer_pii")).toBe(false);
  });
});
