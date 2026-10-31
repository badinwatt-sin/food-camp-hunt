import { requirePlayer } from '@/lib/player';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';
import { isGame, memory, mystery, spot } from '@/lib/minigames/engine';

export const dynamic = 'force-dynamic';

/** All moves of the three solo games. The secrets (differences, card layout, answers) never leave the server. */
export const POST = handler(async (req: Request, ctx: { params: Promise<{ game: string }> }) => {
  checkOrigin(req);
  const { game } = await ctx.params;
  if (!isGame(game)) throw new HttpError(404, 'NOT_FOUND');
  const p = await requirePlayer();
  rateLimit(req, 'mg', 900, 10 * 60 * 1000, p.id);
  const body = await readJson(req);
  if (typeof body?.action !== 'string') throw new HttpError(400, 'BAD_INPUT');
  const out = game === 'spot' ? await spot(p.id, body) : game === 'memory' ? await memory(p.id, body) : await mystery(p.id, body);
  return ok(out);
});
