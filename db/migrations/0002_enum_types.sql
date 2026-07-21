-- Up Migration
-- D-04 canonical enums, verbatim (00-master/PROGRESS.md Part B + 04-database-design §1).
-- Defined once in core, referenced by every subsystem schema platform-wide.

create type user_role as enum ('customer','supplier','driver','admin','super_admin');

create type order_status as enum ('pending_payment','paid','confirmed','preparing',
  'ready_for_pickup','assigned','picked_up','en_route','delivered','confirmed_received',
  'cancelled','refunded','returned');

create type delivery_status as enum ('assigned','accepted','at_pickup','picked_up',
  'en_route','arrived','delivered','confirmed','failed');

create type invoice_status as enum ('draft','issued','partially_paid','paid','overdue','written_off');

-- cod/bank_transfer/credit_terms active at launch; mada/stc_pay/apple_pay
-- defined-but-dormant (D-11).
create type payment_method as enum ('cod','bank_transfer','credit_terms','mada','stc_pay','apple_pay');

create type identity_status as enum ('pending_verification','active','locked','pending_deletion','deleted');

create type locale_code as enum ('ar','en');

-- sms dormant until Tier 3 (D-10).
create type notification_channel as enum ('in_app','email','web_push','sms');

-- Down Migration

drop type if exists notification_channel;
drop type if exists locale_code;
drop type if exists identity_status;
drop type if exists payment_method;
drop type if exists invoice_status;
drop type if exists delivery_status;
drop type if exists order_status;
drop type if exists user_role;
