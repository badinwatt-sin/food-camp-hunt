-- =====================================================================
-- Team leaders redeem for their team + pickup tracking. Idempotent.
-- schema.sql already includes this for NEW projects; run this file once on an EXISTING project.
--  * participants.is_leader : exactly one leader per team at most (enforced by a unique index)
--  * game_settings.market_open : switch that lets leaders redeem from their phone (default closed)
--  * redemptions.fulfilled_at/by : set when staff hand the goods over ("เบิกจริง")
-- =====================================================================
alter table public.participants add column if not exists is_leader boolean not null default false;
create unique index if not exists participants_one_leader_per_team
  on public.participants(team_id) where is_leader;

alter table public.game_settings add column if not exists market_open boolean not null default false;

alter table public.redemptions add column if not exists fulfilled_at timestamptz;
alter table public.redemptions add column if not exists fulfilled_by text;
