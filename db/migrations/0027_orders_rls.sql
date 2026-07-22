-- Up Migration
-- 10-customer-storefront/04-database-design.md §4 (orders block): customer
-- owns own rows. grants + RLS both required (app_user has no implicit
-- access) — same pattern as 0006/0020_*_rls.sql.
grant usage on schema orders to app_user, service_role;

-- ---------------------------------------------------------------------------
-- orders.carts
-- ---------------------------------------------------------------------------
alter table orders.carts enable row level security;
alter table orders.carts force row level security;
create policy cart_own on orders.carts                    -- 04-roles §3 "Cart: CRUD own"
  for all using (user_id = (auth.jwt()->>'sub')::uuid)
           with check (user_id = (auth.jwt()->>'sub')::uuid);
grant select, insert, update, delete on orders.carts to app_user;

-- ---------------------------------------------------------------------------
-- orders.cart_lines
-- ---------------------------------------------------------------------------
alter table orders.cart_lines enable row level security;
alter table orders.cart_lines force row level security;
create policy cart_lines_own on orders.cart_lines         -- 04-roles §3 "Cart: CRUD own" (via parent)
  for all using (exists (select 1 from orders.carts c
                         where c.id = cart_id and c.user_id = (auth.jwt()->>'sub')::uuid))
           with check (exists (select 1 from orders.carts c
                         where c.id = cart_id and c.user_id = (auth.jwt()->>'sub')::uuid));
grant select, insert, update, delete on orders.cart_lines to app_user;

-- Down Migration

revoke select, insert, update, delete on orders.cart_lines from app_user;
drop policy if exists cart_lines_own on orders.cart_lines;
alter table orders.cart_lines disable row level security;

revoke select, insert, update, delete on orders.carts from app_user;
drop policy if exists cart_own on orders.carts;
alter table orders.carts disable row level security;

revoke usage on schema orders from app_user, service_role;
