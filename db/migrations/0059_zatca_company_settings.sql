-- Up Migration
-- SP-04 (S15): credit.issue_invoice needs the company's own VAT/CR number
-- (ZATCA UBL seller block) and the D-06 net-30 payment term, neither of
-- which existed as a core.settings row yet (only company_iban/iban_holder,
-- 0030, for the bank-transfer payTo block). Same placeholder-value
-- precedent 0030 already set — real values are a [BUSINESS-CONFIRM] the
-- owner must supply before a real (non-simulator) ZATCA submission.
insert into core.settings (key, value) values
  ('company_name_ar', '"شركة بترو سبيشل لزيوت التشحيم"'),
  ('company_name_en', '"Petro Special Lubricants Co."'),
  ('company_vat_number', '"300000000000003"'),
  ('company_cr_number', '"4030399323"'),
  ('payment_terms_days', '30');

-- Down Migration

delete from core.settings where key in
  ('company_name_ar', 'company_name_en', 'company_vat_number', 'company_cr_number', 'payment_terms_days');
