-- Up Migration
-- 08-implementation-guide.md §6 (SP-STMT-1/SP-EARLY-1, S16).

-- SP-06 Task SP-STMT-1: EP-SP-050/051/052 read this (generated on demand if
-- missing, not only by the monthly worker -- a read-heavy statement page
-- shouldn't have to wait for the 1st-of-month sweep the first time a
-- supplier asks). Idempotent per (supplier_id, period_start, period_end),
-- matching credit.statements' own unique constraint (0052). SCOPED
-- SIMPLIFICATION (documented): opening_balance chains off the immediately
-- preceding period's own closing_balance when one exists, rather than
-- reconstructing full historical ledger state from scratch every call --
-- correct for consecutive periods (the only way the monthly worker ever
-- calls this), reduces to 0 for a supplier's first-ever statement.
create function credit.generate_statement(p_supplier_id uuid, p_period_start date, p_period_end date)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, credit
as $$
declare
  v_opening numeric := 0;
  v_invoices numeric; v_payments numeric; v_notes numeric; v_closing numeric;
  v_aging jsonb;
  v_statement_id uuid;
begin
  select closing_balance into v_opening from credit.statements
    where supplier_id = p_supplier_id and period_end = p_period_start - 1;
  v_opening := coalesce(v_opening, 0);

  select coalesce(sum(total), 0) into v_invoices from credit.invoices
    where supplier_id = p_supplier_id and issued_at::date between p_period_start and p_period_end;
  select coalesce(sum(amount), 0) into v_payments from credit.payments_received
    where supplier_id = p_supplier_id and verified_at::date between p_period_start and p_period_end;
  select coalesce(sum(amount), 0) into v_notes from credit.credit_notes
    where supplier_id = p_supplier_id and created_at::date between p_period_start and p_period_end;

  v_closing := v_opening + v_invoices - v_payments - v_notes;

  select jsonb_build_object('b0_30', coalesce(b_0_30, 0), 'b31_60', coalesce(b_31_60, 0),
                             'b61_90', coalesce(b_61_90, 0), 'b90plus', coalesce(b_90_plus, 0))
    into v_aging from credit.v_receivables_aging where supplier_id = p_supplier_id;
  v_aging := coalesce(v_aging, jsonb_build_object('b0_30', 0, 'b31_60', 0, 'b61_90', 0, 'b90plus', 0));

  insert into credit.statements (supplier_id, period_start, period_end, opening_balance, invoices_total, payments_total, credit_notes_total, closing_balance, aging)
    values (p_supplier_id, p_period_start, p_period_end, v_opening, v_invoices, v_payments, v_notes, v_closing, v_aging)
    on conflict (supplier_id, period_start, period_end) do update
      set opening_balance = excluded.opening_balance, invoices_total = excluded.invoices_total,
          payments_total = excluded.payments_total, credit_notes_total = excluded.credit_notes_total,
          closing_balance = excluded.closing_balance, aging = excluded.aging, generated_at = now()
    returning id into v_statement_id;

  return v_statement_id;
end $$;
comment on function credit.generate_statement(uuid, date, date) is 'SP-06 FR-SP06-001/003 — idempotent per period, opening chains off the prior period''s own closing';
grant execute on function credit.generate_statement(uuid, date, date) to app_service_role;

-- SP-07 Task SP-EARLY-1: EV-PC-043 (loyalty.reward.granted) consumer target.
-- Dormant for now -- LE-05/06 (S19/S20) are what will actually PRODUCE this
-- event; same "consumer exists, no producer yet" precedent
-- workers/dispatchWorker.ts already documented for EV-PC-015. Reduces the
-- supplier's open exposure via a credit note, never touches custody
-- (D-14 rule f -- credit_notes only ever attaches to credit.invoices/
-- suppliers, never custody_ledger).
create function credit.grant_loyalty_credit_note(p_supplier_id uuid, p_kind text, p_value numeric, p_source_ref text)
returns uuid
language sql security definer
set search_path = pg_catalog, credit
as $$
  insert into credit.credit_notes (supplier_id, kind, amount, source_ref, reason)
    values (p_supplier_id, p_kind, p_value, p_source_ref,
            case p_kind when 'early_pay' then 'Early-payment incentive (2/10 net 30)' else 'Volume rebate' end)
    returning id;
$$;
comment on function credit.grant_loyalty_credit_note(uuid, text, numeric, text) is 'SP-06/07 FR-SP06-005/FR-SP07 — EV-PC-043 consumer target, dormant until LE-05/06 (S19/20) exist';
grant execute on function credit.grant_loyalty_credit_note(uuid, text, numeric, text) to app_service_role;

-- Down Migration

revoke execute on function credit.grant_loyalty_credit_note(uuid, text, numeric, text) from app_service_role;
revoke execute on function credit.generate_statement(uuid, date, date) from app_service_role;
drop function if exists credit.grant_loyalty_credit_note(uuid, text, numeric, text);
drop function if exists credit.generate_statement(uuid, date, date);
