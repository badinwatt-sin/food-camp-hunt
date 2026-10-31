-- =====================================================================
-- Player IDs + nick names (run once on an EXISTING database; schema.sql already has it).
-- A player now logs in with an ID that the organiser sets (stored only as a keyed hash in
-- participants.code_hash, as before). Adds an optional nick name shown to teammates in the game.
-- Safe to run more than once.
-- =====================================================================
alter table public.participants add column if not exists nick_name text
  check (nick_name is null or length(trim(nick_name)) between 1 and 60);
