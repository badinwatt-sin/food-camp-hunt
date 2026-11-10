import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Older hosted databases reject the unqualified team UPDATE inside this RPC.
 * Keep those deployments usable until their stored function is upgraded.
 * Every fallback write has an explicit filter; never retry unrelated errors.
 */
export async function resetLineForBulk(sb: SupabaseClient): Promise<void> {
  const { error } = await sb.rpc('reset_line_checkin');
  if (!error) return;
  if (!/UPDATE requires a WHERE clause/i.test(error.message ?? '')) throw error;

  // Closing LINE first prevents players from restarting the race between writes.
  const closed = await sb.from('game_settings').update({ line_open: false }).eq('id', 1);
  if (closed.error) throw closed.error;
  const teams = await sb.from('teams')
    .update({ line_completed_at: null, line_finish_rank: null, line_reward_tokens: 0 })
    .not('id', 'is', null);
  if (teams.error) throw teams.error;
  const people = await sb.from('participants').update({ line_joined_at: null })
    .not('line_joined_at', 'is', null);
  if (people.error) throw people.error;
  const ledger = await sb.from('token_ledger').delete()
    .like('idempotency_key', 'line:%').eq('created_by', 'system');
  if (ledger.error) throw ledger.error;
}
