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

-- Down Migration

drop schema if exists catalog cascade;
