-- =====================================================================
-- Food Camp Hunt (Guess & Collect + treasure hunt)  —  database schema
-- Run this whole file once in Supabase: SQL Editor > New query > Run.
-- It is safe to re-run on an EMPTY project. Do NOT re-run on a project
-- that already holds real data without reading it first.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------- tables ----------------------------------------------------

create table if not exists public.game_settings (
  id                int primary key default 1 check (id = 1),
  is_open           boolean not null default false,
  tokens_per_correct int not null default 10 check (tokens_per_correct >= 0),
  hunt_open         boolean not null default false,
  checkin_open      boolean not null default false,   -- event-day check-in switch
  checkin_code      text,                             -- secret inside the staff check-in QR code
  checkin_announced_at timestamptz,                   -- bump = pop-up again for players not yet checked in
  market_open       boolean not null default false   -- lets team leaders redeem from their phones
);
insert into public.game_settings (id) values (1) on conflict do nothing;

create table if not exists public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete restrict,
  name            text not null check (length(trim(name)) between 1 and 100),
  nick_name       text check (nick_name is null or length(trim(nick_name)) between 1 and 60),
  -- The player's login ID is set by the organiser; only a keyed hash of it is stored. NULL = no active ID.
  code_hash       text unique,
  is_leader       boolean not null default false,   -- team leader: may redeem for the team (max one per team)
  checked_in_at   timestamptz,                      -- event-day check-in
  checked_in_by   text,                             -- 'self' or 'staff:<role>'
  avatar_url      text,                             -- uploaded profile photo (public 'avatars' bucket)
  avatar_emoji    text check (avatar_emoji is null or length(avatar_emoji) <= 16),
  session_version int not null default 1,
  status          text not null default 'not_started'
                  check (status in ('not_started','in_progress','completed')),
  confirmed_at    timestamptz,
  completed_at    timestamptz,
  correct_count   int not null default 0,
  tokens_earned   int not null default 0,
  created_at      timestamptz not null default now()
);
create index if not exists participants_team_idx on public.participants(team_id);
create unique index if not exists participants_one_leader_per_team on public.participants(team_id) where is_leader;

create table if not exists public.questions (
  id            uuid primary key default gen_random_uuid(),
  position      int not null default 1,
  prompt        text not null check (length(trim(prompt)) > 0),
  image_url     text,
  options       text[] not null check (array_length(options, 1) = 4),
  correct_index int not null check (correct_index between 0 and 3),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.answers (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  question_id    uuid not null references public.questions(id) on delete restrict,
  selected_index int not null check (selected_index between 0 and 3),
  is_correct     boolean not null,
  answered_at    timestamptz not null default now(),
  unique (participant_id, question_id)
);

create table if not exists public.market_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  category   text not null default 'ingredient',
  price      int not null check (price > 0),
  stock      int not null default 0 check (stock >= 0),   -- DB refuses negative stock
  image_url  text,                                        -- optional picture shown to players
  active     boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.redemptions (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete restrict,
  item_id         uuid not null references public.market_items(id) on delete restrict,
  item_name       text not null,            -- snapshot
  unit_price      int  not null,            -- snapshot
  quantity        int  not null check (quantity > 0),
  total_cost      int  not null check (total_cost > 0),
  idempotency_key text not null unique,
  confirmed_by    text not null,
  fulfilled_at    timestamptz,                -- set when staff hand the goods over
  fulfilled_by    text,
  created_at      timestamptz not null default now()
);

create table if not exists public.token_ledger (
  id              uuid primary key default gen_random_uuid(),
  team_id         uuid not null references public.teams(id) on delete restrict,
  participant_id  uuid references public.participants(id) on delete restrict,
  redemption_id   uuid references public.redemptions(id) on delete restrict,
  kind            text not null check (kind in ('quiz','redemption','adjustment','hunt','puzzle')),
  amount          int  not null,
  reason          text,
  idempotency_key text not null unique,
  created_by      text,
  created_at      timestamptz not null default now(),
  check (
    (kind = 'quiz'       and amount >= 0 and participant_id is not null) or
    (kind = 'hunt'       and amount >= 0 and participant_id is not null) or
    (kind = 'puzzle'     and amount >= 0 and participant_id is not null) or
    (kind = 'redemption' and amount <  0) or
    (kind = 'adjustment' and amount <> 0 and reason is not null)
  )
);
create index if not exists ledger_team_idx on public.token_ledger(team_id);
-- Hard guarantee: a participant can be credited for the quiz only ONCE.
create unique index if not exists ledger_one_quiz_per_participant
  on public.token_ledger(participant_id) where kind = 'quiz';

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,
  action     text not null,
  details    jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------- helper: team balance & summary ------------------------------

create or replace function public.team_balance(p_team uuid)
returns int language sql stable as $$
  select coalesce(sum(amount), 0)::int from public.token_ledger where team_id = p_team;
$$;

create or replace view public.team_summary with (security_invoker = true) as
select t.id as team_id,
       t.name,
       (select count(*) from public.participants p where p.team_id = t.id)::int as participants,
       (select count(*) from public.participants p where p.team_id = t.id and p.status = 'completed')::int as completed,
       (select count(*) from public.participants p where p.team_id = t.id and p.status = 'in_progress')::int as in_progress,
       public.team_balance(t.id) as balance,
       (select coalesce(sum(-amount),0) from public.token_ledger l where l.team_id = t.id and l.kind='redemption')::int as spent
from public.teams t;

-- ---------- game functions (all atomic) ----------------------------------

create or replace function public.start_participant(p_participant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_part participants%rowtype; v_open boolean;
begin
  select * into v_part from participants where id = p_participant for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_part.status = 'not_started' then
    select is_open into v_open from game_settings where id = 1;
    if not v_open then raise exception 'GAME_CLOSED'; end if;
    update participants set status = 'in_progress', confirmed_at = now() where id = p_participant;
  end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.submit_answer(p_participant uuid, p_question uuid, p_selected int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_q questions%rowtype; v_ex answers%rowtype;
  v_open boolean; v_next uuid; v_correct boolean; v_count int; v_total int;
begin
  -- Row lock serialises concurrent submits from the same participant.
  select * into v_part from participants where id = p_participant for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_selected is null or p_selected < 0 or p_selected > 3 then raise exception 'BAD_INPUT'; end if;
  select * into v_q from questions where id = p_question;
  if not found then raise exception 'BAD_INPUT'; end if;

  select * into v_ex from answers where participant_id = p_participant and question_id = p_question;
  if found then  -- retry / duplicate: return the stored result, change nothing
    select count(*) into v_count from answers a join questions q on q.id = a.question_id and q.active where a.participant_id = p_participant;
    select count(*) into v_total from questions where active;
    return jsonb_build_object('is_correct', v_ex.is_correct, 'correct_index', v_q.correct_index,
      'selected', v_ex.selected_index, 'already', true, 'answered', v_count, 'total', v_total);
  end if;

  if v_part.status = 'completed' then raise exception 'ALREADY_COMPLETED'; end if;
  if v_part.status <> 'in_progress' then raise exception 'NOT_STARTED'; end if;
  select is_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'GAME_CLOSED'; end if;
  if not v_q.active then raise exception 'BAD_INPUT'; end if;

  select q.id into v_next from questions q
   where q.active and not exists (select 1 from answers a where a.participant_id = p_participant and a.question_id = q.id)
   order by q.position, q.id limit 1;
  if v_next is distinct from p_question then raise exception 'OUT_OF_ORDER'; end if;

  v_correct := (p_selected = v_q.correct_index);
  insert into answers (participant_id, question_id, selected_index, is_correct)
  values (p_participant, p_question, p_selected, v_correct);

  select count(*) into v_count from answers a join questions q on q.id = a.question_id and q.active where a.participant_id = p_participant;
  select count(*) into v_total from questions where active;
  return jsonb_build_object('is_correct', v_correct, 'correct_index', v_q.correct_index,
    'selected', p_selected, 'already', false, 'answered', v_count, 'total', v_total);
end $$;

create or replace function public.complete_quiz(p_participant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_total int; v_answered int; v_correct int; v_per int; v_tokens int;
begin
  select * into v_part from participants where id = p_participant for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_part.status = 'completed' then
    return jsonb_build_object('already', true, 'correct_count', v_part.correct_count, 'tokens', v_part.tokens_earned);
  end if;
  if v_part.status <> 'in_progress' then raise exception 'NOT_STARTED'; end if;

  select count(*) into v_total from questions where active;
  select count(*), count(*) filter (where a.is_correct) into v_answered, v_correct
    from answers a join questions q on q.id = a.question_id and q.active
   where a.participant_id = p_participant;
  if v_total = 0 or v_answered < v_total then raise exception 'INCOMPLETE'; end if;

  select tokens_per_correct into v_per from game_settings where id = 1;
  v_tokens := v_correct * v_per;

  -- Unique indexes make this exactly-once even if two requests race.
  insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
  values (v_part.team_id, p_participant, 'quiz', v_tokens, 'Quiz', 'quiz:' || p_participant, 'system')
  on conflict do nothing;

  update participants set status = 'completed', completed_at = now(),
         correct_count = v_correct, tokens_earned = v_tokens
   where id = p_participant;
  return jsonb_build_object('already', false, 'correct_count', v_correct, 'tokens', v_tokens);
end $$;

create or replace function public.redeem_item(p_team uuid, p_item uuid, p_qty int, p_key text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team teams%rowtype; v_item market_items%rowtype; v_ex redemptions%rowtype;
  v_cost int; v_bal int; v_id uuid;
begin
  if p_qty is null or p_qty < 1 or p_qty > 100 or p_key is null or length(p_key) < 8 then
    raise exception 'BAD_INPUT';
  end if;
  -- Lock order is always: team, then item. Locking the team row serialises every
  -- spend for that team, so two clicks can never both pass the balance check.
  select * into v_team from teams where id = p_team for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select * into v_ex from redemptions where idempotency_key = p_key;
  if found then
    if v_ex.team_id <> p_team then raise exception 'BAD_INPUT'; end if;
    return jsonb_build_object('already', true, 'redemption_id', v_ex.id,
      'total_cost', v_ex.total_cost, 'balance', team_balance(p_team));
  end if;

  select * into v_item from market_items where id = p_item for update;
  if not found or not v_item.active then raise exception 'ITEM_UNAVAILABLE'; end if;
  if v_item.stock < p_qty then raise exception 'OUT_OF_STOCK'; end if;
  v_cost := v_item.price * p_qty;
  v_bal  := team_balance(p_team);
  if v_bal < v_cost then raise exception 'INSUFFICIENT_TOKENS'; end if;

  insert into redemptions (team_id, item_id, item_name, unit_price, quantity, total_cost, idempotency_key, confirmed_by)
  values (p_team, p_item, v_item.name, v_item.price, p_qty, v_cost, p_key, p_actor)
  returning id into v_id;

  update market_items set stock = stock - p_qty where id = p_item;

  insert into token_ledger (team_id, redemption_id, kind, amount, reason, idempotency_key, created_by)
  values (p_team, v_id, 'redemption', -v_cost, v_item.name || ' x' || p_qty, 'redeem:' || v_id, p_actor);

  insert into audit_log (actor, action, details)
  values (p_actor, 'redeem', jsonb_build_object('team_id', p_team, 'item_id', p_item, 'item', v_item.name,
          'quantity', p_qty, 'cost', v_cost, 'balance_after', v_bal - v_cost, 'stock_after', v_item.stock - p_qty));

  return jsonb_build_object('already', false, 'redemption_id', v_id, 'total_cost', v_cost, 'balance', v_bal - v_cost);
end $$;

create or replace function public.adjust_tokens(p_team uuid, p_amount int, p_reason text, p_key text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_team teams%rowtype; v_bal int; v_ex token_ledger%rowtype;
begin
  if p_amount is null or p_amount = 0 or p_reason is null or length(trim(p_reason)) < 3
     or p_key is null or length(p_key) < 8 then
    raise exception 'BAD_INPUT';
  end if;
  select * into v_team from teams where id = p_team for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select * into v_ex from token_ledger where idempotency_key = 'adjust:' || p_key;
  if found then
    return jsonb_build_object('already', true, 'balance', team_balance(p_team));
  end if;

  v_bal := team_balance(p_team);
  if v_bal + p_amount < 0 then raise exception 'INSUFFICIENT_TOKENS'; end if;

  insert into token_ledger (team_id, kind, amount, reason, idempotency_key, created_by)
  values (p_team, 'adjustment', p_amount, trim(p_reason), 'adjust:' || p_key, p_actor);
  insert into audit_log (actor, action, details)
  values (p_actor, 'adjust_tokens', jsonb_build_object('team_id', p_team, 'amount', p_amount,
          'reason', trim(p_reason), 'balance_after', v_bal + p_amount));
  return jsonb_build_object('already', false, 'balance', v_bal + p_amount);
end $$;

-- ---------- Food Camp Hunt (treasure hunt) ---------------------------------
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


-- ---------- Squads + team goal (see supabase/squads.sql) ----------------------
create table if not exists public.squads (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.teams(id) on delete restrict,
  name       text not null check (length(trim(name)) between 1 and 60),
  created_at timestamptz not null default now()
);
create index if not exists squads_team_idx on public.squads(team_id);

alter table public.participants add column if not exists squad_id uuid references public.squads(id) on delete set null;
alter table public.game_settings add column if not exists team_goal_pct int not null default 0 check (team_goal_pct between 0 and 100);
alter table public.market_items add column if not exists requires_goal boolean not null default false;

alter table public.hunt_claims add column if not exists squad_id uuid references public.squads(id) on delete restrict;
alter table public.hunt_claims drop constraint if exists hunt_claims_team_id_spot_id_key;
create unique index if not exists hunt_claims_squad_spot on public.hunt_claims(squad_id, spot_id) where squad_id is not null;
create unique index if not exists hunt_claims_team_spot_nosquad on public.hunt_claims(team_id, spot_id) where squad_id is null;

-- Has the team reached the goal? (goal 0 = no goal, always true)
create or replace function public.team_goal_met(p_team uuid)
returns boolean language sql stable as $$
  select g.team_goal_pct = 0
      or (c.n > 0 and c.done * 100 >= g.team_goal_pct * c.n)
  from public.game_settings g,
       lateral (select count(*)::int as n, count(*) filter (where status = 'completed')::int as done
                  from public.participants where team_id = p_team) c
  where g.id = 1;
$$;

create or replace function public.claim_spot(p_participant uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_spot hunt_spots%rowtype; v_open boolean; v_team teams%rowtype;
  v_ex hunt_claims%rowtype; v_id uuid; v_squad uuid;
begin
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Locking the team row serialises teammates scanning at the same moment.
  select * into v_team from teams where id = v_part.team_id for update;
  -- Re-read after the lock; only use the squad if it really belongs to this team.
  select s.id into v_squad from participants p join squads s on s.id = p.squad_id and s.team_id = p.team_id
   where p.id = p_participant;

  select * into v_spot from hunt_spots where secret = upper(trim(coalesce(p_secret,''))) and active;
  if not found then raise exception 'SPOT_NOT_FOUND'; end if;

  select * into v_ex from hunt_claims
   where spot_id = v_spot.id and team_id = v_part.team_id and squad_id is not distinct from v_squad;
  if found then
    return jsonb_build_object('already', true, 'title', v_spot.title, 'tokens', v_ex.tokens,
      'balance', team_balance(v_part.team_id));
  end if;

  select hunt_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'HUNT_CLOSED'; end if;

  insert into hunt_claims (team_id, squad_id, spot_id, participant_id, tokens)
  values (v_part.team_id, v_squad, v_spot.id, p_participant, v_spot.tokens) returning id into v_id;

  insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
  values (v_part.team_id, p_participant, 'hunt', v_spot.tokens, 'Hunt: ' || v_spot.title,
          'hunt:' || v_part.team_id || ':' || v_spot.id || ':' || coalesce(v_squad::text, '-'), 'system');

  return jsonb_build_object('already', false, 'title', v_spot.title, 'tokens', v_spot.tokens,
    'balance', team_balance(v_part.team_id));
end $$;

create or replace function public.redeem_item(p_team uuid, p_item uuid, p_qty int, p_key text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_team teams%rowtype; v_item market_items%rowtype; v_ex redemptions%rowtype;
  v_cost int; v_bal int; v_id uuid;
begin
  if p_qty is null or p_qty < 1 or p_qty > 100 or p_key is null or length(p_key) < 8 then
    raise exception 'BAD_INPUT';
  end if;
  select * into v_team from teams where id = p_team for update;
  if not found then raise exception 'NOT_FOUND'; end if;

  select * into v_ex from redemptions where idempotency_key = p_key;
  if found then
    if v_ex.team_id <> p_team then raise exception 'BAD_INPUT'; end if;
    return jsonb_build_object('already', true, 'redemption_id', v_ex.id,
      'total_cost', v_ex.total_cost, 'balance', team_balance(p_team));
  end if;

  select * into v_item from market_items where id = p_item for update;
  if not found or not v_item.active then raise exception 'ITEM_UNAVAILABLE'; end if;
  if v_item.requires_goal and not team_goal_met(p_team) then raise exception 'GOAL_NOT_MET'; end if;
  if v_item.stock < p_qty then raise exception 'OUT_OF_STOCK'; end if;
  v_cost := v_item.price * p_qty;
  v_bal  := team_balance(p_team);
  if v_bal < v_cost then raise exception 'INSUFFICIENT_TOKENS'; end if;

  insert into redemptions (team_id, item_id, item_name, unit_price, quantity, total_cost, idempotency_key, confirmed_by)
  values (p_team, p_item, v_item.name, v_item.price, p_qty, v_cost, p_key, p_actor)
  returning id into v_id;

  update market_items set stock = stock - p_qty where id = p_item;

  insert into token_ledger (team_id, redemption_id, kind, amount, reason, idempotency_key, created_by)
  values (p_team, v_id, 'redemption', -v_cost, v_item.name || ' x' || p_qty, 'redeem:' || v_id, p_actor);

  insert into audit_log (actor, action, details)
  values (p_actor, 'redeem', jsonb_build_object('team_id', p_team, 'item_id', p_item, 'item', v_item.name,
          'quantity', p_qty, 'cost', v_cost, 'balance_after', v_bal - v_cost, 'stock_after', v_item.stock - p_qty));

  return jsonb_build_object('already', false, 'redemption_id', v_id, 'total_cost', v_cost, 'balance', v_bal - v_cost);
end $$;

alter table public.squads enable row level security;
revoke all on public.squads from anon, authenticated;
revoke all on function public.team_goal_met(uuid), public.claim_spot(uuid, text),
  public.redeem_item(uuid, uuid, int, text, text) from public, anon, authenticated;
grant all on public.squads to service_role;
grant execute on function public.team_goal_met(uuid), public.claim_spot(uuid, text),
  public.redeem_item(uuid, uuid, int, text, text) to service_role;

-- ---------- Co-op spots + team puzzles (see supabase/coop.sql) ----------------
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

-- ---------- Team photo missions with admin review (see supabase/photos.sql) -------
create table if not exists public.photo_missions (
  id            uuid primary key default gen_random_uuid(),
  position      int  not null default 1,
  title         text not null check (length(trim(title)) > 0),
  description   text not null default '',
  category      text not null default 'other' check (category in ('person','object','food','place','other')),
  ref_image_url text,
  tokens        int  not null default 20 check (tokens >= 0),
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

create table if not exists public.photo_submissions (
  id              uuid primary key default gen_random_uuid(),
  mission_id      uuid not null references public.photo_missions(id) on delete restrict,
  team_id         uuid not null references public.teams(id) on delete restrict,
  participant_id  uuid not null references public.participants(id) on delete restrict,
  image_url       text not null,
  status          text not null default 'pending' check (status in ('pending','approved','rejected')),
  tokens          int  not null,
  rejected_by     text,
  rejected_reason text,
  created_at      timestamptz not null default now()
);
-- upgrade from the first version (which had no 'pending' state)
alter table public.photo_submissions drop constraint if exists photo_submissions_status_check;
alter table public.photo_submissions add constraint photo_submissions_status_check check (status in ('pending','approved','rejected'));
alter table public.photo_submissions alter column status set default 'pending';
alter table public.photo_submissions add column if not exists reviewed_at timestamptz;
alter table public.photo_submissions add column if not exists reviewed_by text;
-- a team has at most ONE open photo (waiting for review or accepted) per mission; a rejected one can be replaced
drop index if exists public.photo_one_approved_per_team;
create unique index if not exists photo_one_open_per_team
  on public.photo_submissions(mission_id, team_id) where status in ('pending','approved');

-- Leader uploads (or replaces a still-pending photo). No tokens are given here.
create or replace function public.submit_photo(p_participant uuid, p_mission uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_m photo_missions%rowtype;
  v_open boolean; v_ex photo_submissions%rowtype; v_id uuid; v_old text; v_has boolean;
begin
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_part.team_id for update;   -- serialises the team
  if not v_part.is_leader then raise exception 'NOT_LEADER'; end if;
  if p_url is null or length(p_url) < 8 then raise exception 'BAD_INPUT'; end if;
  select * into v_m from photo_missions where id = p_mission and active;
  if not found then raise exception 'BAD_INPUT'; end if;

  select * into v_ex from photo_submissions
   where mission_id = p_mission and team_id = v_part.team_id and status in ('pending','approved');
  v_has := found;      -- FOUND is overwritten by the next SELECT INTO, so keep it
  if v_has and v_ex.status = 'approved' then
    return jsonb_build_object('already', true, 'status', 'approved', 'tokens', v_ex.tokens);
  end if;

  select puzzle_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'PUZZLE_CLOSED'; end if;

  if v_has then      -- still pending: the leader swaps in a better photo
    v_old := v_ex.image_url;
    update photo_submissions set image_url = p_url, participant_id = p_participant, created_at = now(), tokens = v_m.tokens
     where id = v_ex.id;
    return jsonb_build_object('already', false, 'status', 'pending', 'replaced', true, 'old_url', v_old, 'tokens', v_m.tokens);
  end if;

  insert into photo_submissions (mission_id, team_id, participant_id, image_url, tokens)
  values (p_mission, v_part.team_id, p_participant, p_url, v_m.tokens) returning id into v_id;
  return jsonb_build_object('already', false, 'status', 'pending', 'replaced', false, 'tokens', v_m.tokens, 'submission_id', v_id);
end $$;

-- Staff/admin decision. pending -> approved (credits the team once) | rejected (no tokens).
-- approved -> rejected = take an earlier approval back (tokens are returned to zero out the credit).
create or replace function public.review_photo(p_submission uuid, p_approve boolean, p_reason text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s photo_submissions%rowtype; v_team teams%rowtype; v_title text; v_reason text;
begin
  select * into v_s from photo_submissions where id = p_submission;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_s.team_id for update;
  select * into v_s from photo_submissions where id = p_submission;      -- re-read under the lock
  select title into v_title from photo_missions where id = v_s.mission_id;
  v_reason := nullif(trim(coalesce(p_reason, '')), '');

  if v_s.status = 'pending' and p_approve then
    update photo_submissions set status = 'approved', reviewed_at = now(), reviewed_by = p_actor where id = p_submission;
    if v_s.tokens > 0 then
      insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
      values (v_s.team_id, v_s.participant_id, 'puzzle', v_s.tokens, 'Photo: ' || left(coalesce(v_title, ''), 60), 'photo:' || p_submission, p_actor);
    end if;
    insert into audit_log (actor, action, details)
    values (p_actor, 'photo.approve', jsonb_build_object('submission', p_submission, 'team_id', v_s.team_id, 'tokens', v_s.tokens));
    return jsonb_build_object('already', false, 'status', 'approved', 'tokens', v_s.tokens, 'balance', team_balance(v_s.team_id));
  end if;

  if v_s.status = 'pending' and not p_approve then
    update photo_submissions set status = 'rejected', reviewed_at = now(), reviewed_by = p_actor, rejected_by = p_actor, rejected_reason = v_reason
     where id = p_submission;
    insert into audit_log (actor, action, details)
    values (p_actor, 'photo.reject', jsonb_build_object('submission', p_submission, 'team_id', v_s.team_id, 'reason', v_reason));
    return jsonb_build_object('already', false, 'status', 'rejected', 'tokens', 0, 'balance', team_balance(v_s.team_id));
  end if;

  if v_s.status = 'approved' and not p_approve then      -- revoke an earlier approval
    update photo_submissions set status = 'rejected', reviewed_at = now(), reviewed_by = p_actor, rejected_by = p_actor, rejected_reason = v_reason
     where id = p_submission;
    if v_s.tokens > 0 then
      insert into token_ledger (team_id, kind, amount, reason, idempotency_key, created_by)
      values (v_s.team_id, 'adjustment', -v_s.tokens, 'Photo approval revoked: ' || left(coalesce(v_title, ''), 60), 'photo-reject:' || p_submission, p_actor);
    end if;
    insert into audit_log (actor, action, details)
    values (p_actor, 'photo.revoke', jsonb_build_object('submission', p_submission, 'team_id', v_s.team_id, 'tokens', v_s.tokens));
    return jsonb_build_object('already', false, 'status', 'rejected', 'tokens', 0, 'balance', team_balance(v_s.team_id));
  end if;

  return jsonb_build_object('already', true, 'status', v_s.status, 'balance', team_balance(v_s.team_id));  -- nothing to change
end $$;

-- older helper from the first version (refund on rejection); kept so nothing that references it breaks
create or replace function public.reject_photo(p_submission uuid, p_reason text, p_actor text)
returns jsonb language sql security definer set search_path = public as $$
  select public.review_photo(p_submission, false, p_reason, p_actor);
$$;

alter table public.photo_missions   enable row level security;
alter table public.photo_submissions enable row level security;
revoke all on public.photo_missions, public.photo_submissions from anon, authenticated;
revoke all on function public.submit_photo(uuid, uuid, text), public.review_photo(uuid, boolean, text, text), public.reject_photo(uuid, text, text) from public, anon, authenticated;
grant all on public.photo_missions, public.photo_submissions to service_role;
grant execute on function public.submit_photo(uuid, uuid, text), public.review_photo(uuid, boolean, text, text), public.reject_photo(uuid, text, text) to service_role;

insert into storage.buckets (id, name, public)
values ('mission-photos', 'mission-photos', true)
on conflict (id) do nothing;

-- ---------- storage bucket for question images ---------------------------
insert into storage.buckets (id, name, public)
values ('question-images', 'question-images', true)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- ---------- LOCK EVERYTHING DOWN -----------------------------------------
-- RLS on, and NO policies: the public/anon key can read or write nothing.
-- Only the server (service-role key) can touch data.
alter table public.game_settings enable row level security;
alter table public.teams         enable row level security;
alter table public.participants  enable row level security;
alter table public.questions     enable row level security;
alter table public.answers       enable row level security;
alter table public.market_items  enable row level security;
alter table public.redemptions   enable row level security;
alter table public.token_ledger  enable row level security;
alter table public.audit_log     enable row level security;
alter table public.hunt_spots    enable row level security;
alter table public.hunt_claims   enable row level security;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant  all on all tables    in schema public to service_role;
grant  execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;
