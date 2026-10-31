import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { checkOrigin, handler, ok } from '@/lib/http';

/** Idempotent: credits the team wallet exactly once, however many times it is called. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requirePlayer();
  const sb = db();
  const { data, error } = await sb.rpc('complete_quiz', { p_participant: p.id });
  if (error) throw error;
  const balance = await sb.rpc('team_balance', { p_team: p.team_id });
  return ok({ correct: data.correct_count, tokens: data.tokens, teamBalance: balance.data ?? 0 });
});
