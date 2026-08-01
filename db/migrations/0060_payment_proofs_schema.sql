-- Up Migration
-- SP-05 (S15) Task SP-PAY-1: EP-SP-040 (`POST /supplier/invoices/{id}/pay-proof`)
-- needs somewhere to hold an UNVERIFIED bank-transfer claim.
-- credit.payments_received (0052) is deliberately verified-only by design
-- (its own comment: "a payment is recorded only after admin verification") —
-- reusing orders.payments (retail's pending/verified table) doesn't fit
-- either, since a wholesale order is created already 'confirmed' and never
-- passes through 'pending_payment' the way a retail bank-transfer order
-- does. A dedicated pending-claim table, same shape orders.payments already
-- established (status machine: pending -> verified/rejected).
create table credit.payment_proofs (
  id            uuid primary key default gen_random_uuid(),
  invoice_id    uuid not null references credit.invoices(id) on delete restrict,
  supplier_id   uuid not null references credit.suppliers(id) on delete restrict,
  amount        numeric(12,2) not null check (amount > 0),
  bank_ref      text,
  proof_media_id uuid references core.media_objects(id),
  status        text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  submitted_at  timestamptz not null default now(),
  verified_at   timestamptz,
  verified_by   uuid references core.identities(id)
);
create index on credit.payment_proofs (invoice_id, status);
comment on table credit.payment_proofs is
  'SP-05 EP-SP-040/EP-X-006 — unverified bank-transfer claim against an invoice; credit.apply_verified_payment (via the verify action) marks it verified and writes credit.payments_received';

alter table credit.payment_proofs enable row level security;
alter table credit.payment_proofs force row level security;
create policy payment_proof_supplier_read on credit.payment_proofs
  for select using (supplier_id = (app_auth.jwt()->>'supplier_id')::uuid);
grant select on credit.payment_proofs to app_user;
grant all privileges on credit.payment_proofs to app_service_role;

-- Down Migration

revoke all privileges on credit.payment_proofs from app_service_role;
revoke select on credit.payment_proofs from app_user;
drop policy if exists payment_proof_supplier_read on credit.payment_proofs;
drop table if exists credit.payment_proofs;
