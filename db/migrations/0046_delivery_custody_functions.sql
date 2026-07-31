-- Up Migration
-- DL-07 (S11) shift-close needs the custody functions 04-database-design.md
-- §5 specifies verbatim; not needed until now (S10 only built dispatch/state
-- machine). search_path set inline per 0033/0038's own lesson.
create function delivery.record_cash_custody(p_driver uuid, p_order uuid, p_amount numeric)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, delivery, core
as $$
declare c uuid;
begin
  insert into delivery.driver_cash_custody (driver_id, order_id, amount) values (p_driver, p_order, p_amount)
    returning id into c;
  insert into core.outbox (name, version, payload)                                  -- EV-PC-026
    values ('custody.cash.collected', 1,
            jsonb_build_object('custody_ref', c, 'amount', p_amount, 'order_id', p_order,
                               'holder_kind', 'driver', 'holder_id', p_driver));
  -- deliberately never touches credit.* — custody and B2B debt are separate ledgers (D-14 rule f).
  return c;
end $$;
comment on function delivery.record_cash_custody(uuid, uuid, numeric) is
  'D-14 rule f — driver-held Custody Funds; called on POD of a home COD (DL-05, S12)';

create function delivery.remit_cash_custody(p_custody_ref uuid, p_verified_by uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, delivery, core
as $$
declare v_row delivery.driver_cash_custody%rowtype;
begin
  update delivery.driver_cash_custody set status = 'remitted', remitted_at = now(), remittance_ref = p_custody_ref
    where id = p_custody_ref and status = 'held'
    returning * into v_row;
  if not found then return; end if;  -- idempotent: already remitted / unknown ref is a no-op, not an error
  insert into core.outbox (name, version, payload)                                  -- EV-PC-027
    values ('custody.cash.remitted', 1,
            jsonb_build_object('custody_ref', p_custody_ref, 'amount', v_row.amount,
                               'holder_kind', 'driver', 'holder_id', v_row.driver_id,
                               'remitted_at', v_row.remitted_at, 'verified_by', p_verified_by));
end $$;
comment on function delivery.remit_cash_custody(uuid, uuid) is
  'D-14 rule f — the ONLY writer of custody status (held->remitted); FR-DL07-006';

create function delivery.audit_interval_days(p_kind text, p_entity uuid) returns int
language sql stable
set search_path = pg_catalog, delivery, core
as $$
  select coalesce(
    (select interval_days from delivery.audit_schedules where entity_kind = p_kind and entity_id = p_entity),
    case core.get_setting('audit_cadence_default')::text when '"monthly"' then 30
         when '"weekly"' then 7 else 30 end)
$$;
comment on function delivery.audit_interval_days(text, uuid) is 'D-14 rule g — per-entity override or the settings default';

grant execute on function delivery.record_cash_custody(uuid, uuid, numeric) to app_service_role;
grant execute on function delivery.remit_cash_custody(uuid, uuid) to app_service_role;
grant execute on function delivery.audit_interval_days(text, uuid) to app_user, app_service_role;

-- Down Migration

revoke execute on function delivery.audit_interval_days(text, uuid) from app_user, app_service_role;
revoke execute on function delivery.remit_cash_custody(uuid, uuid) from app_service_role;
revoke execute on function delivery.record_cash_custody(uuid, uuid, numeric) from app_service_role;
drop function if exists delivery.audit_interval_days(text, uuid);
drop function if exists delivery.remit_cash_custody(uuid, uuid);
drop function if exists delivery.record_cash_custody(uuid, uuid, numeric);
