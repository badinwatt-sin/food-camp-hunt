/** Colour maths shared by the phone (live preview) and the server (the verdict). No DOM, no Node APIs. */

export type Rgb = [number, number, number];
export type Lab = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/** sRGB → CIE L*a*b* (D65). Perceptual distance works for white/black/grey targets too, unlike a hue test. */
export function rgbToLab([r, g, b]: Rgb): Lab {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.0;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const deltaE = (a: Lab, b: Lab) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/**
 * Share of BACKGROUND pixels that match the target colour.
 * A selfie's person normally fills the middle of the frame, so the "background" is the band around it:
 * everything outside the centre box (x 24–76 %, y 14–100 %). The sides and the strip above the head decide.
 * Lighting shifts the colour, so the match uses a ΔE tolerance (admin-tunable).
 */
export function backgroundMatch(data: Uint8ClampedArray | Uint8Array, w: number, h: number, target: Rgb, tolerance: number) {
  const t = rgbToLab(target);
  let bg = 0, hit = 0, all = 0, allHit = 0;
  const x0 = Math.floor(w * 0.24), x1 = Math.ceil(w * 0.76), y0 = Math.floor(h * 0.14);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const ok = deltaE(rgbToLab([data[i], data[i + 1], data[i + 2]]), t) <= tolerance;
      all++; if (ok) allHit++;
      const centre = x >= x0 && x < x1 && y >= y0;
      if (!centre) { bg++; if (ok) hit++; }
    }
  }
  return { backgroundPct: bg ? (hit / bg) * 100 : 0, framePct: all ? (allHit / all) * 100 : 0 };
}

/** Thai name for a colour (for prompts and the UI); falls back to the hex code. */
export function colorName(hex: string): string {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2 / 255, s = max === min ? 0 : (max - min) / (255 - Math.abs(max + min - 255));
  if (s < 0.12) return l > 0.85 ? 'สีขาว' : l < 0.2 ? 'สีดำ' : 'สีเทา';
  const d = max - min;
  let hue = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hue = ((hue * 60) + 360) % 360;
  if (hue < 15 || hue >= 345) return l > 0.75 ? 'สีชมพู' : 'สีแดง';
  if (hue < 40) return l < 0.35 ? 'สีน้ำตาล' : 'สีส้ม';
  if (hue < 70) return 'สีเหลือง';
  if (hue < 165) return 'สีเขียว';
  if (hue < 200) return 'สีฟ้าอมเขียว';
  if (hue < 255) return 'สีฟ้า / น้ำเงิน';
  if (hue < 290) return 'สีม่วง';
  return 'สีชมพู';
}

/** Backgrounds that are easy to find in a camp and far from skin tones (so a face alone never "matches"). */
export const TEAM_PALETTE = ['#2f9e5b', '#2f6fd6', '#d63a3a', '#8a55d6', '#12a4a4', '#1f3557'];
/** Minimum perceptual distance (ΔE) between two teams' colours, so a photo can never satisfy two teams at once. */
export const MIN_TEAM_COLOR_GAP = 30;
export const colorGap = (a: string, b: string) => deltaE(rgbToLab(hexToRgb(a)), rgbToLab(hexToRgb(b)));

/** Picks `n` different palette colours in random order, each at least MIN_TEAM_COLOR_GAP away from `taken` and from each other. */
export function pickDistinctColors(n: number, taken: string[] = [], rnd: () => number = Math.random): string[] {
  const pool = [...TEAM_PALETTE].sort(() => rnd() - 0.5);
  const out: string[] = [];
  for (const c of pool) {
    if (out.length >= n) break;
    if ([...taken, ...out].every((t) => colorGap(c, t) >= MIN_TEAM_COLOR_GAP)) out.push(c);
  }
  return out;   // shorter than n only if the palette ran out
}
