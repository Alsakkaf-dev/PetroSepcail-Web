import type { UserRole } from "./security/jwt.js";

// PC-02/FR-PC02-003: "A single server-side authorize(actor, action, resource)
// derived from 04-roles §3; every endpoint calls it." Per NFR-PC-003 ("RLS
// enable+force on every table; the DB is the security boundary; API checks
// are UX-only"), this is a coarse, fast, DB-independent UX gate — it answers
// "can this role ever attempt this action on this resource kind at all",
// returning a clean 403 before a doomed query would otherwise just come back
// empty from RLS. Row-level "own" scoping is enforced by RLS itself, not
// re-implemented here.
export type Action = "create" | "read" | "update" | "delete";

export type Resource =
  | "catalog"
  | "inventory"
  | "cart"
  | "retail_order"
  | "wholesale_order"
  | "delivery_task"
  | "driver_location"
  | "proof_of_delivery"
  | "return"
  | "review"
  | "wishlist"
  | "invoice"
  | "payment"
  | "statement"
  | "credit_limit"
  | "loyalty_ledger"
  | "coupon"
  | "customer_pii"
  | "supplier_master"
  | "driver_profile"
  | "admin_account"
  | "audit_log"
  | "platform_config"
  | "analytics";

export interface Actor {
  role: UserRole;
}

// 04-roles-and-permissions-matrix.md §3, transcribed verbatim (own-row
// scoping, "assigned"/"log"/aggregate-only nuances are enforced downstream —
// see comment above).
const MATRIX: Record<Resource, Partial<Record<UserRole, readonly Action[]>>> = {
  catalog: {
    customer: ["read"],
    supplier: ["read"],
    driver: ["read"],
    admin: ["create", "read", "update", "delete"],
    super_admin: ["create", "read", "update", "delete"]
  },
  inventory: {
    customer: ["read"],
    supplier: ["read"],
    admin: ["create", "read", "update", "delete"],
    super_admin: ["create", "read", "update", "delete"]
  },
  cart: {
    customer: ["create", "read", "update", "delete"],
    supplier: ["create", "read", "update", "delete"]
  },
  retail_order: {
    customer: ["create", "read", "update"],
    driver: ["read"],
    admin: ["read", "update"],
    super_admin: ["read", "update"]
  },
  wholesale_order: {
    supplier: ["create", "read", "update"],
    driver: ["read"],
    admin: ["read", "update"],
    super_admin: ["read", "update"]
  },
  delivery_task: {
    customer: ["read"],
    supplier: ["read"],
    driver: ["read", "update"],
    admin: ["read", "update"],
    super_admin: ["read", "update"]
  },
  driver_location: {
    customer: ["read"],
    supplier: ["read"],
    driver: ["create"],
    admin: ["read"],
    super_admin: ["read"]
  },
  proof_of_delivery: {
    customer: ["read"],
    supplier: ["read"],
    driver: ["create"],
    admin: ["read"],
    super_admin: ["read"]
  },
  return: {
    customer: ["create", "read"],
    admin: ["read", "update"],
    super_admin: ["read", "update"]
  },
  review: {
    customer: ["create", "read", "update", "delete"],
    admin: ["read", "delete"],
    super_admin: ["read", "delete"]
  },
  wishlist: {
    customer: ["create", "read", "update", "delete"]
  },
  invoice: {
    supplier: ["read"],
    admin: ["read", "create"],
    super_admin: ["read", "create", "update"]
  },
  payment: {
    supplier: ["read"],
    admin: ["create", "read"],
    super_admin: ["create", "read"]
  },
  statement: {
    supplier: ["read"],
    admin: ["read"],
    super_admin: ["read"]
  },
  credit_limit: {
    supplier: ["read"],
    admin: ["read", "update"], // <= SAR 100,000, enforced downstream (04-roles §5)
    super_admin: ["read", "update"]
  },
  loyalty_ledger: {
    customer: ["read"],
    supplier: ["read"],
    admin: ["read", "create"],
    super_admin: ["read", "create"]
  },
  coupon: {
    customer: ["read"],
    supplier: ["read"],
    admin: ["create", "read", "update", "delete"],
    super_admin: ["create", "read", "update", "delete"]
  },
  customer_pii: {
    customer: ["read", "update"],
    driver: ["read"], // recipient contact fields only, while task active
    admin: ["read"], // core.admin_read_customer only, single-record, logged (S01)
    super_admin: ["read"]
  },
  supplier_master: {
    supplier: ["read", "update"],
    admin: ["create", "read", "update", "delete"],
    super_admin: ["create", "read", "update", "delete"]
  },
  driver_profile: {
    driver: ["read"],
    admin: ["create", "read", "update", "delete"],
    super_admin: ["create", "read", "update", "delete"]
  },
  admin_account: {
    admin: ["read"],
    super_admin: ["create", "read", "update", "delete"]
  },
  audit_log: {
    admin: ["read"], // own actions only
    super_admin: ["read"]
  },
  platform_config: {
    admin: ["read"],
    super_admin: ["create", "read", "update", "delete"]
  },
  analytics: {
    admin: ["read"], // aggregates only (04-roles §4.1 k-anonymity floor)
    super_admin: ["read"]
  }
};

export function authorize(actor: Actor, action: Action, resource: Resource): boolean {
  const allowed = MATRIX[resource]?.[actor.role];
  return allowed?.includes(action) ?? false;
}
