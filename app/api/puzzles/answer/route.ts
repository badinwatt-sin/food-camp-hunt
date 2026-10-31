import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { checkOrigin, handler, ok, rateLimit, readJson } from '@/lib/http';

/** Submits the squad's answer. Attempts are shared by the whole squad and limited by the database. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  rateLimit(req, 'puzzle', 30, 10 * 60 * 1000);
  const p = await requirePlayer();
  const body = await readJson<{ puzzleId?: string; selected?: number }>(req);
  const { data, error } = await db().rpc('submit_puzzle', {
    p_participant: p.id, p_puzzle: body.puzzleId, p_selected: body.selected,
  });
  if (error) throw error;
  return ok({
    correct: !!data.is_correct, already: !!data.already, tokens: data.tokens,
    left: data.attempts_left ?? 0, balance: data.balance,
  });
});
