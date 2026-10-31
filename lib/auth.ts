import 'server-only';
import crypto from 'crypto';
import { cookies } from 'next/headers';
import { env } from './env';

const PLAYER_COOKIE = 'fc_player';
const ADMIN_COOKIE = 'fc_admin';

function sign(payload: string): string {
  return crypto.createHmac('sha256', env('SESSION_SECRET')).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

export function makeToken(data: Record<string, unknown>, ttlSec: number): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `${body}.${sign(body)}`;
}

export function readToken<T>(token?: string): (T & { exp: number }) | null {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, sign(body))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

async function setCookie(name: string, value: string, maxAge: number) {
  (await cookies()).set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

// ---- player -----------------------------------------------------------
export async function setPlayerSession(pid: string, version: number) {
  await setCookie(PLAYER_COOKIE, makeToken({ pid, v: version }, 60 * 60 * 24 * 3), 60 * 60 * 24 * 3);
}
export async function clearPlayerSession() {
  (await cookies()).delete(PLAYER_COOKIE);
}
export async function getPlayerSession(): Promise<{ pid: string; v: number } | null> {
  const t = readToken<{ pid: string; v: number }>((await cookies()).get(PLAYER_COOKIE)?.value);
  return t ? { pid: t.pid, v: t.v } : null;
}

// ---- admin ------------------------------------------------------------
export type AdminRole = 'admin' | 'staff';

/** Returns the role if the password matches, else null. */
export function checkAdminPassword(password: string): AdminRole | null {
  // Ignore stray spaces/newlines around either side (easy to paste into a dashboard by accident).
  const given = String(password ?? '').trim();
  const admin = process.env.ADMIN_PASSWORD?.trim();
  const staff = process.env.STAFF_PASSWORD?.trim();
  if (admin && safeEqual(given, admin)) return 'admin';
  if (staff && safeEqual(given, staff)) return 'staff';
  return null;
}
export async function setAdminSession(role: AdminRole) {
  await setCookie(ADMIN_COOKIE, makeToken({ role }, 60 * 60 * 12), 60 * 60 * 12);
}
export async function clearAdminSession() {
  (await cookies()).delete(ADMIN_COOKIE);
}
export async function getAdminRole(): Promise<AdminRole | null> {
  const t = readToken<{ role: AdminRole }>((await cookies()).get(ADMIN_COOKIE)?.value);
  return t && (t.role === 'admin' || t.role === 'staff') ? t.role : null;
}
