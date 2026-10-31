import 'server-only';



/**
 * Spot-the-difference scenes, drawn as SVG on the server. Picture A is the original, picture B has exactly 5 changes.
 * The differences (coordinates) stay on the server: the phone only gets the two pictures and sends back where it tapped.
 * Canvas is 400 x 300. A tap counts when it lands within HIT_R pixels of a difference's centre.
 */
export const HIT_R = 32;
export type Diff = { id: number; x: number; y: number; what: string };
export type Scene = { id: number; name: string; diffs: Diff[]; render: (changed: boolean) => string };

const wrap = (inner: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" font-family="Arial, Helvetica, sans-serif">${inner}</svg>`;
const sky = `<rect width="400" height="300" fill="#cfeaf5"/><circle cx="352" cy="44" r="26" fill="#f6d365"/>
<ellipse cx="90" cy="48" rx="34" ry="12" fill="#fff" opacity=".9"/><ellipse cx="116" cy="42" rx="24" ry="10" fill="#fff" opacity=".9"/>
<path d="M0 205 Q70 140 160 192 T400 176 V300 H0Z" fill="#9cc58a"/><rect y="214" width="400" height="86" fill="#c9a56b"/>`;

// ---------------------------------------------------------------- 1) central kitchen
const kitchen: Scene = {
  id: 0, name: 'ครัวกลาง',
  diffs: [
    { id: 0, x: 200, y: 86, what: 'สีหลังคา' },
    { id: 1, x: 118, y: 136, what: 'ขวดซอสหาย' },
    { id: 2, x: 292, y: 112, what: 'ไอน้ำหม้อ' },
    { id: 3, x: 232, y: 30, what: 'ธงเปลี่ยนสี' },
    { id: 4, x: 193, y: 168, what: 'มีดสลับข้าง' },
  ],
  render: (b) => wrap(`${sky}
  <rect x="30" y="60" width="9" height="160" fill="#7a4e2b"/><rect x="361" y="60" width="9" height="160" fill="#7a4e2b"/>
  <path d="M34 22 Q200 44 366 22" stroke="#5b4630" stroke-width="2" fill="none"/>
  ${[70, 110, 150, 190, 230, 270, 310].map((x, i) => `<polygon points="${x - 11},${28 + (x < 200 ? (200 - x) / 40 : (x - 200) / 40)} ${x + 11},${28 + (x < 200 ? (200 - x) / 40 : (x - 200) / 40)} ${x},${50 + (x < 200 ? (200 - x) / 40 : (x - 200) / 40)}" fill="${i === 4 && b ? '#2f9e6f' : ['#e0573b', '#f2b134', '#2f9e6f', '#3f7fb5', '#e0573b', '#f2b134', '#3f7fb5'][i]}"/>`).join('')}
  <polygon points="60,112 200,56 340,112" fill="${b ? '#3f7fb5' : '#d9663f'}"/><polygon points="60,112 200,56 340,112" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="14 12"/>
  <rect x="70" y="112" width="260" height="104" fill="#f4ead0"/><rect x="70" y="170" width="260" height="46" fill="#8a5a33"/>
  <rect x="150" y="120" width="100" height="26" rx="4" fill="#2f5d3a"/><text x="200" y="138" font-size="14" font-weight="bold" fill="#fff" text-anchor="middle">FOOD CAMP</text>
  <rect x="86" y="146" width="104" height="5" fill="#6d4526"/>
  <g fill="#b3261e"><rect x="92" y="124" width="14" height="22" rx="3"/><rect x="95" y="118" width="8" height="7"/></g>
  ${b ? '' : '<g fill="#f2b134"><rect x="111" y="122" width="14" height="24" rx="3"/><rect x="114" y="115" width="8" height="8"/></g>'}
  <g fill="#2f9e6f"><rect x="132" y="124" width="14" height="22" rx="3"/><rect x="135" y="118" width="8" height="7"/></g>
  <rect x="154" y="160" width="76" height="16" rx="3" fill="#e9d3a6" stroke="#b58f55"/>
  <rect x="${b ? 206 : 160}" y="162" width="20" height="5" rx="2" fill="#9aa4ad"/><rect x="${b ? 222 : 176}" y="162" width="6" height="5" fill="#6d4526"/>
  <ellipse cx="292" cy="150" rx="30" ry="9" fill="#555"/><rect x="262" y="128" width="60" height="22" rx="6" fill="#6b7480"/><rect x="258" y="126" width="68" height="6" rx="3" fill="#4d5560"/>
  ${b ? '' : '<g stroke="#fff" stroke-width="4" stroke-linecap="round" fill="none" opacity=".95"><path d="M278 118 q-6 -8 0 -14"/><path d="M292 118 q-6 -8 0 -14"/><path d="M306 118 q-6 -8 0 -14"/></g>'}
  <circle cx="40" cy="205" r="30" fill="#4c8f4a"/><circle cx="22" cy="220" r="20" fill="#5aa457"/>
  <rect x="320" y="225" width="60" height="30" fill="#b88d5a"/><rect x="330" y="215" width="40" height="14" fill="#e9d3a6"/>`),
};

// ---------------------------------------------------------------- 2) ingredient market
const market: Scene = {
  id: 1, name: 'ตลาดวัตถุดิบ',
  diffs: [
    { id: 0, x: 116, y: 186, what: 'มะเขือเทศหาย' },
    { id: 1, x: 246, y: 76, what: 'แถบผ้าใบ' },
    { id: 2, x: 330, y: 150, what: 'ราคาป้าย' },
    { id: 3, x: 212, y: 236, what: 'แมวหาย' },
    { id: 4, x: 150, y: 148, what: 'กระเทียมห้อย' },
  ],
  render: (b) => wrap(`${sky}
  <rect x="40" y="60" width="8" height="170" fill="#7a4e2b"/><rect x="352" y="60" width="8" height="170" fill="#7a4e2b"/>
  ${[0, 1, 2, 3, 4, 5, 6].map((i) => `<polygon points="${34 + i * 47},58 ${81 + i * 47},58 ${88 + i * 47},92 ${27 + i * 47},92" fill="${i === 4 ? (b ? '#3f7fb5' : '#e0573b') : i % 2 ? '#fff' : '#e0573b'}"/>`).join('')}
  <path d="M34 92 h340" stroke="#a83b25" stroke-width="3"/>
  <line x1="110" y1="92" x2="110" y2="118" stroke="#6d4526" stroke-width="2"/>
  ${[0, 1, 2, 3].map((i) => `<ellipse cx="${110 + (i % 2 ? 8 : -8)}" cy="${122 + i * 11}" rx="9" ry="8" fill="#f4ead0" stroke="#d6c7a1"/>`).join('')}
  <line x1="150" y1="92" x2="150" y2="108" stroke="#6d4526" stroke-width="2"/>
  ${[0, 1, 2, b ? null : 3].filter((v) => v !== null).map((i) => `<ellipse cx="150" cy="${112 + (i as number) * 12}" rx="8" ry="7" fill="#f4ead0" stroke="#d6c7a1"/>`).join('')}
  <rect x="290" y="108" width="84" height="64" rx="4" fill="#2b3a33" stroke="#8a5a33" stroke-width="5"/>
  <text x="332" y="132" font-size="13" fill="#fff" text-anchor="middle">TOMATO</text><text x="332" y="158" font-size="24" font-weight="bold" fill="#f6d365" text-anchor="middle">${b ? '35' : '25'}</text>
  <rect x="60" y="170" width="150" height="56" fill="#b88d5a" stroke="#8a5a33" stroke-width="3"/>
  ${[0, 1, 2, 3, 4, 5].map((i) => ({ x: 78 + (i % 3) * 38, y: 186 + Math.floor(i / 3) * 24 })).filter((p, i) => !(b && i === 1)).map((p) => `<circle cx="${p.x}" cy="${p.y}" r="13" fill="#d8402c"/><rect x="${p.x - 3}" y="${p.y - 15}" width="6" height="5" fill="#3b8a3b"/>`).join('')}
  <rect x="226" y="190" width="104" height="38" fill="#b88d5a" stroke="#8a5a33" stroke-width="3"/>
  ${[0, 1, 2, 3].map((i) => `<polygon points="${244 + i * 24},196 ${236 + i * 24},222 ${252 + i * 24},222" fill="#f08a24"/>`).join('')}
  ${b ? '' : `<g transform="translate(190,222)"><ellipse cx="22" cy="26" rx="20" ry="14" fill="#555"/><circle cx="12" cy="10" r="10" fill="#555"/><polygon points="5,2 8,-6 12,2" fill="#555"/><polygon points="14,2 18,-6 20,3" fill="#555"/><path d="M42 26 q12 -4 10 -18" stroke="#555" stroke-width="5" fill="none" stroke-linecap="round"/></g>`}
  <circle cx="26" cy="204" r="26" fill="#4c8f4a"/><rect x="236" y="236" width="50" height="22" rx="4" fill="#e9d3a6"/>`),
};

// ---------------------------------------------------------------- 3) dining tent
const dining: Scene = {
  id: 2, name: 'ลานกินข้าว',
  diffs: [
    { id: 0, x: 219, y: 100, what: 'สีดอกไม้' },
    { id: 1, x: 154, y: 139, what: 'ถ้วยหาย' },
    { id: 2, x: 330, y: 69, what: 'โคมไฟหาย' },
    { id: 3, x: 68, y: 180, what: 'สีเก้าอี้' },
    { id: 4, x: 336, y: 228, what: 'กองไฟ' },
  ],
  render: (b) => wrap(`${sky}
  <polygon points="40,110 200,30 360,110" fill="#f4ead0"/><polygon points="40,110 200,30 360,110" fill="none" stroke="#2f5d3a" stroke-width="5"/>
  <path d="M60 100 Q200 140 340 100" stroke="#7a4e2b" stroke-width="2" fill="none"/>
  ${[100, 140, 180, 220, 260, 300].map((x, i) => `<circle cx="${x}" cy="${112 + Math.sin(i * 1.05) * 6}" r="5" fill="${['#f2b134', '#e0573b', '#3f7fb5'][i % 3]}"/>`).join('')}
  ${b ? '' : '<line x1="330" y1="92" x2="330" y2="56" stroke="#6d4526" stroke-width="2"/><rect x="320" y="56" width="20" height="26" rx="5" fill="#e0573b"/><rect x="326" y="52" width="8" height="5" fill="#6d4526"/>'}
  <rect x="100" y="150" width="200" height="14" rx="4" fill="#8a5a33"/><rect x="116" y="164" width="9" height="52" fill="#6d4526"/><rect x="275" y="164" width="9" height="52" fill="#6d4526"/>
  <ellipse cx="140" cy="146" rx="26" ry="7" fill="#fff" stroke="#c8c8c8"/><ellipse cx="140" cy="144" rx="18" ry="4" fill="#f2b134"/>
  ${b ? '' : '<rect x="144" y="130" width="20" height="18" rx="3" fill="#3f7fb5"/>'}
  <ellipse cx="260" cy="146" rx="26" ry="7" fill="#fff" stroke="#c8c8c8"/><ellipse cx="260" cy="144" rx="18" ry="4" fill="#d8402c"/>
  <rect x="206" y="116" width="26" height="30" rx="5" fill="#9bd0e8" stroke="#6aa6c4"/>
  <path d="M219 116 V104" stroke="#3b8a3b" stroke-width="3"/><circle cx="219" cy="100" r="9" fill="${b ? '#f2b134' : '#e0573b'}"/><circle cx="219" cy="100" r="3" fill="#f6d365"/>
  <rect x="50" y="176" width="40" height="8" rx="3" fill="${b ? '#3f7fb5' : '#d9663f'}"/><rect x="52" y="146" width="8" height="40" fill="${b ? '#3f7fb5' : '#d9663f'}"/><rect x="54" y="184" width="6" height="32" fill="#6d4526"/><rect x="82" y="184" width="6" height="32" fill="#6d4526"/>
  <rect x="312" y="244" width="48" height="8" rx="3" fill="#6d4526" transform="rotate(8 336 248)"/><rect x="312" y="244" width="48" height="8" rx="3" fill="#7a4e2b" transform="rotate(-8 336 248)"/>
  <path d="M336 244 q-18 -14 -6 -30 q4 12 10 6 q14 6 -4 24z" fill="${b ? '#3f7fb5' : '#f08a24'}"/><path d="M336 244 q-8 -8 -2 -16 q8 6 2 16z" fill="${b ? '#9bd0e8' : '#f6d365'}"/>
  <circle cx="368" cy="204" r="26" fill="#4c8f4a"/>`),
};

export const SCENES: Scene[] = [kitchen, market, dining];

export function nearestDiff(scene: Scene, px: number, py: number, exclude: number[]): Diff | null {
  let best: Diff | null = null, bd = Infinity;
  for (const d of scene.diffs) {
    if (exclude.includes(d.id)) continue;
    const dist = Math.hypot(d.x - px, d.y - py);
    if (dist <= HIT_R && dist < bd) { best = d; bd = dist; }
  }
  return best;
}
