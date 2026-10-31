import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Lightweight poll (one query): photo missions decided by staff in the last 24 h, so the app can pop up
 * "confirmed +N tokens" / "not accepted" for the whole team. The browser remembers which ones it has already shown.
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sb = db();
  const { data: cs } = await sb.from('game_settings').select('checkin_open, checkin_announced_at').eq('id', 1).single();
  const { data } = await sb.from('photo_submissions')
    .select('id, status, tokens, rejected_reason, reviewed_at, photo_missions(title)')
    .eq('team_id', p.team_id).in('status', ['approved', 'rejected']).gte('reviewed_at', since)
    .order('reviewed_at', { ascending: true }).limit(20);
  return ok({
    // pop-up "you are at the venue? check in with staff" for people who have not checked in yet
    checkin: cs?.checkin_open && !p.checked_in_at ? { announcedAt: cs.checkin_announced_at ?? 'open' } : null,
    photos: (data ?? []).map((x: any) => ({
      id: x.id, status: x.status, tokens: x.tokens, reason: x.rejected_reason ?? null, at: x.reviewed_at, title: x.photo_missions?.title ?? '',
    })),
  });
});
