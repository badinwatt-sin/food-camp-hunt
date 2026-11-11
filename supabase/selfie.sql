-- =====================================================================
-- v2: each team has its OWN background colour (unique), and the mission can start for the judges only
--     (observers play a score-free test wall; nobody else is notified) before it starts for everyone.
-- Team Selfie Wall ("Agency in the Wonder Woods") — first mission after the teams are formed.
-- Run once on an EXISTING database (schema.sql already contains it; safe to re-run).
--   * Admin opens a time window (start/end) and picks the background colour + the required share (e.g. 60 %).
--   * Every competing member uploads ONE selfie; the server (pixel analysis + AI) accepts or rejects it.
--   * Observers (คณะทำงาน) may add their photo to the wall but never count towards completion.
--   * The first team whose members all have an accepted photo gets rewards[1], then [2], [3], [4] (admin-set, default 20/15/10/5).
--   * The reward is paid ONCE per team into the team wallet (ledger key 'selfie:<team>').
-- =====================================================================
alter table public.game_settings add column if not exists selfie_open boolean not null default false;
alter table public.game_settings add column if not exists selfie_start timestamptz;
alter table public.game_settings add column if not exists selfie_end timestamptz;
alter table public.game_settings add column if not exists selfie_color text not null default '#2f8f5b';
alter table public.game_settings add column if not exists selfie_percent int not null default 60;
alter table public.game_settings add column if not exists selfie_tolerance int not null default 32;
alter table public.game_settings add column if not exists selfie_rewards text not null default '20,15,10,5';
alter table public.game_settings add column if not exists selfie_announced_at timestamptz;
alter table public.game_settings add column if not exists selfie_audience text not null default 'all';   -- 'all' = everyone, 'judges' = observers only (score-free test)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'game_settings_selfie_audience_check' and conrelid = 'public.game_settings'::regclass) then
    alter table public.game_settings add constraint game_settings_selfie_audience_check check (selfie_audience in ('all', 'judges'));
  end if;
end $$;
-- every team gets its own colour (NULL = use the default colour in game_settings.selfie_color); never the same twice
alter table public.teams add column if not exists selfie_color text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'teams_selfie_color_check' and conrelid = 'public.teams'::regclass) then
    alter table public.teams add constraint teams_selfie_color_check check (selfie_color is null or selfie_color ~ '^#[0-9a-f]{6}$');
  end if;
end $$;
create unique index if not exists teams_selfie_color_unique on public.teams (selfie_color) where selfie_color is not null;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'game_settings_selfie_check' and conrelid = 'public.game_settings'::regclass) then
    alter table public.game_settings add constraint game_settings_selfie_check check (
      selfie_percent between 1 and 100 and selfie_tolerance between 5 and 100 and selfie_color ~ '^#[0-9a-fA-F]{6}$'
    );
  end if;
end $$;

alter table public.teams add column if not exists selfie_completed_at timestamptz;
alter table public.teams add column if not exists selfie_finish_rank int;
alter table public.teams add column if not exists selfie_reward_tokens int not null default 0;
create unique index if not exists teams_selfie_rank_unique on public.teams(selfie_finish_rank) where selfie_finish_rank is not null;

create table if not exists public.selfie_photos (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  is_test        boolean not null default false,       -- judges' score-free test wall
  unique (participant_id, is_test),
  image_url      text not null,
  color_pct      numeric(5,1) not null default 0,
  checks         jsonb not null default '{}'::jsonb,   -- what the pixel analysis / AI said (for admins)
  created_at     timestamptz not null default now()
);
-- upgrade from v1 (one photo per player) -> one real + one test photo per player
alter table public.selfie_photos add column if not exists is_test boolean not null default false;
alter table public.selfie_photos drop constraint if exists selfie_photos_participant_id_key;
create unique index if not exists selfie_photos_participant_test_idx on public.selfie_photos (participant_id, is_test);
create index if not exists selfie_photos_team_idx on public.selfie_photos(team_id);
alter table public.selfie_photos enable row level security;

-- Is the mission accepting photos right now? (switch on, and inside the window when one is set)
create or replace function public.selfie_window_open()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(selfie_open, false)
     and (selfie_start is null or selfie_start <= now())
     and (selfie_end is null or selfie_end >= now())
  from game_settings where id = 1;
$$;

-- Stores (or replaces) the player's accepted selfie, then pays the team if it just became complete.
create or replace function public.submit_selfie(p_participant uuid, p_url text, p_pct numeric, p_checks jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_old text; v_total int; v_have int;
  v_rank int; v_tokens int; v_rewards int[]; v_ranked int;
begin
  perform pg_advisory_xact_lock(71040002);                 -- one finishing order for every team
  if not selfie_window_open() then raise exception 'SELFIE_CLOSED'; end if;
  if (select selfie_audience from game_settings where id = 1) <> 'all' then raise exception 'SELFIE_CLOSED'; end if;   -- judges-only test phase
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_part.team_id for update;   -- serialise with other wallet writers
  select image_url into v_old from selfie_photos where participant_id = p_participant and not is_test;
  insert into selfie_photos (participant_id, team_id, image_url, color_pct, checks, is_test)
  values (p_participant, v_team.id, p_url, coalesce(p_pct, 0), coalesce(p_checks, '{}'::jsonb), false)
  on conflict (participant_id, is_test) do update
    set image_url = excluded.image_url, color_pct = excluded.color_pct, checks = excluded.checks, created_at = now();
  -- progress = competing members only (observers may hang their photo on the wall, but never count)
  select count(*) filter (where not p.is_observer),
         count(*) filter (where not p.is_observer and s.participant_id is not null)
    into v_total, v_have
    from participants p left join selfie_photos s on s.participant_id = p.id and not s.is_test
   where p.team_id = v_team.id;
  if v_total > 0 and v_have = v_total and v_team.selfie_completed_at is null then
    select coalesce(max(selfie_finish_rank), 0) + 1 into v_rank from teams;
    select array_agg(nullif(trim(x), '')::int order by ord) into v_rewards
      from unnest(string_to_array((select selfie_rewards from game_settings where id = 1), ',')) with ordinality as t(x, ord);
    v_tokens := greatest(coalesce(v_rewards[v_rank], 0), 0);
    if v_tokens > 0 then
      insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
      values (v_team.id, p_participant, 'adjustment', v_tokens,
        'Selfie wall complete, rank ' || v_rank, 'selfie:' || v_team.id::text, 'system');
    end if;
    update teams set selfie_completed_at = clock_timestamp(), selfie_finish_rank = v_rank, selfie_reward_tokens = v_tokens
      where id = v_team.id returning * into v_team;
    insert into audit_log (actor, action, details) values ('system', 'selfie.complete',
      jsonb_build_object('team_id', v_team.id, 'rank', v_rank, 'tokens', v_tokens));
  end if;
  return jsonb_build_object('oldUrl', v_old, 'total', v_total, 'count', v_have,
    'complete', v_team.selfie_completed_at is not null, 'rank', v_team.selfie_finish_rank,
    'tokens', v_team.selfie_reward_tokens, 'justCompleted', v_rank is not null, 'balance', team_balance(v_team.id));
end $$;

-- Judges' test wall: observers only, no tokens, no ranks, nothing paid. The wall is every observer together.
create or replace function public.submit_selfie_test(p_participant uuid, p_url text, p_pct numeric, p_checks jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_part participants%rowtype; v_old text; v_total int; v_have int;
begin
  perform pg_advisory_xact_lock(71040003);
  if not selfie_window_open() then raise exception 'SELFIE_CLOSED'; end if;
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  if not v_part.is_observer then raise exception 'FORBIDDEN'; end if;
  select image_url into v_old from selfie_photos where participant_id = p_participant and is_test;
  insert into selfie_photos (participant_id, team_id, image_url, color_pct, checks, is_test)
  values (p_participant, v_part.team_id, p_url, coalesce(p_pct, 0), coalesce(p_checks, '{}'::jsonb), true)
  on conflict (participant_id, is_test) do update
    set image_url = excluded.image_url, color_pct = excluded.color_pct, checks = excluded.checks, created_at = now();
  select (select count(*) from participants where is_observer), (select count(*) from selfie_photos where is_test) into v_total, v_have;
  return jsonb_build_object('oldUrl', v_old, 'total', v_total, 'count', v_have,
    'complete', v_total > 0 and v_have >= v_total, 'justCompleted', v_total > 0 and v_have >= v_total and v_old is null,
    'rank', null, 'tokens', 0);
end $$;

-- Rehearsal reset (admin danger zone): every photo, every rank and the paid rewards.
create or replace function public.reset_selfie_wall()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_urls text[];
begin
  perform pg_advisory_xact_lock(71040002);
  update game_settings set selfie_open = false where id = 1;
  select coalesce(array_agg(image_url), '{}') into v_urls from selfie_photos;
  delete from selfie_photos where id is not null;
  update teams set selfie_completed_at = null, selfie_finish_rank = null, selfie_reward_tokens = 0 where id is not null;
  delete from token_ledger where idempotency_key like 'selfie:%' and created_by = 'system';
  return jsonb_build_object('urls', to_jsonb(v_urls));
end $$;

revoke all on function public.selfie_window_open(), public.submit_selfie(uuid, text, numeric, jsonb), public.submit_selfie_test(uuid, text, numeric, jsonb), public.reset_selfie_wall() from public, anon, authenticated;
grant execute on function public.selfie_window_open(), public.submit_selfie(uuid, text, numeric, jsonb), public.submit_selfie_test(uuid, text, numeric, jsonb), public.reset_selfie_wall() to service_role;
grant all on public.selfie_photos to service_role;

insert into storage.buckets (id, name, public) values ('selfies', 'selfies', true) on conflict (id) do nothing;
