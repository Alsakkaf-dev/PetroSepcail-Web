-- Up Migration
-- 10-customer-storefront/04-database-design.md §3.4/3.5/3.6 (SF-07/08/09,
-- S13). Adapted from the doc's `auth.jwt()` draft to this project's real
-- `app_auth.jwt()` (every other *_rls.sql migration already makes this
-- adaptation, per 0027/0041's own precedent).
create table orders.returns (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders.orders(id) on delete restrict,
  user_id     uuid not null references core.identities(id) on delete restrict,
  status      text not null default 'requested'
                check (status in ('requested','approved','rejected','picked_up','refunded')),
  reason_code text not null check (reason_code in ('wrong_item','damaged','changed_mind','other')),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table orders.returns is 'SF-07 — 7-day unopened window; admin-decided (AC-05, EV-PC-015)';
create trigger set_updated_at before update on orders.returns
  for each row execute function moddatetime(updated_at);

create table orders.return_lines (
  id            uuid primary key default gen_random_uuid(),
  return_id     uuid not null references orders.returns(id) on delete cascade,
  order_line_id uuid not null references orders.order_lines(id) on delete restrict,
  qty           int not null check (qty >= 1),
  unopened      boolean not null
);

create table orders.refunds (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references orders.orders(id) on delete restrict,
  return_id   uuid references orders.returns(id) on delete set null,
  amount      numeric(12,2) not null,
  method      text not null default 'bank_transfer' check (method in ('bank_transfer')),  -- no card path (D-11)
  iban        text,
  status      text not null default 'pending' check (status in ('pending','completed','failed')),
  created_at  timestamptz not null default now(),
  completed_at timestamptz
);

create table orders.reviews (
  id        uuid primary key default gen_random_uuid(),
  sku_id    uuid not null references catalog.skus(id) on delete cascade,
  user_id   uuid not null references core.identities(id) on delete cascade,
  order_id  uuid not null references orders.orders(id) on delete restrict,
  stars     int not null check (stars between 1 and 5),
  body      text check (body is null or char_length(body) <= 1000),
  status    text not null default 'pending' check (status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  edited_at  timestamptz,
  unique (sku_id, user_id)
);
create index on orders.reviews (sku_id) where status = 'approved';
comment on table orders.reviews is 'SF-08 — verified-purchase gated; moderated before public';

-- SF-08 FR-SF08-005/006 — approved-only aggregate for the product page;
-- same "expose an aggregate view, never raw moderation state" pattern as
-- catalog.v_sku_availability.
create view orders.v_sku_review_summary as
select sku_id, round(avg(stars)::numeric, 2) as avg_stars, count(*) as review_count
from orders.reviews where status = 'approved'
group by sku_id;

create table orders.wishlist_items (
  id        uuid primary key default gen_random_uuid(),
  user_id   uuid not null references core.identities(id) on delete cascade,
  sku_id    uuid not null references catalog.skus(id) on delete cascade,
  back_in_stock_optin boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, sku_id)
);
comment on table orders.wishlist_items is 'SF-09 — owner-scoped; restock alerts on EV-PC-005';

-- RLS ------------------------------------------------------------------------
alter table orders.returns enable row level security;
alter table orders.returns force row level security;
create policy return_own on orders.returns
  for all using (user_id = (app_auth.jwt()->>'sub')::uuid)
           with check (user_id = (app_auth.jwt()->>'sub')::uuid);
grant select, insert on orders.returns to app_user;

alter table orders.return_lines enable row level security;
alter table orders.return_lines force row level security;
create policy return_lines_own on orders.return_lines
  for select using (exists (select 1 from orders.returns r
                            where r.id = return_id and r.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select on orders.return_lines to app_user;

alter table orders.refunds enable row level security;
alter table orders.refunds force row level security;
create policy refund_read_own on orders.refunds
  for select using (exists (select 1 from orders.orders o
                            where o.id = order_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select on orders.refunds to app_user;

alter table orders.reviews enable row level security;
alter table orders.reviews force row level security;
create policy review_public_read on orders.reviews
  for select using (status = 'approved' or user_id = (app_auth.jwt()->>'sub')::uuid);
grant select on orders.reviews to app_user;
-- write path (insert/update/delete) is SECURITY DEFINER-only (submit_review/
-- edit_review/delete_review below) — same "no broad write policy" precedent
-- as orders.orders' own UPDATE (0027).

alter table orders.wishlist_items enable row level security;
alter table orders.wishlist_items force row level security;
create policy wishlist_own on orders.wishlist_items
  for all using (user_id = (app_auth.jwt()->>'sub')::uuid)
           with check (user_id = (app_auth.jwt()->>'sub')::uuid);
grant select, insert, delete, update on orders.wishlist_items to app_user;

grant all privileges on orders.returns, orders.return_lines, orders.refunds, orders.reviews, orders.wishlist_items
  to app_service_role;

-- Functions -------------------------------------------------------------------

-- SF-07 FR-SF07-001/002 — 7-day, unopened-attestation window. delivered_at
-- is derived from status_history's first 'delivered' row (0037's own
-- convention: order-level milestones aren't stored as a separate column).
create function orders.request_return(p_user uuid, p_order_id uuid, p_lines jsonb, p_reason_code text, p_note text default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, orders, core
as $$
declare
  v_delivered_at timestamptz; v_return_id uuid; v_line jsonb;
begin
  if not exists (select 1 from orders.orders where id = p_order_id and user_id = p_user) then
    raise exception 'NOT_FOUND' using errcode = 'P0010';
  end if;
  if p_reason_code = 'other' and (p_note is null or length(trim(p_note)) = 0) then
    raise exception 'VALIDATION_ERROR' using errcode = 'P0016';
  end if;

  select min(at) into v_delivered_at from orders.status_history where order_id = p_order_id and status = 'delivered';
  if v_delivered_at is null or v_delivered_at < now() - interval '7 days' then
    raise exception 'RETURN_WINDOW_CLOSED' using errcode = 'P0017';
  end if;

  insert into orders.returns (order_id, user_id, reason_code, note) values (p_order_id, p_user, p_reason_code, p_note)
    returning id into v_return_id;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    if (v_line->>'unopened')::boolean is distinct from true then
      raise exception 'VALIDATION_ERROR' using errcode = 'P0016'; -- FR-SF07-001: opened => not offered
    end if;
    if not exists (select 1 from orders.order_lines ol where ol.id = (v_line->>'orderLineId')::uuid and ol.order_id = p_order_id) then
      raise exception 'NOT_FOUND' using errcode = 'P0010';
    end if;
    insert into orders.return_lines (return_id, order_line_id, qty, unopened)
      values (v_return_id, (v_line->>'orderLineId')::uuid, (v_line->>'qty')::int, true);
  end loop;

  insert into core.outbox (name, version, actor_sub, payload)
    values ('orders.return.requested', 1, p_user, jsonb_build_object('return_id', v_return_id, 'order_id', p_order_id));
  -- AC-05's approval action (S18) is the real EV-PC-015 (orders.return.approved)
  -- producer per 06-integration-contracts — this is a distinct "requested"
  -- fact, not that event; no consumer registered for it yet, same
  -- "the event is the durable record" posture used throughout this build.

  return v_return_id;
end $$;
comment on function orders.request_return(uuid, uuid, jsonb, text, text) is 'SF-07 EP-SF-051 FR-SF07-001/002';
grant execute on function orders.request_return(uuid, uuid, jsonb, text, text) to app_service_role;

-- SF-08 FR-SF08-001/002/003 — verified-purchase gate: a delivered/confirmed
-- order containing this SKU, owned by this user.
create function orders.submit_review(p_user uuid, p_sku_id uuid, p_stars int, p_body text default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, orders, core
as $$
declare v_order_id uuid; v_review_id uuid;
begin
  select o.id into v_order_id
  from orders.orders o join orders.order_lines ol on ol.order_id = o.id
  where o.user_id = p_user and ol.pack_size_id in (select id from catalog.pack_sizes where sku_id = p_sku_id)
    and o.status in ('delivered', 'confirmed_received')
  limit 1;
  if v_order_id is null then raise exception 'NOT_VERIFIED_PURCHASE' using errcode = 'P0018'; end if;

  if exists (select 1 from orders.reviews where sku_id = p_sku_id and user_id = p_user) then
    raise exception 'CONFLICT' using errcode = 'P0003';
  end if;

  insert into orders.reviews (sku_id, user_id, order_id, stars, body) values (p_sku_id, p_user, v_order_id, p_stars, p_body)
    returning id into v_review_id;

  insert into core.outbox (name, version, actor_sub, payload)                     -- EV-PC-016
    values ('orders.review.submitted', 1, p_user, jsonb_build_object('review_id', v_review_id, 'sku_id', p_sku_id, 'stars', p_stars));

  return v_review_id;
end $$;
comment on function orders.submit_review(uuid, uuid, int, text) is 'SF-08 EP-SF-060 FR-SF08-001/002/003';
grant execute on function orders.submit_review(uuid, uuid, int, text) to app_service_role;

-- FR-SF08-004 — 48h edit/delete window (NOT [BUSINESS-CONFIRM] tagged in
-- 05-api-specification.md's own text, taken as the literal fixed value).
create function orders.edit_review(p_review_id uuid, p_user uuid, p_stars int default null, p_body text default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, orders
as $$
declare v_row orders.reviews;
begin
  select * into v_row from orders.reviews where id = p_review_id and user_id = p_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_row.created_at < now() - interval '48 hours' then
    raise exception 'REVIEW_EDIT_WINDOW_CLOSED' using errcode = 'P0019';
  end if;
  update orders.reviews set stars = coalesce(p_stars, stars), body = coalesce(p_body, body), edited_at = now(), status = 'pending'
    where id = p_review_id; -- an edit re-enters moderation (status back to pending) — same integrity reasoning as the original post
end $$;
comment on function orders.edit_review(uuid, uuid, int, text) is 'SF-08 EP-SF-062 FR-SF08-004';
grant execute on function orders.edit_review(uuid, uuid, int, text) to app_service_role;

create function orders.delete_review(p_review_id uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, orders
as $$
declare v_row orders.reviews;
begin
  select * into v_row from orders.reviews where id = p_review_id and user_id = p_user;
  if not found then raise exception 'NOT_FOUND' using errcode = 'P0010'; end if;
  if v_row.created_at < now() - interval '48 hours' then
    raise exception 'REVIEW_EDIT_WINDOW_CLOSED' using errcode = 'P0019';
  end if;
  delete from orders.reviews where id = p_review_id;
end $$;
comment on function orders.delete_review(uuid, uuid) is 'SF-08 EP-SF-063 FR-SF08-004';
grant execute on function orders.delete_review(uuid, uuid) to app_service_role;

-- Down Migration

revoke execute on function orders.delete_review(uuid, uuid) from app_service_role;
drop function if exists orders.delete_review(uuid, uuid);
revoke execute on function orders.edit_review(uuid, uuid, int, text) from app_service_role;
drop function if exists orders.edit_review(uuid, uuid, int, text);
revoke execute on function orders.submit_review(uuid, uuid, int, text) from app_service_role;
drop function if exists orders.submit_review(uuid, uuid, int, text);
revoke execute on function orders.request_return(uuid, uuid, jsonb, text, text) from app_service_role;
drop function if exists orders.request_return(uuid, uuid, jsonb, text, text);

revoke all privileges on orders.returns, orders.return_lines, orders.refunds, orders.reviews, orders.wishlist_items
  from app_service_role;

revoke select, insert, delete, update on orders.wishlist_items from app_user;
drop policy if exists wishlist_own on orders.wishlist_items;
alter table orders.wishlist_items disable row level security;

revoke select on orders.reviews from app_user;
drop policy if exists review_public_read on orders.reviews;
alter table orders.reviews disable row level security;

revoke select on orders.refunds from app_user;
drop policy if exists refund_read_own on orders.refunds;
alter table orders.refunds disable row level security;

revoke select on orders.return_lines from app_user;
drop policy if exists return_lines_own on orders.return_lines;
alter table orders.return_lines disable row level security;

revoke select, insert on orders.returns from app_user;
drop policy if exists return_own on orders.returns;
alter table orders.returns disable row level security;

drop table if exists orders.wishlist_items;
drop view if exists orders.v_sku_review_summary;
drop table if exists orders.reviews;
drop table if exists orders.refunds;
drop table if exists orders.return_lines;
drop table if exists orders.returns;
