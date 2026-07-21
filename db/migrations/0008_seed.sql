-- Up Migration
-- 04-database-design §3.9/§7 seed + 05-master-database-architecture §5.
-- Identical seed in every tier (NFR-PC-001) — no environment branching.

-- ---------------------------------------------------------------------------
-- settings (every [BUSINESS-CONFIRM] number, D-06 + D-14g)
-- ---------------------------------------------------------------------------
insert into core.settings (key, value) values
  ('vat_rate', '0.15'),
  ('cod_ceiling', '1500'),
  ('delivery_radius_km', '60'),
  ('points_per_sar', '1'),
  ('redeem_rate', '0.05'),
  ('early_pay_days', '10'),
  ('early_pay_discount', '0.02'),
  ('default_credit_limit', '20000'),
  ('session_idle_min', '30'),
  ('admin_idle_min', '15'),
  ('ping_interval_s', '5'),
  ('free_delivery_threshold', '300'),
  ('return_window_days', '7'),
  ('audit_cadence_default', '"monthly"');

-- ---------------------------------------------------------------------------
-- feature_flags
-- ---------------------------------------------------------------------------
insert into core.feature_flags (key, value) values
  ('payments.cards.enabled', 'false'),
  ('sms.enabled', 'false'),
  ('zatca.mode', '"simulator"'),
  ('email.mode', '"catcher"'),
  ('tls.mode', '"selfsigned"');

-- ---------------------------------------------------------------------------
-- i18n_strings — PS.dict (assets/js/main.js) keys/EN values, paired with the
-- matching Arabic already inline in the static site's HTML for the same
-- data-i18n key (index.html et al.). Where the static site has no inline
-- span for a key (aria-only / JS-only strings: nav.aria, trust.*,
-- form.sending|success|error|required|badEmail, family.*, lang.*,
-- brand.*, common.viewAll|callUs|contactUs, crumbs.aria), the Arabic was
-- authored fresh in the site's existing tone — no source string to extract.
-- Brand/standard names (Special, Petrotoryon, Raval, ISO 9001, API, SASO)
-- stay in Latin script in Arabic too, matching site convention (see e.g.
-- index.html meta description: "علاماتنا: Special، Petrotoryon، Raval").
-- ---------------------------------------------------------------------------
insert into core.i18n_strings (key, ar, en, context) values
  ('brand.name', 'بتروسبيشل', 'PetroSpecial', 'brand'),
  ('brand.tagline', 'زيوت تشحيم سعودية الصنع بمعايير عالمية', 'Saudi-made lubricants engineered to world-class standards', 'brand'),

  ('nav.home', 'الرئيسية', 'Home', 'nav'),
  ('nav.products', 'المنتجات', 'Products', 'nav'),
  ('nav.about', 'عن الشركة', 'About Us', 'nav'),
  ('nav.quality', 'الجودة', 'Quality', 'nav'),
  ('nav.distribution', 'التوزيع', 'Distribution', 'nav'),
  ('nav.contact', 'تواصل معنا', 'Contact Us', 'nav'),
  ('nav.aria', 'التنقل الرئيسي', 'Main navigation', 'nav'),
  ('nav.menu', 'القائمة', 'Menu', 'nav'),

  ('common.readMore', 'اقرأ القصة الكاملة', 'Read the full story', 'common'),
  ('common.viewAll', 'عرض جميع المنتجات', 'View all products', 'common'),
  ('common.browse', 'تصفح المنتجات', 'Browse products', 'common'),
  ('common.callUs', 'اتصل بنا', 'Call us', 'common'),
  ('common.contactUs', 'تواصل معنا', 'Contact us', 'common'),
  ('common.details', 'عرض التفاصيل', 'View details', 'common'),
  ('common.backHome', 'العودة للرئيسية', 'Back to home', 'common'),
  ('common.skip', 'تجاوز إلى المحتوى الرئيسي', 'Skip to main content', 'common'),

  ('trust.iso', 'معتمد وفق ISO 9001', 'ISO 9001 Certified', 'trust'),
  ('trust.api', 'مطابق لمعايير API SL / SN', 'API SL / SN', 'trust'),
  ('trust.saso', 'معتمد من الهيئة السعودية للمواصفات (SASO)', 'SASO Standards', 'trust'),
  ('trust.aramco', 'مواصفات أرامكو السعودية', 'Saudi Aramco Specs', 'trust'),
  ('trust.saudi', 'صنع في السعودية', 'SAUDI MADE', 'trust'),
  ('trust.virgin', 'زيوت بكر 100%', '100% Virgin Base Oils', 'trust'),

  ('cta.title', 'جاهزون لتشغيل محركاتك؟', 'Ready to power your engines?', 'cta'),
  ('cta.text', 'تواصل مع فريق المبيعات لتوريد الزيوت لمحلات البناشر ومراكز الخدمة وأساطيل الشركات في المنطقة الغربية.', 'Talk to our sales team about supply for tire shops, service centers and corporate fleets across the Western Region.', 'cta'),
  ('cta.call', 'اتصل بالمبيعات', 'Call sales', 'cta'),
  ('cta.form', 'أرسل استفساراً', 'Send an enquiry', 'cta'),

  ('form.name', 'الاسم', 'Full name', 'form'),
  ('form.email', 'البريد الإلكتروني', 'Email address', 'form'),
  ('form.phone', 'رقم الهاتف', 'Phone number', 'form'),
  ('form.message', 'رسالتك', 'Your message', 'form'),
  ('form.send', 'إرسال الرسالة', 'Send message', 'form'),
  ('form.sending', 'جارٍ الإرسال…', 'Sending…', 'form'),
  ('form.success', 'شكراً لك! تم استلام رسالتك — سيتواصل معك فريقنا قريباً.', 'Thank you! Your message has been received — our team will get back to you shortly.', 'form'),
  ('form.error', 'حدث خطأ ولم يتم إرسال الرسالة. حاول مرة أخرى أو اتصل بنا مباشرة.', 'Something went wrong and the message was not sent. Please try again, or call us directly.', 'form'),
  ('form.required', 'هذا الحقل مطلوب', 'This field is required', 'form'),
  ('form.badEmail', 'يرجى إدخال بريد إلكتروني صحيح', 'Please enter a valid email address', 'form'),

  ('footer.about', 'مصنع سعودي لزيوت المحركات والتشحيم في جدة — زيوت أساس بكر 100% من المجموعتين الثانية والثالثة، بإضافات معتمدة عالمياً، مصممة لظروف المناخ الصحراوي.', 'A Saudi manufacturer of motor oils and lubricants in Jeddah — 100% virgin Group II & III base oils, globally certified additives, engineered for desert conditions.', 'footer'),
  ('footer.pages', 'الصفحات', 'Pages', 'footer'),
  ('footer.products', 'عائلات المنتجات', 'Product families', 'footer'),
  ('footer.contact', 'تواصل', 'Contact', 'footer'),
  ('footer.privacy', 'سياسة الخصوصية', 'Privacy Policy', 'footer'),
  ('footer.copyright', 'حقوق النشر', 'Copyright', 'footer'),
  ('crumbs.aria', 'مسار التنقل', 'Breadcrumb', 'crumbs'),
  ('footer.rights', 'جميع الحقوق محفوظة.', 'All rights reserved.', 'footer'),
  ('footer.cr', 'السجل التجاري', 'Commercial Registration', 'footer'),
  ('footer.sales', 'المبيعات', 'Sales', 'footer'),
  ('footer.support', 'خدمة العملاء', 'Customer Service', 'footer'),
  ('footer.address', 'طريق مكة القديم، كيلو 8، جدة 22347، المملكة العربية السعودية', 'Old Makkah Road, Km 8, Jeddah 22347, Saudi Arabia', 'footer'),

  ('family.special', 'Special', 'Special', 'family'),
  ('family.petro', 'Petrotoryon', 'Petrotoryon', 'family'),
  ('family.raval', 'Raval', 'Raval', 'family'),

  ('lang.switchTo', 'English', 'عربي', 'lang'),
  ('lang.label', 'تبديل اللغة', 'Switch language', 'lang');

-- ---------------------------------------------------------------------------
-- 5 seeded role identities (one per D-04 user_role value) — status='active'
-- so S02's login flow works against them without a verification step.
-- password_hash is a structural placeholder only: real argon2id hashing
-- lands with PC-AUTH-1 (S02), which must replace these with real hashes for
-- documented dev credentials. Fixed low-entropy UUIDs (…001..005) make these
-- rows easy to find/reference from later sessions (S02 login tests, S10/S14
-- backfill of driver_id/supplier_id once delivery.drivers/credit.suppliers
-- exist).
-- ---------------------------------------------------------------------------
insert into core.identities (id, full_name, email, phone, password_hash, status, locale) values
  ('00000000-0000-0000-0000-000000000001', 'Seed Customer', 'customer.seed@petrospecial.internal', '+966500000001', '$argon2id$SEED-PLACEHOLDER$replace-in-S02-PC-AUTH-1', 'active', 'ar'),
  ('00000000-0000-0000-0000-000000000002', 'Seed Supplier', 'supplier.seed@petrospecial.internal', '+966500000002', '$argon2id$SEED-PLACEHOLDER$replace-in-S02-PC-AUTH-1', 'active', 'ar'),
  ('00000000-0000-0000-0000-000000000003', 'Seed Driver', 'driver.seed@petrospecial.internal', '+966500000003', '$argon2id$SEED-PLACEHOLDER$replace-in-S02-PC-AUTH-1', 'active', 'ar'),
  ('00000000-0000-0000-0000-000000000004', 'Seed Admin', 'admin.seed@petrospecial.internal', '+966500000004', '$argon2id$SEED-PLACEHOLDER$replace-in-S02-PC-AUTH-1', 'active', 'ar'),
  ('00000000-0000-0000-0000-000000000005', 'Seed Super Admin', 'superadmin.seed@petrospecial.internal', '+966500000005', '$argon2id$SEED-PLACEHOLDER$replace-in-S02-PC-AUTH-1', 'active', 'ar');

-- supplier_id/driver_id left null: credit.suppliers (S14) and
-- delivery.drivers (S10/S11) don't exist yet — those sessions backfill.
insert into core.role_grants (identity_id, role) values
  ('00000000-0000-0000-0000-000000000001', 'customer'),
  ('00000000-0000-0000-0000-000000000002', 'supplier'),
  ('00000000-0000-0000-0000-000000000003', 'driver'),
  ('00000000-0000-0000-0000-000000000004', 'admin'),
  ('00000000-0000-0000-0000-000000000005', 'super_admin');

-- Down Migration

delete from core.role_grants where identity_id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);
delete from core.identities where id in (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000003',
  '00000000-0000-0000-0000-000000000004',
  '00000000-0000-0000-0000-000000000005'
);
delete from core.i18n_strings;
delete from core.feature_flags;
delete from core.settings;
