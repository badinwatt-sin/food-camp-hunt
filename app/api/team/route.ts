import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The player's own team: who is in it and what each person does (leader / squad). Teammates are shown by nick name
 * (full name only as a fallback); nothing about other teams is exposed.
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const [{ data: people }, { data: squads }] = await Promise.all([
    sb.from('participants').select('id, name, nick_name, is_leader, status, squad_id, avatar_url, avatar_emoji').eq('team_id', p.team_id),
    sb.from('squads').select('id, name').eq('team_id', p.team_id).order('name'),
  ]);
  const squadName = new Map((squads ?? []).map((s: any) => [s.id, s.name]));
  const members = (people ?? []).map((m: any) => ({
    name: m.nick_name || m.name,
    isLeader: !!m.is_leader,
    isMe: m.id === p.id,
    squad: m.squad_id ? squadName.get(m.squad_id) ?? null : null,
    quizDone: m.status === 'completed',
    avatarUrl: m.avatar_url ?? null,
    avatarEmoji: m.avatar_emoji ?? null,
  }));
  members.sort((a: any, b: any) => Number(b.isLeader) - Number(a.isLeader) || (a.squad ?? '~').localeCompare(b.squad ?? '~', 'th') || a.name.localeCompare(b.name, 'th'));
  return ok({
    team: p.teams?.name ?? '',
    total: members.length,
    quizDone: members.filter((m: any) => m.quizDone).length,
    squads: (squads ?? []).map((s: any) => s.name),
    members,
  });
});
