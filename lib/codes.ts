import 'server-only';
import crypto from 'crypto';
import { env } from './env';

// No 0/O/1/I/L to avoid look-alike characters when typing from a printed card.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function generateCode(): string {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s;
}

export function formatCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function normalizeCode(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Keyed hash: a leaked database alone cannot be used to recover codes. */
export function hashCode(code: string): string {
  return crypto.createHmac('sha256', env('CODE_PEPPER')).update(normalizeCode(code)).digest('hex');
}
