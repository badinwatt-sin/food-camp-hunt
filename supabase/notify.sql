-- =====================================================================
-- Notification bell. Idempotent: run once on an EXISTING project (schema.sql already contains it).
-- One row = one message in the bell.
--   audience 'all'   every player        'team' one team (team_id)
--            'user'  one player (participant_id)      'admin'  organisers only
-- Admin can switch the bell off for all players (game_settings.notify_enabled); each person can also mute it on their own device.
-- =====================================================================
create table if not exists public.notifications (
  id             bigserial primary key,
  created_at     timestamptz not null default now(),
  audience       text not null check (audience in ('all', 'team', 'user', 'admin')),
  team_id        uuid references public.teams(id) on delete cascade,
  participant_id uuid references public.participants(id) on delete cascade,
  kind           text not null default 'info',
  title          text not null check (length(title) between 1 and 160),
  body           text not null default '',
  link           text
);
create index if not exists notifications_created_idx on public.notifications (created_at desc);
create index if not exists notifications_team_idx on public.notifications (team_id, created_at desc);
alter table public.notifications enable row level security;
grant all on public.notifications to service_role;
grant usage, select on sequence public.notifications_id_seq to service_role;
alter table public.game_settings add column if not exists notify_enabled boolean not null default true;
