import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * The player's bell: messages from the organisers (everyone), about their own team and just for them, last 3 days.
 * When the admin has switched the bell off for players, nothing is returned and `enabled` is false.
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const { data: st } = await sb.from('game_settings').select('notify_enabled').eq('id', 1).single();
  if ((st as any)?.notify_enabled === false) return ok({ enabled: false, items: [] });
  const since = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
  const cols = 'id, created_at, kind, title, body, link';
  const [a, t, u] = await Promise.all([
    sb.from('notifications').select(cols).eq('audience', 'all').gte('created_at', since).order('id', { ascending: false }).limit(30),
    sb.from('notifications').select(cols).eq('audience', 'team').eq('team_id', p.team_id).gte('created_at', since).order('id', { ascending: false }).limit(30),
    sb.from('notifications').select(cols).eq('audience', 'user').eq('participant_id', p.id).gte('created_at', since).order('id', { ascending: false }).limit(10),
  ]);
  const items = [...(a.data ?? []), ...(t.data ?? []), ...(u.data ?? [])] as any[];
  items.sort((x, y) => y.id - x.id);
  return ok({
    enabled: true,
    items: items.slice(0, 40).map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, at: r.created_at, link: r.link })),
  });
});
