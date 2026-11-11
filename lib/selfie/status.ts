import 'server-only';
import { db } from '../supabase';
import { SELFIE_SETTINGS_SELECT, publicSettings, selfieEligible } from './settings';

export type SelfieMember = { id: string; name: string; fullName: string; isMe: boolean; isObserver: boolean; photoUrl: string | null; at: string | null };
export const JUDGE_WALL_NAME = 'ทีมกรรมการ (ทดสอบ)';

/**
 * Everything the selfie-wall screen needs for one player.
 * - normal phase: the player's team wall in the TEAM's own colour, rewards and standings.
 * - judges phase: only observers may look; the wall is all the observers together, in the default colour,
 *   with no tokens, no ranks and no standings (a rehearsal, nothing is scored).
 * Returns null when this player is not meant to see the mission yet.
 */
export async function selfieStatus(p: { id: string; team_id: string; is_observer?: boolean }) {
  const sb = db();
  const { data: row, error: se } = await sb.from('game_settings').select(SELFIE_SETTINGS_SELECT).eq('id', 1).single();
  if (se) throw se;
  const s = publicSettings(row);
  if (!selfieEligible(s.audience, !!p.is_observer)) return null;
  const test = s.audience === 'judges';

  const [team, people, photos, ranks] = await Promise.all([
    sb.from('teams').select('id, name, selfie_color, selfie_completed_at, selfie_finish_rank, selfie_reward_tokens').eq('id', p.team_id).single(),
    test
      ? sb.from('participants').select('id, name, nick_name, is_observer').eq('is_observer', true).order('name').order('id')
      : sb.from('participants').select('id, name, nick_name, is_observer').eq('team_id', p.team_id).order('is_observer').order('name').order('id'),
    test
      ? sb.from('selfie_photos').select('participant_id, image_url, created_at').eq('is_test', true)
      : sb.from('selfie_photos').select('participant_id, image_url, created_at').eq('team_id', p.team_id).eq('is_test', false),
    sb.from('teams').select('name, selfie_finish_rank, selfie_reward_tokens, selfie_completed_at').not('selfie_finish_rank', 'is', null).order('selfie_finish_rank'),
  ]);
  if (team.error) throw team.error;
  if (people.error) throw people.error;
  const color = test ? s.color : (team.data.selfie_color || s.color);
  const photoOf = new Map((photos.data ?? []).map((x: any) => [x.participant_id, x]));
  const members: SelfieMember[] = (people.data ?? []).map((m: any) => {
    const ph: any = photoOf.get(m.id);
    return { id: m.id, name: m.nick_name || m.name, fullName: m.name, isMe: m.id === p.id, isObserver: !!m.is_observer, photoUrl: ph?.image_url ?? null, at: ph?.created_at ?? null };
  });
  const competing = test ? members : members.filter((m) => !m.isObserver);
  const count = competing.filter((m) => m.photoUrl).length;
  const total = competing.length;
  const taken = (ranks.data ?? []).length;
  const complete = test ? total > 0 && count === total : !!team.data.selfie_completed_at;
  return {
    test,
    settings: { ...s, color },
    team: {
      name: test ? JUDGE_WALL_NAME : team.data.name, members, count, total, pct: total ? Math.round((count / total) * 100) : 0,
      complete, rank: test ? null : team.data.selfie_finish_rank, tokens: test ? 0 : team.data.selfie_reward_tokens ?? 0,
      completedAt: test ? null : team.data.selfie_completed_at,
    },
    me: { isObserver: !!p.is_observer, photoUrl: photoOf.get(p.id)?.image_url ?? null },
    nextReward: test || complete ? 0 : (s.rewards[taken] ?? 0), nextRank: test || complete ? null : taken + 1,
    standings: test ? [] : (ranks.data ?? []).map((t: any) => ({ team: t.name, rank: t.selfie_finish_rank, tokens: t.selfie_reward_tokens, at: t.selfie_completed_at })),
  };
}
