import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { checkOrigin, handler, ok } from '@/lib/http';

export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requirePlayer();
  const { error } = await db().rpc('start_participant', { p_participant: p.id });
  if (error) throw error;
  return ok();
});
