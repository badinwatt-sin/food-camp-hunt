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
