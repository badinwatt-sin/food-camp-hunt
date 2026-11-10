import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { checkOrigin, handler, ok, rateLimit } from '@/lib/http';

/** Record the first invitation click, then let the browser open that same invitation. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requirePlayer();
  rateLimit(req, 'line-join', 30, 10 * 60 * 1000, p.id);
  const { data, error } = await db().rpc('join_line_group', { p_participant: p.id });
  if (error) throw error;
  return ok(data);
});
