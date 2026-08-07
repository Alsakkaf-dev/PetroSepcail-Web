import {
  cancelWholesaleOrderResponse,
  pickupPointsResponse,
  placeWholesaleOrderRequest,
  placeWholesaleOrderResponse,
  supplierCartResponse,
  supplierCatalogResponse,
  supplierOrderListResponse,
  supplierPriceResponse,
  supplierProfileResponse,
  updateSupplierProfileRequest,
  updateSupplierProfileResponse
} from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import type { PoolClient } from "pg";
import { getVatRate, money } from "../catalog/pricing.js";
import { withRlsTransaction, withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { buildPage, decodeCursor, encodeCursor, parsePagination } from "../gateway/pagination.js";
import type { AccessTokenClaims } from "../security/jwt.js";
import { generateZatcaArtifacts } from "../zatca/fatooraSim.js";

// 30-supplier-portal/05-api-specification.md §1/2/3 (SP-01/02/03, S14).
// EP-SP-030..072 (invoices/payments/statements/tracking/templates, SP-04..09)
// are out of this session's scope (S15/S16) -- not implemented here.

function requireSupplier(request: { ctx: { actor: AccessTokenClaims | null } }): { actor: AccessTokenClaims; supplierId: string } {
  const actor = request.ctx.actor;
  if (!actor) throw new ApiError("INVALID_CREDENTIALS");
  if (actor.role !== "supplier" || !actor.supplier_id) throw new ApiError("FORBIDDEN");
  return { actor, supplierId: actor.supplier_id };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// FR-SP01-004: never return a raw IBAN over the wire, same masking
// discipline card numbers/tokens get elsewhere in this codebase.
function maskIban(iban: string | null): string | null {
  if (!iban || iban.length < 4) return iban;
  return `${"*".repeat(iban.length - 4)}${iban.slice(-4)}`;
}

async function getOrCreateOpenCart(client: PoolClient, userId: string): Promise<string> {
  const existing = await client.query<{ id: string }>("select id from orders.carts where user_id = $1 and status = 'open'", [
    userId
  ]);
  if (existing.rows[0]) return existing.rows[0].id;
  const created = await client.query<{ id: string }>("insert into orders.carts (user_id) values ($1) returning id", [userId]);
  return created.rows[0]!.id;
}

interface SupplierLineRow {
  line_id: string;
  pack_size_id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  qty: number;
  unit_price: string;
  current_price: string | null;
}

// FR-SF03-007-equivalent for the wholesale cart: refresh each line's tier
// price on read. `catalog.tier_prices` RLS (0053) already scopes the join to
// the caller's own tier -- no explicit supplierId predicate needed here.
async function loadSupplierLines(client: PoolClient, cartId: string): Promise<SupplierLineRow[]> {
  const res = await client.query<SupplierLineRow>(
    `select cl.id as line_id, cl.pack_size_id, s.slug, s.name_ar, s.name_en, cl.qty,
            cl.unit_price, tp.unit_price as current_price
     from orders.cart_lines cl
     join catalog.pack_sizes p on p.id = cl.pack_size_id
     join catalog.skus s on s.id = p.sku_id
     left join catalog.tier_prices tp on tp.pack_size_id = cl.pack_size_id
     where cl.cart_id = $1
     order by cl.created_at`,
    [cartId]
  );
  for (const row of res.rows) {
    if (row.current_price !== null && row.current_price !== row.unit_price) {
      await client.query("update orders.cart_lines set unit_price = $2 where id = $1", [row.line_id, row.current_price]);
      row.unit_price = row.current_price;
    }
  }
  return res.rows;
}

function toCartResponse(lines: SupplierLineRow[], vatRate: number) {
  const subtotal = lines.reduce((sum, l) => sum + Number(l.unit_price) * l.qty, 0);
  const vat = subtotal * vatRate;
  return supplierCartResponse.parse({
    lines: lines.map((l) => ({
      packSizeId: l.pack_size_id,
      skuSlug: l.slug,
      nameAr: l.name_ar,
      nameEn: l.name_en,
      qty: l.qty,
      tierUnitPrice: money(Number(l.unit_price))
    })),
    subtotal: money(subtotal),
    vatAmount: money(vat),
    total: money(subtotal + vat)
  });
}

interface CatalogRow {
  pack_size_id: string;
  slug: string;
  name_ar: string;
  name_en: string;
  unit_price: string;
  in_stock: boolean | null;
}
interface CatalogCursor {
  slug: string;
  packSizeId: string;
}

async function getCompanySettings(client: PoolClient): Promise<{ nameAr: string; nameEn: string; vatNumber: string }> {
  // core.settings.value is jsonb - node-postgres already deserializes it into
  // a native JS value on read, so byKey.company_name_ar etc. are already the
  // plain strings (0059's seed values are JSON string literals, e.g.
  // '"شركة بترو سبيشل..."', for exactly this). Re-parsing with JSON.parse
  // here always threw for any non-numeric setting - never caught before
  // because a wholesale order had never been placed against a real database.
  const res = await client.query<{ key: string; value: unknown }>(
    "select key, value from core.settings where key in ('company_name_ar', 'company_name_en', 'company_vat_number')"
  );
  const get = (key: string): string => (res.rows.find((r) => r.key === key)?.value as string | undefined) ?? "";
  return { nameAr: get("company_name_ar"), nameEn: get("company_name_en"), vatNumber: get("company_vat_number") };
}

// SP-04 SP-INV-1/2: issues the invoice (idempotent on order_id) and, only on
// the first real issuance, generates+writes the FATOORA-sim artifacts. A
// replay (order already invoiced) is a safe no-op -- credit.issue_invoice
// itself returns the existing invoice id without inserting a second row, so
// this function returning early there is correct, not a shortcut.
async function issueInvoiceAndStamp(orderId: string): Promise<void> {
  await withServiceRoleTransaction(async (client) => {
    const issueRes = await client.query<{ issue_invoice: string }>("select credit.issue_invoice($1) as issue_invoice", [orderId]);
    const invoiceId = issueRes.rows[0]!.issue_invoice;

    const invoiceRes = await client.query<{ total: string; vat_amount: string; issued_at: Date; zatca_uuid: string | null }>(
      "select total, vat_amount, issued_at, zatca_uuid from credit.invoices where id = $1",
      [invoiceId]
    );
    const invoice = invoiceRes.rows[0]!;
    if (invoice.zatca_uuid !== null) return; // already stamped by a prior call (idempotent replay)

    const company = await getCompanySettings(client);
    const artifacts = generateZatcaArtifacts({
      sellerNameAr: company.nameAr,
      sellerNameEn: company.nameEn,
      sellerVatNumber: company.vatNumber,
      issuedAt: invoice.issued_at,
      total: money(Number(invoice.total)),
      vatAmount: money(Number(invoice.vat_amount))
    });
    await client.query("select credit.set_zatca_stamp($1, $2, $3, $4)", [
      invoiceId,
      artifacts.zatcaUuid,
      artifacts.qrTlv,
      artifacts.cryptoStamp
    ]);
  });
}

export function registerSupplierRoutes(app: FastifyInstance): void {
  // EP-SP-001 · GET /supplier/catalog · auth(supplier)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/api/v1/supplier/catalog", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const { cursor, limit } = parsePagination(request.query);
    const after = cursor ? decodeCursor<CatalogCursor>(cursor) : null;

    const rows = await withRlsTransaction(actor, async (client) => {
      const conditions = ["p.is_active"];
      const params: unknown[] = [];
      if (after) {
        params.push(after.slug, after.packSizeId);
        conditions.push(`(s.slug, p.id) > ($${params.length - 1}, $${params.length}::uuid)`);
      }
      params.push(limit + 1);
      const res = await client.query<CatalogRow>(
        `select p.id as pack_size_id, s.slug, s.name_ar, s.name_en, tp.unit_price, a.in_stock
         from catalog.pack_sizes p
         join catalog.skus s on s.id = p.sku_id
         join catalog.tier_prices tp on tp.pack_size_id = p.id
         left join catalog.v_sku_availability a on a.pack_size_id = p.id
         where ${conditions.join(" and ")}
         order by s.slug, p.id
         limit $${params.length}`,
        params
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? encodeCursor({ slug: page[page.length - 1]!.slug, packSizeId: page[page.length - 1]!.pack_size_id }) : null;

    return reply.code(200).send(
      supplierCatalogResponse.parse(
        buildPage(
          page.map((r) => ({
            packSizeId: r.pack_size_id,
            skuSlug: r.slug,
            nameAr: r.name_ar,
            nameEn: r.name_en,
            tierUnitPrice: money(Number(r.unit_price)),
            inStock: r.in_stock ?? false
          })),
          nextCursor
        )
      )
    );
  });

  // EP-SP-002 · GET /supplier/cart · auth(supplier)
  app.get("/api/v1/supplier/cart", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const vatRate = await getVatRate();
    const lines = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      return loadSupplierLines(client, cartId);
    });
    return reply.code(200).send(toCartResponse(lines, vatRate));
  });

  // EP-SP-002 · POST /supplier/cart · auth(supplier) — add/update a line
  app.post<{ Body: { packSizeId: string; qty: number } }>("/api/v1/supplier/cart", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const vatRate = await getVatRate();
    const body = request.body;
    const lines = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      const price = await client.query<{ unit_price: string }>("select unit_price from catalog.tier_prices where pack_size_id = $1", [
        body.packSizeId
      ]);
      const unitPrice = price.rows[0]?.unit_price;
      if (unitPrice === undefined) throw new ApiError("TIER_PRICE_MISSING");
      await client.query(
        `insert into orders.cart_lines (cart_id, pack_size_id, qty, unit_price)
         values ($1, $2, $3, $4)
         on conflict (cart_id, pack_size_id) do update
           set qty = least(orders.cart_lines.qty + excluded.qty, 99), unit_price = excluded.unit_price`,
        [cartId, body.packSizeId, body.qty, unitPrice]
      );
      return loadSupplierLines(client, cartId);
    });
    return reply.code(201).send(toCartResponse(lines, vatRate));
  });

  // EP-SP-002 · PATCH /supplier/cart · auth(supplier) — set a line's qty
  app.patch<{ Body: { packSizeId: string; qty: number } }>("/api/v1/supplier/cart", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const vatRate = await getVatRate();
    const body = request.body;
    const lines = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      const updated = await client.query("update orders.cart_lines set qty = $2 where cart_id = $1 and pack_size_id = $3 returning id", [
        cartId,
        body.qty,
        body.packSizeId
      ]);
      if (updated.rowCount === 0) throw new ApiError("NOT_FOUND");
      return loadSupplierLines(client, cartId);
    });
    return reply.code(200).send(toCartResponse(lines, vatRate));
  });

  // EP-SP-002 · DELETE /supplier/cart · auth(supplier) · ?packSizeId= — drop a line
  app.delete<{ Querystring: { packSizeId: string } }>("/api/v1/supplier/cart", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const vatRate = await getVatRate();
    const lines = await withRlsTransaction(actor, async (client) => {
      const cartId = await getOrCreateOpenCart(client, actor.sub);
      await client.query("delete from orders.cart_lines where cart_id = $1 and pack_size_id = $2", [cartId, request.query.packSizeId]);
      return loadSupplierLines(client, cartId);
    });
    return reply.code(200).send(toCartResponse(lines, vatRate));
  });

  // EP-SP-003 · POST /supplier/orders · auth(supplier) · idempotencyKey
  // SCOPED SIMPLIFICATION (documented): credit.place_wholesale_order (0054)
  // hardcodes deliverySlot='next_am' -- it takes no such parameter. The
  // request field is accepted (matching the API spec's own body shape) but
  // not yet forwarded; a future session extends the DB function if a real
  // slot picker is needed for wholesale.
  app.post("/api/v1/supplier/orders", async (request, reply) => {
    const { actor, supplierId } = requireSupplier(request);
    const body = placeWholesaleOrderRequest.parse(request.body);

    let result: { order_id: string; status: string; total: string };
    try {
      result = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ order_id: string; status: string; total: string }>(
          `select order_id, status, total from credit.place_wholesale_order($1, $2, $3::jsonb, $4, $5)`,
          [
            supplierId,
            actor.sub,
            JSON.stringify(body.lines.map((l) => ({ packSizeId: l.packSizeId, qty: l.qty }))),
            body.addressId,
            body.idempotencyKey ?? null
          ]
        );
        return res.rows[0]!;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NO_CREDIT_LIMIT")) throw new ApiError("NO_CREDIT_LIMIT");
      if (message.includes("CREDIT_LIMIT_EXCEEDED")) {
        const detail = (err as { detail?: string }).detail;
        let details: unknown;
        if (detail) {
          try {
            details = JSON.parse(detail);
          } catch {
            /* leave undefined, err.message alone still identifies the code */
          }
        }
        throw new ApiError("CREDIT_LIMIT_EXCEEDED", details);
      }
      if (message.includes("PRICE_CHANGED")) throw new ApiError("PRICE_CHANGED");
      if (message.includes("CART_EMPTY")) throw new ApiError("CART_EMPTY");
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("CONFLICT")) throw new ApiError("CONFLICT");
      throw err;
    }

    // SP-04 Task SP-INV-1 (EV-PC-012 consumer): a wholesale order is always
    // credit_terms, so invoicing is not a decoupled background concern the
    // way a retail COD/bank-transfer confirm is -- this route IS the only
    // producer of `orders.order.confirmed{kind:wholesale}` in the system, so
    // issuing synchronously here (idempotent on order_id, credit.issue_invoice)
    // avoids workers/ needing a TS dependency on services/api's zatca module
    // it structurally cannot have (workers only depends on pg + observability).
    // Best-effort: the order itself already committed successfully above: a
    // failure here must not turn an honest 201 into a misleading 500.
    try {
      await issueInvoiceAndStamp(result.order_id);
    } catch (err) {
      request.log.error({ err, orderId: result.order_id }, "supplier: invoice issuance failed after order placement");
    }

    return reply.code(201).send(
      placeWholesaleOrderResponse.parse({ orderId: result.order_id, status: result.status, total: money(Number(result.total)) })
    );
  });

  // EP-SP-004 · POST /supplier/orders/{id}/cancel · auth(supplier)
  app.post<{ Params: { id: string } }>("/api/v1/supplier/orders/:id/cancel", async (request, reply) => {
    const { actor } = requireSupplier(request);
    let status: string;
    try {
      status = await withServiceRoleTransaction(async (client) => {
        const res = await client.query<{ cancel_order: string }>("select orders.cancel_order($1, $2) as cancel_order", [
          request.params.id,
          actor.sub
        ]);
        return res.rows[0]!.cancel_order;
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("NOT_FOUND")) throw new ApiError("NOT_FOUND");
      if (message.includes("ORDER_NOT_CANCELLABLE")) throw new ApiError("ORDER_NOT_CANCELLABLE");
      throw err;
    }
    return reply.code(200).send(cancelWholesaleOrderResponse.parse({ status }));
  });

  // EP-SP-005 · GET /supplier/orders · auth(supplier)
  app.get<{ Querystring: { cursor?: string; limit?: string } }>("/api/v1/supplier/orders", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const { cursor, limit } = parsePagination(request.query);
    const after = cursor ? decodeCursor<{ placedAt: string; id: string }>(cursor) : null;

    const rows = await withRlsTransaction(actor, async (client) => {
      const conditions = ["user_id = $1", "kind = 'wholesale'"];
      const params: unknown[] = [actor.sub];
      if (after) {
        params.push(after.placedAt, after.id);
        conditions.push(`(placed_at, id) < ($${params.length - 1}::timestamptz, $${params.length}::uuid)`);
      }
      params.push(limit + 1);
      // placed_at_cursor: full microsecond precision as text, since `pg`
      // truncates placed_at to a millisecond-resolution JS Date and a
      // truncated cursor silently drops rows sharing a millisecond.
      const res = await client.query<{
        id: string;
        status: string;
        total: string;
        placed_at: Date;
        placed_at_cursor: string;
      }>(
        `select id, status, total, placed_at, placed_at::text as placed_at_cursor from orders.orders
         where ${conditions.join(" and ")}
         order by placed_at desc, id desc
         limit $${params.length}`,
        params
      );
      return res.rows;
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore
      ? encodeCursor({ placedAt: page[page.length - 1]!.placed_at_cursor, id: page[page.length - 1]!.id })
      : null;

    return reply.code(200).send(
      supplierOrderListResponse.parse(
        buildPage(
          page.map((o) => ({ orderId: o.id, status: o.status, total: money(Number(o.total)), placedAt: o.placed_at.toISOString() })),
          nextCursor
        )
      )
    );
  });

  // EP-SP-010 · GET /supplier/profile · auth(supplier)
  app.get("/api/v1/supplier/profile", async (request, reply) => {
    const { actor, supplierId } = requireSupplier(request);
    const row = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{
        business_name_ar: string;
        business_name_en: string;
        tier: string;
        limit_amount: string | null;
        is_pickup_point: boolean;
        geo_lat: string | null;
        geo_lng: string | null;
        bank_name: string | null;
        bank_iban: string | null;
      }>(
        `select s.business_name_ar, s.business_name_en, s.tier, cl.limit_amount,
                s.is_pickup_point, s.geo_lat, s.geo_lng, s.bank_name, s.bank_iban
         from credit.suppliers s
         left join credit.credit_limits cl on cl.supplier_id = s.id and cl.is_current
         where s.id = $1`,
        [supplierId]
      );
      return res.rows[0];
    });
    if (!row) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(
      supplierProfileResponse.parse({
        businessNameAr: row.business_name_ar,
        businessNameEn: row.business_name_en,
        tier: row.tier,
        creditLimit: money(Number(row.limit_amount ?? 0)),
        isPickupPoint: row.is_pickup_point,
        geo: row.geo_lat !== null && row.geo_lng !== null ? { lat: Number(row.geo_lat), lng: Number(row.geo_lng) } : null,
        bank: { name: row.bank_name, ibanMasked: maskIban(row.bank_iban) }
      })
    );
  });

  // EP-SP-011 · PATCH /supplier/profile · auth(supplier) — contact/bank only;
  // tier/creditLimit/isPickupPoint are admin-only (AC-03) and rejected here
  // structurally: checked against the RAW body before zod parsing, since zod's
  // default .object() silently strips unknown keys rather than rejecting them.
  app.patch("/api/v1/supplier/profile", async (request, reply) => {
    const { supplierId } = requireSupplier(request);
    const raw = request.body as Record<string, unknown>;
    if ("tier" in raw || "creditLimit" in raw || "isPickupPoint" in raw) throw new ApiError("FORBIDDEN");
    const body = updateSupplierProfileRequest.parse(request.body);

    await withServiceRoleTransaction(async (client) => {
      await client.query("select credit.update_supplier_profile($1, $2, $3, $4, $5)", [
        supplierId,
        body.contact?.businessNameAr ?? null,
        body.contact?.businessNameEn ?? null,
        body.bank?.name ?? null,
        body.bank?.iban ?? null
      ]);
    });
    return reply.code(200).send(updateSupplierProfileResponse.parse({ status: "updated" }));
  });

  // EP-SP-012 · GET /pickup-points · public (no auth)
  // Distance uses a haversine calc against the caller-supplied lat/lng (same
  // Maps-vendor-free default Section 3/DEFERRED-DECISIONS.md sets for
  // checkout/deliveryQuote.ts — no Google Maps/geocoding vendor wired).
  app.get<{ Querystring: { lat?: string; lng?: string; radiusKm?: string } }>("/api/v1/pickup-points", async (request, reply) => {
    const rows = await withServiceRoleTransaction(async (client) => {
      const res = await client.query<{
        supplier_id: string;
        business_name_ar: string;
        business_name_en: string;
        geo_lat: string;
        geo_lng: string;
      }>("select * from catalog.list_pickup_points()");
      return res.rows;
    });

    const lat = request.query.lat !== undefined ? Number(request.query.lat) : null;
    const lng = request.query.lng !== undefined ? Number(request.query.lng) : null;
    const radiusKm = request.query.radiusKm !== undefined ? Number(request.query.radiusKm) : null;

    let items = rows.map((r) => ({
      supplierId: r.supplier_id,
      businessNameAr: r.business_name_ar,
      businessNameEn: r.business_name_en,
      geo: { lat: Number(r.geo_lat), lng: Number(r.geo_lng) },
      distanceKm: lat !== null && lng !== null ? haversineKm(lat, lng, Number(r.geo_lat), Number(r.geo_lng)) : null
    }));

    if (lat !== null && lng !== null) {
      items = items.filter((i) => radiusKm === null || (i.distanceKm ?? Infinity) <= radiusKm);
      items.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }

    return reply.code(200).send(
      pickupPointsResponse.parse({ items: items.map((i) => ({ ...i, distanceKm: i.distanceKm !== null ? Number(i.distanceKm.toFixed(2)) : null })) })
    );
  });

  // EP-SP-020 · GET /supplier/price · auth(supplier) · ?packSizeId=
  app.get<{ Querystring: { packSizeId: string } }>("/api/v1/supplier/price", async (request, reply) => {
    const { actor } = requireSupplier(request);
    const row = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<{ unit_price: string; tier: string }>(
        `select tp.unit_price, s.tier from catalog.tier_prices tp
         join credit.suppliers s on s.id = (app_auth.jwt()->>'supplier_id')::uuid
         where tp.pack_size_id = $1`,
        [request.query.packSizeId]
      );
      return res.rows[0];
    });
    if (!row) throw new ApiError("TIER_PRICE_MISSING");
    return reply.code(200).send(supplierPriceResponse.parse({ tierUnitPrice: money(Number(row.unit_price)), tier: row.tier }));
  });
}
