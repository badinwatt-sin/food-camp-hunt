import 'server-only';
import { db } from './supabase';
import { isLineGroupUrl, type LineStatus } from './line-types';

/** Eligible members count, including people whose login ID has not yet been issued. Activity staff do not. */
export async function getLineStatus(p: { id: string; team_id: string }): Promise<LineStatus> {
  const sb = db();
  const [settings, team, people, ranks] = await Promise.all([
    sb.from('game_settings').select('line_open').eq('id', 1).single(),
    sb.from('teams').select('*').eq('id', p.team_id).single(),
    sb.from('participants').select('*').eq('team_id', p.team_id).order('name').order('id'),
    sb.from('teams').select('line_finish_rank'),
  ]);
  if (settings.error) throw settings.error;
  if (team.error) throw team.error;
  if (people.error) throw people.error;
  if (ranks.error) throw ranks.error;
  const open = !!settings.data.line_open;
  const configured = !!team.data.line_group_code && !!team.data.line_group_url && isLineGroupUrl(team.data.line_group_url);
  const me = people.data.find((m) => m.id === p.id);
  const eligible = people.data.filter((m) => !m.is_observer);
  const joinedCount = eligible.filter((m) => !!m.line_joined_at).length;
  const revision = Number(team.data.line_revision) || 1;
  const highestRank = Math.max(0, ...(Array.isArray(ranks.data) ? ranks.data : []).map((t) => Number(t.line_finish_rank) || 0));
  const alreadyRewarded = !!team.data.line_completed_at;
  return {
    open, configured,
    group: team.data.line_group_code,
    groupName: team.data.line_group_name || team.data.line_group_code || null,
    url: open && configured ? team.data.line_group_url : null,
    joined: !!me?.line_joined_at,
    joinedAt: me?.line_joined_at ?? null,
    revision,
    rejoinRequired: revision > 1 && !me?.line_joined_at,
    isObserver: !!me?.is_observer,
    nextRewardTokens: alreadyRewarded ? 0 : Math.max(0, 20 - highestRank * 5),
    rewardPreviouslyEarned: alreadyRewarded,
    total: eligible.length,
    joinedCount,
    complete: eligible.length > 0 && joinedCount === eligible.length,
    rank: team.data.line_finish_rank,
    tokens: team.data.line_reward_tokens ?? 0,
    members: eligible.map((m) => ({ name: m.nick_name || m.name, joined: !!m.line_joined_at, isMe: m.id === p.id })),
  };
}
