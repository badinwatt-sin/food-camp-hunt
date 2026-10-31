import 'server-only';
import { NextResponse } from 'next/server';

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const ok = (data: unknown = { ok: true }, status = 200) => NextResponse.json(data, { status });

// Thai messages shown to people; codes are raised by the database functions.
const MESSAGES: Record<string, [number, string]> = {
  NOT_FOUND: [404, 'ไม่พบข้อมูล'],
  BAD_INPUT: [400, 'ข้อมูลไม่ถูกต้อง'],
  GAME_CLOSED: [403, 'เกมยังไม่เปิด หรือปิดแล้ว'],
  NOT_STARTED: [409, 'ยังไม่ได้เริ่มเล่น'],
  ALREADY_COMPLETED: [409, 'เล่นจบแล้ว'],
  OUT_OF_ORDER: [409, 'ลำดับคำถามไม่ถูกต้อง กรุณารีเฟรช'],
  INCOMPLETE: [409, 'ยังตอบไม่ครบทุกข้อ'],
  ITEM_UNAVAILABLE: [409, 'สินค้านี้ไม่พร้อมแลก'],
  OUT_OF_STOCK: [409, 'สินค้าคงเหลือไม่พอ'],
  INSUFFICIENT_TOKENS: [409, 'โทเคนของทีมไม่พอ'],
  SPOT_NOT_FOUND: [404, 'ไม่พบจุดนี้ รหัสไม่ถูกต้อง หรือจุดถูกปิดแล้ว'],
  PUZZLE_CLOSED: [403, 'ภารกิจทีมยังไม่เปิด หรือปิดแล้ว'],
  HUNT_CLOSED: [403, 'กิจกรรมล่าสมบัติยังไม่เปิด หรือปิดแล้ว'],
  GOAL_NOT_MET: [409, 'ทีมยังไม่ถึงเป้าหมายการเล่นควิซ สินค้านี้ยังล็อกอยู่'],
  NO_ATTEMPTS: [409, 'สควอดนี้ใช้สิทธิ์ตอบครบแล้ว'],
  DUPLICATE_ID: [409, 'ID นี้ถูกใช้แล้ว'],
  NOT_LEADER: [403, 'เฉพาะหัวหน้าทีมเท่านั้นที่แลกสินค้าได้'],
  MARKET_CLOSED: [403, 'ตลาดยังไม่เปิดให้หัวหน้าทีมแลกเอง กรุณาติดต่อทีมงาน'],
  CHECKIN_CLOSED: [403, 'ยังไม่เปิดให้เช็กอิน หรือปิดแล้ว กรุณาสอบถามทีมงาน'],
  BAD_CHECKIN_CODE: [400, 'QR / รหัสเช็กอินไม่ถูกต้อง กรุณาสแกน QR ของทีมงานอีกครั้ง'],
  MG_CLOSED: [403, 'เกมนี้ยังไม่เปิด หรือปิดแล้ว'],
  MG_NO_ATTEMPTS: [409, 'คุณเล่นเกมนี้ครบ 3 ครั้งแล้ว'],
  UNAUTHORIZED: [401, 'กรุณาเข้าสู่ระบบ'],
  FORBIDDEN: [403, 'ไม่มีสิทธิ์ทำรายการนี้'],
  RATE_LIMITED: [429, 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่'],
};

export function errorResponse(e: unknown) {
  let code = 'SERVER_ERROR';
  if (e instanceof HttpError) code = e.code;
  else if (e && typeof (e as any).message === 'string') {
    const m = (e as any).message as string;
    const hit = Object.keys(MESSAGES).find((k) => m.includes(k));
    if (hit) code = hit;
    else console.error('[server error]', m);
  }
  const [status, message] = MESSAGES[code] ?? [500, 'เกิดข้อผิดพลาด กรุณาลองใหม่'];
  return NextResponse.json({ error: code, message }, { status });
}

/** Wrap a handler so thrown errors become clean JSON responses. */
export function handler<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return async (...args: A): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

/** Basic CSRF guard: state-changing requests must come from our own origin. */
export function checkOrigin(req: Request) {
  const origin = req.headers.get('origin');
  if (!origin) return; // same-origin fetches from some browsers omit it; cookies are SameSite=Lax anyway
  const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
  if (!host || new URL(origin).host !== host) throw new HttpError(403, 'FORBIDDEN');
}

// Best-effort in-memory rate limit (per server instance). See README "limits".
const hits = new Map<string, { n: number; reset: number }>();
/** `who` = a player id for signed-in routes. Keying by person (not network address) matters: a whole venue on one Wi-Fi shares a single IP. */
export function rateLimit(req: Request, bucket: string, max: number, windowMs: number, who?: string) {
  const ip = (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
  const key = `${bucket}:${who ?? ip}`;
  const now = Date.now();
  const cur = hits.get(key);
  if (!cur || cur.reset < now) {
    hits.set(key, { n: 1, reset: now + windowMs });
    return;
  }
  cur.n += 1;
  if (cur.n > max) throw new HttpError(429, 'RATE_LIMITED');
}

// Failure-only limiter (also in memory, per server instance): successful requests never count.
const fails = new Map<string, { n: number; reset: number }>();
const ipOf = (req: Request) => (req.headers.get('x-forwarded-for') ?? 'unknown').split(',')[0].trim();
export function tooManyFailures(req: Request, bucket: string, max: number, windowMs: number) {
  const cur = fails.get(`${bucket}:${ipOf(req)}`);
  if (cur && cur.reset > Date.now() && cur.n >= max) throw new HttpError(429, 'RATE_LIMITED');
  void windowMs;
}
export function recordFailure(req: Request, bucket: string, windowMs: number) {
  const key = `${bucket}:${ipOf(req)}`;
  const now = Date.now();
  const cur = fails.get(key);
  if (!cur || cur.reset < now) fails.set(key, { n: 1, reset: now + windowMs });
  else cur.n += 1;
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'BAD_INPUT');
  }
}
