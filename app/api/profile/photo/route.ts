import { randomUUID } from 'crypto';
import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { removeAvatarFile, sniffImage } from '@/lib/avatars';
import { checkOrigin, handler, HttpError, ok, rateLimit } from '@/lib/http';

/** Upload a profile photo (the app sends a small square JPEG). Max 1.5 MB, real image bytes only. */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  rateLimit(req, 'avatar', 20, 10 * 60 * 1000);
  const p = await requirePlayer();
  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'BAD_INPUT');
  if (file.size > 1.5 * 1024 * 1024) throw new HttpError(400, 'BAD_INPUT');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(400, 'BAD_INPUT');

  const sb = db();
  const path = `${p.id}/${randomUUID()}.${kind}`;
  const { error } = await sb.storage.from('avatars').upload(path, bytes, { contentType: `image/${kind === 'jpg' ? 'jpeg' : kind}` });
  if (error) throw error;
  const url = sb.storage.from('avatars').getPublicUrl(path).data.publicUrl;
  const { error: ue } = await sb.from('participants').update({ avatar_url: url, avatar_emoji: null }).eq('id', p.id);
  if (ue) throw ue;
  await removeAvatarFile(p.avatar_url); // the previous photo, if any
  return ok({ url });
});
