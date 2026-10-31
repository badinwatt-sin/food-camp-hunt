-- =====================================================================
-- Co-op activities (run AFTER schema.sql / hunt.sql / squads.sql). Idempotent.
-- schema.sql already includes this for NEW projects.
--
--  A) Co-op hunt spots: a spot can require N squad members to scan it within a
--     time window before the squad gets the tokens (min_players, window_sec).
--  B) Team puzzles ("ภารกิจทีม"): a question whose clues are split across the
--     members of a squad. Anyone may submit the squad's answer (limited tries).
--     Puzzle tokens go to the shared team wallet (ledger kind 'puzzle').
--     Puzzles have their OWN switch: game_settings.puzzle_open (hunt_open only controls the hunt).
-- Group = the player's squad; people without a squad = the whole team.
-- =====================================================================

-- ledger: allow kind 'puzzle'
alter table public.token_ledger drop constraint if exists token_ledger_kind_check;
alter table public.token_ledger drop constraint if exists token_ledger_check;
alter table public.token_ledger add constraint token_ledger_kind_check
  check (kind in ('quiz','redemption','adjustment','hunt','puzzle'));
alter table public.token_ledger add constraint token_ledger_check check (
  (kind = 'quiz'       and amount >= 0 and participant_id is not null) or
  (kind = 'hunt'       and amount >= 0 and participant_id is not null) or
  (kind = 'puzzle'     and amount >= 0 and participant_id is not null) or
  (kind = 'redemption' and amount <  0) or
  (kind = 'adjustment' and amount <> 0 and reason is not null)
);

-- A) co-op spots -------------------------------------------------------
alter table public.hunt_spots add column if not exists min_players int not null default 1
  check (min_players between 1 and 10);
alter table public.hunt_spots add column if not exists window_sec int not null default 180
  check (window_sec between 30 and 1800);

create table if not exists public.hunt_scans (
  id             uuid primary key default gen_random_uuid(),
  spot_id        uuid not null references public.hunt_spots(id) on delete cascade,
  team_id        uuid not null references public.teams(id) on delete cascade,
  squad_id       uuid references public.squads(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  scanned_at     timestamptz not null default now(),
  unique (spot_id, participant_id)
);

create or replace function public.claim_spot(p_participant uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_spot hunt_spots%rowtype; v_open boolean; v_team teams%rowtype;
  v_ex hunt_claims%rowtype; v_id uuid; v_squad uuid; v_size int; v_need int; v_have int;
begin
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_part.team_id for update;   -- serialises teammates
  select s.id into v_squad from participants p join squads s on s.id = p.squad_id and s.team_id = p.team_id
   where p.id = p_participant;

  select * into v_spot from hunt_spots where secret = upper(trim(coalesce(p_secret,''))) and active;
  if not found then raise exception 'SPOT_NOT_FOUND'; end if;

  select * into v_ex from hunt_claims
   where spot_id = v_spot.id and team_id = v_part.team_id and squad_id is not distinct from v_squad;
  if found then
    return jsonb_build_object('already', true, 'pending', false, 'title', v_spot.title, 'tokens', v_ex.tokens,
      'balance', team_balance(v_part.team_id));
  end if;

  select hunt_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'HUNT_CLOSED'; end if;

  if v_spot.min_players > 1 then
    -- Co-op spot: needs several group members to scan within the time window.
    select count(*)::int into v_size from participants
     where team_id = v_part.team_id and squad_id is not distinct from v_squad;
    v_need := least(v_spot.min_players, v_size);   -- a small squad is never asked for more people than it has
    insert into hunt_scans (spot_id, team_id, squad_id, participant_id)
    values (v_spot.id, v_part.team_id, v_squad, p_participant)
    on conflict (spot_id, participant_id)
    do update set scanned_at = now(), team_id = excluded.team_id, squad_id = excluded.squad_id;
    select count(*)::int into v_have from hunt_scans
     where spot_id = v_spot.id and team_id = v_part.team_id and squad_id is not distinct from v_squad
       and scanned_at > now() - make_interval(secs => v_spot.window_sec);
    if v_have < v_need then
      return jsonb_build_object('already', false, 'pending', true, 'title', v_spot.title, 'tokens', 0,
        'have', v_have, 'need', v_need, 'window_sec', v_spot.window_sec, 'balance', team_balance(v_part.team_id));
    end if;
  end if;

  insert into hunt_claims (team_id, squad_id, spot_id, participant_id, tokens)
  values (v_part.team_id, v_squad, v_spot.id, p_participant, v_spot.tokens) returning id into v_id;

  insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
  values (v_part.team_id, p_participant, 'hunt', v_spot.tokens, 'Hunt: ' || v_spot.title,
          'hunt:' || v_part.team_id || ':' || v_spot.id || ':' || coalesce(v_squad::text, '-'), 'system');
  delete from hunt_scans where spot_id = v_spot.id and team_id = v_part.team_id and squad_id is not distinct from v_squad;

  return jsonb_build_object('already', false, 'pending', false, 'title', v_spot.title, 'tokens', v_spot.tokens,
    'balance', team_balance(v_part.team_id));
end $$;

-- B) team puzzles ------------------------------------------------------
-- separate open/close switch for puzzles (default closed; independent of hunt_open)
alter table public.game_settings add column if not exists puzzle_open boolean not null default false;

create table if not exists public.team_puzzles (
  id            uuid primary key default gen_random_uuid(),
  position      int  not null default 1,
  prompt        text not null check (length(trim(prompt)) > 0),
  clues         text[] not null check (array_length(clues, 1) between 2 and 8),
  options       text[] not null check (array_length(options, 1) = 4),
  correct_index int  not null check (correct_index between 0 and 3),
  tokens        int  not null default 20 check (tokens >= 0),
  max_attempts  int  not null default 2 check (max_attempts between 1 and 4),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.puzzle_attempts (
  id             uuid primary key default gen_random_uuid(),
  puzzle_id      uuid not null references public.team_puzzles(id) on delete restrict,
  team_id        uuid not null references public.teams(id) on delete restrict,
  squad_id       uuid references public.squads(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  selected_index int  not null check (selected_index between 0 and 3),
  is_correct     boolean not null,
  created_at     timestamptz not null default now()
);
create index if not exists puzzle_attempts_grp on public.puzzle_attempts(puzzle_id, team_id, squad_id);

create table if not exists public.puzzle_solves (
  id             uuid primary key default gen_random_uuid(),
  puzzle_id      uuid not null references public.team_puzzles(id) on delete restrict,
  team_id        uuid not null references public.teams(id) on delete restrict,
  squad_id       uuid references public.squads(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  tokens         int  not null,
  solved_at      timestamptz not null default now()
);
create unique index if not exists puzzle_solves_squad on public.puzzle_solves(puzzle_id, squad_id) where squad_id is not null;
create unique index if not exists puzzle_solves_team  on public.puzzle_solves(puzzle_id, team_id)  where squad_id is null;

create or replace function public.submit_puzzle(p_participant uuid, p_puzzle uuid, p_selected int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_pz team_puzzles%rowtype; v_open boolean;
  v_squad uuid; v_sv puzzle_solves%rowtype; v_used int; v_ok boolean;
begin
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_selected is null or p_selected < 0 or p_selected > 3 then raise exception 'BAD_INPUT'; end if;
  select * into v_team from teams where id = v_part.team_id for update;   -- serialises the whole team
  select s.id into v_squad from participants p join squads s on s.id = p.squad_id and s.team_id = p.team_id
   where p.id = p_participant;
  select * into v_pz from team_puzzles where id = p_puzzle and active;
  if not found then raise exception 'BAD_INPUT'; end if;

  select * into v_sv from puzzle_solves
   where puzzle_id = p_puzzle and team_id = v_part.team_id and squad_id is not distinct from v_squad;
  if found then
    return jsonb_build_object('solved', true, 'already', true, 'is_correct', true, 'tokens', v_sv.tokens,
      'balance', team_balance(v_part.team_id));
  end if;

  select puzzle_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'PUZZLE_CLOSED'; end if;

  select count(*)::int into v_used from puzzle_attempts
   where puzzle_id = p_puzzle and team_id = v_part.team_id and squad_id is not distinct from v_squad;
  if v_used >= v_pz.max_attempts then raise exception 'NO_ATTEMPTS'; end if;

  v_ok := (p_selected = v_pz.correct_index);
  insert into puzzle_attempts (puzzle_id, team_id, squad_id, participant_id, selected_index, is_correct)
  values (p_puzzle, v_part.team_id, v_squad, p_participant, p_selected, v_ok);
  v_used := v_used + 1;

  if v_ok then
    insert into puzzle_solves (puzzle_id, team_id, squad_id, participant_id, tokens)
    values (p_puzzle, v_part.team_id, v_squad, p_participant, v_pz.tokens);
    insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
    values (v_part.team_id, p_participant, 'puzzle', v_pz.tokens, 'Puzzle: ' || left(v_pz.prompt, 60),
            'puzzle:' || v_part.team_id || ':' || p_puzzle || ':' || coalesce(v_squad::text, '-'), 'system');
  end if;

  return jsonb_build_object('solved', v_ok, 'already', false, 'is_correct', v_ok,
    'tokens', case when v_ok then v_pz.tokens else 0 end,
    'attempts_used', v_used, 'attempts_left', greatest(v_pz.max_attempts - v_used, 0),
    'balance', team_balance(v_part.team_id));
end $$;

alter table public.hunt_scans     enable row level security;
alter table public.team_puzzles   enable row level security;
alter table public.puzzle_attempts enable row level security;
alter table public.puzzle_solves  enable row level security;
revoke all on public.hunt_scans, public.team_puzzles, public.puzzle_attempts, public.puzzle_solves from anon, authenticated;
revoke all on function public.claim_spot(uuid, text), public.submit_puzzle(uuid, uuid, int) from public, anon, authenticated;
grant all on public.hunt_scans, public.team_puzzles, public.puzzle_attempts, public.puzzle_solves to service_role;
grant execute on function public.claim_spot(uuid, text), public.submit_puzzle(uuid, uuid, int) to service_role;
