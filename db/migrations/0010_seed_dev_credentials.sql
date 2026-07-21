-- Up Migration
-- S01 (db/migrations/0008) seeded the 5 role identities with a structural
-- placeholder password_hash tagged "replace-in-S02-PC-AUTH-1" — this is that
-- replacement, now that PC-AUTH-1's real argon2id hashing exists
-- (services/api/src/security/password.ts).
--
-- Password for all 5 seed identities: DevSeed#12345
-- (memoryCost=65536 KiB, timeCost=8, parallelism=1 — matches
-- password.ts's ARGON2ID_OPTIONS exactly, so verifyPassword() accepts it.)
--
-- Intentionally NOT a secret to protect: NFR-PC-001 mandates identical seed
-- data in every tier, and D-12's "friends in other countries open a browser
-- ... use the whole system exactly like any shared website" positions T2 as
-- a public hello-world demo — these are documented demo credentials for
-- trying each of the 5 roles, not leaked production secrets. Real customer/
-- supplier/admin accounts created after go-live are unaffected.
update core.identities set password_hash =
  '$argon2id$v=19$m=65536,t=8,p=1$ghQ03U8vqNpVYoNRDTVCBQ$Jwlu4mUwu0NpV9Tl3y3tw6JuEOO/PgAkK+/qAZG4JHE'
where id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);

-- Down Migration
-- Restores the S01 placeholder (down migrations only matter for local
-- rollback testing, never applied against a real deployed tier).
update core.identities set password_hash =
  '$argon2id$SEED-PLACEHOLDER$replace-in-S02-PC-AUTH-1'
where id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);
