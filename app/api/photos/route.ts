import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Team photo missions: the brief, an optional example picture, and whether the team has already succeeded. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const [{ data: settings }, { data: missions }, { data: subs }, { data: leader }] = await Promise.all([
    sb.from('game_settings').select('puzzle_open').eq('id', 1).single(),
    sb.from('photo_missions').select('id, title, description, category, ref_image_url, tokens').eq('active', true).order('position').order('id'),
    sb.from('photo_submissions').select('mission_id, image_url, created_at, participants(name, nick_name)').eq('team_id', p.team_id).eq('status', 'approved'),
    sb.from('participants').select('name, nick_name').eq('team_id', p.team_id).eq('is_leader', true).maybeSingle(),
  ]);
  const done = new Map((subs ?? []).map((x: any) => [x.mission_id, x]));
  return ok({
    open: !!settings?.puzzle_open,
    isLeader: !!p.is_leader,
    leaderName: leader ? leader.nick_name || leader.name : null,
    team: p.teams?.name ?? '',
    missions: (missions ?? []).map((m: any) => {
      const d: any = done.get(m.id);
      return {
        id: m.id, title: m.title, description: m.description, category: m.category, refImageUrl: m.ref_image_url, tokens: m.tokens,
        done: d ? { url: d.image_url, by: d.participants?.nick_name || d.participants?.name || '', at: d.created_at } : null,
      };
    }),
  });
});
