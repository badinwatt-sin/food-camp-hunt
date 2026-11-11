import { randomUUID } from 'crypto';
import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { removePublicFile, sniffImage } from '@/lib/avatars';
import { checkOrigin, handler, HttpError, ok, rateLimit } from '@/lib/http';
import { selfieStatus } from '@/lib/selfie/status';
import { SELFIE_SETTINGS_SELECT, publicSettings, selfieEligible } from '@/lib/selfie/settings';
import { analyzeSelfie } from '@/lib/selfie/analyze';
import { aiCheckSelfie, aiEnabled } from '@/lib/selfie/ai';
import { colorName } from '@/lib/selfie/color';

export const dynamic = 'force-dynamic';

/** The selfie wall: settings, who on the team already hangs on it, and the finishing order. */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const st = await selfieStatus(p);
  if (!st) throw new HttpError(403, 'SELFIE_CLOSED');   // judges-only phase: everyone else sees nothing
  return ok(st);
});

/**
 * One selfie per player. The phone sends a JPEG; the server measures the background colour (pixels) against the
 * TEAM's own colour and, when ANTHROPIC_API_KEY is set, asks Claude whether a real person is in front of it.
 * Rejected photos are never stored. In the judges-only phase the photo goes to the score-free test wall.
 */
export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  const p = await requirePlayer();
  rateLimit(req, 'selfie', 40, 10 * 60 * 1000, p.id);
  const sb = db();
  const { data: row } = await sb.from('game_settings').select(SELFIE_SETTINGS_SELECT).eq('id', 1).single();
  const s = publicSettings(row);
  if (!s.live || !selfieEligible(s.audience, !!p.is_observer)) throw new HttpError(403, 'SELFIE_CLOSED');
  const test = s.audience === 'judges';
  const { data: team } = await sb.from('teams').select('selfie_color').eq('id', p.team_id).single();
  const color = (test ? s.color : team?.selfie_color || s.color).toLowerCase();

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) throw new HttpError(400, 'BAD_INPUT');
  if (file.size > 2.5 * 1024 * 1024) throw new HttpError(400, 'BAD_INPUT');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (sniffImage(bytes) !== 'jpg') throw new HttpError(400, 'BAD_INPUT');   // the app always sends JPEG

  const pix = analyzeSelfie(bytes, color, s.tolerance);
  if (!pix) throw new HttpError(400, 'BAD_INPUT');
  const ai = await aiCheckSelfie(bytes, color, s.percent);
  const name = colorName(color);

  // ---- the verdict (explained to the player in Thai)
  let reason: string | null = null;
  let pct = pix.backgroundPct;
  if (ai) {
    pct = Math.round(ai.background_match_percent);
    if (!ai.person_visible) reason = ai.problem_th || 'ยังไม่เห็นหน้าคุณชัดๆ ในภาพ ลองถ่าย Selfie ให้เห็นหน้าเต็มๆ';
    else if (ai.background_match_percent < s.percent) reason = ai.problem_th || `พื้นหลังเป็น${name}ประมาณ ${pct}% ยังไม่ถึง ${s.percent}% ลองขยับให้ฉากหลัง${name}เต็มเฟรมมากขึ้น`;
    else if (pix.backgroundPct < s.percent * 0.4) reason = `ภาพนี้วัดสีพื้นหลังได้แค่ ${Math.round(pix.backgroundPct)}% ลองถ่ายในที่สว่างขึ้น ให้ฉากหลัง${name}อยู่รอบตัวคุณ`;
  } else if (pix.backgroundPct < s.percent) {
    reason = `พื้นหลังเป็น${name}ประมาณ ${Math.round(pix.backgroundPct)}% ยังไม่ถึง ${s.percent}% ลองขยับให้ฉากหลัง${name}เต็มเฟรมมากขึ้น`;
  }
  const checks = { pixel: pix, color, ai: ai ? { person: ai.person_visible, people: ai.people_count, pct: ai.background_match_percent, bg: ai.background_description } : null, aiEnabled: aiEnabled() };
  if (reason) return ok({ accepted: false, reason, pct: Math.round(pct), need: s.percent, checks });

  const path = `${test ? 'test' : p.team_id}/${p.id}/${randomUUID()}.jpg`;
  const { error: ue } = await sb.storage.from('selfies').upload(path, bytes, { contentType: 'image/jpeg' });
  if (ue) throw ue;
  const url = sb.storage.from('selfies').getPublicUrl(path).data.publicUrl;
  const { data, error } = await sb.rpc(test ? 'submit_selfie_test' : 'submit_selfie', { p_participant: p.id, p_url: url, p_pct: Math.round(pct * 10) / 10, p_checks: checks });
  if (error) { await removePublicFile('selfies', url); throw error; }
  if (data?.oldUrl) await removePublicFile('selfies', data.oldUrl);
  return ok({ accepted: true, pct: Math.round(pct), need: s.percent, url, ...data, test, status: await selfieStatus(p) });
});
