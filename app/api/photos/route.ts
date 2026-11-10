import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, HttpError, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Team photo missions: the brief, an optional example picture, and the team's photo with its review status
 * (pending = waiting for staff, approved = tokens given, rejected = try again).
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const { data: settings, error: settingsError } = await sb.from('game_settings').select('puzzle_open').eq('id', 1).single();
  if (settingsError) throw settingsError;
  if (!settings?.puzzle_open) throw new HttpError(403, 'PUZZLE_CLOSED');
  const [{ data: missions }, { data: subs }, { data: leader }] = await Promise.all([
    sb.from('photo_missions').select('id, title, description, category, ref_image_url, tokens').eq('active', true).order('position').order('id'),
    sb.from('photo_submissions').select('id, mission_id, image_url, status, tokens, rejected_reason, created_at, reviewed_at, participants(*)').eq('team_id', p.team_id).order('created_at', { ascending: false }),
    sb.from('participants').select('*').eq('team_id', p.team_id).eq('is_leader', true).maybeSingle(),
  ]);
  // The latest submission per mission decides what the team sees (a rejected one can be followed by a new one).
  const latest = new Map<string, any>();
  for (const x of (subs ?? []) as any[]) if (!x.participants?.is_observer && !latest.has(x.mission_id)) latest.set(x.mission_id, x);
  return ok({
    open: !!settings?.puzzle_open,
    isLeader: !!p.is_leader && !p.is_observer,
    isObserver: !!p.is_observer,
    leaderName: leader && !leader.is_observer ? leader.nick_name || leader.name : null,
    team: p.teams?.name ?? '',
    missions: (missions ?? []).map((m: any) => {
      const x: any = latest.get(m.id);
      return {
        id: m.id, title: m.title, description: m.description, category: m.category, refImageUrl: m.ref_image_url, tokens: m.tokens,
        submission: x ? {
          status: x.status, url: x.image_url, tokens: x.tokens, reason: x.rejected_reason ?? null, at: x.created_at, reviewedAt: x.reviewed_at,
          by: x.participants?.nick_name || x.participants?.name || '',
        } : null,
      };
    }),
  });
});
