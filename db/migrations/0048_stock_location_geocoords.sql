-- Up Migration
-- DL-02 (S11, ADR-19 Google Maps Directions) needs a real origin coordinate
-- to route from — catalog.stock_locations (0022, S07) never got lat/lng at
-- all, so there was no way to route anything even once Maps is wired.
-- [BUSINESS-CONFIRM]: the seeded hub coordinate is a real Jeddah point
-- (industrial area, not the exact warehouse address, which isn't specified
-- anywhere in platform-docs) — same "documented placeholder pending the real
-- value" convention as D-06's other [BUSINESS-CONFIRM] defaults.
alter table catalog.stock_locations add column lat numeric(9,6);
alter table catalog.stock_locations add column lng numeric(9,6);

update catalog.stock_locations set lat = 21.485811, lng = 39.192504 where kind = 'hub';

-- Down Migration

alter table catalog.stock_locations drop column if exists lng;
alter table catalog.stock_locations drop column if exists lat;
