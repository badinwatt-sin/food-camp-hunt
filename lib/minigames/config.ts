/** Shared (browser + server) numbers for the solo mini-games. Token values are BEFORE the admin's percentage multiplier. */
export const MG_MAX_ATTEMPTS = 3;
export type MgGame = 'spot' | 'memory' | 'mystery';
export const MG_GAMES: MgGame[] = ['spot', 'memory', 'mystery'];

export const SPOT = { seconds: 180, diffs: 5, perDiff: 6, speedBonus: 30, missPenaltySec: 3, grace: 4 };
export const MEMORY = { pairs: 6, best: 60, perExtraMove: 4, floor: 10 };
export const MYSTERY = { rounds: 5, secondsPerRound: 20, maxPerRound: 10, minCorrect: 2, grace: 3 };

export const MG_MAX_TOKENS: Record<MgGame, number> = {
  spot: SPOT.diffs * SPOT.perDiff + SPOT.speedBonus,          // 60
  memory: MEMORY.best,                                          // 60
  mystery: MYSTERY.rounds * MYSTERY.maxPerRound,               // 50
};

export const MG_INFO: Record<MgGame, { icon: string; title: string; en: string; how: string; color: string }> = {
  spot: { icon: '🔍', title: 'จับผิดภาพ Food Camp', en: 'Spot the Difference', color: '#d8ecf5',
    how: `หาจุดที่ต่างกัน ${SPOT.diffs} จุด ใน ${SPOT.seconds / 60} นาที · หาได้ครบและเร็วยิ่งได้โทเคนมาก · กดผิดโดนบวกเวลา ${SPOT.missPenaltySec} วินาที` },
  memory: { icon: '🃏', title: 'Camp Memory Flip', en: 'Memory Match', color: '#fde7b0',
    how: `เปิดไพ่ 12 ใบ จับคู่วัตถุดิบ/อุปกรณ์ให้ครบ ${MEMORY.pairs} คู่ · ใช้จำนวนครั้งน้อยที่สุดได้โทเคนสูงสุด` },
  mystery: { icon: '🥬', title: 'Mystery Ingredient', en: 'Guess the Ingredient', color: '#d9efd8',
    how: `ภาพวัตถุดิบซูมจนแทบดูไม่ออก ค่อยๆ ชัดขึ้น (แตะเปิดภาพเพิ่มได้) แล้วเลือกคำตอบ ${MYSTERY.rounds} ข้อ · ตอบเร็วยิ่งได้โทเคนมาก` },
};

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** Spot the difference: 6 tokens per difference + a speed bonus (scaled by how many were found). 5/5 in 60 s = 50. */
export function spotTokens(found: number, seconds: number): number {
  const f = clamp(found, 0, SPOT.diffs);
  const speed = SPOT.speedBonus * (f / SPOT.diffs) * clamp(1 - seconds / SPOT.seconds, 0, 1);
  return Math.round(f * SPOT.perDiff + speed);
}
/** Memory: the fewer moves (a move = two cards turned) the better. */
export function memoryTokens(moves: number): number {
  return clamp(MEMORY.best - Math.max(0, moves - MEMORY.pairs) * MEMORY.perExtraMove, MEMORY.floor, MEMORY.best);
}
/** Mystery: a correct answer earns 10, falling linearly to 2 at the time limit. Wrong / too late = 0. */
export function mysteryTokens(correct: boolean, seconds: number): number {
  if (!correct || seconds > MYSTERY.secondsPerRound + MYSTERY.grace) return 0;
  return clamp(Math.round(MYSTERY.maxPerRound * (1 - seconds / MYSTERY.secondsPerRound)), MYSTERY.minCorrect, MYSTERY.maxPerRound);
}
export const applyPercent = (raw: number, pct: number) => Math.round((raw * pct) / 100);
