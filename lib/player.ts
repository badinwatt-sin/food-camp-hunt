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
    .select('id, name, nick_name, is_leader, avatar_url, avatar_emoji, checked_in_at, team_id, status, session_version, code_hash, correct_count, tokens_earned, squad_id, teams(name), squads(name)')
    .eq('id', s.pid)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.code_hash || data.session_version !== s.v) throw new HttpError(401, 'UNAUTHORIZED');
  return data as any;
}
