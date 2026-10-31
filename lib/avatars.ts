import 'server-only';
import { db } from './supabase';

const PUBLIC_MARK = '/object/public/avatars/';

/** Storage path of a photo from its public URL (null if it is not one of ours). */
export function avatarPath(url: string | null | undefined): string | null {
  const i = url ? url.indexOf(PUBLIC_MARK) : -1;
  return url && i >= 0 ? decodeURIComponent(url.slice(i + PUBLIC_MARK.length).split('?')[0]) : null;
}

/** Best effort: removing the old file must never block saving the new picture. */
export async function removeAvatarFile(url: string | null | undefined) {
  const path = avatarPath(url);
  if (path) await db().storage.from('avatars').remove([path]).catch(() => {});
}

/** Looks at the first bytes so a renamed non-image can't be stored as a picture. */
export function sniffImage(b: Uint8Array): 'jpg' | 'png' | 'webp' | null {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'webp';
  return null;
}

/** Best-effort delete of a file in a PUBLIC bucket given its public URL (used for team mission photos). */
export async function removePublicFile(bucket: string, url: string | null | undefined) {
  const mark = `/object/public/${bucket}/`;
  const i = url ? url.indexOf(mark) : -1;
  if (!url || i < 0) return;
  const path = decodeURIComponent(url.slice(i + mark.length).split('?')[0]);
  await db().storage.from(bucket).remove([path]).catch(() => {});
}
