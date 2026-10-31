import 'server-only';
import { db } from './supabase';

/** Members of the player's group: their squad, or the whole team when they have no squad. Ordered by id (stable). */
export async function groupMembers(p: { id: string; team_id: string; squad_id: string | null }) {
  let q = db().from('participants').select('id, name').eq('team_id', p.team_id);
  q = p.squad_id ? q.eq('squad_id', p.squad_id) : q.is('squad_id', null);
  const { data, error } = await q.order('id');
  if (error) throw error;
  return (data ?? []) as { id: string; name: string }[];
}

/**
 * Which clues does member #i of n hold, out of c clues? Every clue is held by someone, and a small group
 * (n < c) holds several clues each:
 *   n >= c : member i holds clue (i % c)         -> several members share a clue
 *   n <  c : member i holds clues j where j % n == i
 */
export function cluesFor(i: number, n: number, c: number): number[] {
  const out: number[] = [];
  for (let j = 0; j < c; j++) if (n >= c ? i % c === j : j % n === i) out.push(j);
  return out;
}
