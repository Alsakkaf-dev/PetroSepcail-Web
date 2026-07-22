-- Up Migration
-- orders schema (10-customer-storefront/04-database-design.md §3, SF-03/04):
-- SF is the lifecycle owner. Column conventions per 05-master-database-
-- architecture §3 (uuid PK, created_at/updated_at, money numeric(12,2)).
-- Enums (order_status, payment_method) come from core (D-04) — no local
-- enum, per this doc's own §0 rule.

create schema orders;

-- 3.1 carts / cart_lines --------------------------------------------------
create table orders.carts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references core.identities(id) on delete cascade,
  status     text not null default 'open' check (status in ('open','merged','converted')),
  coupon_code text,                                      -- validated live via EP-X-002; not trusted as discount source
  version    int not null default 0,                    -- optimistic concurrency (FR-SF03-009)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '30 days'  -- FR-SF03-006 [BUSINESS-CONFIRM]
);
create unique index one_open_cart_per_user on orders.carts (user_id) where status = 'open';
comment on table orders.carts is 'SF-03 — one open cart per customer; 30-day persistence';
create trigger set_updated_at before update on orders.carts
  for each row execute function moddatetime(updated_at);

create table orders.cart_lines (
  id           uuid primary key default gen_random_uuid(),
  cart_id      uuid not null references orders.carts(id) on delete cascade,
  pack_size_id uuid not null references catalog.pack_sizes(id) on delete restrict,
  qty          int not null check (qty between 1 and 99),          -- max_line_qty [BUSINESS-CONFIRM]
  unit_price   numeric(12,2) not null,                              -- snapshot from EP-X-004 at add-time; re-validated at checkout
  created_at   timestamptz not null default now(),
  unique (cart_id, pack_size_id)
);
comment on table orders.cart_lines is 'SF-03 FR-SF03-001 — one row per pack size in a cart';

-- 3.2 orders / order_lines ------------------------------------------------
-- D-14b (PROGRESS.md, hybrid fulfillment): additive fulfillment_type +
-- pickup_location_id — "D-04 order_status stays verbatim; SF-04 as written
-- remains valid as the home-delivery path; pickup is an additive branch."
-- pickup_location_id has NO FK yet: it targets a pickup-point supplier row
-- (credit.suppliers.is_pickup_point=true), and credit.suppliers doesn't
-- exist until SP-01 (S14) — same deferred-FK precedent as S01's
-- role_grants.supplier_id/driver_id. The pickup UI/directory itself is
-- S16 (SP-06..09) territory; this session only needs the column to exist
-- and default correctly for the home_delivery path it actually builds.
create table orders.orders (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references core.identities(id) on delete restrict,
  kind           text not null check (kind in ('retail','wholesale')) default 'retail',
  supplier_id    uuid,                                   -- set iff kind='wholesale' (SP-01)
  status         order_status not null,                  -- D-04 enum (core); entry value set by FR-SF04-009/010
  payment_method payment_method not null,                -- D-04; retail = 'cod' | 'bank_transfer' only (D-11)
  fulfillment_type text not null default 'home_delivery'
                   check (fulfillment_type in ('home_delivery','pickup_point')),   -- D-14b
  pickup_location_id uuid,                                -- set iff fulfillment_type='pickup_point' (D-14b; FK deferred to S14)
  subtotal       numeric(12,2) not null,                 -- ex-VAT sum of line unit_price*qty
  vat_amount     numeric(12,2) not null,                 -- 15% of taxable base (PC-12 vat_rate)
  discount_amount numeric(12,2) not null default 0,      -- coupon + points redemption
  delivery_fee   numeric(12,2) not null default 0,       -- from EP-X-005 (0 when free-delivery threshold met)
  total          numeric(12,2) not null,                 -- subtotal + vat - discount + delivery_fee
  cod_amount     numeric(12,2),                          -- set iff payment_method='cod' (carried in EV-PC-013)
  address_snapshot jsonb not null,                       -- frozen at placement (FR-SF04-012)
  delivery_slot  text not null,                          -- 'same_day'|'next_am'|'next_pm' [BUSINESS-CONFIRM]
  idempotency_key text,                                  -- client key (NFR-SF-004)
  placed_at      timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index on orders.orders (user_id, status);
comment on table orders.orders is 'SF-05 — shared retail/wholesale order; one D-04 lifecycle';
create trigger set_updated_at before update on orders.orders
  for each row execute function moddatetime(updated_at);

create table orders.order_lines (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references orders.orders(id) on delete cascade,
  pack_size_id uuid not null references catalog.pack_sizes(id) on delete restrict,
  sku_slug     text not null,                            -- snapshot (SKU may change later)
  name_ar      text not null, name_en text not null,     -- snapshot
  qty          int not null check (qty >= 1),
  unit_price   numeric(12,2) not null,                   -- ex-VAT, server-recomputed at placement
  line_vat     numeric(12,2) not null,
  line_total   numeric(12,2) not null                    -- (unit_price*qty)+line_vat
);
comment on table orders.order_lines is 'SF-04 — immutable priced snapshot; driver sees address+lines but NOT price (04-roles §3)';

-- Down Migration

drop schema if exists orders cascade;
