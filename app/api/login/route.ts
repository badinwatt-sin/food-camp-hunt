import { NextResponse } from 'next/server';
import { db } from '@/lib/supabase';
import { setPlayerSession } from '@/lib/auth';
import { hashCode, normalizeCode } from '@/lib/codes';
import { checkOrigin, handler, rateLimit, readJson } from '@/lib/http';

export const POST = handler(async (req: Request) => {
  checkOrigin(req);
  rateLimit(req, 'login', 15, 10 * 60 * 1000);
  const body = await readJson<{ code?: string }>(req);
  const code = normalizeCode(body.code ?? '');
  const bad = NextResponse.json({ error: 'BAD_CODE', message: 'รหัสไม่ถูกต้อง หรือถูกยกเลิกแล้ว' }, { status: 401 });
  if (code.length !== 8) return bad;

  const { data, error } = await db()
    .from('participants')
    .select('id, session_version')
    .eq('code_hash', hashCode(code))
    .maybeSingle();
  if (error) throw error;
  if (!data) return bad;

  await setPlayerSession(data.id, data.session_version);
  return NextResponse.json({ ok: true });
});
