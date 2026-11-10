import { db } from '@/lib/supabase';
import { requireMember } from '@/lib/player';
import { checkOrigin, handler, ok, readJson } from '@/lib/http';

/** Idempotent: re-sending the same answer returns the stored result and never re-scores. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requireMember();
  const body = await readJson<{ questionId?: string; selected?: number }>(req);
  const { data, error } = await db().rpc('submit_answer', {
    p_participant: p.id,
    p_question: body.questionId,
    p_selected: body.selected,
  });
  if (error) throw error;
  return ok({
    isCorrect: data.is_correct,
    correctIndex: data.correct_index,
    selected: data.selected,
    answered: data.answered,
    total: data.total,
  });
});
