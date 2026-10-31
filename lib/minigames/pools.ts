import 'server-only';

/** Memory-flip cards: ingredients and kitchen tools. 6 of these are used per game. */
export const MEMORY_CARDS: { id: string; emoji: string; name: string }[] = [
  { id: 'tomato', emoji: '🍅', name: 'มะเขือเทศ' }, { id: 'garlic', emoji: '🧄', name: 'กระเทียม' },
  { id: 'chili', emoji: '🌶️', name: 'พริก' }, { id: 'mushroom', emoji: '🍄', name: 'เห็ด' },
  { id: 'carrot', emoji: '🥕', name: 'แครอท' }, { id: 'corn', emoji: '🌽', name: 'ข้าวโพด' },
  { id: 'lemon', emoji: '🍋', name: 'มะนาว' }, { id: 'pan', emoji: '🍳', name: 'กระทะ' },
  { id: 'knife', emoji: '🔪', name: 'มีด' }, { id: 'spoon', emoji: '🥄', name: 'ช้อน' },
  { id: 'salt', emoji: '🧂', name: 'เกลือ' }, { id: 'pot', emoji: '🍲', name: 'หม้อ' },
];

/** Mystery ingredient pool (shown zoomed in, then 4 picture choices). */
export const INGREDIENTS: { id: string; emoji: string; name: string }[] = [
  { id: 'tomato', emoji: '🍅', name: 'มะเขือเทศ' }, { id: 'carrot', emoji: '🥕', name: 'แครอท' },
  { id: 'corn', emoji: '🌽', name: 'ข้าวโพด' }, { id: 'mushroom', emoji: '🍄', name: 'เห็ด' },
  { id: 'garlic', emoji: '🧄', name: 'กระเทียม' }, { id: 'chili', emoji: '🌶️', name: 'พริก' },
  { id: 'lemon', emoji: '🍋', name: 'มะนาว' }, { id: 'broccoli', emoji: '🥦', name: 'บรอกโคลี' },
  { id: 'eggplant', emoji: '🍆', name: 'มะเขือม่วง' }, { id: 'pineapple', emoji: '🍍', name: 'สับปะรด' },
  { id: 'coconut', emoji: '🥥', name: 'มะพร้าว' }, { id: 'onion', emoji: '🧅', name: 'หอมใหญ่' },
  { id: 'potato', emoji: '🥔', name: 'มันฝรั่ง' }, { id: 'cabbage', emoji: '🥬', name: 'ผักกาด' },
  { id: 'banana', emoji: '🍌', name: 'กล้วย' }, { id: 'egg', emoji: '🥚', name: 'ไข่' },
];

export function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
