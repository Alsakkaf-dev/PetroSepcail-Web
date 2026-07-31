-- Up Migration
-- 30-supplier-portal/04-database-design.md §2 (Task SP-DB-1) — the full
-- `credit` schema, built upfront (same "Database, first" ordering DL used,
-- S10). Only SP-01/02/03's own functions/endpoints are wired this session
-- (S14); invoices/invoice_lines/payments_received/custody_ledger/
-- order_templates/statements exist now so SP-04/05/06/09 (S15/S16) don't
-- need schema surgery — but `credit.invoices` is also a genuine SP-03
-- dependency THIS session (compute_exposure sums its open_balance), not
-- just front-loading for later.
create schema credit;

create table credit.suppliers (
  id            uuid primary key default gen_random_uuid(),
  identity_id   uuid not null unique references core.identities(id) on delete restrict,
  business_name_ar text not null,
  business_name_en text not null,
  cr_number     text,
  vat_number    text,
  tier          text not null default 'bronze' check (tier in ('bronze','silver','gold')),
  bank_name     text,
  bank_iban     text,
  is_pickup_point boolean not null default false,
  geo_lat       numeric(9,6),
  geo_lng       numeric(9,6),
  status        text not null default 'active' check (status in ('pending','active','suspended')),
  activated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check ( is_pickup_point = false or (geo_lat is not null and geo_lng is not null) )
);
comment on table credit.suppliers is 'SP-01 — supplier master; suppliers.id == JWT supplier_id; tier drives SP-02 pricing';
create trigger set_updated_at before update on credit.suppliers
  for each row execute function moddatetime(updated_at);

create table credit.credit_limits (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references credit.suppliers(id) on delete restrict,
  limit_amount numeric(12,2) not null check (limit_amount >= 0),
  is_current   boolean not null default true,
  set_by       uuid references core.identities(id),
  reason       text,
  effective_at timestamptz not null default now()
);
create unique index one_current_limit_per_supplier on credit.credit_limits (supplier_id) where is_current;
comment on table credit.credit_limits is 'SP-03 — per-supplier credit ceiling; changes arrive as EV-PC-034; history retained';

-- invoice_status (D-04, core) already exists (0002_enum_types.sql).
create table credit.invoices (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references credit.suppliers(id) on delete restrict,
  order_id      uuid not null references orders.orders(id) on delete restrict,
  source_event_id uuid unique,
  status        invoice_status not null default 'issued',
  subtotal      numeric(12,2) not null,
  vat_amount    numeric(12,2) not null,
  total         numeric(12,2) not null,
  paid_amount   numeric(12,2) not null default 0 check (paid_amount >= 0),
  open_balance  numeric(12,2) not null,
  zatca_uuid    uuid,
  ubl_media_id  uuid references core.media_objects(id),
  qr_tlv        text,
  crypto_stamp  text,
  pdf_media_id  uuid references core.media_objects(id),
  issued_at     timestamptz not null default now(),
  due_at        timestamptz not null,
  delivery_date date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on credit.invoices (supplier_id, status);
create index on credit.invoices (status) where status in ('issued','partially_paid','overdue');
comment on table credit.invoices is 'SP-04 (S15) — immutable ZATCA e-invoice; corrections via credit_notes only. B2B DEBT ONLY.';
revoke update, delete on credit.invoices from public;

create table credit.invoice_lines (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references credit.invoices(id) on delete cascade,
  pack_size_id uuid not null references catalog.pack_sizes(id) on delete restrict,
  name_ar      text not null,
  name_en      text not null,
  qty          int not null check (qty > 0),
  unit_price   numeric(12,2) not null,
  line_subtotal numeric(12,2) not null,
  vat_amount   numeric(12,2) not null,
  line_total   numeric(12,2) not null
);
comment on table credit.invoice_lines is 'SP-04 (S15) — frozen at issue; VAT itemized per ZATCA';

create table credit.payments_received (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references credit.suppliers(id) on delete restrict,
  invoice_id    uuid not null references credit.invoices(id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  method        payment_method not null,
  bank_ref      text,
  proof_media_id uuid references core.media_objects(id),
  verified_by   uuid references core.identities(id),
  verified_at   timestamptz,
  recorded_at   timestamptz not null default now()
);
create index on credit.payments_received (invoice_id);
comment on table credit.payments_received is 'SP-05 (S15) — a payment is recorded only after admin verification (EV-PC-018)';

create table credit.credit_notes (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references credit.suppliers(id) on delete restrict,
  invoice_id   uuid references credit.invoices(id) on delete restrict,
  kind         text not null check (kind in ('return','price_correction','early_pay','volume','goodwill')),
  amount       numeric(12,2) not null check (amount > 0),
  source_ref   text,
  reason       text,
  issued_by    uuid references core.identities(id),
  created_at   timestamptz not null default now()
);
comment on table credit.credit_notes is 'SP-04/06 (S15/S16) — reduces an invoice open_balance or the statement';

create table credit.custody_ledger (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references credit.suppliers(id) on delete restrict,
  order_id     uuid not null references orders.orders(id) on delete restrict,
  amount       numeric(12,2) not null check (amount > 0),
  custody_ref  uuid not null,
  status       text not null default 'held' check (status in ('held','remitted')),
  collected_at timestamptz not null default now(),
  remitted_at  timestamptz,
  remittance_ref uuid,
  unique (custody_ref)
);
create index on credit.custody_ledger (supplier_id, status);
comment on table credit.custody_ledger is
  'D-14 rule f — company cash a pickup supplier holds on OUR behalf. NOT debt. NEVER joined to credit.invoices/exposure.';
revoke update, delete on credit.custody_ledger from public;

create table credit.order_templates (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references credit.suppliers(id) on delete cascade,
  name         text not null,
  lines        jsonb not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table credit.order_templates is 'SP-09 (S16) — repeat-order template; prices resolve fresh at reorder';
create trigger set_updated_at before update on credit.order_templates
  for each row execute function moddatetime(updated_at);

create table credit.statements (
  id            uuid primary key default gen_random_uuid(),
  supplier_id   uuid not null references credit.suppliers(id) on delete restrict,
  period_start  date not null,
  period_end    date not null,
  opening_balance numeric(12,2) not null,
  invoices_total  numeric(12,2) not null,
  payments_total  numeric(12,2) not null,
  credit_notes_total numeric(12,2) not null,
  closing_balance numeric(12,2) not null,
  aging jsonb not null,
  pdf_media_id  uuid references core.media_objects(id),
  generated_at  timestamptz not null default now(),
  unique (supplier_id, period_start, period_end)
);
comment on table credit.statements is 'SP-06 (S16) — reconciled monthly ledger';

-- catalog.tier_prices (Task SP-DB-2) — D-14/wholesale, catalog-owned.
create table catalog.tier_prices (
  pack_size_id uuid not null references catalog.pack_sizes(id) on delete cascade,
  tier         text not null check (tier in ('bronze','silver','gold')),
  unit_price   numeric(12,2) not null check (unit_price >= 0),
  updated_at   timestamptz not null default now(),
  primary key (pack_size_id, tier)
);
comment on table catalog.tier_prices is
  'SP-02 resolves; AC-02 (S17+) is the sole writer of values. NEVER exposed to a customer session (NFR-SP-003).';

-- Down Migration

drop table if exists catalog.tier_prices;
drop table if exists credit.statements;
drop table if exists credit.order_templates;
drop table if exists credit.custody_ledger;
drop table if exists credit.credit_notes;
drop table if exists credit.payments_received;
drop table if exists credit.invoice_lines;
drop table if exists credit.invoices;
drop table if exists credit.credit_limits;
drop table if exists credit.suppliers;
drop schema if exists credit cascade;
