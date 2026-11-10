import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** The assigned team's roster, LINE progress, and leader-only squad controls. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const [people, squads] = await Promise.all([
    // Internal wildcard lets the read continue before the optional observer migration is applied.
    sb.from('participants').select('*').eq('team_id', p.team_id),
    sb.from('squads').select('id, name').eq('team_id', p.team_id).order('name'),
  ]);
  if (people.error) throw people.error;
  if (squads.error) throw squads.error;
  const squadRows = squads.data ?? [];
  const squadName = new Map(squadRows.map((s: any) => [s.id, s.name]));
  const members = (people.data ?? []).map((m: any) => ({
    id: m.id,
    name: m.nick_name || m.name,
    isObserver: !!m.is_observer,
    isLeader: !!m.is_leader && !m.is_observer,
    isMe: m.id === p.id,
    squadId: m.is_observer ? null : m.squad_id ?? null,
    squad: !m.is_observer && m.squad_id ? squadName.get(m.squad_id) ?? null : null,
    lineJoined: !!m.line_joined_at,
    quizDone: !m.is_observer && m.status === 'completed',
    avatarUrl: m.avatar_url ?? null,
    avatarEmoji: m.avatar_emoji ?? null,
  }));
  members.sort((a: any, b: any) => Number(a.isObserver) - Number(b.isObserver) || Number(b.isLeader) - Number(a.isLeader)
    || (a.squad ?? '~').localeCompare(b.squad ?? '~', 'th') || a.name.localeCompare(b.name, 'th'));
  const eligible = members.filter((m: any) => !m.isObserver);
  const joined = eligible.filter((m: any) => m.lineJoined).length;
  const missing = eligible.length - joined;
  return ok({
    team: p.teams?.name ?? '',
    total: eligible.length,
    observerTotal: members.length - eligible.length,
    quizDone: eligible.filter((m: any) => m.quizDone).length,
    line: { joined, total: eligible.length, missing, missingPct: eligible.length ? Math.ceil(missing * 1000 / eligible.length) / 10 : 0 },
    canManageSquads: !!p.is_leader && !p.is_observer,
    squadOptions: squadRows.map((s: any) => ({ id: s.id, name: s.name })),
    squads: squadRows.map((s: any) => s.name),
    members,
  });
});
