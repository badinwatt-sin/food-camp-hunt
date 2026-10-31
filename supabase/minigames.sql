-- =====================================================================
-- Solo mini-games (เกมย่อย) to collect tokens BEFORE the event
-- (run once on an EXISTING database; schema.sql already contains it; safe to re-run)
--   * 3 games: spot the difference ('spot'), memory flip ('memory'), mystery ingredient ('mystery')
--   * every game: max 3 attempts per player, the BEST attempt counts
--     (the ledger only receives the improvement: delta = new best - old best)
--   * tokens go to the team wallet (ledger kind 'minigame')
--   * each game has its own on/off switch + one percentage multiplier for the whole economy
-- =====================================================================
alter table public.game_settings add column if not exists mg_spot_open    boolean not null default false;
alter table public.game_settings add column if not exists mg_memory_open  boolean not null default false;
alter table public.game_settings add column if not exists mg_mystery_open boolean not null default false;
alter table public.game_settings add column if not exists mg_percent      int not null default 100 check (mg_percent between 0 and 500);

alter table public.token_ledger drop constraint if exists token_ledger_kind_check;
alter table public.token_ledger drop constraint if exists token_ledger_check;
alter table public.token_ledger add constraint token_ledger_kind_check
  check (kind in ('quiz','redemption','adjustment','hunt','puzzle','minigame'));
alter table public.token_ledger add constraint token_ledger_check check (
  (kind = 'quiz'       and amount >= 0 and participant_id is not null) or
  (kind = 'hunt'       and amount >= 0 and participant_id is not null) or
  (kind = 'puzzle'     and amount >= 0 and participant_id is not null) or
  (kind = 'minigame'   and amount >= 0 and participant_id is not null) or
  (kind = 'redemption' and amount <  0) or
  (kind = 'adjustment' and amount <> 0 and reason is not null)
);

create table if not exists public.minigame_attempts (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  game           text not null check (game in ('spot','memory','mystery')),
  n              int  not null check (n between 1 and 3),     -- hard limit: 3 attempts per game
  state          jsonb not null default '{}'::jsonb,           -- secrets (card layout, differences, answers) never leave the server
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  tokens         int check (tokens is null or tokens >= 0),
  result         jsonb,
  unique (participant_id, game, n)
);
create index if not exists mg_attempts_game_idx on public.minigame_attempts(game, tokens desc) where finished_at is not null;
alter table public.minigame_attempts enable row level security;

-- Finishes an attempt exactly once and credits the team with the improvement over the player's previous best.
create or replace function public.mg_finish(p_attempt uuid, p_tokens int, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare a minigame_attempts%rowtype; v_team uuid; v_prev int; v_delta int;
begin
  select * into a from minigame_attempts where id = p_attempt for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if a.finished_at is not null then
    return jsonb_build_object('tokens', a.tokens, 'awarded', 0, 'already', true, 'result', a.result);
  end if;
  select team_id into v_team from participants where id = a.participant_id;
  perform 1 from teams where id = v_team for update;            -- serialise with the team's other wallet writes
  select coalesce(max(tokens), 0) into v_prev from minigame_attempts
   where participant_id = a.participant_id and game = a.game and finished_at is not null;
  p_tokens := greatest(coalesce(p_tokens, 0), 0);
  update minigame_attempts set finished_at = now(), tokens = p_tokens, result = p_result where id = a.id;
  v_delta := greatest(p_tokens - v_prev, 0);
  if v_delta > 0 then
    insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
    values (v_team, a.participant_id, 'minigame', v_delta, a.game, 'mg:' || a.id::text, 'player');
  end if;
  return jsonb_build_object('tokens', p_tokens, 'awarded', v_delta, 'best', greatest(v_prev, p_tokens), 'already', false, 'result', p_result);
end $$;
revoke all on function public.mg_finish(uuid, int, jsonb) from public, anon, authenticated;
