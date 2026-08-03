-- Up Migration
-- 30-supplier-portal/04-database-design.md §5/§6 (Task SP-DB-3 continued) +
-- 08-implementation-guide.md §4/5 (SP-INV-1/2/3, SP-PAY-1/2, SP-CUSTODY-1).
-- fatoora_stamp (UBL/QR/crypto-stamp generation) is deliberately NOT a DB
-- function here -- ADR-11 frames it as a vendor-swappable adapter ("Tier-3
-- real-ZATCA swap is .env only"), the same shape mapsClient.ts/pusherClient.ts
-- already established for this codebase's other vendor adapters (TS module,
-- not SQL). credit.issue_invoice creates the row; services/api/src/zatca/
-- fatooraSim.ts computes the artifacts; credit.set_zatca_stamp (below)
-- writes them back over the same SECURITY DEFINER-only path every other
-- credit.* write uses.

-- SP-INV-1: EV-PC-012 consumer target. Idempotent on source_event_id AND on
-- order_id (defensive -- an event replay with no event_id must still not
-- double-invoice).
create function credit.issue_invoice(p_order_id uuid, p_event_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, credit, orders, core
as $$
declare
  v_order record;
  v_invoice_id uuid;
  v_terms_days int;
begin
  if p_event_id is not null then
    select id into v_invoice_id from credit.invoices where source_event_id = p_event_id;
    if found then return v_invoice_id; end if;
  end if;

  select id into v_invoice_id from credit.invoices where order_id = p_order_id;
  if found then return v_invoice_id; end if;

  select * into v_order from orders.orders where id = p_order_id and kind = 'wholesale';
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  select coalesce((core.get_setting('payment_terms_days'))::int, 30) into v_terms_days;

  insert into credit.invoices (supplier_id, order_id, source_event_id, status, subtotal, vat_amount, total, paid_amount, open_balance, issued_at, due_at)
    values (v_order.supplier_id, p_order_id, p_event_id, 'issued', v_order.subtotal, v_order.vat_amount, v_order.total, 0, v_order.total,
            now(), now() + (v_terms_days || ' days')::interval)
    returning id into v_invoice_id;

  insert into credit.invoice_lines (invoice_id, pack_size_id, name_ar, name_en, qty, unit_price, line_subtotal, vat_amount, line_total)
    select v_invoice_id, ol.pack_size_id, ol.name_ar, ol.name_en, ol.qty, ol.unit_price,
           ol.unit_price * ol.qty, ol.line_vat, ol.line_total
    from orders.order_lines ol where ol.order_id = p_order_id;

  insert into core.outbox (name, version, payload)                              -- EV-PC-030
    values ('credit.invoice.issued', 1,
            jsonb_build_object('invoice_id', v_invoice_id, 'supplier_id', v_order.supplier_id, 'total', v_order.total,
                               'due_at', now() + (v_terms_days || ' days')::interval));

  return v_invoice_id;
end $$;
comment on function credit.issue_invoice(uuid, uuid) is 'SP-04 FR-SP04-001 — idempotent invoice issuance from a confirmed wholesale order';
grant execute on function credit.issue_invoice(uuid, uuid) to app_service_role;

-- SP-INV-2: writes the artifacts services/api/src/zatca/fatooraSim.ts computes.
create function credit.set_zatca_stamp(p_invoice_id uuid, p_zatca_uuid uuid, p_qr_tlv text, p_crypto_stamp text)
returns void
language sql security definer
set search_path = pg_catalog, credit
as $$
  update credit.invoices set zatca_uuid = p_zatca_uuid, qr_tlv = p_qr_tlv, crypto_stamp = p_crypto_stamp, updated_at = now()
  where id = p_invoice_id;
$$;
comment on function credit.set_zatca_stamp(uuid, uuid, text, text) is 'SP-04 FR-SP04-002 — writes the FATOORA-sim adapter output onto an already-issued invoice';
grant execute on function credit.set_zatca_stamp(uuid, uuid, text, text) to app_service_role;

-- SP-INV-2: EV-PC-022 consumer target — stamps the delivery date once the
-- physical goods actually arrive (invoice may issue before delivery, on
-- confirm; ZATCA wants the real delivery/supply date, not the order date).
create function credit.stamp_delivery_date(p_order_id uuid, p_delivered_at timestamptz)
returns void
language sql security definer
set search_path = pg_catalog, credit
as $$
  update credit.invoices set delivery_date = p_delivered_at::date, updated_at = now() where order_id = p_order_id;
$$;
comment on function credit.stamp_delivery_date(uuid, timestamptz) is 'SP-04 — EV-PC-022 consumer target, ZATCA delivery-date stamp';
grant execute on function credit.stamp_delivery_date(uuid, timestamptz) to app_service_role;

-- SP-PAY-1: EP-SP-040 — records an UNVERIFIED claim only (no state change to
-- the invoice yet). PROOF_ALREADY_SUBMITTED guards a second claim while one
-- is still pending.
create function credit.submit_payment_proof(p_invoice_id uuid, p_supplier_id uuid, p_amount numeric, p_bank_ref text, p_proof_media_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
declare v_proof_id uuid;
begin
  perform 1 from credit.invoices where id = p_invoice_id and supplier_id = p_supplier_id;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  if exists (select 1 from credit.payment_proofs where invoice_id = p_invoice_id and status = 'pending') then
    raise exception 'PROOF_ALREADY_SUBMITTED' using errcode = 'P0022';
  end if;

  insert into credit.payment_proofs (invoice_id, supplier_id, amount, bank_ref, proof_media_id)
    values (p_invoice_id, p_supplier_id, p_amount, p_bank_ref, p_proof_media_id)
    returning id into v_proof_id;

  insert into core.outbox (name, version, payload)                             -- EV-PC-017
    values ('payments.bank_transfer.proof_submitted', 1,
            jsonb_build_object('order_id_or_invoice_id', p_invoice_id, 'claimed_amount', p_amount,
                               'reference', p_bank_ref, 'proof_media_id', p_proof_media_id));
  return v_proof_id;
end $$;
comment on function credit.submit_payment_proof(uuid, uuid, numeric, text, uuid) is 'SP-05 EP-SP-040 FR-SP05-001 — unverified claim only';
grant execute on function credit.submit_payment_proof(uuid, uuid, numeric, text, uuid) to app_service_role;

-- SP-PAY-1: EV-PC-018 consumer target -- pulled-forward AC-08 stand-in
-- caller (a real admin-verify console is S18, same "no console yet, the DB
-- function/route exists so it's real, not stubbed" precedent
-- orders.verify_bank_transfer/readyForPickupResponse already set). Partial
-- or full; INVOICE_NOT_OPEN guards a paid/written_off invoice.
create function credit.apply_verified_payment(p_proof_id uuid, p_verified_by uuid, p_matched_bank_ref text default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public, credit
as $$
declare
  v_proof record;
  v_invoice record;
  v_new_paid numeric; v_new_open numeric; v_new_status invoice_status; v_days_to_settle int;
  v_payment_id uuid;
begin
  select * into v_proof from credit.payment_proofs where id = p_proof_id and status = 'pending' for update;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;

  select * into v_invoice from credit.invoices where id = v_proof.invoice_id for update;
  if v_invoice.status in ('paid', 'written_off') then raise exception 'INVOICE_NOT_OPEN' using errcode = 'P0023'; end if;

  update credit.payment_proofs set status = 'verified', verified_at = now(), verified_by = p_verified_by where id = p_proof_id;

  insert into credit.payments_received (supplier_id, invoice_id, amount, method, bank_ref, proof_media_id, verified_by, verified_at)
    values (v_proof.supplier_id, v_proof.invoice_id, v_proof.amount, 'bank_transfer',
            coalesce(p_matched_bank_ref, v_proof.bank_ref), v_proof.proof_media_id, p_verified_by, now())
    returning id into v_payment_id;

  v_new_paid := v_invoice.paid_amount + v_proof.amount;
  v_new_open := v_invoice.total - v_new_paid;
  v_new_status := case when v_new_open <= 0 then 'paid' else 'partially_paid' end;

  update credit.invoices set paid_amount = v_new_paid, open_balance = greatest(v_new_open, 0), status = v_new_status, updated_at = now()
    where id = v_invoice.id;

  insert into core.outbox (name, version, payload)                             -- EV-PC-031
    values ('credit.payment.recorded', 1, jsonb_build_object('payment_id', v_payment_id, 'invoice_id', v_invoice.id, 'amount', v_proof.amount, 'paid_at', now()));

  if v_new_status = 'paid' then
    v_days_to_settle := extract(day from (now() - v_invoice.issued_at))::int;
    insert into core.outbox (name, version, payload)                           -- EV-PC-032
      values ('credit.invoice.settled', 1, jsonb_build_object('invoice_id', v_invoice.id, 'supplier_id', v_invoice.supplier_id, 'days_to_settle', v_days_to_settle));
  end if;

  return jsonb_build_object('paymentId', v_payment_id, 'invoiceStatus', v_new_status, 'openBalance', greatest(v_new_open, 0));
end $$;
comment on function credit.apply_verified_payment(uuid, uuid, text) is 'SP-05 FR-SP05-002/003 — EV-PC-018 consumer target, partial/full';
grant execute on function credit.apply_verified_payment(uuid, uuid, text) to app_service_role;

-- SP-CUSTODY-1: EV-PC-026 consumer target. Idempotent on custody_ref (a
-- replayed event must not double-create the held row) -- returns the
-- existing id on conflict rather than erroring, same "duplicate event =
-- no-op, not a failure" DoD requirement issue_invoice's own idempotency
-- already follows.
create function credit.record_custody(p_supplier_id uuid, p_order_id uuid, p_amount numeric, p_custody_ref uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
declare v_id uuid;
begin
  insert into credit.custody_ledger (supplier_id, order_id, amount, custody_ref)
    values (p_supplier_id, p_order_id, p_amount, p_custody_ref)
    on conflict (custody_ref) do nothing
    returning id into v_id;
  if v_id is null then
    select id into v_id from credit.custody_ledger where custody_ref = p_custody_ref;
  end if;
  return v_id;
end $$;
comment on function credit.record_custody(uuid, uuid, numeric, uuid) is 'SP-05 FR-SP05-006 — EV-PC-026 consumer target, D-14 rule f, idempotent on custody_ref';
grant execute on function credit.record_custody(uuid, uuid, numeric, uuid) to app_service_role;

-- SP-CUSTODY-1: EV-PC-027 consumer target. CUSTODY_MISMATCH guards a
-- remittance that doesn't match an existing held row.
create function credit.remit_custody(p_custody_ref uuid, p_remittance_ref uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
begin
  update credit.custody_ledger set status = 'remitted', remitted_at = now(), remittance_ref = p_remittance_ref
    where custody_ref = p_custody_ref and status = 'held';
  if not found then raise exception 'CUSTODY_MISMATCH' using errcode = 'P0024'; end if;
end $$;
comment on function credit.remit_custody(uuid, uuid) is 'SP-05 FR-SP05-007 — EV-PC-027 consumer target, D-14 rule f';
grant execute on function credit.remit_custody(uuid, uuid) to app_service_role;

-- SP-PAY-2: daily worker target. EV-PC-033 per invoice crossing due_at.
create function credit.mark_overdue()
returns int
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
declare v_count int := 0; v_row record;
begin
  for v_row in select id, supplier_id, open_balance from credit.invoices
               where status in ('issued', 'partially_paid') and due_at < now()
  loop
    update credit.invoices set status = 'overdue', updated_at = now() where id = v_row.id;
    insert into core.outbox (name, version, payload)                          -- EV-PC-033
      values ('credit.invoice.overdue', 1,
              jsonb_build_object('invoice_id', v_row.id, 'supplier_id', v_row.supplier_id,
                                 'days_overdue', 0, 'balance', v_row.open_balance));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
comment on function credit.mark_overdue() is 'SP-05 FR-SP05-004 — daily worker target, day-31 dunning per D-06 net-30';
grant execute on function credit.mark_overdue() to app_service_role;

-- SP-PAY-2: admin write-off — DB layer only, pulled forward the same way
-- other AC-owned actions have been (no AC console exists until S17/S18);
-- excluded from exposure automatically since credit.compute_exposure (0054)
-- only ever summed 'issued'/'partially_paid'/'overdue' invoices.
create function credit.write_off_invoice(p_invoice_id uuid, p_admin uuid, p_reason text)
returns void
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
begin
  update credit.invoices set status = 'written_off', updated_at = now()
    where id = p_invoice_id and status in ('issued', 'partially_paid', 'overdue');
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  insert into credit.credit_notes (supplier_id, invoice_id, kind, amount, reason, issued_by)
    select supplier_id, id, 'goodwill', open_balance, p_reason, p_admin from credit.invoices where id = p_invoice_id;
end $$;
comment on function credit.write_off_invoice(uuid, uuid, text) is 'SP-05 FR-SP05-005 — admin-only (AC-08, S18), no route wired yet, DB layer ready per this project''s own "database first" precedent';
grant execute on function credit.write_off_invoice(uuid, uuid, text) to app_service_role;

-- Down Migration

revoke execute on function credit.write_off_invoice(uuid, uuid, text) from app_service_role;
revoke execute on function credit.mark_overdue() from app_service_role;
revoke execute on function credit.remit_custody(uuid, uuid) from app_service_role;
revoke execute on function credit.record_custody(uuid, uuid, numeric, uuid) from app_service_role;
revoke execute on function credit.apply_verified_payment(uuid, uuid, text) from app_service_role;
revoke execute on function credit.submit_payment_proof(uuid, uuid, numeric, text, uuid) from app_service_role;
revoke execute on function credit.stamp_delivery_date(uuid, timestamptz) from app_service_role;
revoke execute on function credit.set_zatca_stamp(uuid, uuid, text, text) from app_service_role;
revoke execute on function credit.issue_invoice(uuid, uuid) from app_service_role;

drop function if exists credit.write_off_invoice(uuid, uuid, text);
drop function if exists credit.mark_overdue();
drop function if exists credit.remit_custody(uuid, uuid);
drop function if exists credit.record_custody(uuid, uuid, numeric, uuid);
drop function if exists credit.apply_verified_payment(uuid, uuid, text);
drop function if exists credit.submit_payment_proof(uuid, uuid, numeric, text, uuid);
drop function if exists credit.stamp_delivery_date(uuid, timestamptz);
drop function if exists credit.set_zatca_stamp(uuid, uuid, text, text);
drop function if exists credit.issue_invoice(uuid, uuid);
