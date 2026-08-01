-- Up Migration
-- 50-loyalty-engine/08-implementation-guide.md §3/§4 (LE-EXP-1/LE-CMP-1, S20).

-- LE-EXP-1: monthly FIFO-ish expiry sweep. SCOPED SIMPLIFICATION (documented):
-- true FIFO lot-tracking would need to record which specific earn entries a
-- later redemption consumed, which this simple signed-ledger model (like
-- credit.custody_ledger/audit.audit_log) doesn't do. This instead expires
-- min(current balance, points earned before the cutoff minus what's already
-- been expired for this user) -- never expires more than the user actually
-- has, and never re-expires the same points twice; per-user, run monthly.
create function loyalty.sweep_expiry()
returns int
language plpgsql security definer
set search_path = pg_catalog, loyalty, core
as $$
declare v_months int; v_row record; v_count int := 0; v_to_expire int;
begin
  select coalesce((core.get_setting('points_expiry_months'))::int, 12) into v_months;

  for v_row in
    select user_id,
           sum(points) filter (where kind = 'earn' and earned_at < now() - (v_months || ' months')::interval) as expirable_earned,
           sum(points) filter (where kind = 'expire') as already_expired,
           sum(points) as balance
    from loyalty.points_ledger
    group by user_id
  loop
    v_to_expire := least(
      coalesce(v_row.balance, 0),
      greatest(coalesce(v_row.expirable_earned, 0) + coalesce(v_row.already_expired, 0), 0)
    );
    if v_to_expire > 0 then
      perform loyalty.record_points(v_row.user_id, 'expire', -v_to_expire, null, null, now());
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;
comment on function loyalty.sweep_expiry() is 'LE-07/LE-EXP-1 FR-LE07-004 — monthly, SCOPED SIMPLIFICATION documented above (not true FIFO lot-tracking)';
grant execute on function loyalty.sweep_expiry() to app_service_role;

-- LE-EXP-1: daily 30-day expiry warning read (PC-06 notification hub is the
-- caller; this just returns the same "points due to expire" figure
-- 04-database-design §5's own sample query already defines).
create function loyalty.points_expiring_soon(p_within_days int default 30)
returns table(user_id uuid, expiring int)
language sql stable security definer
set search_path = pg_catalog, loyalty, core
as $$
  select pl.user_id, sum(pl.points)::int as expiring
  from loyalty.points_ledger pl
  where pl.kind = 'earn'
    and pl.earned_at < now() - (((core.get_setting('points_expiry_months'))::int * 30 - p_within_days) || ' days')::interval
  group by pl.user_id
  having sum(pl.points) > 0;
$$;
comment on function loyalty.points_expiring_soon(int) is 'LE-EXP-1 FR-LE07-005 — daily warning read for PC-06';
grant execute on function loyalty.points_expiring_soon(int) to app_service_role;

-- LE-CMP-1: campaign scheduler. Emits EV-PC-044 at start/end boundaries.
create function loyalty.sweep_campaigns()
returns int
language plpgsql security definer
set search_path = pg_catalog, loyalty, core
as $$
declare v_count int := 0; v_row record;
begin
  for v_row in select id, name_en from loyalty.campaigns where status = 'scheduled' and starts_at <= now()
  loop
    update loyalty.campaigns set status = 'active' where id = v_row.id;
    insert into core.outbox (name, version, payload) values ('loyalty.campaign.started', 1, jsonb_build_object('campaign_id', v_row.id));
    v_count := v_count + 1;
  end loop;
  for v_row in select id, name_en from loyalty.campaigns where status = 'active' and ends_at <= now()
  loop
    update loyalty.campaigns set status = 'ended' where id = v_row.id;
    insert into core.outbox (name, version, payload) values ('loyalty.campaign.ended', 1, jsonb_build_object('campaign_id', v_row.id));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;
comment on function loyalty.sweep_campaigns() is 'LE-03 FR-LE03-002 — EV-PC-044 at start/end boundaries';
grant execute on function loyalty.sweep_campaigns() to app_service_role;

-- LE-04: admin-authored rule creation (AC-04 forwards here) — validates the
-- tree is well-formed (whitelisted fields/operators, bounded) before saving,
-- so a bad rule never reaches loyalty.eval_rule at evaluation time.
create function loyalty.create_eligibility_rule(p_name text, p_tree jsonb, p_admin uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, loyalty
as $$
declare v_id uuid;
begin
  perform loyalty.eval_rule(p_tree, '{}'::jsonb, 0); -- validates shape/whitelist; raises RULE_INVALID if malformed
  insert into loyalty.eligibility_rules (name, tree, created_by) values (p_name, p_tree, p_admin) returning id into v_id;
  return v_id;
end $$;
comment on function loyalty.create_eligibility_rule(text, jsonb, uuid) is 'LE-04 FR-LE04 — validates at save (RULE_INVALID), not at every later evaluation';
grant execute on function loyalty.create_eligibility_rule(text, jsonb, uuid) to app_service_role;

-- LE-02: AC-04's own admin coupon-config surface (EP-AC-030) forwards here
-- for real now that LE-02 exists (it didn't yet when adminPromotions.ts was
-- first written, S17 — this closes that gap within the same session rather
-- than leaving a since-outdated stub).
create function loyalty.admin_create_coupon(
  p_code text, p_type text, p_value numeric, p_min_order numeric, p_first_order_only boolean,
  p_per_user_limit int, p_usage_cap int, p_valid_until timestamptz, p_admin uuid
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, loyalty, audit
as $$
declare v_id uuid;
begin
  insert into loyalty.coupons (code, type, value, min_order, first_order_only, per_user_limit, usage_cap, valid_until)
    values (p_code, p_type, p_value, coalesce(p_min_order, 0), coalesce(p_first_order_only, false), p_per_user_limit, p_usage_cap, p_valid_until)
    on conflict (code) do update
      set type = excluded.type, value = excluded.value, min_order = excluded.min_order,
          first_order_only = excluded.first_order_only, per_user_limit = excluded.per_user_limit,
          usage_cap = excluded.usage_cap, valid_until = excluded.valid_until
    returning id into v_id;
  insert into audit.audit_log (actor_id, actor_role, action, resource, resource_id, after)
    values (p_admin, 'admin', 'promotions.coupon.saved', 'loyalty.coupons', v_id::text, jsonb_build_object('code', p_code));
  return v_id;
end $$;
comment on function loyalty.admin_create_coupon(text, text, numeric, numeric, boolean, int, int, timestamptz, uuid) is 'LE-02 EP-AC-030/FR-LE02-001 — admin-authored coupon config';
grant execute on function loyalty.admin_create_coupon(text, text, numeric, numeric, boolean, int, int, timestamptz, uuid) to app_service_role;

-- Down Migration

revoke execute on function loyalty.admin_create_coupon(text, text, numeric, numeric, boolean, int, int, timestamptz, uuid) from app_service_role;
drop function if exists loyalty.admin_create_coupon(text, text, numeric, numeric, boolean, int, int, timestamptz, uuid);
revoke execute on function loyalty.create_eligibility_rule(text, jsonb, uuid) from app_service_role;
drop function if exists loyalty.create_eligibility_rule(text, jsonb, uuid);
revoke execute on function loyalty.sweep_campaigns() from app_service_role;
drop function if exists loyalty.sweep_campaigns();
revoke execute on function loyalty.points_expiring_soon(int) from app_service_role;
drop function if exists loyalty.points_expiring_soon(int);
revoke execute on function loyalty.sweep_expiry() from app_service_role;
drop function if exists loyalty.sweep_expiry();
