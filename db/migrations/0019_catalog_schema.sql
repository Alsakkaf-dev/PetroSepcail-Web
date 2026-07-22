-- Up Migration
-- catalog schema (10-customer-storefront/04-database-design.md §2, SF-01/
-- AC-02): product content model. AC-02 is the sole writer; SF/SP read only
-- (comment on each table, enforced by RLS+grants in 0020_catalog_rls.sql).
-- Column conventions per 05-master-database-architecture §3 (uuid PK,
-- created_at/updated_at, bilingual name_ar/name_en AR-non-null).

create schema catalog;

-- 2.1 brand_families ----------------------------------------------------------
create table catalog.brand_families (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique check (code in ('special','petro','raval')),
  name_ar    text not null, name_en text not null,
  intro_ar   text not null, intro_en text not null,   -- seeded from site cat.*.intro
  color_token text not null,                            -- '--f-special' | '--f-petro' | '--f-raval' (PC-08)
  sort       int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table catalog.brand_families is 'SF-01 — three brand families; write AC-02 only';
create trigger set_updated_at before update on catalog.brand_families
  for each row execute function moddatetime(updated_at);

-- 2.2 skus ----------------------------------------------------------------------
-- SPEC-GAP (04-database-design §2.2 vs 05-api-specification §1 EP-SF-003):
-- the DB doc's literal DDL gives `compatibility`/`pack_note`/`origin` as
-- single (non-bilingual) columns and has no `type` column at all, but this
-- document's own global convention (§0 preamble: "bilingual name_ar/name_en
-- AR-non-null") plus the real legacy-site content (ps.spec.compat.v etc.)
-- genuinely differs AR vs EN for these fields, and EP-SF-003's response
-- shape literally requires a 10th spec field, `type` (site: ps.spec.type.v),
-- that has no backing column anywhere in the DB doc. Least-surprising
-- reading: split those three into _ar/_en pairs and add `product_type_ar/en`
-- as an additive column. `grade`/`line`/`api_service` stay single columns —
-- the site never gives them a translated `.v` counterpart (locale-invariant
-- technical designations: 'SAE 10W-30', 'API SL', 'SUPER SPECIAL').
create table catalog.skus (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,                   -- site's 23 canonical slugs (PROGRESS Part A)
  family_id     uuid not null references catalog.brand_families(id) on delete restrict,
  name_ar       text not null, name_en text not null,
  grade         text not null,                          -- viscosity/variant: '20W-50','5W-30','DOT 4','ATF','CVT','GREEN','RED'
  application   text not null check (application in         -- filter facet (SF-02)
                 ('petrol_engine','diesel_engine','coolant','brake_fluid','gear_fluid')),
  line          text,                                    -- product line label (spec: 'brand'/'line')
  api_service   text,                                    -- e.g. 'API SL/SN'
  product_type_ar text not null, product_type_en text not null,  -- SPEC-GAP addition, see above
  compatibility_ar text, compatibility_en text,           -- SPEC-GAP: bilingual split of `compatibility`
  drain_km      int,                                     -- ps.spec.km.v (drain interval)
  pack_note_ar  text, pack_note_en text,                  -- SPEC-GAP: bilingual split of `pack_note`
  shelf_life_months int,                                 -- ps.spec.shelf.v
  origin_ar     text not null default 'المملكة العربية السعودية',
  origin_en     text not null default 'Saudi Arabia',    -- SPEC-GAP: bilingual split of `origin`
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on catalog.skus (family_id);
create index on catalog.skus (application);
comment on table catalog.skus is 'SF-01 — 23 launch SKUs; structured spec fields; write AC-02 only';
create trigger set_updated_at before update on catalog.skus
  for each row execute function moddatetime(updated_at);

-- 2.3 sku_content (the 7 datasheet blocks, structured) ------------------------
create table catalog.sku_content (
  id       uuid primary key default gen_random_uuid(),
  sku_id   uuid not null references catalog.skus(id) on delete cascade,
  block    text not null check (block in
             ('overview','specs','benefits','quality','manufacturer','hse','cta')),
  ordinal  int not null default 0,                       -- for multi-line blocks (benefits bullets, overview paras)
  body_ar  text not null, body_en text not null,
  unique (sku_id, block, ordinal)
);
comment on table catalog.sku_content is 'SF-01 FR-SF01-003 — 7-block datasheet content, AR non-null';

-- 2.4 certifications -----------------------------------------------------------
create table catalog.certifications (
  id        uuid primary key default gen_random_uuid(),
  sku_id    uuid not null references catalog.skus(id) on delete cascade,
  mark      text not null check (mark in
              ('iso_9001','api_service','saso','saudi_made','virgin_base_oils','aramco_spec')),
  caption_ar text not null, caption_en text not null,
  unique (sku_id, mark)
);
comment on table catalog.certifications is 'SF-01 FR-SF01-006 — structured trust marks';

-- 2.5 pack_sizes -----------------------------------------------------------------
create table catalog.pack_sizes (
  id         uuid primary key default gen_random_uuid(),
  sku_id     uuid not null references catalog.skus(id) on delete cascade,
  size_label text not null,                              -- '1L','4L','5L','20L','209L' [BUSINESS-CONFIRM]
  size_liters numeric(7,2) not null,
  barcode    text unique,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (sku_id, size_label)
);
comment on table catalog.pack_sizes is 'SF-01 FR-SF01-004 — one buyable variant per row';

-- 2.6 prices (retail list price, ex-VAT — the value behind EP-X-004 for retail)
create table catalog.prices (
  id            uuid primary key default gen_random_uuid(),
  pack_size_id  uuid not null references catalog.pack_sizes(id) on delete cascade,
  list_price    numeric(12,2) not null check (list_price >= 0),  -- ex-VAT retail unit price (SAR)
  effective_at  timestamptz not null default now(),
  is_current    boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index one_current_price on catalog.prices (pack_size_id) where is_current;
comment on table catalog.prices is 'SF-01 — retail price authority source; VAT applied by rule, not stored here. Wholesale tier_prices are defined in 30-supplier-portal/04 (same catalog schema).';

-- 2.7 inventory (quantity hidden from customers — in-stock flag only) --------
create table catalog.inventory (
  pack_size_id uuid primary key references catalog.pack_sizes(id) on delete cascade,
  qty_on_hand  int not null default 0 check (qty_on_hand >= 0),
  reserved     int not null default 0 check (reserved >= 0),
  updated_at   timestamptz not null default now()
);
comment on table catalog.inventory is 'AC-02 writes; single Jeddah hub source of truth (D-14a); customers read in-stock flag via v_sku_availability only.';
create trigger set_updated_at before update on catalog.inventory
  for each row execute function moddatetime(updated_at);

-- customer-facing availability view: exposes a boolean, never a number (FR-SF01-005 / 04-roles §3 "Inventory: R in-stock flag only")
create view catalog.v_sku_availability as
select p.id as pack_size_id, p.sku_id,
       (i.qty_on_hand - i.reserved) > 0 as in_stock
from catalog.pack_sizes p
join catalog.inventory i on i.pack_size_id = p.id
where p.is_active;
comment on view catalog.v_sku_availability is 'SF-01 FR-SF01-005 — boolean availability; no quantity leak';

-- 2.8 sku_media (references PC-09 objects) --------------------------------------
create table catalog.sku_media (
  id       uuid primary key default gen_random_uuid(),
  sku_id   uuid not null references catalog.skus(id) on delete cascade,
  media_id uuid not null references core.media_objects(id),  -- signed-URL access (PC-09)
  alt_ar   text, alt_en text,
  sort     int not null default 0
);
comment on table catalog.sku_media is 'SF-01 FR-SF01-007 — product gallery; images are private MinIO objects';

-- Down Migration

drop schema if exists catalog cascade;
