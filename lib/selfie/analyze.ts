import 'server-only';

import jpeg from 'jpeg-js';
import { backgroundMatch, hexToRgb } from './color';

/** Decodes the JPEG the phone sent and measures how much of the background is the target colour. */
export function analyzeSelfie(bytes: Uint8Array, hex: string, tolerance: number) {
  let img: { width: number; height: number; data: Uint8Array | Buffer };
  try { img = jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 64, maxResolutionInMP: 12 }); }
  catch { return null; }
  // Sample down to ~120 px wide: plenty for a colour share, and quick on a serverless function.
  const scale = Math.max(1, Math.floor(img.width / 120));
  const w = Math.floor(img.width / scale), h = Math.floor(img.height / scale);
  const small = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = ((y * scale) * img.width + x * scale) * 4, d = (y * w + x) * 4;
    small[d] = img.data[s]; small[d + 1] = img.data[s + 1]; small[d + 2] = img.data[s + 2]; small[d + 3] = 255;
  }
  const m = backgroundMatch(small, w, h, hexToRgb(hex), tolerance);
  return { hash: dHash(small, w, h), avg: avgColor(small, w, h), width: img.width, height: img.height, backgroundPct: Math.round(m.backgroundPct * 10) / 10, framePct: Math.round(m.framePct * 10) / 10 };
}

/**
 * 256-bit "difference hash" of the picture (17x16 grey grid, is each cell brighter than its right neighbour).
 * Two files of the SAME picture (re-saved, resized, recompressed) have almost the same hash; a new selfie never does.
 * It describes the image, not the person: no face data is computed or stored.
 */
function dHash(rgba: Uint8Array, w: number, h: number): string {
  const gw = 17, gh = 16, grey: number[][] = [];
  for (let gy = 0; gy < gh; gy++) {
    const row: number[] = [];
    for (let gx = 0; gx < gw; gx++) {
      let sum = 0, n = 0;
      const x0 = Math.floor((gx * w) / gw), x1 = Math.max(x0 + 1, Math.floor(((gx + 1) * w) / gw));
      const y0 = Math.floor((gy * h) / gh), y1 = Math.max(y0 + 1, Math.floor(((gy + 1) * h) / gh));
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) { const i = (y * w + x) * 4; sum += 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]; n++; }
      row.push(sum / Math.max(1, n));
    }
    grey.push(row);
  }
  let bits = '';
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw - 1; x++) bits += grey[y][x] > grey[y][x + 1] ? '1' : '0';
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Number of differing bits between two hashes (0 = identical picture). */
export function hashDistance(a: string, b: string): number {
  if (a.length !== b.length) return 256;
  let d = 0;
  for (let i = 0; i < a.length; i++) { let x = parseInt(a[i], 16) ^ parseInt(b[i], 16); while (x) { d += x & 1; x >>= 1; } }
  return d;
}

/** Average colour of the picture: two pictures with the same layout but another tint are not the same picture. */
function avgColor(rgba: Uint8Array, w: number, h: number): [number, number, number] {
  let r = 0, g = 0, b = 0;
  const n = w * h;
  for (let i = 0; i < n; i++) { r += rgba[i * 4]; g += rgba[i * 4 + 1]; b += rgba[i * 4 + 2]; }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

/** True when the two uploads are (almost) the same picture: same brightness layout AND the same overall colour. */
export function samePicture(a: { hash?: string; avg?: number[] } | undefined, b: { hash?: string; avg?: number[] } | undefined, maxBits: number, maxColor: number): boolean {
  if (!a?.hash || !b?.hash || !a.avg || !b.avg) return false;
  return hashDistance(a.hash, b.hash) <= maxBits && a.avg.every((v, i) => Math.abs(v - (b.avg as number[])[i]) <= maxColor);
}
