import {
  adminSkuListResponse,
  inventoryUpdateRequest,
  inventoryUpdateResponse,
  packSizeUpsertRequest,
  packSizeUpsertResponse,
  priceUpdateRequest,
  priceUpdateResponse,
  skuUpsertRequest,
  skuUpsertResponse
} from "@petrospecial/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { PoolClient } from "pg";
import { withServiceRoleTransaction } from "../db.js";
import { ApiError } from "../errors.js";
import { publishEvent } from "../events/publishEvent.js";
import { requirePermission } from "../gateway/requirePermission.js";

async function replaceSkuContent(
  client: PoolClient,
  skuId: string,
  blocks: NonNullable<import("@petrospecial/contracts").SkuUpsertRequest["blocks"]>
): Promise<void> {
  await client.query("delete from catalog.sku_content where sku_id = $1", [skuId]);
  const rows: Array<[string, number, string, string]> = [];
  blocks.overview.forEach((b, i) => rows.push(["overview", i, b.ar, b.en]));
  blocks.benefits.forEach((b, i) => rows.push(["benefits", i, b.ar, b.en]));
  blocks.quality.forEach((b, i) => rows.push(["quality", i, b.ar, b.en]));
  blocks.manufacturer.forEach((b, i) => rows.push(["manufacturer", i, b.ar, b.en]));
  blocks.hse.forEach((b, i) => rows.push(["hse", i, b.ar, b.en]));
  rows.push(["cta", 0, blocks.cta.headingAr, blocks.cta.headingEn]);
  rows.push(["cta", 1, blocks.cta.textAr, blocks.cta.textEn]);
  for (const [block, ordinal, bodyAr, bodyEn] of rows) {
    await client.query(
      `insert into catalog.sku_content (sku_id, block, ordinal, body_ar, body_en) values ($1, $2, $3, $4, $5)`,
      [skuId, block, ordinal, bodyAr, bodyEn]
    );
  }
}

export function registerAdminCatalogRoutes(app: FastifyInstance): void {
  // SPEC-GAP (packages/contracts/src/ac-catalog.ts, adminSkuListResponse):
  // an additive read the console needs to display current values before
  // editing — no GET exists for AC-02 in 40-admin-center/05-api-
  // specification.md §2.
  app.get("/api/v1/admin/catalog/skus", { preHandler: requirePermission("read", "catalog") }, async (_request, reply) => {
    const rows = await withServiceRoleTransaction(async (client) => {
      const res = await client.query(
        `select s.id as sku_id, s.slug, s.name_ar, s.name_en, s.is_active,
                p.id as pack_size_id, p.size_label,
                catalog.resolve_retail_price(p.id) as retail_price,
                i.qty_on_hand, i.reserved
         from catalog.skus s
         join catalog.pack_sizes p on p.sku_id = s.id
         left join catalog.inventory i on i.pack_size_id = p.id
         order by s.name_ar, p.size_liters`
      );
      return res.rows;
    });

    return reply.code(200).send(
      adminSkuListResponse.parse({
        items: rows.map((r) => ({
          skuId: r.sku_id,
          slug: r.slug,
          nameAr: r.name_ar,
          nameEn: r.name_en,
          isActive: r.is_active,
          packSizeId: r.pack_size_id,
          sizeLabel: r.size_label,
          retailPrice: r.retail_price,
          qtyOnHand: r.qty_on_hand ?? 0,
          reserved: r.reserved ?? 0
        }))
      })
    );
  });

  // EP-AC-010 · POST /admin/catalog/skus · auth(admin) — create
  app.post("/api/v1/admin/catalog/skus", { preHandler: requirePermission("create", "catalog") }, async (request, reply) => {
    const body = skuUpsertRequest.parse(request.body);
    const actor = request.ctx.actor!;

    const row = await withServiceRoleTransaction(async (client) => {
      const existing = await client.query("select id from catalog.skus where slug = $1", [body.slug]);
      if (existing.rows.length > 0) throw new ApiError("CONFLICT", { field: "slug" });

      const family = await client.query<{ id: string }>("select id from catalog.brand_families where code = $1", [
        body.familyCode
      ]);
      if (family.rows.length === 0) throw new ApiError("VALIDATION_ERROR", { field: "familyCode" });

      const res = await client.query(
        `insert into catalog.skus (
           slug, family_id, name_ar, name_en, grade, application, line, api_service,
           product_type_ar, product_type_en, compatibility_ar, compatibility_en,
           drain_km, pack_note_ar, pack_note_en, shelf_life_months, is_active
         ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         returning id, slug, name_ar, name_en, is_active, updated_at`,
        [
          body.slug,
          family.rows[0]!.id,
          body.nameAr,
          body.nameEn,
          body.grade,
          body.application,
          body.line ?? null,
          body.apiService ?? null,
          body.productTypeAr,
          body.productTypeEn,
          body.compatibilityAr ?? null,
          body.compatibilityEn ?? null,
          body.drainKm ?? null,
          body.packNoteAr ?? null,
          body.packNoteEn ?? null,
          body.shelfLifeMonths ?? null,
          body.isActive ?? true
        ]
      );
      const sku = res.rows[0];

      if (body.blocks) await replaceSkuContent(client, sku.id, body.blocks);

      await client.query(
        `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
         values ($1, $2, 'sku_created', 'catalog.skus', $3, null, $4)`,
        [actor.sub, actor.role, sku.id, JSON.stringify({ slug: sku.slug, nameAr: sku.name_ar, nameEn: sku.name_en })]
      );
      return sku;
    });

    return reply.code(201).send(
      skuUpsertResponse.parse({
        id: row.id,
        slug: row.slug,
        familyCode: body.familyCode,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        isActive: row.is_active,
        updatedAt: row.updated_at.toISOString()
      })
    );
  });

  // EP-AC-010 · PATCH /admin/catalog/skus · auth(admin) — update by slug
  app.patch("/api/v1/admin/catalog/skus", { preHandler: requirePermission("update", "catalog") }, async (request, reply) => {
    const body = skuUpsertRequest.parse(request.body);
    const actor = request.ctx.actor!;

    const row = await withServiceRoleTransaction(async (client) => {
      const before = await client.query("select * from catalog.skus where slug = $1", [body.slug]);
      if (before.rows.length === 0) throw new ApiError("NOT_FOUND");
      const beforeRow = before.rows[0];

      const family = await client.query<{ id: string }>("select id from catalog.brand_families where code = $1", [
        body.familyCode
      ]);
      if (family.rows.length === 0) throw new ApiError("VALIDATION_ERROR", { field: "familyCode" });

      const res = await client.query(
        `update catalog.skus set
           family_id = $2, name_ar = $3, name_en = $4, grade = $5, application = $6, line = $7,
           api_service = $8, product_type_ar = $9, product_type_en = $10, compatibility_ar = $11,
           compatibility_en = $12, drain_km = $13, pack_note_ar = $14, pack_note_en = $15,
           shelf_life_months = $16, is_active = $17
         where slug = $1
         returning id, slug, name_ar, name_en, is_active, updated_at`,
        [
          body.slug,
          family.rows[0]!.id,
          body.nameAr,
          body.nameEn,
          body.grade,
          body.application,
          body.line ?? null,
          body.apiService ?? null,
          body.productTypeAr,
          body.productTypeEn,
          body.compatibilityAr ?? null,
          body.compatibilityEn ?? null,
          body.drainKm ?? null,
          body.packNoteAr ?? null,
          body.packNoteEn ?? null,
          body.shelfLifeMonths ?? null,
          body.isActive ?? beforeRow.is_active
        ]
      );
      const sku = res.rows[0];

      if (body.blocks) await replaceSkuContent(client, sku.id, body.blocks);

      // FR-AC02-002: "a mutation is audited" — SF sees it on next read (no
      // cache layer sits between SF's catalog routes and this table).
      await client.query(
        `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
         values ($1, $2, 'sku_updated', 'catalog.skus', $3, $4, $5)`,
        [
          actor.sub,
          actor.role,
          sku.id,
          JSON.stringify({ nameAr: beforeRow.name_ar, nameEn: beforeRow.name_en, isActive: beforeRow.is_active }),
          JSON.stringify({ nameAr: sku.name_ar, nameEn: sku.name_en, isActive: sku.is_active })
        ]
      );
      return sku;
    });

    return reply.code(200).send(
      skuUpsertResponse.parse({
        id: row.id,
        slug: row.slug,
        familyCode: body.familyCode,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        isActive: row.is_active,
        updatedAt: row.updated_at.toISOString()
      })
    );
  });

  // EP-AC-011 · POST/PATCH /admin/catalog/pack-sizes · auth(admin) — upsert
  // keyed on the table's own unique(sku_id, size_label) constraint; the
  // spec gives no {id} path segment for either verb, so both behave the
  // same (create-or-replace-by-natural-key).
  async function upsertPackSize(request: FastifyRequest, reply: FastifyReply) {
    const body = packSizeUpsertRequest.parse(request.body);
    const actor = request.ctx.actor!;

    const row = await withServiceRoleTransaction(async (client) => {
      const sku = await client.query("select id from catalog.skus where id = $1", [body.skuId]);
      if (sku.rows.length === 0) throw new ApiError("VALIDATION_ERROR", { field: "skuId" });

      const res = await client.query(
        `insert into catalog.pack_sizes (sku_id, size_label, size_liters, barcode, is_active)
         values ($1, $2, $3, $4, $5)
         on conflict (sku_id, size_label) do update
           set size_liters = excluded.size_liters, barcode = excluded.barcode, is_active = excluded.is_active
         returning id, sku_id, size_label, size_liters, is_active`,
        [body.skuId, body.sizeLabel, body.sizeLiters, body.barcode ?? null, body.isActive ?? true]
      );
      const packSize = res.rows[0];

      // A brand-new pack size has no inventory row yet — one is required by
      // catalog.v_sku_availability's join (0019_catalog_schema.sql §2.7).
      await client.query(
        "insert into catalog.inventory (pack_size_id) values ($1) on conflict (pack_size_id) do nothing",
        [packSize.id]
      );

      await client.query(
        `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
         values ($1, $2, 'pack_size_upserted', 'catalog.pack_sizes', $3, null, $4)`,
        [actor.sub, actor.role, packSize.id, JSON.stringify({ sizeLabel: packSize.size_label })]
      );
      return packSize;
    });

    return reply.code(200).send(
      packSizeUpsertResponse.parse({
        id: row.id,
        skuId: row.sku_id,
        sizeLabel: row.size_label,
        sizeLiters: row.size_liters,
        isActive: row.is_active
      })
    );
  }
  app.post("/api/v1/admin/catalog/pack-sizes", { preHandler: requirePermission("create", "catalog") }, upsertPackSize);
  app.patch("/api/v1/admin/catalog/pack-sizes", { preHandler: requirePermission("update", "catalog") }, upsertPackSize);

  // EP-AC-012 · PUT /admin/catalog/prices · auth(admin)
  app.put("/api/v1/admin/catalog/prices", { preHandler: requirePermission("update", "catalog") }, async (request, reply) => {
    const body = priceUpdateRequest.parse(request.body);
    const actor = request.ctx.actor!;

    if (!body.retailPrice && !body.tierPrices) {
      throw new ApiError("VALIDATION_ERROR", { field: "retailPrice/tierPrices", reason: "at least one is required" });
    }

    const result = await withServiceRoleTransaction(async (client) => {
      const packSize = await client.query("select id from catalog.pack_sizes where id = $1", [body.packSizeId]);
      if (packSize.rows.length === 0) throw new ApiError("NOT_FOUND");

      let retailPrice: string;
      let effectiveAt: Date;
      let oldPrice: string | null = null;

      if (body.retailPrice) {
        const before = await client.query<{ list_price: string }>(
          "select list_price from catalog.prices where pack_size_id = $1 and is_current",
          [body.packSizeId]
        );
        oldPrice = before.rows[0]?.list_price ?? null;

        await client.query("update catalog.prices set is_current = false where pack_size_id = $1 and is_current", [
          body.packSizeId
        ]);
        const res = await client.query<{ list_price: string; effective_at: Date }>(
          `insert into catalog.prices (pack_size_id, list_price, is_current)
           values ($1, $2, true) returning list_price, effective_at`,
          [body.packSizeId, body.retailPrice]
        );
        retailPrice = res.rows[0]!.list_price;
        effectiveAt = res.rows[0]!.effective_at;

        // FR-AC02-003: "a change emits EV-PC-003 ... issued invoices are
        // never retro-priced" — this only ever inserts a new catalog.prices
        // row, it never updates orders.order_lines' already-snapshotted
        // unit_price.
        await publishEvent(client, {
          name: "catalog.price.changed",
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { pack_size_id: body.packSizeId, old: oldPrice, new: retailPrice }
        });
        await client.query(
          `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
           values ($1, $2, 'price_changed', 'catalog.prices', $3, $4, $5)`,
          [actor.sub, actor.role, body.packSizeId, JSON.stringify({ listPrice: oldPrice }), JSON.stringify({ listPrice: retailPrice })]
        );
      } else {
        const current = await client.query<{ list_price: string }>(
          "select list_price from catalog.prices where pack_size_id = $1 and is_current",
          [body.packSizeId]
        );
        if (!current.rows[0]) throw new ApiError("NOT_FOUND");
        retailPrice = current.rows[0].list_price;
        effectiveAt = new Date();
      }

      let tierPrices: { bronze: string; silver: string; gold: string } | undefined;
      if (body.tierPrices) {
        // AC-02/SP-02 (04-database-design.md §5 comment: "AC-02 (S17+) is the
        // sole writer of values" — this route). NEVER exposed to a customer
        // (NFR-SP-003); catalog.tier_prices has no is_current concept, a
        // straight upsert per (pack_size_id, tier) is the whole model (0052).
        for (const [tier, price] of Object.entries(body.tierPrices) as Array<["bronze" | "silver" | "gold", string]>) {
          await client.query(
            `insert into catalog.tier_prices (pack_size_id, tier, unit_price) values ($1, $2, $3)
             on conflict (pack_size_id, tier) do update set unit_price = excluded.unit_price, updated_at = now()`,
            [body.packSizeId, tier, price]
          );
        }
        tierPrices = body.tierPrices;
        await publishEvent(client, {
          name: "catalog.price.changed",
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { pack_size_id: body.packSizeId, tier_prices: body.tierPrices }
        });
        await client.query(
          `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
           values ($1, $2, 'tier_price_changed', 'catalog.tier_prices', $3, $4)`,
          [actor.sub, actor.role, body.packSizeId, JSON.stringify(body.tierPrices)]
        );
      }

      return { retailPrice, tierPrices, effectiveAt };
    });

    return reply.code(200).send(
      priceUpdateResponse.parse({
        packSizeId: body.packSizeId,
        retailPrice: result.retailPrice,
        ...(result.tierPrices ? { tierPrices: result.tierPrices } : {}),
        effectiveAt: result.effectiveAt.toISOString()
      })
    );
  });

  // EP-AC-013 · PUT /admin/catalog/inventory · auth(admin)
  app.put("/api/v1/admin/catalog/inventory", { preHandler: requirePermission("update", "inventory") }, async (request, reply) => {
    const body = inventoryUpdateRequest.parse(request.body);
    const actor = request.ctx.actor!;

    const row = await withServiceRoleTransaction(async (client) => {
      const current = await client.query<{ qty_on_hand: number; reserved: number }>(
        "select qty_on_hand, reserved from catalog.inventory where pack_size_id = $1",
        [body.packSizeId]
      );
      if (current.rows.length === 0) throw new ApiError("NOT_FOUND");
      const { qty_on_hand: oldQty, reserved } = current.rows[0]!;
      const delta = body.qtyOnHand - oldQty;

      if (delta !== 0) {
        const hub = await client.query<{ id: string }>(
          "select id from catalog.stock_locations where kind = 'hub' and is_active limit 1"
        );
        const hubId = hub.rows[0]?.id ?? null;
        await client.query(
          `select catalog.record_stock_movement($1, $2, $3, $4, 'adjust', null, $5)`,
          delta > 0 ? [body.packSizeId, delta, null, hubId, actor.sub] : [body.packSizeId, -delta, hubId, null, actor.sub]
        );
      }

      // FR-AC02-004: hub stock crossing zero -> EV-PC-004 (stockout); a
      // restock (0 -> >0) -> EV-PC-005, consumed by SF-01/SF-09 back-in-stock.
      const wasInStock = oldQty - reserved > 0;
      const isInStock = body.qtyOnHand - reserved > 0;
      if (wasInStock && !isInStock) {
        await publishEvent(client, {
          name: "catalog.inventory.stockout",
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { pack_size_id: body.packSizeId }
        });
      } else if (!wasInStock && isInStock) {
        await publishEvent(client, {
          name: "catalog.inventory.restocked",
          actorSub: actor.sub,
          actorRole: actor.role,
          payload: { pack_size_id: body.packSizeId, qty: body.qtyOnHand }
        });
      }

      await client.query(
        `insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, before, after)
         values ($1, $2, 'inventory_adjusted', 'catalog.inventory', $3, $4, $5)`,
        [
          actor.sub,
          actor.role,
          body.packSizeId,
          JSON.stringify({ qtyOnHand: oldQty }),
          JSON.stringify({ qtyOnHand: body.qtyOnHand })
        ]
      );

      const after = await client.query<{ qty_on_hand: number; reserved: number }>(
        "select qty_on_hand, reserved from catalog.inventory where pack_size_id = $1",
        [body.packSizeId]
      );
      return after.rows[0]!;
    });

    return reply.code(200).send(
      inventoryUpdateResponse.parse({
        packSizeId: body.packSizeId,
        qtyOnHand: row.qty_on_hand,
        reserved: row.reserved
      })
    );
  });
}
