-- =====================================================================
-- Event-day check-in. Idempotent. schema.sql already includes this for NEW projects;
-- run this file once on an EXISTING project.
--
-- On arrival players scan the staff's check-in QR code (opens /?checkin=CODE) and then press
-- "confirm" to confirm they are at the venue. Staff can also check people in by hand.
-- =====================================================================
alter table public.participants add column if not exists checked_in_at timestamptz;
alter table public.participants add column if not exists checked_in_by text;   -- 'self' or 'staff:<role>'

alter table public.game_settings add column if not exists checkin_open boolean not null default false;
alter table public.game_settings add column if not exists checkin_code text;     -- the secret inside the staff QR code
alter table public.game_settings add column if not exists checkin_announced_at timestamptz;  -- bump = show the pop-up again
