import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';
import { SELFIE_SETTINGS_SELECT, publicSettings } from '@/lib/selfie/settings';
import { selfieStatus } from '@/lib/selfie/status';

export const dynamic = 'force-dynamic';

/**
 * Lightweight poll (one query): photo missions decided by staff in the last 24 h, so the app can pop up
 * "confirmed +N tokens" / "not accepted" for the whole team. The browser remembers which ones it has already shown.
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const sb = db();
  const { data: cs } = await sb.from('game_settings').select(`checkin_open, checkin_announced_at, ${SELFIE_SETTINGS_SELECT}`).eq('id', 1).single();
  const sw = publicSettings(cs);
  // pop-up for the selfie wall while it is live and the team is not finished (progress + the tokens still on the table)
  const selfie = sw.live ? await selfieStatus(p).catch(() => null) : null;
  const { data: rej } = await sb.from('selfie_rejections').select('id, reason, created_at').eq('participant_id', p.id).gte('created_at', since).order('created_at', { ascending: true }).limit(5);
  const { data } = await sb.from('photo_submissions')
    .select('id, status, tokens, rejected_reason, reviewed_at, photo_missions(title)')
    .eq('team_id', p.team_id).in('status', ['approved', 'rejected']).gte('reviewed_at', since)
    .order('reviewed_at', { ascending: true }).limit(20);
  return ok({
    // pop-up "you are at the venue? check in with staff" for people who have not checked in yet
    checkin: !p.is_observer && cs?.checkin_open && !p.checked_in_at ? { announcedAt: cs.checkin_announced_at ?? 'open' } : null,
    // committee/judges in the real phases are never notified; only the people who actually play get the pop-up
    selfie: selfie && !selfie.team.complete && !selfie.me.readOnly ? { announcedAt: selfie.settings.announcedAt ?? 'open', pct: selfie.team.pct, count: selfie.team.count, total: selfie.team.total, mine: !!selfie.me.photoUrl, nextReward: selfie.nextReward, end: sw.end, color: selfie.settings.color, percent: sw.percent, test: selfie.test } : null,
    selfieRejected: (rej ?? []).map((x: any) => ({ id: `selfierej:${x.id}`, reason: x.reason, at: x.created_at })),
    photos: (data ?? []).map((x: any) => ({
      id: x.id, status: x.status, tokens: x.tokens, reason: x.rejected_reason ?? null, at: x.reviewed_at, title: x.photo_missions?.title ?? '',
    })),
  });
});
