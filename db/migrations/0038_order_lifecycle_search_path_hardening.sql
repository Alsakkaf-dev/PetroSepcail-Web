-- Up Migration
-- Corrective forward migration (per this repo's migration-history-is-append-
-- only rule — 0037 is never edited in place). 0037_order_status_history.sql
-- redefined the 5 order-lifecycle functions from 0035 via `create or replace
-- function` to add status_history inserts, but that redefinition silently
-- dropped the search_path hardening 0033_function_search_path_hardening.sql
-- had applied to functions that existed at that time — these 5 functions
-- didn't exist yet in 0033, so they were never covered, and 0037's
-- create-or-replace has no way to preserve an ALTER FUNCTION ... SET that
-- predates it. Confirmed via the live Supabase security advisor
-- (function_search_path_mutable, WARN) after applying 0037. Minimal schema
-- list per function verified against each one's real body
-- (pg_get_functiondef), matching 0033's own methodology: `pg_catalog` alone
-- where the body is fully schema-qualified with no bare type name; add
-- `public` where the body declares or casts to the unqualified `order_status`
-- enum (which, like 0033 already documented for orders.place_order, lives in
-- `public` in both the real Supabase project and a fresh local/CI Postgres).
alter function orders.cancel_order(uuid, uuid, text) set search_path = pg_catalog;
alter function orders.mark_ready_for_pickup(uuid) set search_path = pg_catalog;
alter function orders.confirm_receipt(uuid, uuid) set search_path = pg_catalog, public;
alter function orders.mirror_delivery_status(uuid, uuid, text) set search_path = pg_catalog, public;
alter function orders.verify_bank_transfer(uuid, uuid) set search_path = pg_catalog, public;

-- Down Migration

alter function orders.verify_bank_transfer(uuid, uuid) reset search_path;
alter function orders.mirror_delivery_status(uuid, uuid, text) reset search_path;
alter function orders.confirm_receipt(uuid, uuid) reset search_path;
alter function orders.mark_ready_for_pickup(uuid) reset search_path;
alter function orders.cancel_order(uuid, uuid, text) reset search_path;
