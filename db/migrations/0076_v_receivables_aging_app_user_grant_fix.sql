-- Up Migration
-- Real bug caught live by creditZatcaJourney.e2e.test.ts: 0072 granted
-- credit.v_receivables_aging to app_service_role only, but
-- routes/supplierStatement.ts's own dashboard and statement handlers read it
-- through withRlsTransaction (app_user) - the same asymmetry 0072's own
-- postmortem already found and fixed for credit.v_exposure ("grant select on
-- credit.v_exposure to app_user, app_service_role" - v_receivables_aging was
-- the one sibling view in that same fix that only got app_service_role).
-- Never caught before because a wholesale order had never been placed
-- against a real database until this session's own e2e coverage.
grant select on credit.v_receivables_aging to app_user;

-- Down Migration

revoke select on credit.v_receivables_aging from app_user;
