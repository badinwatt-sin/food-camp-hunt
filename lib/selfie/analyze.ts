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
  return { width: img.width, height: img.height, backgroundPct: Math.round(m.backgroundPct * 10) / 10, framePct: Math.round(m.framePct * 10) / 10 };
}
