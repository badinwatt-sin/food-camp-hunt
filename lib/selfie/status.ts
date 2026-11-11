import 'server-only';
import { db } from '../supabase';
import { SELFIE_SETTINGS_SELECT, publicSettings, selfieAccess } from './settings';

export type SelfieMember = { id: string; name: string; fullName: string; isMe: boolean; isObserver: boolean; photoUrl: string | null; at: string | null };
export const JUDGE_WALL_NAME = 'ทีมกรรมการ (ทดสอบ)';
const maxIso = (...v: (string | null | undefined)[]) => v.filter(Boolean).sort().slice(-1)[0] ?? null;

/**
 * Everything the selfie screen needs for one player, or null when this player is not meant to see the mission yet.
 *  - judges phase: only observers (committee/judges); the wall is all the observers together, default colour,
 *    no tokens, no ranks, no standings (a rehearsal; nothing is scored).
 *  - teams / all phase: the player's Team Wall in the TEAM's own colour with rewards and standings.
 *    Observers may look (read-only) but are never ON a real wall, never counted and never notified.
 */
export async function selfieStatus(p: { id: string; team_id: string; is_observer?: boolean }) {
  const sb = db();
  const { data: row, error: se } = await sb.from('game_settings').select(SELFIE_SETTINGS_SELECT).eq('id', 1).single();
  if (se) throw se;
  const s = publicSettings(row);
  const { data: team, error: te } = await sb.from('teams')
    .select('id, name, selfie_color, selfie_active, selfie_excluded, selfie_started_at, selfie_completed_at, selfie_finish_rank, selfie_reward_tokens').eq('id', p.team_id).single();
  if (te) throw te;
  const judge = !!p.is_observer || !!team.selfie_excluded;   // a committee / test team counts as judges as a whole
  // a committee / test team has no real wall: in the real phases it simply sees nothing
  if (s.audience !== 'judges' && team.selfie_excluded) return null;
  const access = selfieAccess(s.audience, judge, !!team.selfie_active);
  if (!access.eligible) return null;
  const test = access.test;

  // judges' wall = every observer + every member of a committee / test team
  let judgeRows: any[] = [];
  if (test) {
    const { data: ex } = await sb.from('teams').select('id').eq('selfie_excluded', true);
    const exIds = (ex ?? []).map((t: any) => t.id);
    const [obs, inEx] = await Promise.all([
      sb.from('participants').select('id, name, nick_name, is_observer').eq('is_observer', true),
      exIds.length ? sb.from('participants').select('id, name, nick_name, is_observer').in('team_id', exIds) : Promise.resolve({ data: [] as any[], error: null }),
    ]);
    if (obs.error) throw obs.error;
    const seen = new Set<string>();
    judgeRows = [...(obs.data ?? []), ...(inEx.data ?? [])].filter((m: any) => (seen.has(m.id) ? false : (seen.add(m.id), true))).sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'th'));
  }
  const [people, photos, ranks, rej] = await Promise.all([
    test
      ? Promise.resolve({ data: judgeRows, error: null })
      : sb.from('participants').select('id, name, nick_name, is_observer').eq('team_id', p.team_id).eq('is_observer', false).order('name').order('id'),
    test
      ? sb.from('selfie_photos').select('participant_id, image_url, created_at').eq('is_test', true)
      : sb.from('selfie_photos').select('participant_id, image_url, created_at').eq('team_id', p.team_id).eq('is_test', false),
    sb.from('teams').select('name, selfie_finish_rank, selfie_reward_tokens, selfie_completed_at').not('selfie_finish_rank', 'is', null).order('selfie_finish_rank'),
    sb.from('selfie_rejections').select('id, reason, created_at').eq('participant_id', p.id).order('created_at', { ascending: false }).limit(1),
  ]);
  if (people.error) throw people.error;
  const color = test ? s.color : (team.selfie_color || s.color);
  const photoOf = new Map((photos.data ?? []).map((x: any) => [x.participant_id, x]));
  const members: SelfieMember[] = (people.data ?? []).map((m: any) => {
    const ph: any = photoOf.get(m.id);
    return { id: m.id, name: m.nick_name || m.name, fullName: m.name, isMe: m.id === p.id, isObserver: test ? true : !!m.is_observer, photoUrl: ph?.image_url ?? null, at: ph?.created_at ?? null };
  });
  const count = members.filter((m) => m.photoUrl).length;
  const total = members.length;
  const taken = (ranks.data ?? []).length;
  const complete = test ? total > 0 && count === total : !!team.selfie_completed_at;
  const mine = photoOf.get(p.id) as any;
  const lastRej = (rej.data ?? [])[0] as any;
  // a rejection counts until the player has uploaded something newer
  const rejected = lastRej && (!mine || new Date(mine.created_at) < new Date(lastRej.created_at)) ? { id: lastRej.id, reason: lastRej.reason, at: lastRej.created_at } : null;
  return {
    test,
    settings: { ...s, color, announcedAt: test ? s.announcedAt : s.audience === 'teams' ? maxIso(s.announcedAt, team.selfie_started_at) : s.announcedAt },
    team: {
      name: test ? JUDGE_WALL_NAME : team.name, members, count, total, pct: total ? Math.round((count / total) * 100) : 0,
      complete, rank: test ? null : team.selfie_finish_rank, tokens: test ? 0 : team.selfie_reward_tokens ?? 0,
      completedAt: test ? null : team.selfie_completed_at,
    },
    me: { isObserver: judge, readOnly: access.readOnly, photoUrl: mine?.image_url ?? null, rejected },
    nextReward: test || complete ? 0 : (s.rewards[taken] ?? 0), nextRank: test || complete ? null : taken + 1,
    standings: test ? [] : (ranks.data ?? []).map((t: any) => ({ team: t.name, rank: t.selfie_finish_rank, tokens: t.selfie_reward_tokens, at: t.selfie_completed_at })),
  };
}
