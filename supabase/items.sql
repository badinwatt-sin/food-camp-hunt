-- =====================================================================
-- Market item pictures (run once on an EXISTING database; schema.sql already has it).
-- Safe to run more than once.
-- =====================================================================
alter table public.market_items add column if not exists image_url text;
