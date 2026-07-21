-- Up Migration
-- FR-PC04-004: "every [error] code has an AR and EN user-message key
-- (PC-07)". core.i18n_strings is the PC-07 string store (S01); this extends
-- it with the PC-01/02 auth error messages introduced by S02
-- (services/api/src/errors.ts ERROR_REGISTRY). Full locale-resolution
-- delivery (EP-PC-030, Accept-Language) is PC-07's own build in S05 — this
-- migration only makes sure the AR/EN pair for each code exists.

insert into core.i18n_strings (key, ar, en, context) values
  ('error.validation_error', 'تعذر التحقق من صحة البيانات المدخلة.', 'Validation failed.', 'error'),
  ('error.identity_exists', 'يوجد حساب بهذا البريد الإلكتروني أو رقم الهاتف بالفعل.', 'An account with this email or phone already exists.', 'error'),
  ('error.token_invalid', 'هذا الرابط أو الرمز غير صالح أو منتهي الصلاحية.', 'This link or code is invalid or has expired.', 'error'),
  ('error.invalid_credentials', 'البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'Incorrect email or password.', 'error'),
  ('error.email_unverified', 'يرجى تفعيل بريدك الإلكتروني قبل تسجيل الدخول.', 'Please verify your email before signing in.', 'error'),
  ('error.account_locked', 'تم إيقاف هذا الحساب مؤقتاً بسبب عدة محاولات فاشلة.', 'This account is temporarily locked due to too many failed attempts.', 'error'),
  ('error.mfa_required', 'مطلوب رمز تحقق.', 'A verification code is required.', 'error'),
  ('error.mfa_invalid', 'رمز التحقق غير صحيح.', 'The verification code is invalid.', 'error'),
  ('error.token_reuse_detected', 'انتهت صلاحية هذه الجلسة. يرجى تسجيل الدخول مرة أخرى.', 'This session is no longer valid. Please sign in again.', 'error'),
  ('error.forbidden', 'لا تملك صلاحية القيام بهذا الإجراء.', 'You do not have permission to do this.', 'error'),
  ('error.not_found', 'غير موجود.', 'Not found.', 'error'),
  ('error.internal_error', 'حدث خطأ غير متوقع.', 'An unexpected error occurred.', 'error');

-- Down Migration

delete from core.i18n_strings where context = 'error';
