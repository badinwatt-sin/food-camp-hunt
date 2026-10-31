-- =====================================================================
-- Player profile pictures (run once on an EXISTING database; schema.sql already has it).
-- A player can upload a photo (stored in the public 'avatars' bucket) or pick a cute emoji.
-- Safe to run more than once.
-- =====================================================================
alter table public.participants add column if not exists avatar_url text;
alter table public.participants add column if not exists avatar_emoji text
  check (avatar_emoji is null or length(avatar_emoji) <= 16);

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;
