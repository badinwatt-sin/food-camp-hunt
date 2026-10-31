import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { AVATAR_EMOJIS } from '@/lib/avatar-list';
import { removeAvatarFile } from '@/lib/avatars';
import { checkOrigin, handler, HttpError, ok, rateLimit, readJson } from '@/lib/http';

/** Pick a cute emoji as the profile picture (clears any uploaded photo), or remove the photo. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  rateLimit(req, 'profile', 60, 10 * 60 * 1000);
  const p = await requirePlayer();
  const body = await readJson<{ emoji?: string | null; removePhoto?: boolean }>(req);
  const patch: Record<string, unknown> = {};
  if (typeof body.emoji === 'string') {
    if (!AVATAR_EMOJIS.includes(body.emoji)) throw new HttpError(400, 'BAD_INPUT');
    patch.avatar_emoji = body.emoji; patch.avatar_url = null;
  } else if (body.emoji === null) patch.avatar_emoji = null;
  if (body.removePhoto) patch.avatar_url = null;
  if (Object.keys(patch).length === 0) throw new HttpError(400, 'BAD_INPUT');
  const { error } = await db().from('participants').update(patch).eq('id', p.id);
  if (error) throw error;
  if (patch.avatar_url === null) await removeAvatarFile(p.avatar_url);
  return ok();
});
