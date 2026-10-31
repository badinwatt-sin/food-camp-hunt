import { requirePlayer } from '@/lib/player';
import { handler, ok } from '@/lib/http';
import { status } from '@/lib/minigames/engine';

export const dynamic = 'force-dynamic';

/** Hub: which solo games are open, attempts used, my best and the top 5 of each game. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  return ok(await status(p.id));
});
