import crypto from 'crypto';
import { db } from '@/lib/supabase';
import { requireMember } from '@/lib/player';
import { normalizeCode } from '@/lib/codes';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

const safeEq = (a: string, b: string) =>
  crypto.timingSafeEqual(crypto.createHash('sha256').update(a).digest(), crypto.createHash('sha256').update(b).digest());

/**
 * Event-day check-in. The player scanned the staff QR code (the app got its secret code) and then pressed "confirm".
 * Idempotent: checking in twice keeps the first time.
 */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requireMember();
  rateLimit(req, 'checkin', 20, 10 * 60 * 1000, p.id);
  const body = await readJson<{ code?: string; confirm?: boolean }>(req);
  if (body.confirm !== true) throw new HttpError(400, 'BAD_INPUT'); // the player must press the confirm button
  const sb = db();
  const { data: s } = await sb.from('game_settings').select('checkin_open, checkin_code').eq('id', 1).single();
  if (!s?.checkin_open) throw new HttpError(403, 'CHECKIN_CLOSED');

  const { data: me } = await sb.from('participants').select('checked_in_at').eq('id', p.id).single();
  if (me?.checked_in_at) return ok({ already: true, at: me.checked_in_at });

  const code = normalizeCode(body.code ?? '');
  if (!s.checkin_code || !code || !safeEq(code, normalizeCode(s.checkin_code))) throw new HttpError(400, 'BAD_CHECKIN_CODE');

  const at = new Date().toISOString();
  // only the first check-in is stored, even if two taps race
  await sb.from('participants').update({ checked_in_at: at, checked_in_by: 'self' }).eq('id', p.id).is('checked_in_at', null);
  return ok({ already: false, at });
});
