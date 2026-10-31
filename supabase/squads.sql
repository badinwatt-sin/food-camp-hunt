-- =====================================================================
-- Squads + team goal (run AFTER schema.sql / hunt.sql). Idempotent.
-- schema.sql already includes this for NEW projects; run this file once on an
-- EXISTING project that already has hunt.sql applied.
--
--  * Squad = small group (4-5 people) inside a team. Each SQUAD can claim each
--    hunt spot once; the tokens still go to the shared TEAM wallet.
--    People with no squad behave as before (the team claims each spot once).
--  * Team goal = % of team members who finished the quiz. Market items flagged
--    requires_goal stay locked until the team reaches that %. 0 = goal off.
-- =====================================================================

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
