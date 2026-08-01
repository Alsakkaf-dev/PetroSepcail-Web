-- Up Migration
-- 50-loyalty-engine/04-database-design.md §4 (LE-DB-2, S19/S20).

-- LE-01: the SINGLE writer of the points ledger. Every earn/redeem/reverse/
-- expire/restore goes through here; idempotent on (kind, source_event_id).
create function loyalty.record_points(p_user uuid, p_kind text, p_points int, p_order uuid, p_event uuid, p_earned_at timestamptz)
returns bigint
language plpgsql security definer
set search_path = pg_catalog, loyalty, core
as $$
declare v_id bigint;
begin
  if p_event is not null then
    select id into v_id from loyalty.points_ledger where kind = p_kind and source_event_id = p_event;
    if found then return v_id; end if;
  end if;

  insert into loyalty.points_ledger (user_id, kind, points, order_id, source_event_id, earned_at)
    values (p_user, p_kind, p_points, p_order, p_event, coalesce(p_earned_at, now()))
    returning id into v_id;

  if p_kind = 'earn' then
    insert into core.outbox (name, version, payload)                                 -- EV-PC-040
      values ('loyalty.points.earned', 1,
              jsonb_build_object('user_id', p_user, 'points', p_points, 'order_id', p_order,
                                 'balance', (select coalesce(sum(points), 0) from loyalty.points_ledger where user_id = p_user)));
  elsif p_kind = 'redeem' then
    insert into core.outbox (name, version, payload)                                 -- EV-PC-041
      values ('loyalty.points.redeemed', 1,
              jsonb_build_object('user_id', p_user, 'points', -p_points,
                                 'discount_sar', round((-p_points) * (core.get_setting('redeem_rate'))::numeric / 100 * 100, 2),
                                 'order_id', p_order));
  elsif p_kind = 'expire' then
    insert into core.outbox (name, version, payload)                                 -- EV-PC-042
      values ('loyalty.points.expired', 1, jsonb_build_object('user_id', p_user, 'points', -p_points));
  end if;

  return v_id;
end $$;
comment on function loyalty.record_points(uuid, text, int, uuid, uuid, timestamptz) is 'LE-01 NFR-LE-001 — the single append-only writer';
grant execute on function loyalty.record_points(uuid, text, int, uuid, uuid, timestamptz) to app_service_role;

-- LE-01: EV-PC-011 consumer target. floor(subtotal * points_per_sar);
-- ex-VAT/ex-delivery (NFR-LE-004) -- orders.orders.subtotal IS that figure.
-- Custody never earns (D-14 rule f) -- this is only ever called for
-- kind='retail' orders (the worker filters), wholesale never reaches here.
create function loyalty.earn_on_paid(p_user uuid, p_order uuid, p_subtotal numeric, p_event uuid)
returns void
language sql security definer
set search_path = pg_catalog, loyalty, core
as $$
  select loyalty.record_points(p_user, 'earn', floor(p_subtotal * (core.get_setting('points_per_sar'))::numeric)::int, p_order, p_event, now());
$$;
comment on function loyalty.earn_on_paid(uuid, uuid, numeric, uuid) is 'LE-01 FR-LE01 — EV-PC-011 consumer target';
grant execute on function loyalty.earn_on_paid(uuid, uuid, numeric, uuid) to app_service_role;

-- LE-01: EV-PC-014/015 consumer target (cancel/return reversal). Reversal is
-- EXACT (not re-derived) -- reverses exactly the points a specific earn
-- entry granted for that order, never more.
create function loyalty.reverse_points(p_order uuid, p_event uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty
as $$
declare v_user uuid; v_earned int;
begin
  select user_id, points into v_user, v_earned from loyalty.points_ledger where order_id = p_order and kind = 'earn' limit 1;
  if not found or v_earned = 0 then return; end if;
  perform loyalty.record_points(v_user, 'reverse', -v_earned, p_order, p_event, now());
end $$;
comment on function loyalty.reverse_points(uuid, uuid) is 'LE-01 FR-LE01 — EV-PC-014/015 consumer target, exact reversal';
grant execute on function loyalty.reverse_points(uuid, uuid) to app_service_role;

-- LE-01: EV-PC-015 (partial return) consumer target. DEFERRED-DECISIONS.md
-- item 6: reverse proportionally -- refund_amount / original_subtotal_ex_vat
-- x points_originally_earned, floored. Distinct from reverse_points (full
-- cancellation, EV-PC-014) which reverses the entire original earn.
create function loyalty.reverse_points_partial(p_order uuid, p_refund_amount numeric, p_event uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty, orders
as $$
declare v_user uuid; v_earned int; v_subtotal numeric; v_reverse int;
begin
  select pl.user_id, pl.points into v_user, v_earned from loyalty.points_ledger pl where pl.order_id = p_order and pl.kind = 'earn' limit 1;
  if not found or v_earned = 0 then return; end if;
  select subtotal into v_subtotal from orders.orders where id = p_order;
  if v_subtotal is null or v_subtotal = 0 then return; end if;

  v_reverse := floor((p_refund_amount / v_subtotal) * v_earned)::int;
  if v_reverse <= 0 then return; end if;
  perform loyalty.record_points(v_user, 'reverse', -least(v_reverse, v_earned), p_order, p_event, now());
end $$;
comment on function loyalty.reverse_points_partial(uuid, numeric, uuid) is 'LE-01 DEFERRED-DECISIONS.md item 6 — proportional reversal for a partial return';
grant execute on function loyalty.reverse_points_partial(uuid, numeric, uuid) to app_service_role;

-- LE-07: EP-X-003. Cap at redeem_cap_pct of order total AND available
-- balance (FR-LE07-001). Never throws (NFR-LE-008) -- returns 0 allowed
-- rather than erroring when balance/cap is 0.
create function loyalty.quote_redemption(p_user uuid, p_points_requested int, p_order_total numeric)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, loyalty, core
as $$
  with bal as (select coalesce(sum(points), 0) as b from loyalty.points_ledger where user_id = p_user),
       cap as (select floor(p_order_total * (core.get_setting('redeem_cap_pct'))::numeric / (core.get_setting('redeem_rate'))::numeric * 100)::int as max_pts)
  select jsonb_build_object(
    'allowedPoints', greatest(least(p_points_requested, (select b from bal), (select max_pts from cap)), 0),
    'discountSar', round(greatest(least(p_points_requested, (select b from bal), (select max_pts from cap)), 0) * (core.get_setting('redeem_rate'))::numeric / 100, 2));
$$;
comment on function loyalty.quote_redemption(uuid, int, numeric) is 'LE-07 EP-X-003 FR-LE07-001 — never throws';
grant execute on function loyalty.quote_redemption(uuid, int, numeric) to app_service_role, app_user;

-- LE-07: EP-LE-020, atomic apply at placement. Idempotent on order id
-- (source_event_id = order id itself, since redemption has no separate
-- upstream event -- it's a direct customer action at checkout).
create function loyalty.apply_redemption(p_user uuid, p_order uuid, p_points int)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty
as $$
begin
  if p_points <= 0 then return; end if;
  perform loyalty.record_points(p_user, 'redeem', -p_points, p_order, p_order, now());
end $$;
comment on function loyalty.apply_redemption(uuid, uuid, int) is 'LE-07 EP-LE-020 FR-LE07-002 — idempotent on order id';
grant execute on function loyalty.apply_redemption(uuid, uuid, int) to app_service_role;

-- LE-07: restore on cancel/return -- a 'restore' entry, never un-does the
-- original 'redeem' row (append-only, NFR-LE-001).
create function loyalty.restore_redemption(p_order uuid, p_event uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty
as $$
declare v_user uuid; v_redeemed int;
begin
  select user_id, -points into v_user, v_redeemed from loyalty.points_ledger where order_id = p_order and kind = 'redeem' limit 1;
  if not found or v_redeemed = 0 then return; end if;
  perform loyalty.record_points(v_user, 'restore', v_redeemed, p_order, p_event, now());
end $$;
comment on function loyalty.restore_redemption(uuid, uuid) is 'LE-07 FR-LE07-006 — restore on cancel/return, append-only';
grant execute on function loyalty.restore_redemption(uuid, uuid) to app_service_role;

-- LE-04: bounded, whitelisted JSON-tree interpreter (NFR-LE-007). No
-- dynamic SQL, no eval. tree shape: {op:'and'|'or', conditions:[...]} where
-- each condition is either a nested tree or a leaf {field, operator, value}.
-- Whitelisted fields/operators only; depth capped at 5 to bound recursion.
create function loyalty.eval_rule(p_tree jsonb, p_ctx jsonb, p_depth int default 0)
returns boolean
language plpgsql stable
set search_path = pg_catalog
as $$
declare
  v_op text; v_cond jsonb; v_result boolean; v_field text; v_operator text; v_value jsonb; v_ctx_value jsonb;
begin
  if p_depth > 5 then raise exception 'RULE_INVALID' using errcode = '22023', detail = 'max depth exceeded'; end if;
  v_op := p_tree->>'op';

  if v_op in ('and', 'or') then
    v_result := (v_op = 'and');
    for v_cond in select * from jsonb_array_elements(p_tree->'conditions')
    loop
      if v_op = 'and' then
        v_result := v_result and loyalty.eval_rule(v_cond, p_ctx, p_depth + 1);
      else
        v_result := v_result or loyalty.eval_rule(v_cond, p_ctx, p_depth + 1);
      end if;
    end loop;
    return v_result;
  end if;

  -- leaf condition: whitelisted fields/operators only.
  v_field := p_tree->>'field';
  v_operator := p_tree->>'operator';
  v_value := p_tree->'value';
  if v_field not in ('is_first_order', 'order_total', 'user_tier', 'sku_family') then
    raise exception 'RULE_INVALID' using errcode = '22023', detail = 'unknown field';
  end if;
  if v_operator not in ('eq', 'gte', 'lte', 'gt', 'lt') then
    raise exception 'RULE_INVALID' using errcode = '22023', detail = 'unknown operator';
  end if;
  v_ctx_value := p_ctx->v_field;
  if v_ctx_value is null then return false; end if;

  return case v_operator
    when 'eq' then v_ctx_value = v_value
    when 'gte' then (v_ctx_value)::numeric >= (v_value)::numeric
    when 'lte' then (v_ctx_value)::numeric <= (v_value)::numeric
    when 'gt' then (v_ctx_value)::numeric > (v_value)::numeric
    when 'lt' then (v_ctx_value)::numeric < (v_value)::numeric
  end;
end $$;
comment on function loyalty.eval_rule(jsonb, jsonb, int) is 'LE-04 NFR-LE-007 — bounded whitelisted evaluator, no dynamic SQL';
grant execute on function loyalty.eval_rule(jsonb, jsonb, int) to app_service_role;

-- LE-02: EP-X-002. Never throws (NFR-LE-008) -- returns a rejection object,
-- not an exception, for every failure mode.
create function loyalty.validate_coupon(p_code text, p_user uuid, p_order_total numeric)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, loyalty, orders
as $$
declare
  v_coupon loyalty.coupons;
  v_user_uses int;
  v_is_first_order boolean;
  v_discount numeric;
begin
  select * into v_coupon from loyalty.coupons
    where code = p_code and active and (valid_until is null or valid_until > now()) and valid_from <= now();
  if not found then
    return jsonb_build_object('valid', false, 'discountSar', null, 'reasonAr', 'الكوبون غير صالح', 'reasonEn', 'This coupon is invalid or expired');
  end if;
  if v_coupon.usage_cap is not null and v_coupon.used_count >= v_coupon.usage_cap then
    return jsonb_build_object('valid', false, 'discountSar', null, 'reasonAr', 'تم استخدام هذا الكوبون بالكامل', 'reasonEn', 'This coupon has reached its usage limit');
  end if;
  if p_order_total < v_coupon.min_order then
    return jsonb_build_object('valid', false, 'discountSar', null, 'reasonAr', 'قيمة الطلب أقل من الحد الأدنى', 'reasonEn', 'Order total is below the minimum for this coupon');
  end if;
  if v_coupon.per_user_limit is not null then
    select count(*) into v_user_uses from loyalty.coupon_redemptions where coupon_id = v_coupon.id and user_id = p_user and status = 'applied';
    if v_user_uses >= v_coupon.per_user_limit then
      return jsonb_build_object('valid', false, 'discountSar', null, 'reasonAr', 'وصلت للحد الأقصى لاستخدام هذا الكوبون', 'reasonEn', 'You have already used this coupon the maximum number of times');
    end if;
  end if;
  if v_coupon.first_order_only then
    select not exists (select 1 from orders.orders where user_id = p_user and kind = 'retail' and status not in ('cancelled')) into v_is_first_order;
    if not v_is_first_order then
      return jsonb_build_object('valid', false, 'discountSar', null, 'reasonAr', 'هذا الكوبون لأول طلب فقط', 'reasonEn', 'This coupon is for first orders only');
    end if;
  end if;
  if v_coupon.eligibility_rule_id is not null then
    if not loyalty.eval_rule(
      (select tree from loyalty.eligibility_rules where id = v_coupon.eligibility_rule_id),
      jsonb_build_object('order_total', p_order_total),
      0
    ) then
      return jsonb_build_object('valid', false, 'discountSar', null, 'reasonAr', 'لا تنطبق شروط هذا الكوبون', 'reasonEn', 'You are not eligible for this coupon');
    end if;
  end if;

  v_discount := case v_coupon.type when 'percent' then round(p_order_total * v_coupon.value / 100, 2) else least(v_coupon.value, p_order_total) end;
  return jsonb_build_object('valid', true, 'discountSar', v_discount, 'reasonAr', null, 'reasonEn', null);
end $$;
comment on function loyalty.validate_coupon(text, uuid, numeric) is 'LE-02 EP-X-002 NFR-LE-008 — never throws';
grant execute on function loyalty.validate_coupon(text, uuid, numeric) to app_service_role, app_user;

-- LE-02: applies at placement -- records the redemption + increments
-- used_count atomically (closes the "validate but never actually redeem"
-- gap the pre-LE-02 stub necessarily had).
create function loyalty.apply_coupon_redemption(p_code text, p_user uuid, p_order uuid, p_discount_sar numeric)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty
as $$
declare v_coupon_id uuid;
begin
  select id into v_coupon_id from loyalty.coupons where code = p_code;
  if not found then return; end if;
  insert into loyalty.coupon_redemptions (coupon_id, user_id, order_id, discount_sar)
    values (v_coupon_id, p_user, p_order, p_discount_sar)
    on conflict (coupon_id, order_id) do nothing;
  update loyalty.coupons set used_count = used_count + 1 where id = v_coupon_id;
end $$;
comment on function loyalty.apply_coupon_redemption(text, uuid, uuid, numeric) is 'LE-02 FR-LE02-003 — records usage at placement, idempotent per (coupon, order)';
grant execute on function loyalty.apply_coupon_redemption(text, uuid, uuid, numeric) to app_service_role;

-- LE-02: release on cancel (EV-PC-014 consumer alongside reverse_points).
create function loyalty.release_coupon_redemption(p_order uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty
as $$
declare v_coupon_id uuid;
begin
  update loyalty.coupon_redemptions set status = 'released' where order_id = p_order and status = 'applied' returning coupon_id into v_coupon_id;
  if v_coupon_id is not null then
    update loyalty.coupons set used_count = greatest(used_count - 1, 0) where id = v_coupon_id;
  end if;
end $$;
comment on function loyalty.release_coupon_redemption(uuid) is 'LE-02 FR-LE02-003 — release on cancel';
grant execute on function loyalty.release_coupon_redemption(uuid) to app_service_role;

-- LE-05: EV-PC-032 consumer target. <=10 days -> 2% (D-06 2/10 net 30);
-- idempotent per invoice (source_ref = invoice_id).
create function loyalty.grant_early_pay_reward(p_supplier uuid, p_invoice uuid, p_invoice_total numeric, p_days_to_settle int)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty, core
as $$
declare v_early_pay_days int; v_discount_pct numeric; v_value numeric;
begin
  select (core.get_setting('early_pay_days'))::int, (core.get_setting('early_pay_discount'))::numeric
    into v_early_pay_days, v_discount_pct;
  if p_days_to_settle > v_early_pay_days then return; end if;

  v_value := round(p_invoice_total * v_discount_pct, 2);
  insert into loyalty.incentives (supplier_id, kind, basis, value_sar, source_ref)
    values (p_supplier, 'early_pay', jsonb_build_object('invoice_id', p_invoice, 'days_to_settle', p_days_to_settle), v_value, p_invoice::text)
    on conflict (supplier_id, kind, source_ref) do nothing;

  insert into core.outbox (name, version, payload)                                -- EV-PC-043
    values ('loyalty.reward.granted', 1, jsonb_build_object('supplier_id', p_supplier, 'kind', 'early_pay', 'value_sar', v_value, 'source_ref', p_invoice::text));
end $$;
comment on function loyalty.grant_early_pay_reward(uuid, uuid, numeric, int) is 'LE-05 FR-LE05 — EV-PC-032 consumer target, idempotent per invoice';
grant execute on function loyalty.grant_early_pay_reward(uuid, uuid, numeric, int) to app_service_role;

-- LE-06: quarterly close worker target. 1%/2% tiers (implementation guide's
-- own literal framing) -- threshold between tiers is [BUSINESS-CONFIRM],
-- see DEFERRED-DECISIONS.md item 12 appended alongside this migration.
create function loyalty.grant_volume_reward(p_supplier uuid, p_quarter text, p_purchases numeric)
returns void
language plpgsql security definer
set search_path = pg_catalog, loyalty, core
as $$
declare v_threshold numeric; v_pct numeric; v_value numeric;
begin
  select coalesce((core.get_setting('volume_rebate_threshold'))::numeric, 50000) into v_threshold;
  if p_purchases < v_threshold then return; end if;
  v_pct := case when p_purchases >= v_threshold * 2 then 0.02 else 0.01 end;
  v_value := round(p_purchases * v_pct, 2);

  insert into loyalty.incentives (supplier_id, kind, basis, value_sar, source_ref)
    values (p_supplier, 'volume', jsonb_build_object('quarter', p_quarter, 'purchases', p_purchases), v_value, p_quarter)
    on conflict (supplier_id, kind, source_ref) do nothing;

  insert into core.outbox (name, version, payload)                                -- EV-PC-043
    values ('loyalty.reward.granted', 1, jsonb_build_object('supplier_id', p_supplier, 'kind', 'volume', 'value_sar', v_value, 'source_ref', p_quarter));
end $$;
comment on function loyalty.grant_volume_reward(uuid, text, numeric) is 'LE-06 FR-LE06 — quarterly close worker target, idempotent per (supplier, quarter)';
grant execute on function loyalty.grant_volume_reward(uuid, text, numeric) to app_service_role;

insert into core.settings (key, value) values ('volume_rebate_threshold', '50000');

-- Down Migration

delete from core.settings where key = 'volume_rebate_threshold';

revoke execute on function loyalty.grant_volume_reward(uuid, text, numeric) from app_service_role;
drop function if exists loyalty.grant_volume_reward(uuid, text, numeric);
revoke execute on function loyalty.grant_early_pay_reward(uuid, uuid, numeric, int) from app_service_role;
drop function if exists loyalty.grant_early_pay_reward(uuid, uuid, numeric, int);
revoke execute on function loyalty.release_coupon_redemption(uuid) from app_service_role;
drop function if exists loyalty.release_coupon_redemption(uuid);
revoke execute on function loyalty.apply_coupon_redemption(text, uuid, uuid, numeric) from app_service_role;
drop function if exists loyalty.apply_coupon_redemption(text, uuid, uuid, numeric);
revoke execute on function loyalty.validate_coupon(text, uuid, numeric) from app_service_role, app_user;
drop function if exists loyalty.validate_coupon(text, uuid, numeric);
revoke execute on function loyalty.eval_rule(jsonb, jsonb, int) from app_service_role;
drop function if exists loyalty.eval_rule(jsonb, jsonb, int);
revoke execute on function loyalty.restore_redemption(uuid, uuid) from app_service_role;
drop function if exists loyalty.restore_redemption(uuid, uuid);
revoke execute on function loyalty.apply_redemption(uuid, uuid, int) from app_service_role;
drop function if exists loyalty.apply_redemption(uuid, uuid, int);
revoke execute on function loyalty.quote_redemption(uuid, int, numeric) from app_service_role, app_user;
drop function if exists loyalty.quote_redemption(uuid, int, numeric);
revoke execute on function loyalty.reverse_points_partial(uuid, numeric, uuid) from app_service_role;
drop function if exists loyalty.reverse_points_partial(uuid, numeric, uuid);
revoke execute on function loyalty.reverse_points(uuid, uuid) from app_service_role;
drop function if exists loyalty.reverse_points(uuid, uuid);
revoke execute on function loyalty.earn_on_paid(uuid, uuid, numeric, uuid) from app_service_role;
drop function if exists loyalty.earn_on_paid(uuid, uuid, numeric, uuid);
revoke execute on function loyalty.record_points(uuid, text, int, uuid, uuid, timestamptz) from app_service_role;
drop function if exists loyalty.record_points(uuid, text, int, uuid, uuid, timestamptz);
