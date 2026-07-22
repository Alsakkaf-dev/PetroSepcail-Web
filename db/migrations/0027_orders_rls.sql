-- Up Migration
-- 10-customer-storefront/04-database-design.md §4 (orders block): customer
-- owns own rows. grants + RLS both required (app_user has no implicit
-- access) — same pattern as 0006/0020_*_rls.sql.
grant usage on schema orders to app_user, app_service_role;

-- ---------------------------------------------------------------------------
-- orders.carts
-- ---------------------------------------------------------------------------
alter table orders.carts enable row level security;
alter table orders.carts force row level security;
create policy cart_own on orders.carts                    -- 04-roles §3 "Cart: CRUD own"
  for all using (user_id = (app_auth.jwt()->>'sub')::uuid)
           with check (user_id = (app_auth.jwt()->>'sub')::uuid);
grant select, insert, update, delete on orders.carts to app_user;

-- ---------------------------------------------------------------------------
-- orders.cart_lines
-- ---------------------------------------------------------------------------
alter table orders.cart_lines enable row level security;
alter table orders.cart_lines force row level security;
create policy cart_lines_own on orders.cart_lines         -- 04-roles §3 "Cart: CRUD own" (via parent)
  for all using (exists (select 1 from orders.carts c
                         where c.id = cart_id and c.user_id = (app_auth.jwt()->>'sub')::uuid))
           with check (exists (select 1 from orders.carts c
                         where c.id = cart_id and c.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select, insert, update, delete on orders.cart_lines to app_user;

-- ---------------------------------------------------------------------------
-- orders.orders — customer CR own (04-roles §3 "Retail orders: CR own");
-- UPDATE (status transitions) is SECURITY DEFINER-only (orders.place_order,
-- future cancel/mirror functions), no broad UPDATE policy granted here.
-- ---------------------------------------------------------------------------
alter table orders.orders enable row level security;
alter table orders.orders force row level security;
create policy order_read_own on orders.orders
  for select using (user_id = (app_auth.jwt()->>'sub')::uuid);
create policy order_insert_own on orders.orders
  for insert with check (user_id = (app_auth.jwt()->>'sub')::uuid and kind = 'retail');
grant select, insert on orders.orders to app_user;

-- ---------------------------------------------------------------------------
-- orders.order_lines — read-only, owner-scoped via parent order
-- ---------------------------------------------------------------------------
alter table orders.order_lines enable row level security;
alter table orders.order_lines force row level security;
create policy order_lines_read_own on orders.order_lines
  for select using (exists (select 1 from orders.orders o
                            where o.id = order_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select on orders.order_lines to app_user;

-- ---------------------------------------------------------------------------
-- orders.payments — owner reads; owner may submit proof fields (insert);
-- verify (verified_by/at) is app_service_role only (AC-08, S18).
-- ---------------------------------------------------------------------------
alter table orders.payments enable row level security;
alter table orders.payments force row level security;
create policy payment_read_own on orders.payments
  for select using (exists (select 1 from orders.orders o
                            where o.id = order_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
create policy payment_proof_own on orders.payments
  for insert with check (exists (select 1 from orders.orders o
                            where o.id = order_id and o.user_id = (app_auth.jwt()->>'sub')::uuid));
grant select, insert on orders.payments to app_user;

grant all privileges on all tables in schema orders to app_service_role;

-- Down Migration

revoke all privileges on all tables in schema orders from app_service_role;

revoke select, insert on orders.payments from app_user;
drop policy if exists payment_proof_own on orders.payments;
drop policy if exists payment_read_own on orders.payments;
alter table orders.payments disable row level security;

revoke select on orders.order_lines from app_user;
drop policy if exists order_lines_read_own on orders.order_lines;
alter table orders.order_lines disable row level security;

revoke select, insert on orders.orders from app_user;
drop policy if exists order_insert_own on orders.orders;
drop policy if exists order_read_own on orders.orders;
alter table orders.orders disable row level security;

revoke select, insert, update, delete on orders.cart_lines from app_user;
drop policy if exists cart_lines_own on orders.cart_lines;
alter table orders.cart_lines disable row level security;

revoke select, insert, update, delete on orders.carts from app_user;
drop policy if exists cart_own on orders.carts;
alter table orders.carts disable row level security;

revoke usage on schema orders from app_user, app_service_role;
