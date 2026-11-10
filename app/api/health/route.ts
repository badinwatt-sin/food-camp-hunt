import { db } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Setup check: which settings the server can see (true/false only, never the values),
 * whether the database answers, and which commit is live. Safe to open in a browser.
 */
export async function GET() {
  const names = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SESSION_SECRET', 'CODE_PEPPER', 'ADMIN_PASSWORD', 'STAFF_PASSWORD'];
  const env = Object.fromEntries(names.map((n) => [n, !!process.env[n]?.trim()]));
  let database = 'skipped (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing)';
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const { error } = await db().from('game_settings').select('is_open').eq('id', 1).single();
      database = error ? `error: ${error.message.slice(0, 120)}` : 'ok';
    } catch (e) {
      database = `error: ${String((e as Error).message).slice(0, 120)}`;
    }
  }
  // Read column metadata only; never return participant records or invite URLs.
  let lineNames = { ready: false };
  let line = { ready: false, checks: { settings: false, teams: false, participants: false } };
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const [settings, teams, participants, names] = await Promise.all([
        db().from('game_settings').select('line_open').limit(0),
        db().from('teams').select('line_group_code, line_group_url, line_completed_at, line_finish_rank, line_reward_tokens').limit(0),
        db().from('participants').select('line_joined_at').limit(0),
        db().from('teams').select('line_group_name').limit(0),
      ]);
      lineNames = { ready: !names.error };
      const checks = { settings: !settings.error, teams: !teams.error, participants: !participants.error };
      line = { ready: Object.values(checks).every(Boolean), checks };
    } catch { /* Keep false checks when metadata is unavailable. */ }
  }
  return Response.json({ commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7), env, database, features: { line, lineNames } });
}
