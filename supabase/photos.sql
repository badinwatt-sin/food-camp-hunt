-- =====================================================================
-- Team photo missions with ADMIN REVIEW. Idempotent: safe on a new project and as an upgrade of the first version.
-- schema.sql already includes this for NEW projects; run this file on an EXISTING project.
--
-- Admin defines photo challenges (a person, an object, a dish ...). The whole team takes the photo together and
-- ONLY the team leader can upload it. The upload is "pending": no tokens yet. Staff/admin look at it and press
-- confirm (the team wallet is credited) or reject (no tokens; the leader can upload a new photo).
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
