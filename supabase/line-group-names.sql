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
