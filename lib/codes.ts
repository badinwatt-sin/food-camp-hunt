import 'server-only';
import crypto from 'crypto';
import { env } from './env';

/**
 * Hunt spot codes (A-Z / 0-9 only, upper-case). Used for QR/spot codes, not for player login.
 */
export function normalizeCode(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Player login ID, set by the organiser (e.g. from an Excel sheet). Matching is forgiving:
 * case-insensitive, and spaces / dashes / punctuation are ignored, so "ab-0012", "AB 0012" and "ab0012" are the same ID.
 * Letters and digits of any language are kept. Returns '' when nothing usable is left.
 */
export function normalizeId(input: unknown): string {
  return String(input ?? '').normalize('NFKC').toUpperCase().replace(/[^\p{L}\p{N}]/gu, '').slice(0, 40);
}

/** Keyed hash: a leaked database alone does not reveal the IDs. */
export function hashCode(id: string): string {
  return crypto.createHmac('sha256', env('CODE_PEPPER')).update(normalizeId(id)).digest('hex');
}
