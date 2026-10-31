import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { setPlayerSession } from '@/lib/auth';
import { hashCode, normalizeId } from '@/lib/codes';
import { checkOrigin, handler, readJson, tooManyFailures, recordFailure } from '@/lib/http';

export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  // Only WRONG IDs count: a whole venue sharing one Wi-Fi address can still log in at the same moment.
  tooManyFailures(req, 'login', 40, 10 * 60 * 1000);
  const body = await readJson<{ id?: string; code?: string }>(req);
  const id = normalizeId(body.id ?? body.code ?? '');
  const bad = () => {
    recordFailure(req, 'login', 10 * 60 * 1000);
    return NextResponse.json({ error: 'BAD_ID', message: 'ไม่พบ ID นี้ หรือ ID ถูกยกเลิกแล้ว กรุณาตรวจสอบกับทีมงาน' }, { status: 401 });
  };
  if (!id) return bad();

  const { data, error } = await db()
    .from('participants')
    .select('id, session_version')
    .eq('code_hash', hashCode(id))
    .maybeSingle();
  if (error) throw error;
  if (!data) return bad();

  await setPlayerSession(data.id, data.session_version);
  return NextResponse.json({ ok: true });
});
