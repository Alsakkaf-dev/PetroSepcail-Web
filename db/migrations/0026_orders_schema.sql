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

-- Down Migration

drop schema if exists orders cascade;
