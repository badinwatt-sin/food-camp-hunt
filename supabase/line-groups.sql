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
  update teams set line_completed_at = null, line_finish_rank = null, line_reward_tokens = 0;
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
