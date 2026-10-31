import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';
import { teamGoal } from '@/lib/goal';

export const dynamic = 'force-dynamic';

/** Everything the player screen needs. The correct answer is never included here. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();

  const [{ data: settings }, { data: questions }, { data: answers }, balance, { data: reds }, { data: items }, goal] =
    await Promise.all([
      sb.from('game_settings').select('is_open, tokens_per_correct').eq('id', 1).single(),
      sb.from('questions').select('id, position, prompt, image_url, options').eq('active', true).order('position').order('id'),
      sb.from('answers').select('question_id').eq('participant_id', p.id),
      sb.rpc('team_balance', { p_team: p.team_id }),
      sb.from('redemptions').select('item_name, quantity, total_cost, created_at').eq('team_id', p.team_id).order('created_at', { ascending: false }).limit(50),
      sb.from('market_items').select('name, category, price, stock, requires_goal').eq('active', true).order('price'),
      teamGoal(p.team_id),
    ]);

  const qs = questions ?? [];
  const answeredIds = new Set((answers ?? []).map((a: any) => a.question_id));
  const answered = qs.filter((q: any) => answeredIds.has(q.id)).length;
  const next = qs.find((q: any) => !answeredIds.has(q.id)) ?? null;

  return ok({
    participant: { name: p.name, status: p.status },
    team: { name: p.teams?.name ?? '', balance: balance.data ?? 0 },
    squad: p.squads?.name ?? null,
    goal,
    game: { open: !!settings?.is_open, tokensPerCorrect: settings?.tokens_per_correct ?? 10 },
    total: qs.length,
    answered,
    current: p.status === 'in_progress' && next ? next : null,
    result: p.status === 'completed' ? { correct: p.correct_count, tokens: p.tokens_earned } : null,
    history: (reds ?? []).map((r: any) => ({ item: r.item_name, qty: r.quantity, cost: r.total_cost, at: r.created_at })),
    market: items ?? [],
  });
});
