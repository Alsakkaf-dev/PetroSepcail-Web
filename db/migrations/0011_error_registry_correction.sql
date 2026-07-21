-- Up Migration
-- S02 (0009_auth_error_strings) seeded 'error.internal_error' before its
-- Read scope covered 05-api-specification.md §8 (the authoritative error
-- code registry, first read in S03). The real code is `INTERNAL`, not
-- `INTERNAL_ERROR`. Fix-forward rather than editing 0009 (S02 is a closed,
-- completed session) — delete the wrong key, insert the right one, and add
-- the three §8 codes no session had wired yet: RATE_LIMITED (this session,
-- PC-GW-2), PAYLOAD_TOO_LARGE / CONFLICT (no endpoint uses them yet, but
-- FR-PC04-004 wants the full registry present).

delete from core.i18n_strings where key = 'error.internal_error';

insert into core.i18n_strings (key, ar, en, context) values
  ('error.internal', 'حدث خطأ غير متوقع.', 'An unexpected error occurred.', 'error'),
  ('error.rate_limited', 'عدد كبير جداً من الطلبات. يرجى المحاولة لاحقاً.', 'Too many requests. Please slow down.', 'error'),
  ('error.payload_too_large', 'يتجاوز الملف الحد المسموح به للحجم.', 'The upload exceeds the size limit.', 'error'),
  ('error.conflict', 'يتعارض هذا مع الحالة الحالية.', 'This conflicts with the current state.', 'error');

-- Down Migration

delete from core.i18n_strings where key in ('error.internal', 'error.rate_limited', 'error.payload_too_large', 'error.conflict');

insert into core.i18n_strings (key, ar, en, context) values
  ('error.internal_error', 'حدث خطأ غير متوقع.', 'An unexpected error occurred.', 'error');
