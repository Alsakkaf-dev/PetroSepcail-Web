import { addressCreateRequest, addressListResponse, addressRow, addressUpdateRequest } from "@petrospecial/contracts";
import type { FastifyInstance } from "fastify";
import { withRlsTransaction } from "../db.js";
import { ApiError } from "../errors.js";

interface AddressRecord {
  id: string;
  label: string | null;
  recipient_name: string;
  phone: string;
  line1: string;
  line2: string | null;
  district: string | null;
  city: string;
  lat: string | null;
  lng: string | null;
  is_default: boolean;
}

function toWire(r: AddressRecord) {
  return {
    id: r.id,
    label: r.label,
    recipientName: r.recipient_name,
    phone: r.phone,
    line1: r.line1,
    line2: r.line2,
    district: r.district,
    city: r.city,
    lat: r.lat,
    lng: r.lng,
    isDefault: r.is_default
  };
}

// EP-PC-013/014/015 (PC-01) — flagged unbuilt since S02's own Handover
// Brief ("no session owns them explicitly yet"); S08 picks it up as the
// genuine prerequisite checkout's address-selector step (FR-SF04-002) turned
// out to need. core.addresses + its `addr_own` RLS policy already existed
// (S01, 0004/0006) — this is the first route to actually use them.
export function registerAddressRoutes(app: FastifyInstance): void {
  app.get("/api/v1/me/addresses", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    const rows = await withRlsTransaction(actor, async (client) => {
      const res = await client.query<AddressRecord>(
        `select id, label, recipient_name, phone, line1, line2, district, city, lat, lng, is_default
         from core.addresses where identity_id = $1 order by is_default desc, created_at`,
        [actor.sub]
      );
      return res.rows;
    });
    return reply.code(200).send(addressListResponse.parse({ items: rows.map(toWire) }));
  });

  app.post("/api/v1/me/addresses", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    const body = addressCreateRequest.parse(request.body);

    const row = await withRlsTransaction(actor, async (client) => {
      if (body.isDefault) {
        await client.query("update core.addresses set is_default = false where identity_id = $1", [actor.sub]);
      }
      const res = await client.query<AddressRecord>(
        `insert into core.addresses (identity_id, label, recipient_name, phone, line1, line2, district, city, lat, lng, is_default)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         returning id, label, recipient_name, phone, line1, line2, district, city, lat, lng, is_default`,
        [
          actor.sub,
          body.label ?? null,
          body.recipientName,
          body.phone,
          body.line1,
          body.line2 ?? null,
          body.district ?? null,
          body.city,
          body.lat ?? null,
          body.lng ?? null,
          body.isDefault ?? false
        ]
      );
      return res.rows[0]!;
    });

    return reply.code(201).send(addressRow.parse(toWire(row)));
  });

  app.patch<{ Params: { id: string } }>("/api/v1/me/addresses/:id", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    const body = addressUpdateRequest.parse(request.body);

    const row = await withRlsTransaction(actor, async (client) => {
      if (body.isDefault) {
        await client.query("update core.addresses set is_default = false where identity_id = $1", [actor.sub]);
      }
      const res = await client.query<AddressRecord>(
        `update core.addresses set
           label = coalesce($2, label), recipient_name = coalesce($3, recipient_name),
           phone = coalesce($4, phone), line1 = coalesce($5, line1), line2 = coalesce($6, line2),
           district = coalesce($7, district), city = coalesce($8, city),
           lat = coalesce($9, lat), lng = coalesce($10, lng), is_default = coalesce($11, is_default)
         where id = $1
         returning id, label, recipient_name, phone, line1, line2, district, city, lat, lng, is_default`,
        [
          request.params.id,
          body.label ?? null,
          body.recipientName ?? null,
          body.phone ?? null,
          body.line1 ?? null,
          body.line2 ?? null,
          body.district ?? null,
          body.city ?? null,
          body.lat ?? null,
          body.lng ?? null,
          body.isDefault ?? null
        ]
      );
      return res.rows[0];
    });

    if (!row) throw new ApiError("NOT_FOUND");
    return reply.code(200).send(addressRow.parse(toWire(row)));
  });

  app.delete<{ Params: { id: string } }>("/api/v1/me/addresses/:id", async (request, reply) => {
    const actor = request.ctx.actor;
    if (!actor) throw new ApiError("INVALID_CREDENTIALS");
    await withRlsTransaction(actor, async (client) => {
      await client.query("delete from core.addresses where id = $1", [request.params.id]);
    });
    return reply.code(204).send();
  });
}
