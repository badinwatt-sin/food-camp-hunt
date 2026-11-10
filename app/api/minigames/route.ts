import { requirePlayer } from '@/lib/player';
import { handler, HttpError, ok } from '@/lib/http';
import { status } from '@/lib/minigames/engine';
import { db } from '@/lib/supabase';
import { menuAccess } from '@/lib/menu-access';

export const dynamic = 'force-dynamic';

/** Hub: which solo games are open, attempts used, my best and the top 5 of each game. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const { data: settings, error } = await db().from('game_settings').select('mg_spot_open, mg_memory_open, mg_mystery_open').eq('id', 1).single();
  if (error) throw error;
  if (!menuAccess(settings).games) throw new HttpError(403, 'MG_CLOSED');
  return ok(await status(p.id, !!p.is_observer));
});
