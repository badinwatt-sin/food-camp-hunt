import 'server-only';
import { db } from './supabase';
import { getPlayerSession } from './auth';
import { HttpError } from './http';

/** Loads the logged-in participant and checks the session is still valid (code not revoked/regenerated). */
export async function requirePlayer() {
  const s = await getPlayerSession();
  if (!s) throw new HttpError(401, 'UNAUTHORIZED');
  const { data, error } = await db()
    .from('participants')
    .select('*, teams(name), squads(name)')
    .eq('id', s.pid)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.code_hash || data.session_version !== s.v) throw new HttpError(401, 'UNAUTHORIZED');
  return { ...data, is_observer: !!data.is_observer, is_leader: !!data.is_leader && !data.is_observer } as any;
}

/** Activity staff can observe their assigned team without contributing to its activity state. */
export function ensureMember(player: { is_observer?: boolean }) {
  if (player.is_observer) throw new HttpError(403, 'OBSERVER_READ_ONLY');
}

export async function requireMember() {
  const player = await requirePlayer();
  ensureMember(player);
  return player;
}
