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

-- =====================================================================
-- v2: each team has its OWN background colour (unique), and the mission can start for the judges only
--     (observers play a score-free test wall; nobody else is notified) before it starts for everyone.
-- v5: duplicate-face check (the phone computes a small numeric face signature; the server compares it with the other photos).
--     mode: off | flag (admin reviews) | block (upload refused). Signatures live inside selfie_photos.checks and go away with the photo.
-- v4: a whole team can be marked "committee / test" (selfie_excluded): it never takes part in the real walls,
--     ranks or rewards, and its members test on the judges' wall exactly like observers.
-- v3: start for chosen teams or all teams; committee/judges (observers) never take part in the real walls;
--     admins can reject a photo with a reason (the player is told and retakes); copies of a photo are caught.
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
-- 'judges' = only observers (score-free test) · 'teams' = only the teams the admin started · 'all' = every team
alter table public.game_settings add column if not exists selfie_face_mode text not null default 'block';
alter table public.game_settings add column if not exists selfie_face_distance numeric(3,2) not null default 0.45;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'game_settings_selfie_face_check' and conrelid = 'public.game_settings'::regclass) then
    alter table public.game_settings add constraint game_settings_selfie_face_check check (selfie_face_mode in ('off', 'flag', 'block') and selfie_face_distance between 0.25 and 0.65);
  end if;
end $$;
alter table public.game_settings drop constraint if exists game_settings_selfie_audience_check;
alter table public.game_settings add constraint game_settings_selfie_audience_check check (selfie_audience in ('all', 'teams', 'judges'));
alter table public.teams add column if not exists selfie_excluded boolean not null default false;     -- committee / test team: not scored, not ranked, judges' wall only
alter table public.teams add column if not exists selfie_active boolean not null default false;     -- started in 'teams' mode
alter table public.teams add column if not exists selfie_started_at timestamptz;                      -- that team's own announcement
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
  v_rank int; v_tokens int; v_rewards int[]; v_ranked int; v_aud text;
begin
  perform pg_advisory_xact_lock(71040002);                 -- one finishing order for every team
  if not selfie_window_open() then raise exception 'SELFIE_CLOSED'; end if;
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_part.team_id for update;   -- serialise with other wallet writers
  if v_part.is_observer or v_team.selfie_excluded then raise exception 'OBSERVER_READ_ONLY'; end if;   -- committee / judges / test teams never join the real walls
  select selfie_audience into v_aud from game_settings where id = 1;
  if v_aud = 'judges' or (v_aud = 'teams' and not v_team.selfie_active) then raise exception 'SELFIE_CLOSED'; end if;
  select image_url into v_old from selfie_photos where participant_id = p_participant and not is_test;
  insert into selfie_photos (participant_id, team_id, image_url, color_pct, checks, is_test)
  values (p_participant, v_team.id, p_url, coalesce(p_pct, 0), coalesce(p_checks, '{}'::jsonb), false)
  on conflict (participant_id, is_test) do update
    set image_url = excluded.image_url, color_pct = excluded.color_pct, checks = excluded.checks, created_at = now();
  -- progress = competing members only (observers are not on the real walls at all)
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
  if not (v_part.is_observer or exists (select 1 from teams where id = v_part.team_id and selfie_excluded)) then raise exception 'FORBIDDEN'; end if;
  select image_url into v_old from selfie_photos where participant_id = p_participant and is_test;
  insert into selfie_photos (participant_id, team_id, image_url, color_pct, checks, is_test)
  values (p_participant, v_part.team_id, p_url, coalesce(p_pct, 0), coalesce(p_checks, '{}'::jsonb), true)
  on conflict (participant_id, is_test) do update
    set image_url = excluded.image_url, color_pct = excluded.color_pct, checks = excluded.checks, created_at = now();
  select (select count(*) from participants p where p.is_observer or exists (select 1 from teams t where t.id = p.team_id and t.selfie_excluded)),
         (select count(*) from selfie_photos where is_test) into v_total, v_have;
  return jsonb_build_object('oldUrl', v_old, 'total', v_total, 'count', v_have,
    'complete', v_total > 0 and v_have >= v_total, 'justCompleted', v_total > 0 and v_have >= v_total and v_old is null,
    'rank', null, 'tokens', 0);
end $$;

-- Admin rejected a photo (copied, not the right person, ...): the player is told why and takes a new one.
create table if not exists public.selfie_rejections (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references public.participants(id) on delete cascade,
  reason         text not null,
  created_by     text,
  created_at     timestamptz not null default now()
);
create index if not exists selfie_rejections_pid_idx on public.selfie_rejections(participant_id, created_at desc);
alter table public.selfie_rejections enable row level security;

-- Rehearsal reset (admin danger zone): every photo, every rank and the paid rewards.
create or replace function public.reset_selfie_wall()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_urls text[];
begin
  perform pg_advisory_xact_lock(71040002);
  update game_settings set selfie_open = false where id = 1;
  select coalesce(array_agg(image_url), '{}') into v_urls from selfie_photos;
  delete from selfie_photos where id is not null;
  update teams set selfie_completed_at = null, selfie_finish_rank = null, selfie_reward_tokens = 0, selfie_active = false, selfie_started_at = null where id is not null;
  delete from selfie_rejections where id is not null;
  delete from token_ledger where idempotency_key like 'selfie:%' and created_by = 'system';
  return jsonb_build_object('urls', to_jsonb(v_urls));
end $$;

revoke all on function public.selfie_window_open(), public.submit_selfie(uuid, text, numeric, jsonb), public.submit_selfie_test(uuid, text, numeric, jsonb), public.reset_selfie_wall() from public, anon, authenticated;
grant execute on function public.selfie_window_open(), public.submit_selfie(uuid, text, numeric, jsonb), public.submit_selfie_test(uuid, text, numeric, jsonb), public.reset_selfie_wall() to service_role;
grant all on public.selfie_photos to service_role;
grant all on public.selfie_rejections to service_role;

insert into storage.buckets (id, name, public) values ('selfies', 'selfies', true) on conflict (id) do nothing;

revoke all on all tables    in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
grant  all on all tables    in schema public to service_role;
grant  execute on all functions in schema public to service_role;

alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on functions from public, anon, authenticated;

-- LINE onboarding migration (also available separately for existing projects).
-- =====================================================================
-- LINE onboarding for the four D/C/A/O teams. Safe to run on existing data.
-- A check-in means the player pressed the assigned invitation button; LINE
-- membership itself is not verified. Team assignment controls the invitation.
-- Credits: first complete team 20, then 15, 10, 5, once per team.
-- =====================================================================
begin;

alter table public.game_settings add column if not exists line_open boolean not null default false;
alter table public.participants add column if not exists line_joined_at timestamptz;
alter table public.teams add column if not exists line_group_code text;
alter table public.teams add column if not exists line_group_url text;
alter table public.teams add column if not exists line_completed_at timestamptz;
alter table public.teams add column if not exists line_finish_rank int;
alter table public.teams add column if not exists line_reward_tokens int not null default 0;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'teams_line_invitation_check' and conrelid = 'public.teams'::regclass) then
    alter table public.teams add constraint teams_line_invitation_check check (
      (line_group_code is null and line_group_url is null)
      or (line_group_code is not null and line_group_url is not null
          and line_group_code in ('D','C','A','O')
          and length(line_group_url) <= 2000
          and line_group_url ~* '^https://(line[.]me|lin[.]ee)/[^[:space:]?#][^[:space:]]*$')
    );
  end if;
  if not exists (select 1 from pg_constraint where conname = 'teams_line_result_check' and conrelid = 'public.teams'::regclass) then
    alter table public.teams add constraint teams_line_result_check check (
      (line_completed_at is null and line_finish_rank is null and line_reward_tokens = 0)
      or (line_completed_at is not null and line_finish_rank is not null
          and line_finish_rank between 1 and 4 and line_reward_tokens = 25 - 5 * line_finish_rank)
    );
  end if;
end $$;
create unique index if not exists teams_line_group_unique on public.teams(line_group_code) where line_group_code is not null;
create unique index if not exists teams_line_rank_unique on public.teams(line_finish_rank) where line_finish_rank is not null;

-- Take this lock BEFORE roster row locks, so concurrent joins, reassignments,
-- invitations and rehearsals agree on both the roster and finishing order.
create or replace function public.line_roster_lock()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(71040001);
  return null;
end $$;
drop trigger if exists line_roster_lock on public.participants;
create trigger line_roster_lock before insert or delete or update of team_id on public.participants
for each statement execute function public.line_roster_lock();
drop trigger if exists line_invitation_lock on public.teams;
create trigger line_invitation_lock before update of line_group_code, line_group_url on public.teams
for each statement execute function public.line_roster_lock();

create or replace function public.line_guard_roster()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_old uuid; v_new uuid;
begin
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id then return new; end if;
  if tg_op <> 'INSERT' then v_old := old.team_id; end if;
  if tg_op <> 'DELETE' then v_new := new.team_id; end if;
  if exists (select 1 from teams where (id = v_old or id = v_new) and line_completed_at is not null) then
    raise exception 'LINE_GROUP_COMPLETED';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- A click on an old team's invitation never counts for a newly assigned team.
  if tg_op = 'UPDATE' then new.line_joined_at := null; end if;
  return new;
end $$;
drop trigger if exists line_guard_roster on public.participants;
create trigger line_guard_roster before insert or delete or update of team_id on public.participants
for each row execute function public.line_guard_roster();

create or replace function public.line_guard_invitation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (new.line_group_code is distinct from old.line_group_code or new.line_group_url is distinct from old.line_group_url)
      and (old.line_completed_at is not null or exists (
        select 1 from participants where team_id = old.id and line_joined_at is not null
      )) then
    raise exception 'LINE_GROUP_IN_USE';
  end if;
  return new;
end $$;
drop trigger if exists line_guard_invitation on public.teams;
create trigger line_guard_invitation before update of line_group_code, line_group_url on public.teams
for each row execute function public.line_guard_invitation();

create or replace function public.configure_line_group(p_team uuid, p_code text, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := nullif(upper(trim(p_code)), ''); v_url text := nullif(trim(p_url), '');
begin
  perform pg_advisory_xact_lock(71040001);
  perform 1 from teams where id = p_team for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if (v_code is null) <> (v_url is null) or (v_code is not null and v_code not in ('D','C','A','O')) then
    raise exception 'BAD_LINE_GROUP';
  end if;
  if v_url is not null and (length(v_url) > 2000 or v_url !~* '^https://(line[.]me|lin[.]ee)/[^[:space:]?#][^[:space:]]*$') then
    raise exception 'BAD_LINE_URL';
  end if;
  if exists (select 1 from teams where line_group_code = v_code and id <> p_team) then
    raise exception 'LINE_GROUP_TAKEN';
  end if;
  update teams set line_group_code = v_code, line_group_url = v_url where id = p_team;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.join_line_group(p_participant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_team_id uuid;
  v_open boolean; v_already boolean; v_total int; v_joined int; v_rank int; v_tokens int;
begin
  perform pg_advisory_xact_lock(71040001);
  select line_open into v_open from game_settings where id = 1;
  if not coalesce(v_open, false) then raise exception 'LINE_CLOSED'; end if;
  select team_id into v_team_id from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Serialise with redemptions and other team-wallet writers.
  select * into v_team from teams where id = v_team_id for update;
  select * into v_part from participants where id = p_participant for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_team.line_group_code is null or v_team.line_group_url is null then raise exception 'LINE_NOT_CONFIGURED'; end if;
  v_already := v_part.line_joined_at is not null;
  if not v_already then
    update participants set line_joined_at = clock_timestamp() where id = p_participant returning * into v_part;
  end if;
  select count(*), count(*) filter (where line_joined_at is not null) into v_total, v_joined
    from participants where team_id = v_team.id;
  if v_total > 0 and v_total = v_joined and v_team.line_completed_at is null then
    select coalesce(max(line_finish_rank), 0) + 1 into v_rank from teams;
    if v_rank > 4 then raise exception 'BAD_LINE_GROUP'; end if;
    v_tokens := 25 - 5 * v_rank;
    insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
    values (v_team.id, p_participant, 'adjustment', v_tokens,
      'LINE group ' || v_team.line_group_code || ' complete, rank ' || v_rank,
      'line:' || v_team.id::text, 'system');
    update teams set line_completed_at = clock_timestamp(), line_finish_rank = v_rank, line_reward_tokens = v_tokens
      where id = v_team.id returning * into v_team;
    insert into audit_log (actor, action, details) values ('system', 'line.complete',
      jsonb_build_object('team_id', v_team.id, 'group', v_team.line_group_code, 'rank', v_rank, 'tokens', v_tokens));
  end if;
  return jsonb_build_object('url', v_team.line_group_url, 'already', v_already,
    'joinedAt', v_part.line_joined_at, 'total', v_total, 'joinedCount', v_joined,
    'complete', v_team.line_completed_at is not null, 'rank', v_team.line_finish_rank,
    'tokens', v_team.line_reward_tokens, 'balance', team_balance(v_team.id));
end $$;

-- Used only by the existing, explicitly confirmed bulk-reset tools. Clear all
-- four ranks together; keeping one rank would make the next race ambiguous.
create or replace function public.reset_line_checkin()
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform pg_advisory_xact_lock(71040001);
  -- Close before releasing the reset transaction: no click may restart the
  -- race between this RPC and the bulk tool's subsequent table deletions.
  update game_settings set line_open = false where id = 1;
  perform 1 from teams order by id for update;
  update teams set line_completed_at = null, line_finish_rank = null, line_reward_tokens = 0 where id is not null;
  update participants set line_joined_at = null where line_joined_at is not null;
  delete from token_ledger where idempotency_key like 'line:%' and created_by = 'system';
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.line_roster_lock(), public.line_guard_roster(), public.line_guard_invitation(),
  public.configure_line_group(uuid, text, text), public.join_line_group(uuid), public.reset_line_checkin()
  from public, anon, authenticated;
grant execute on function public.line_roster_lock(), public.line_guard_roster(), public.line_guard_invitation(),
  public.configure_line_group(uuid, text, text), public.join_line_group(uuid), public.reset_line_checkin()
  to service_role;

commit;

-- Editable LINE display names. Run once on an existing Food Camp database.
-- Safe to re-run. This preserves group assignment, invitations, joined status and Tokens.
begin;

alter table public.teams add column if not exists line_group_name text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'teams_line_group_name_check' and conrelid = 'public.teams'::regclass) then
    alter table public.teams add constraint teams_line_group_name_check check (
      line_group_name is null or (
        line_group_name = btrim(line_group_name)
        and char_length(line_group_name) between 1 and 60
        and line_group_name !~ '[[:cntrl:]]'
      )
    );
  end if;
end $$;

commit;

-- Event operations upgrade: LINE revisions, weekly fixed rewards, leader Squads,
-- and activity observers. Run once after the existing LINE migrations.
-- Safe to re-run. Existing earned Tokens and invitation links are preserved.
begin;

alter table public.participants add column if not exists is_observer boolean not null default false;
alter table public.teams add column if not exists line_revision int not null default 1;
alter table public.game_settings add column if not exists mg_spot_tokens int not null default 10;
alter table public.game_settings add column if not exists mg_memory_tokens int not null default 10;
alter table public.game_settings add column if not exists mg_mystery_tokens int not null default 10;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='teams_line_revision_check' and conrelid='public.teams'::regclass) then
    alter table public.teams add constraint teams_line_revision_check check(line_revision >= 1);
  end if;
  if not exists(select 1 from pg_constraint where conname='participants_observer_leader_check' and conrelid='public.participants'::regclass) then
    alter table public.participants add constraint participants_observer_leader_check check(not is_observer or not is_leader);
  end if;
  if not exists(select 1 from pg_constraint where conname='game_settings_weekly_tokens_check' and conrelid='public.game_settings'::regclass) then
    alter table public.game_settings add constraint game_settings_weekly_tokens_check check(
      mg_spot_tokens between 0 and 100000 and mg_memory_tokens between 0 and 100000 and mg_mystery_tokens between 0 and 100000
    );
  end if;
end $$;

-- Serialize roster roles, invitation revisions and scoring mutations in the same
-- order. The existing LINE lock is acquired before participant/team row locks.
create or replace function public.assert_competitor(p_participant uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_observer boolean;
begin
  perform pg_advisory_xact_lock(71040001);
  select is_observer into v_observer from participants where id=p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_observer then raise exception 'OBSERVER_READ_ONLY'; end if;
end $$;

create or replace function public.guard_competitor_activity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.participant_id is not null then perform assert_competitor(new.participant_id); end if;
  return new;
end $$;

do $$ declare v_table text; begin
  foreach v_table in array array['answers','minigame_attempts','hunt_scans','hunt_claims','puzzle_attempts','puzzle_solves','photo_submissions'] loop
    execute format('drop trigger if exists event_activity_lock on public.%I',v_table);
    execute format('create trigger event_activity_lock before insert or update on public.%I for each statement execute function public.line_roster_lock()',v_table);
    execute format('drop trigger if exists guard_competitor_activity on public.%I',v_table);
    execute format('create trigger guard_competitor_activity before insert or update on public.%I for each row execute function public.guard_competitor_activity()',v_table);
  end loop;
end $$;

drop trigger if exists guard_competitor_ledger on public.token_ledger;
create trigger guard_competitor_ledger before insert or update on public.token_ledger
for each row execute function public.guard_competitor_activity();

-- Observer roles may be added to any team. Converting an existing competitor
-- with activity history would change previously-earned group denominators.
create or replace function public.line_guard_roster()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_old_counted uuid; v_new_counted uuid;
begin
  if tg_op='UPDATE' then
    if new.team_id is not distinct from old.team_id and new.is_observer is not distinct from old.is_observer then return new; end if;
    if new.is_observer is distinct from old.is_observer then
    if old.is_leader or new.is_leader or old.status <> 'not_started'
      or exists(select 1 from answers where participant_id=old.id)
      or exists(select 1 from minigame_attempts where participant_id=old.id)
      or exists(select 1 from hunt_scans where participant_id=old.id)
      or exists(select 1 from hunt_claims where participant_id=old.id)
      or exists(select 1 from puzzle_attempts where participant_id=old.id)
      or exists(select 1 from puzzle_solves where participant_id=old.id)
      or exists(select 1 from photo_submissions where participant_id=old.id)
      or exists(select 1 from token_ledger where participant_id=old.id)
    then raise exception 'ROLE_CHANGE_LOCKED'; end if;
    end if;
  end if;
  if tg_op <> 'INSERT' then
    if not old.is_observer then v_old_counted:=old.team_id; end if;
  end if;
  if tg_op <> 'DELETE' then
    if not new.is_observer then v_new_counted:=new.team_id; end if;
  end if;
  if exists(select 1 from teams where id in(v_old_counted,v_new_counted) and line_completed_at is not null) then
    raise exception 'LINE_GROUP_COMPLETED';
  end if;
  if tg_op='DELETE' then return old; end if;
  if tg_op='UPDATE' and new.team_id is distinct from old.team_id then new.line_joined_at:=null; end if;
  if new.is_observer then new.is_leader:=false; new.squad_id:=null; end if;
  return new;
end $$;
drop trigger if exists line_roster_lock on public.participants;
create trigger line_roster_lock before insert or delete or update of team_id,is_observer,is_leader on public.participants
for each statement execute function public.line_roster_lock();
drop trigger if exists line_guard_roster on public.participants;
create trigger line_guard_roster before insert or delete or update of team_id,is_observer on public.participants
for each row execute function public.line_guard_roster();

create or replace view public.team_summary with(security_invoker=true) as
select t.id as team_id,t.name,
  (select count(*) from participants p where p.team_id=t.id and not p.is_observer)::int as participants,
  (select count(*) from participants p where p.team_id=t.id and not p.is_observer and p.status='completed')::int as completed,
  (select count(*) from participants p where p.team_id=t.id and not p.is_observer and p.status='in_progress')::int as in_progress,
  team_balance(t.id) as balance,
  (select coalesce(sum(-amount),0) from token_ledger l where l.team_id=t.id and l.kind='redemption')::int as spent
from teams t;

create or replace function public.team_goal_met(p_team uuid)
returns boolean language sql stable as $$
  select g.team_goal_pct=0 or(c.n>0 and c.done*100>=g.team_goal_pct*c.n)
  from public.game_settings g,
    lateral(select count(*)::int as n,count(*) filter(where status='completed')::int as done
      from public.participants where team_id=p_team and not is_observer)c
  where g.id=1;
$$;

create or replace function public.start_participant(p_participant uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_part participants%rowtype; v_open boolean;
begin
  perform assert_competitor(p_participant);
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
  perform assert_competitor(p_participant);
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
  perform assert_competitor(p_participant);
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

create or replace function public.claim_spot(p_participant uuid, p_secret text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_spot hunt_spots%rowtype; v_open boolean; v_team teams%rowtype;
  v_ex hunt_claims%rowtype; v_id uuid; v_squad uuid; v_size int; v_need int; v_have int;
begin
  perform assert_competitor(p_participant);
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
     where team_id = v_part.team_id and squad_id is not distinct from v_squad and not is_observer;
    v_need := least(v_spot.min_players, v_size);   -- a small squad is never asked for more people than it has
    insert into hunt_scans (spot_id, team_id, squad_id, participant_id)
    values (v_spot.id, v_part.team_id, v_squad, p_participant)
    on conflict (spot_id, participant_id)
    do update set scanned_at = now(), team_id = excluded.team_id, squad_id = excluded.squad_id;
    select count(*)::int into v_have from hunt_scans hs
     where exists(select 1 from participants p where p.id=hs.participant_id and not p.is_observer) and spot_id = v_spot.id and team_id = v_part.team_id and squad_id is not distinct from v_squad
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

create or replace function public.submit_puzzle(p_participant uuid, p_puzzle uuid, p_selected int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_pz team_puzzles%rowtype; v_open boolean;
  v_squad uuid; v_sv puzzle_solves%rowtype; v_used int; v_ok boolean;
begin
  perform assert_competitor(p_participant);
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

create or replace function public.submit_photo(p_participant uuid, p_mission uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_m photo_missions%rowtype;
  v_open boolean; v_ex photo_submissions%rowtype; v_id uuid; v_old text; v_has boolean;
begin
  perform assert_competitor(p_participant);
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

create or replace function public.review_photo(p_submission uuid, p_approve boolean, p_reason text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s photo_submissions%rowtype; v_team teams%rowtype; v_title text; v_reason text;
begin
  perform pg_advisory_xact_lock(71040001);
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

-- Renaming a group is harmless. Replacing its invite starts a new invitation
-- revision and asks everyone to join again, without granting the team twice.
create or replace function public.line_guard_invitation()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.line_group_code is distinct from old.line_group_code
      and (old.line_completed_at is not null or exists(
        select 1 from participants where team_id=old.id and not is_observer and line_joined_at is not null
      )) then
    raise exception 'LINE_GROUP_IN_USE';
  end if;
  if new.line_group_url is distinct from old.line_group_url then
    if old.line_group_url is not null or old.line_revision>1 then new.line_revision:=old.line_revision+1; end if;
    update participants set line_joined_at=null where team_id=old.id and line_joined_at is not null;
  end if;
  return new;
end $$;

create or replace function public.configure_line_group_details(p_team uuid,p_code text,p_url text,p_name text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_before text; v_revision int; v_name text:=nullif(btrim(p_name),'');
begin
  perform pg_advisory_xact_lock(71040001);
  select line_group_url into v_before from teams where id=p_team for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if p_name is not null and (v_name is null or char_length(v_name)>60 or v_name ~ '[[:cntrl:]]') then
    raise exception 'BAD_LINE_GROUP_NAME';
  end if;
  perform configure_line_group(p_team,p_code,p_url);
  if p_name is not null then update teams set line_group_name=v_name where id=p_team; end if;
  select line_revision into v_revision from teams where id=p_team;
  return jsonb_build_object('ok',true,'revision',v_revision,'changed',v_before is distinct from nullif(btrim(p_url),''));
end $$;

create or replace function public.join_line_group(p_participant uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_team_id uuid;
  v_open boolean; v_already boolean; v_total int; v_joined int; v_rank int; v_tokens int;
begin
  perform pg_advisory_xact_lock(71040001);
  select line_open into v_open from game_settings where id=1;
  if not coalesce(v_open,false) then raise exception 'LINE_CLOSED'; end if;
  select team_id into v_team_id from participants where id=p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id=v_team_id for update;
  select * into v_part from participants where id=p_participant for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_team.line_group_code is null or v_team.line_group_url is null then raise exception 'LINE_NOT_CONFIGURED'; end if;
  v_already:=v_part.line_joined_at is not null;
  if not v_already then
    update participants set line_joined_at=clock_timestamp() where id=p_participant returning * into v_part;
  end if;
  select count(*),count(*) filter(where line_joined_at is not null) into v_total,v_joined
    from participants where team_id=v_team.id and not is_observer;
  if not v_part.is_observer and v_total>0 and v_total=v_joined and v_team.line_completed_at is null then
    select coalesce(max(line_finish_rank),0)+1 into v_rank from teams;
    if v_rank>4 then raise exception 'BAD_LINE_GROUP'; end if;
    v_tokens:=25-5*v_rank;
    insert into token_ledger(team_id,participant_id,kind,amount,reason,idempotency_key,created_by)
    values(v_team.id,p_participant,'adjustment',v_tokens,'LINE group '||v_team.line_group_code||' complete, rank '||v_rank,'line:'||v_team.id::text,'system');
    update teams set line_completed_at=clock_timestamp(),line_finish_rank=v_rank,line_reward_tokens=v_tokens
      where id=v_team.id returning * into v_team;
    insert into audit_log(actor,action,details) values('system','line.complete',
      jsonb_build_object('team_id',v_team.id,'group',v_team.line_group_code,'rank',v_rank,'tokens',v_tokens));
  end if;
  return jsonb_build_object('url',v_team.line_group_url,'already',v_already,'joinedAt',v_part.line_joined_at,
    'total',v_total,'joinedCount',v_joined,'complete',v_total>0 and v_total=v_joined,
    'rewardPreviouslyEarned',v_team.line_completed_at is not null,'rank',v_team.line_finish_rank,
    'tokens',v_team.line_reward_tokens,'balance',team_balance(v_team.id),
    'revision',v_team.line_revision,'isObserver',v_part.is_observer);
end $$;

-- Fixed weekly mission reward. Success is verified against persisted server
-- state, never the caller's token number or claimed success. Prior rewards,
-- including historical best-score credits, are respected and never rewritten.
create or replace function public.mg_finish(p_attempt uuid,p_tokens int,p_result jsonb)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  a minigame_attempts%rowtype; v_part participants%rowtype; v_team uuid;
  v_reward int; v_success boolean:=false; v_claimed boolean; v_awarded int:=0;
  v_previous int; v_result jsonb; v_new_tokens int:=0; v_found int; v_completed_at timestamptz;
begin
  perform pg_advisory_xact_lock(71040001);
  select * into a from minigame_attempts where id=p_attempt;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform assert_competitor(a.participant_id);
  select * into v_part from participants where id=a.participant_id;
  v_team:=v_part.team_id;
  perform 1 from teams where id=v_team for update;
  select * into a from minigame_attempts where id=p_attempt for update;
  if a.finished_at is not null then
    return jsonb_build_object('tokens',a.tokens,'awarded',0,'already',true,'result',a.result,
      'claimed',coalesce((a.result->>'success')::boolean,false) or exists(
        select 1 from token_ledger where participant_id=a.participant_id and kind='minigame' and reason=a.game
      ));
  end if;
  select case a.game when 'spot' then mg_spot_tokens when 'memory' then mg_memory_tokens else mg_mystery_tokens end
    into v_reward from game_settings where id=1;
  v_reward:=coalesce(v_reward,0);
  if a.game='spot' then
    v_completed_at:=coalesce((a.state->>'completedAt')::timestamptz,clock_timestamp());
    select count(distinct value::text)::int into v_found from jsonb_array_elements(coalesce(a.state->'found','[]'::jsonb));
    v_success:=v_found=5 and jsonb_array_length(coalesce(a.state->'found','[]'::jsonb))=5
      and not exists(select 1 from jsonb_array_elements(coalesce(a.state->'found','[]'::jsonb)) v where (v.value::text)::int not between 0 and 4)
      and v_completed_at>=a.started_at and v_completed_at<=clock_timestamp()
      and extract(epoch from v_completed_at-a.started_at)+coalesce((a.state->>'misses')::int,0)*3<=184;
  elsif a.game='memory' then
    v_success:=jsonb_array_length(coalesce(a.state->'layout','[]'::jsonb))=12
      and jsonb_array_length(coalesce(a.state->'matched','[]'::jsonb))=12
      and (select count(distinct value::text) from jsonb_array_elements(coalesce(a.state->'matched','[]'::jsonb)))=12
      and not exists(select 1 from jsonb_array_elements(coalesce(a.state->'matched','[]'::jsonb)) v where (v.value::text)::int not between 0 and 11);
  elsif a.game='mystery' then
    v_success:=coalesce((a.state->>'idx')::int,0)>=5 and coalesce((a.state->>'right')::int,0)=5
      and jsonb_array_length(coalesce(a.state->'rounds','[]'::jsonb))=5
      and jsonb_array_length(coalesce(a.state->'got','[]'::jsonb))=5
      and not exists(select 1 from jsonb_array_elements(coalesce(a.state->'got','[]'::jsonb)) v where (v.value::text)::numeric<=0);
  end if;
  select exists(
    select 1 from token_ledger where participant_id=a.participant_id and kind='minigame'
      and ((reason=a.game and amount>0) or idempotency_key='weekly:'||a.participant_id::text||':'||a.game)
  ) or exists(
    select 1 from minigame_attempts where participant_id=a.participant_id and game=a.game and finished_at is not null
      and result->>'fixedReward'='true' and result->>'success'='true'
  ) into v_claimed;
  select coalesce(max(tokens),0) into v_previous from minigame_attempts
    where participant_id=a.participant_id and game=a.game and finished_at is not null;
  if v_success and not v_claimed then
    -- A zero-token success also consumes its once-per-game entitlement.
    insert into token_ledger(team_id,participant_id,kind,amount,reason,idempotency_key,created_by)
      values(v_team,a.participant_id,'minigame',v_reward,a.game,'weekly:'||a.participant_id::text||':'||a.game,'player');
    v_awarded:=v_reward;
    v_new_tokens:=v_reward;
  end if;
  v_result:=case when jsonb_typeof(p_result)='object' then p_result else '{}'::jsonb end
    ||jsonb_build_object('success',v_success,'fixedReward',true,'rewardTokens',v_reward,'alreadyClaimed',v_claimed);
  update minigame_attempts set finished_at=clock_timestamp(),tokens=v_new_tokens,result=v_result where id=a.id;
  return jsonb_build_object('tokens',v_new_tokens,'awarded',v_awarded,'best',greatest(v_previous,v_new_tokens),
    'already',false,'claimed',v_claimed or v_success,'result',v_result);
end $$;

-- Team leaders can prepare their own Squads before hunt/puzzle scoring starts.
-- Membership changes after group progress would let a person double-claim spots.
create or replace function public.leader_manage_squad(p_actor uuid,p_action text,p_name text,p_member uuid,p_squad uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor participants%rowtype; v_member participants%rowtype; v_squad squads%rowtype; v_name text:=btrim(coalesce(p_name,''));
begin
  perform pg_advisory_xact_lock(71040001);
  select * into v_actor from participants where id=p_actor;
  if not found then raise exception 'NOT_FOUND'; end if;
  if v_actor.is_observer then raise exception 'OBSERVER_READ_ONLY'; end if;
  if not v_actor.is_leader then raise exception 'NOT_LEADER'; end if;
  perform 1 from teams where id=v_actor.team_id for update;
  if p_action='create' then
    if char_length(v_name) not between 1 and 60 or v_name ~ '[[:cntrl:]]' then raise exception 'BAD_INPUT'; end if;
    select * into v_squad from squads where team_id=v_actor.team_id and lower(name)=lower(v_name) order by id limit 1;
    if not found then insert into squads(team_id,name) values(v_actor.team_id,v_name) returning * into v_squad; end if;
    return jsonb_build_object('ok',true,'squad',jsonb_build_object('id',v_squad.id,'name',v_squad.name));
  elsif p_action='assign' then
    select * into v_member from participants where id=p_member and team_id=v_actor.team_id for update;
    if not found then raise exception 'FORBIDDEN'; end if;
    if v_member.is_observer then raise exception 'OBSERVER_READ_ONLY'; end if;
    if p_squad is not null then
      select * into v_squad from squads where id=p_squad and team_id=v_actor.team_id;
      if not found then raise exception 'SQUAD_NOT_FOUND'; end if;
    end if;
    if v_member.squad_id is not distinct from p_squad then return jsonb_build_object('ok',true,'already',true); end if;
    if exists(select 1 from hunt_claims where team_id=v_actor.team_id)
      or exists(select 1 from hunt_scans where team_id=v_actor.team_id)
      or exists(select 1 from puzzle_attempts where team_id=v_actor.team_id)
      or exists(select 1 from puzzle_solves where team_id=v_actor.team_id)
    then raise exception 'SQUAD_LOCKED'; end if;
    update participants set squad_id=p_squad where id=p_member;
    return jsonb_build_object('ok',true,'already',false);
  end if;
  raise exception 'BAD_INPUT';
end $$;

revoke all on function public.assert_competitor(uuid),public.guard_competitor_activity(),
  public.configure_line_group_details(uuid,text,text,text),public.leader_manage_squad(uuid,text,text,uuid,uuid),
  public.start_participant(uuid),public.submit_answer(uuid,uuid,int),public.complete_quiz(uuid),
  public.claim_spot(uuid,text),public.submit_puzzle(uuid,uuid,int),public.submit_photo(uuid,uuid,text),
  public.review_photo(uuid,boolean,text,text),public.join_line_group(uuid),public.mg_finish(uuid,int,jsonb)
  from public,anon,authenticated;
grant execute on function public.assert_competitor(uuid),public.guard_competitor_activity(),
  public.configure_line_group_details(uuid,text,text,text),public.leader_manage_squad(uuid,text,text,uuid,uuid),
  public.start_participant(uuid),public.submit_answer(uuid,uuid,int),public.complete_quiz(uuid),
  public.claim_spot(uuid,text),public.submit_puzzle(uuid,uuid,int),public.submit_photo(uuid,uuid,text),
  public.review_photo(uuid,boolean,text,text),public.join_line_group(uuid),public.mg_finish(uuid,int,jsonb)
  to service_role;

commit;

-- ===== notification bell (supabase/notify.sql) =====
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
