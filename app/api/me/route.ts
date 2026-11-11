import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';
import { teamGoal } from '@/lib/goal';
import { menuAccess, MENU_SETTINGS_SELECT } from '@/lib/menu-access';
import { getLineStatus } from '@/lib/line-groups';
import { selfieStatus } from '@/lib/selfie/status';

export const dynamic = 'force-dynamic';

/** Everything the player screen needs. The correct answer is never included here. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();

  const { data: settings, error: settingsError } = await sb.from('game_settings')
    .select(`${MENU_SETTINGS_SELECT}, tokens_per_correct`).eq('id', 1).single();
  if (settingsError) throw settingsError;
  const menus = menuAccess(settings);

  const [{ data: questions }, { data: answers }, balance, { data: reds }, { data: items }, goal, { data: leaderRow }, line, selfie] =
    await Promise.all([
      sb.from('questions').select(menus.quiz ? 'id, position, prompt, image_url, options' : 'id, position').eq('active', true).order('position').order('id'),
      sb.from('answers').select('question_id').eq('participant_id', p.id),
      sb.rpc('team_balance', { p_team: p.team_id }),
      sb.from('redemptions').select('item_id, item_name, quantity, total_cost, created_at, fulfilled_at, market_items(image_url)').eq('team_id', p.team_id).order('created_at', { ascending: false }).limit(500),
      menus.market ? sb.from('market_items').select('id, name, category, price, stock, requires_goal, image_url').eq('active', true).order('price') : Promise.resolve({ data: [] }),
      teamGoal(p.team_id),
      sb.from('participants').select('*').eq('team_id', p.team_id).eq('is_leader', true).maybeSingle(),
      getLineStatus(p),
      menus.selfie ? selfieStatus(p) : Promise.resolve(null),
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
    isObserver: !!p.is_observer,
    participant: { name: p.nick_name || p.name, fullName: p.name, status: p.status },
    team: { name: p.teams?.name ?? '', balance: balance.data ?? 0 },
    squad: p.squads?.name ?? null,
    goal,
    menus,
    line,
    selfie: selfie ? { live: selfie.settings.live, before: selfie.settings.before, after: selfie.settings.after, start: selfie.settings.start, end: selfie.settings.end, color: selfie.settings.color, percent: selfie.settings.percent, pct: selfie.team.pct, count: selfie.team.count, total: selfie.team.total, complete: selfie.team.complete, rank: selfie.team.rank, tokens: selfie.team.tokens, nextReward: selfie.nextReward, mine: !!selfie.me.photoUrl } : null,
    game: { open: !!settings?.is_open, tokensPerCorrect: settings?.tokens_per_correct ?? 10 },
    total: qs.length,
    answered,
    current: !p.is_observer && menus.quiz && p.status === 'in_progress' && next ? next : null,
    result: !p.is_observer && p.status === 'completed' ? { correct: p.correct_count, tokens: p.tokens_earned } : null,
    avatar: { url: p.avatar_url ?? null, emoji: p.avatar_emoji ?? null },
    checkin: { open: !!settings?.checkin_open, done: !!p.checked_in_at, at: p.checked_in_at ?? null },
    isLeader: !!p.is_leader,
    leaderName: leaderRow && !leaderRow.is_observer ? (leaderRow.nick_name || leaderRow.name) : null,
    marketOpen: !!settings?.market_open,
    inventory: Array.from(inv.values()).sort((a, b) => (a.last < b.last ? 1 : -1)).map((i) => ({ item: i.item, image_url: i.image_url, qty: i.qty, handed: i.handed, pending: i.qty - i.handed, spent: i.spent })),
    history: (reds ?? []).slice(0, 50).map((r: any) => ({ item: r.item_name, qty: r.quantity, cost: r.total_cost, at: r.created_at })),
    market: items ?? [],
  });
});
