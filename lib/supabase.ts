import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env';

let client: SupabaseClient | null = null;

/** Server-only Supabase client using the service-role key. Never import from client code. */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export async function audit(actor: string, action: string, details: Record<string, unknown> = {}) {
  await db().from('audit_log').insert({ actor, action, details });
}
