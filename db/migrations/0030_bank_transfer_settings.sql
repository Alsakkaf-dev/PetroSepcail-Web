-- Up Migration
-- FR-SF04-010/EP-SF-022: a bank-transfer order's placement response carries
-- `payTo:{iban, holder}` — the company's own receiving account, a
-- [BUSINESS-CONFIRM] value the owner must supply for real use. Placeholder
-- here so the bank-transfer path is genuinely testable end-to-end.
insert into core.settings (key, value) values
  ('company_iban', '"SA0000000000000000000000"'),
  ('company_iban_holder', '"Petro Special Lubricants Co."'),
  ('bank_transfer_window_hours', '48');

-- Down Migration

delete from core.settings where key in ('company_iban', 'company_iban_holder', 'bank_transfer_window_hours');
