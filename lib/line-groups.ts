import 'server-only';
import { db } from './supabase';
import { isLineGroupUrl, type LineStatus } from './line-types';

/** All members count, including people whose login ID has not yet been issued. */
export async function getLineStatus(p: { id: string; team_id: string }): Promise<LineStatus> {
  const sb = db();
  const [settings, team, people] = await Promise.all([
    sb.from('game_settings').select('line_open').eq('id', 1).single(),
    sb.from('teams').select('*').eq('id', p.team_id).single(),
    sb.from('participants').select('id, name, nick_name, line_joined_at').eq('team_id', p.team_id).order('name').order('id'),
  ]);
  if (settings.error) throw settings.error;
  if (team.error) throw team.error;
  if (people.error) throw people.error;
  const open = !!settings.data.line_open;
  const configured = !!team.data.line_group_code && !!team.data.line_group_url && isLineGroupUrl(team.data.line_group_url);
  const me = people.data.find((m) => m.id === p.id);
  return {
    open, configured,
    group: team.data.line_group_code,
    groupName: team.data.line_group_name || team.data.line_group_code || null,
    url: open && configured ? team.data.line_group_url : null,
    joined: !!me?.line_joined_at,
    joinedAt: me?.line_joined_at ?? null,
    total: people.data.length,
    joinedCount: people.data.filter((m) => !!m.line_joined_at).length,
    complete: !!team.data.line_completed_at,
    rank: team.data.line_finish_rank,
    tokens: team.data.line_reward_tokens ?? 0,
    members: people.data.map((m) => ({ name: m.nick_name || m.name, joined: !!m.line_joined_at, isMe: m.id === p.id })),
  };
}
