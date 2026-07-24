-- Up Migration
-- Supabase security advisor (WARN, function_search_path_mutable): these 10
-- functions had no fixed `search_path`, so a role able to create objects
-- earlier in the default search path (e.g. `public`) could shadow a builtin
-- or same-name object and get called instead of the real one (classic
-- search-path-hijack vector) - a real hardening gap, flagged but deferred to
-- S21 in S08's handover. Fixing now rather than carrying it further: each
-- function gets the minimal schema list it actually needs, verified against
-- its real body (pg_get_functiondef), not guessed:
--   - Everything below is fully schema-qualified inside its own body except
--     two cases: `audit.compute_row_hash` calls the unqualified pgcrypto
--     function `digest()` (lives in `extensions` on this project's real
--     Supabase instance, but in `public` on a fresh local/CI Postgres that
--     never had Supabase's own pre-provisioning - both are included so this
--     migration is portable across `test:migration`'s ephemeral Postgres and
--     the real deployment); `orders.place_order` declares a local
--     `order_status`-typed variable, and that enum type (D-04) lives in
--     `public` in both environments (migration 0001 created it with no
--     explicit schema).
--   - Argument types are schema-qualified in the ALTER FUNCTION signatures
--     below so this migration does not depend on the running session's own
--     search_path to resolve them.
alter function app_auth.jwt() set search_path = pg_catalog;
alter function core.admin_read_customer(uuid, text) set search_path = pg_catalog;
alter function core.get_setting(text) set search_path = pg_catalog;
alter function core.notify_outbox() set search_path = pg_catalog;
alter function catalog.resolve_retail_price(uuid) set search_path = pg_catalog;
alter function catalog.record_stock_movement(uuid, integer, uuid, uuid, text, uuid, uuid) set search_path = pg_catalog;
alter function catalog.reserve_stock(uuid, integer) set search_path = pg_catalog;
alter function catalog.release_stock(uuid, integer) set search_path = pg_catalog;
alter function audit.compute_row_hash() set search_path = pg_catalog, public, extensions;
alter function orders.place_order(uuid, uuid, public.payment_method, jsonb, text, text, text, uuid, numeric, numeric) set search_path = pg_catalog, public;

-- Down Migration

alter function orders.place_order(uuid, uuid, public.payment_method, jsonb, text, text, text, uuid, numeric, numeric) reset search_path;
alter function audit.compute_row_hash() reset search_path;
alter function catalog.release_stock(uuid, integer) reset search_path;
alter function catalog.reserve_stock(uuid, integer) reset search_path;
alter function catalog.record_stock_movement(uuid, integer, uuid, uuid, text, uuid, uuid) reset search_path;
alter function catalog.resolve_retail_price(uuid) reset search_path;
alter function core.notify_outbox() reset search_path;
alter function core.get_setting(text) reset search_path;
alter function core.admin_read_customer(uuid, text) reset search_path;
alter function app_auth.jwt() reset search_path;
