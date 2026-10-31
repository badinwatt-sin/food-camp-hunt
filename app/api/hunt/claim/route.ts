import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { normalizeCode } from '@/lib/codes';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

/** Idempotent: a team earns each spot once, however many times or by whom it is scanned. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requirePlayer();
  rateLimit(req, 'claim', 40, 10 * 60 * 1000, p.id);
  const body = await readJson<{ code?: string }>(req);
  const code = normalizeCode(body.code ?? '');
  if (code.length < 4 || code.length > 40) throw new HttpError(404, 'SPOT_NOT_FOUND');
  const { data, error } = await db().rpc('claim_spot', { p_participant: p.id, p_secret: code });
  if (error) throw error;
  return ok({
    already: data.already, pending: !!data.pending, title: data.title, tokens: data.tokens, balance: data.balance,
    have: data.have ?? 0, need: data.need ?? 0, windowSec: data.window_sec ?? 0,
  });
});
