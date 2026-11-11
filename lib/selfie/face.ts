/** Face signatures: a 128-number vector computed on the phone. Two photos of the same person are about 0.2-0.4 apart; different people are 0.6 or more. */
export const FACE_LEN = 128;

/** Accepts only what the phone should send: 128 finite numbers of a sane size. Rounded to 3 decimals to keep the row small. */
export function parseFace(raw: unknown): number[] | null {
  let v: unknown = raw;
  if (typeof raw === 'string') { try { v = JSON.parse(raw); } catch { return null; } }
  if (!Array.isArray(v) || v.length !== FACE_LEN) return null;
  const out: number[] = [];
  for (const x of v) { if (typeof x !== 'number' || !Number.isFinite(x) || Math.abs(x) > 2) return null; out.push(Math.round(x * 1000) / 1000); }
  return out;
}

export function faceDistance(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < FACE_LEN; i++) { const d = a[i] - b[i]; s += d * d; }
  return Math.sqrt(s);
}

/** Closest other photos to a signature (nearest first), within `maxDist`. */
export function nearFaces<T extends { checks?: any }>(face: number[], others: T[], maxDist: number): { item: T; dist: number }[] {
  const out: { item: T; dist: number }[] = [];
  for (const o of others) {
    const f = parseFace(o.checks?.face);
    if (!f) continue;
    const d = faceDistance(face, f);
    if (d <= maxDist) out.push({ item: o, dist: Math.round(d * 1000) / 1000 });
  }
  return out.sort((a, b) => a.dist - b.dist);
}
