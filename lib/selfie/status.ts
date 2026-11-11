import 'server-only';
import { db } from '../supabase';
import { SELFIE_SETTINGS_SELECT, publicSettings } from './settings';

export type SelfieMember = { id: string; name: string; fullName: string; isMe: boolean; isObserver: boolean; photoUrl: string | null; at: string | null };

/** Everything the selfie-wall screen needs for one player: settings, the team wall, the finishing order of all teams. */
export async function selfieStatus(p: { id: string; team_id: string; is_observer?: boolean }) {
  const sb = db();
  const [settings, team, people, photos, ranks] = await Promise.all([
    sb.from('game_settings').select(SELFIE_SETTINGS_SELECT).eq('id', 1).single(),
    sb.from('teams').select('id, name, selfie_completed_at, selfie_finish_rank, selfie_reward_tokens').eq('id', p.team_id).single(),
    sb.from('participants').select('id, name, nick_name, is_observer').eq('team_id', p.team_id).order('is_observer').order('name').order('id'),
    sb.from('selfie_photos').select('participant_id, image_url, created_at').eq('team_id', p.team_id),
    sb.from('teams').select('name, selfie_finish_rank, selfie_reward_tokens, selfie_completed_at').not('selfie_finish_rank', 'is', null).order('selfie_finish_rank'),
  ]);
  if (settings.error) throw settings.error;
  if (team.error) throw team.error;
  if (people.error) throw people.error;
  const s = publicSettings(settings.data);
  const photoOf = new Map((photos.data ?? []).map((x: any) => [x.participant_id, x]));
  const members: SelfieMember[] = (people.data ?? []).map((m: any) => {
    const ph: any = photoOf.get(m.id);
    return { id: m.id, name: m.nick_name || m.name, fullName: m.name, isMe: m.id === p.id, isObserver: !!m.is_observer, photoUrl: ph?.image_url ?? null, at: ph?.created_at ?? null };
  });
  const competing = members.filter((m) => !m.isObserver);
  const count = competing.filter((m) => m.photoUrl).length;
  const total = competing.length;
  const taken = (ranks.data ?? []).length;
  const complete = !!team.data.selfie_completed_at;
  const nextReward = complete ? 0 : (s.rewards[taken] ?? 0);
  return {
    settings: s,
    team: {
      name: team.data.name, members, count, total, pct: total ? Math.round((count / total) * 100) : 0,
      complete, rank: team.data.selfie_finish_rank, tokens: team.data.selfie_reward_tokens ?? 0, completedAt: team.data.selfie_completed_at,
    },
    me: { isObserver: !!p.is_observer, photoUrl: photoOf.get(p.id)?.image_url ?? null },
    nextReward, nextRank: complete ? null : taken + 1,
    standings: (ranks.data ?? []).map((t: any) => ({ team: t.name, rank: t.selfie_finish_rank, tokens: t.selfie_reward_tokens, at: t.selfie_completed_at })),
  };
}
