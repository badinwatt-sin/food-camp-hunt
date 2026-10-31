-- =====================================================================
-- Food Camp Hunt: treasure-hunt mode.
-- schema.sql already includes this for NEW projects (see bottom of that file).
-- For an EXISTING project created from the older schema, run this file once.
-- It is safe to run more than once.
-- =====================================================================

alter table public.game_settings add column if not exists hunt_open boolean not null default false;

-- allow the new ledger kind 'hunt'
alter table public.token_ledger drop constraint if exists token_ledger_kind_check;
alter table public.token_ledger drop constraint if exists token_ledger_check;
alter table public.token_ledger add constraint token_ledger_kind_check
  check (kind in ('quiz','redemption','adjustment','hunt'));
alter table public.token_ledger add constraint token_ledger_check check (
  (kind = 'quiz'       and amount >= 0 and participant_id is not null) or
  (kind = 'hunt'       and amount >= 0 and participant_id is not null) or
  (kind = 'redemption' and amount <  0) or
  (kind = 'adjustment' and amount <> 0 and reason is not null)
);

-- A hunt spot = a checkpoint in the camp with a secret code (shown as a QR / sign on site).
create table if not exists public.hunt_spots (
  id         uuid primary key default gen_random_uuid(),
  position   int  not null default 1,
  title      text not null check (length(trim(title)) > 0),
  hint       text not null default '',
  secret     text not null unique check (length(secret) between 4 and 40),
  tokens     int  not null default 10 check (tokens >= 0),
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

-- One claim per team per spot: the first teammate to find it earns the tokens for the whole team.
create table if not exists public.hunt_claims (
  id             uuid primary key default gen_random_uuid(),
  team_id        uuid not null references public.teams(id) on delete restrict,
  spot_id        uuid not null references public.hunt_spots(id) on delete restrict,
  participant_id uuid not null references public.participants(id) on delete restrict,
  tokens         int  not null,
  claimed_at     timestamptz not null default now(),
  unique (team_id, spot_id)
);

create or replace function public.claim_spot(p_participant uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_spot hunt_spots%rowtype; v_open boolean; v_team teams%rowtype;
  v_ex hunt_claims%rowtype; v_id uuid;
begin
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Locking the team row serialises teammates scanning at the same moment.
  select * into v_team from teams where id = v_part.team_id for update;

  select * into v_spot from hunt_spots where secret = upper(trim(coalesce(p_secret,''))) and active;
  if not found then raise exception 'SPOT_NOT_FOUND'; end if;

  select * into v_ex from hunt_claims where team_id = v_part.team_id and spot_id = v_spot.id;
  if found then
    return jsonb_build_object('already', true, 'title', v_spot.title, 'tokens', v_ex.tokens,
      'balance', team_balance(v_part.team_id));
  end if;

  select hunt_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'HUNT_CLOSED'; end if;

  insert into hunt_claims (team_id, spot_id, participant_id, tokens)
  values (v_part.team_id, v_spot.id, p_participant, v_spot.tokens) returning id into v_id;

  insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
  values (v_part.team_id, p_participant, 'hunt', v_spot.tokens, 'Hunt: ' || v_spot.title,
          'hunt:' || v_part.team_id || ':' || v_spot.id, 'system');

  return jsonb_build_object('already', false, 'title', v_spot.title, 'tokens', v_spot.tokens,
    'balance', team_balance(v_part.team_id));
end $$;

-- lock down (same rules as the rest of the schema)
alter table public.hunt_spots  enable row level security;
alter table public.hunt_claims enable row level security;
revoke all on public.hunt_spots, public.hunt_claims from anon, authenticated;
revoke all on function public.claim_spot(uuid, text) from public, anon, authenticated;
grant all on public.hunt_spots, public.hunt_claims to service_role;
grant execute on function public.claim_spot(uuid, text) to service_role;
