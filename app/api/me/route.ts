import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';
import { teamGoal } from '@/lib/goal';

export const dynamic = 'force-dynamic';

/** Everything the player screen needs. The correct answer is never included here. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();

  const [{ data: settings }, { data: questions }, { data: answers }, balance, { data: reds }, { data: items }, goal, { data: leaderRow }] =
    await Promise.all([
      sb.from('game_settings').select('is_open, tokens_per_correct, market_open').eq('id', 1).single(),
      sb.from('questions').select('id, position, prompt, image_url, options').eq('active', true).order('position').order('id'),
      sb.from('answers').select('question_id').eq('participant_id', p.id),
      sb.rpc('team_balance', { p_team: p.team_id }),
      sb.from('redemptions').select('item_id, item_name, quantity, total_cost, created_at, fulfilled_at, market_items(image_url)').eq('team_id', p.team_id).order('created_at', { ascending: false }).limit(500),
      sb.from('market_items').select('id, name, category, price, stock, requires_goal, image_url').eq('active', true).order('price'),
      teamGoal(p.team_id),
      sb.from('participants').select('name, nick_name').eq('team_id', p.team_id).eq('is_leader', true).maybeSingle(),
    ]);

  // Team inventory: everything the team has bought, with what is still waiting to be handed over.
  const inv = new Map<string, any>();
  for (const r of (reds ?? []) as any[]) {
    const it = inv.get(r.item_name) ?? { item: r.item_name, image_url: r.market_items?.image_url ?? null, qty: 0, handed: 0, spent: 0, last: r.created_at };
    it.qty += r.quantity; it.spent += r.total_cost; if (r.fulfilled_at) it.handed += r.quantity;
    if (r.created_at > it.last) it.last = r.created_at;
    inv.set(r.item_name, it);
  }

  const qs = questions ?? [];
  const answeredIds = new Set((answers ?? []).map((a: any) => a.question_id));
  const answered = qs.filter((q: any) => answeredIds.has(q.id)).length;
  const next = qs.find((q: any) => !answeredIds.has(q.id)) ?? null;

  return ok({
    participant: { name: p.nick_name || p.name, fullName: p.name, status: p.status },
    team: { name: p.teams?.name ?? '', balance: balance.data ?? 0 },
    squad: p.squads?.name ?? null,
    goal,
    game: { open: !!settings?.is_open, tokensPerCorrect: settings?.tokens_per_correct ?? 10 },
    total: qs.length,
    answered,
    current: p.status === 'in_progress' && next ? next : null,
    result: p.status === 'completed' ? { correct: p.correct_count, tokens: p.tokens_earned } : null,
    isLeader: !!p.is_leader,
    leaderName: leaderRow ? (leaderRow.nick_name || leaderRow.name) : null,
    marketOpen: !!settings?.market_open,
    inventory: Array.from(inv.values()).sort((a, b) => (a.last < b.last ? 1 : -1)).map((i) => ({ item: i.item, image_url: i.image_url, qty: i.qty, handed: i.handed, pending: i.qty - i.handed, spent: i.spent })),
    history: (reds ?? []).slice(0, 50).map((r: any) => ({ item: r.item_name, qty: r.quantity, cost: r.total_cost, at: r.created_at })),
    market: items ?? [],
  });
});
