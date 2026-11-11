import { randomUUID } from 'crypto';
import { db } from '@/lib/supabase';
import { requireMember } from '@/lib/player';
import { removePublicFile, sniffImage } from '@/lib/avatars';
import { notifyAll } from '@/lib/notify';
import { checkOrigin, handler, HttpError, ok, rateLimit } from '@/lib/http';

/**
 * The team LEADER uploads the team's photo for a mission. Anyone else is refused (here and again in the database).
 * The upload is PENDING: tokens are only given after staff confirm the photo (review_photo).
 */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requireMember();
  rateLimit(req, 'photo', 30, 10 * 60 * 1000, p.id);
  if (!p.is_leader) throw new HttpError(403, 'NOT_LEADER');
  const sb = db();
  const { data: settings } = await sb.from('game_settings').select('puzzle_open').eq('id', 1).single();
  if (!settings?.puzzle_open) throw new HttpError(403, 'PUZZLE_CLOSED');

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  const missionId = String(form?.get('missionId') ?? '');
  if (!(file instanceof File) || !missionId) throw new HttpError(400, 'BAD_INPUT');
  if (file.size > 3 * 1024 * 1024) throw new HttpError(400, 'BAD_INPUT');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const kind = sniffImage(bytes);
  if (!kind) throw new HttpError(400, 'BAD_INPUT');

  const path = `${p.team_id}/${missionId}/${randomUUID()}.${kind}`;
  const { error: ue } = await sb.storage.from('mission-photos').upload(path, bytes, { contentType: `image/${kind === 'jpg' ? 'jpeg' : kind}` });
  if (ue) throw ue;
  const url = sb.storage.from('mission-photos').getPublicUrl(path).data.publicUrl;

  const { data, error } = await sb.rpc('submit_photo', { p_participant: p.id, p_mission: missionId, p_url: url });
  if (error || data?.already) {
    await removePublicFile('mission-photos', url); // nothing was recorded for this file
    if (error) throw error;
  }
  if (data?.replaced && data.old_url) await removePublicFile('mission-photos', data.old_url); // the pending photo that was swapped out
  if (!data.already) {
    const { data: m } = await sb.from('photo_missions').select('title').eq('id', missionId).maybeSingle();
    const title = (m as any)?.title ?? 'ภารกิจทีม';
    await notifyAll([
      { audience: 'team', teamId: p.team_id, kind: 'photo', title: `📸 ส่งภาพ “${title}” แล้ว`, body: 'รอทีมงานตรวจสอบ', link: 'activities' },
      { audience: 'admin', kind: 'photo', title: `📸 ${p.teams?.name ?? 'ทีม'} ส่งภาพรอตรวจ`, body: `${title} · โดย ${p.nick_name || p.name}` },
    ]);
  }
  return ok({ already: !!data.already, status: data.status, replaced: !!data.replaced, tokens: data.tokens, url: data.already ? null : url });
});
