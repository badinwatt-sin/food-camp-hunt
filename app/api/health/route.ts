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
  return Response.json({ commit: (process.env.VERCEL_GIT_COMMIT_SHA ?? 'local').slice(0, 7), env, database });
}
