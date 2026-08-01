-- Up Migration
-- Corrective migration (S14 continuation, append-only per this project's own
-- migration-history rule -- 0054 is never edited in place). catalog.v_pickup_points
-- (0054) is documented as EP-SP-012's public (no-auth) directory read
-- (30-supplier-portal/05-api-specification.md §2, FR-SP01-006), but its
-- underlying table credit.suppliers carries FORCE ROW LEVEL SECURITY with
-- only a supplier_self_read policy (0053) restricting every read to the
-- caller's OWN supplier_id -- so the view as shipped returns zero rows for a
-- public/guest caller (no supplier_id claim to match against) and would
-- wrongly limit even an authenticated supplier to their own single row,
-- instead of every active pickup point. Same fix shape 0054 already used to
-- read cross-supplier data safely (catalog.resolve_tier_price): a SECURITY
-- DEFINER function that reads only the same non-PII columns the view itself
-- already limited to (name + geo), preserving NFR-SP-003/D-14 rule f's
-- "no PII/debt/custody leak" guarantee structurally, while actually being
-- reachable by a public/guest caller.
create function catalog.list_pickup_points()
returns table(supplier_id uuid, business_name_ar text, business_name_en text, geo_lat numeric, geo_lng numeric)
language sql stable security definer
set search_path = pg_catalog, catalog, credit
as $$
  select id, business_name_ar, business_name_en, geo_lat, geo_lng
  from credit.suppliers where is_pickup_point and status = 'active';
$$;
comment on function catalog.list_pickup_points() is
  'EP-SP-012 FR-SP01-006 -- public directory read; SECURITY DEFINER bypasses credit.suppliers RLS on purpose, same columns v_pickup_points already limited to (name+geo only)';
grant execute on function catalog.list_pickup_points() to app_user, app_service_role;

-- Down Migration

revoke execute on function catalog.list_pickup_points() from app_user, app_service_role;
drop function if exists catalog.list_pickup_points();
