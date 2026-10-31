-- =====================================================================
-- Team photo missions (replaces the clue-splitting puzzles). Idempotent.
-- schema.sql already includes this for NEW projects; run this file once on an EXISTING project.
--
-- Admin defines photo challenges (e.g. a person, an object, a dish). The whole team takes the photo together;
-- ONLY the team leader can upload it. The mission succeeds when the leader uploads, and the team wallet is credited.
-- Staff may reject a bad photo: the tokens are taken back and the team can upload again.
-- Uses the existing game_settings.puzzle_open switch ("ภารกิจทีม") and ledger kind 'puzzle'.
-- =====================================================================
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
  status          text not null default 'approved' check (status in ('approved','rejected')),
  tokens          int  not null,
  rejected_by     text,
  rejected_reason text,
  created_at      timestamptz not null default now()
);
-- A team can have only ONE accepted photo per mission (a rejected one can be replaced).
create unique index if not exists photo_one_approved_per_team
  on public.photo_submissions(mission_id, team_id) where status = 'approved';

create or replace function public.submit_photo(p_participant uuid, p_mission uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_part participants%rowtype; v_team teams%rowtype; v_m photo_missions%rowtype;
  v_open boolean; v_ex photo_submissions%rowtype; v_id uuid;
begin
  select * into v_part from participants where id = p_participant;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_part.team_id for update;   -- serialises the team
  if not v_part.is_leader then raise exception 'NOT_LEADER'; end if;
  if p_url is null or length(p_url) < 8 then raise exception 'BAD_INPUT'; end if;
  select * into v_m from photo_missions where id = p_mission and active;
  if not found then raise exception 'BAD_INPUT'; end if;

  select * into v_ex from photo_submissions where mission_id = p_mission and team_id = v_part.team_id and status = 'approved';
  if found then
    return jsonb_build_object('already', true, 'tokens', v_ex.tokens, 'balance', team_balance(v_part.team_id));
  end if;

  select puzzle_open into v_open from game_settings where id = 1;
  if not v_open then raise exception 'PUZZLE_CLOSED'; end if;

  insert into photo_submissions (mission_id, team_id, participant_id, image_url, tokens)
  values (p_mission, v_part.team_id, p_participant, p_url, v_m.tokens) returning id into v_id;

  insert into token_ledger (team_id, participant_id, kind, amount, reason, idempotency_key, created_by)
  values (v_part.team_id, p_participant, 'puzzle', v_m.tokens, 'Photo: ' || left(v_m.title, 60), 'photo:' || v_id, 'system');

  return jsonb_build_object('already', false, 'tokens', v_m.tokens, 'balance', team_balance(v_part.team_id), 'submission_id', v_id);
end $$;

create or replace function public.reject_photo(p_submission uuid, p_reason text, p_actor text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_s photo_submissions%rowtype; v_team teams%rowtype; v_title text;
begin
  select * into v_s from photo_submissions where id = p_submission;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into v_team from teams where id = v_s.team_id for update;
  select * into v_s from photo_submissions where id = p_submission;     -- re-read under the lock
  if v_s.status <> 'approved' then
    return jsonb_build_object('already', true, 'balance', team_balance(v_s.team_id));
  end if;
  select title into v_title from photo_missions where id = v_s.mission_id;
  update photo_submissions set status = 'rejected', rejected_by = p_actor, rejected_reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = p_submission;
  if v_s.tokens > 0 then
    insert into token_ledger (team_id, kind, amount, reason, idempotency_key, created_by)
    values (v_s.team_id, 'adjustment', -v_s.tokens, 'Photo rejected: ' || left(coalesce(v_title, ''), 60), 'photo-reject:' || p_submission, p_actor);
  end if;
  insert into audit_log (actor, action, details)
  values (p_actor, 'photo.reject', jsonb_build_object('submission', p_submission, 'team_id', v_s.team_id, 'tokens', v_s.tokens));
  return jsonb_build_object('already', false, 'balance', team_balance(v_s.team_id));
end $$;

alter table public.photo_missions   enable row level security;
alter table public.photo_submissions enable row level security;
revoke all on public.photo_missions, public.photo_submissions from anon, authenticated;
revoke all on function public.submit_photo(uuid, uuid, text), public.reject_photo(uuid, text, text) from public, anon, authenticated;
grant all on public.photo_missions, public.photo_submissions to service_role;
grant execute on function public.submit_photo(uuid, uuid, text), public.reject_photo(uuid, text, text) to service_role;

insert into storage.buckets (id, name, public)
values ('mission-photos', 'mission-photos', true)
on conflict (id) do nothing;
