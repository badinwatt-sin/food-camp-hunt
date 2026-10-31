import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

/**
 * A team LEADER redeems an item for the team's shared wallet. Same all-or-nothing database function as the
 * staff screen: it locks the team + item, checks balance, stock and the team goal, and the idempotency key makes
 * a retry/double tap harmless (never charged twice).
 */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requirePlayer();
  rateLimit(req, 'redeem', 60, 10 * 60 * 1000, p.id);
  if (!p.is_leader) throw new HttpError(403, 'NOT_LEADER');
  const sb = db();
  const { data: settings } = await sb.from('game_settings').select('market_open').eq('id', 1).single();
  if (!settings?.market_open) throw new HttpError(403, 'MARKET_CLOSED');

  const body = await readJson<{ itemId?: string; qty?: number; key?: string }>(req);
  const qty = Number(body.qty);
  if (!body.itemId || !Number.isInteger(qty) || qty < 1 || qty > 20 || !body.key || String(body.key).length < 8) {
    throw new HttpError(400, 'BAD_INPUT');
  }
  const { data, error } = await sb.rpc('redeem_item', {
    p_team: p.team_id, p_item: body.itemId, p_qty: qty, p_key: String(body.key).slice(0, 100),
    p_actor: `leader:${p.nick_name || p.name}`.slice(0, 80),
  });
  if (error) throw error;
  return ok({ already: !!data.already, totalCost: data.total_cost, balance: data.balance });
});
