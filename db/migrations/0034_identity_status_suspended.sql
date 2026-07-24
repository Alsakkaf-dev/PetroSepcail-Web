-- Up Migration
-- AC-06 (S09) FR-AC06-003: "Admin suspends/reactivates supplier/driver;
-- suspended actor blocked at sign-in." `identity_status` (0002_enum_types.sql)
-- has no value for this yet — `locked` is already semantically the
-- failed-login lockout reason (auth.ts's ACCOUNT_LOCKED path), so reusing it
-- for an admin-initiated suspension would conflate two different causes with
-- one status value. `identity_status` is not one of D-04's frozen canonical
-- enums (domain-glossary §9 lists only order_status/delivery_status/
-- invoice_status/payment_method/user_role), so adding a value here is a
-- normal implementation decision, not a D-04 amendment.
alter type identity_status add value if not exists 'suspended';

-- Down Migration
-- Postgres has no `DROP VALUE` for enum types — removing a value would
-- require rebuilding the type and every column/index that uses it. This is a
-- known, accepted, standard Postgres limitation (same reason ALTER TYPE ...
-- ADD VALUE migrations are typically treated as forward-only in practice);
-- documented here rather than silently left unstated.
-- (intentionally no-op)
