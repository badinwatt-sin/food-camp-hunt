// Small inline SVG illustrations (original, no third-party artwork).
export function Tent({ size = 90 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d="M8 86 L50 18 L92 86 Z" fill="#bfe3c8" />
      <path d="M50 18 L92 86 L62 86 L50 60 Z" fill="#7fbf93" />
      <path d="M50 86 L50 58 L38 86 Z" fill="#1b2a4a" />
      <path d="M50 18 L50 10" stroke="#fbf6e9" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 10 L62 14 L50 18 Z" fill="#f2c46d" />
    </svg>
  );
}
export function Tree({ size = 60 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden>
      <path d="M30 4 L48 30 L38 30 L52 50 L8 50 L22 30 L12 30 Z" fill="#7fbf93" />
      <rect x="27" y="50" width="6" height="8" fill="#fbf6e9" />
    </svg>
  );
}
export function Pot({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden>
      <path d="M12 6 q4 6 0 10 M24 4 q4 6 0 10 M36 6 q4 6 0 10" stroke="#bfe3c8" strokeWidth="3" fill="none" strokeLinecap="round" />
      <rect x="6" y="20" width="36" height="20" rx="8" fill="#f2c46d" />
      <rect x="2" y="22" width="6" height="5" rx="2" fill="#f2c46d" />
      <rect x="40" y="22" width="6" height="5" rx="2" fill="#f2c46d" />
    </svg>
  );
}
export function Carrot({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <path d="M8 14 C14 10 30 24 34 32 C26 36 10 24 8 14 Z" fill="#f2a65a" />
      <path d="M8 14 L4 6 M8 14 L2 12 M8 14 L10 4" stroke="#7fbf93" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
export function Coin({ size = 40 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <circle cx="20" cy="20" r="18" fill="#f2c46d" stroke="#1b2a4a" strokeWidth="2.5" />
      <circle cx="20" cy="20" r="12" fill="none" stroke="#1b2a4a" strokeWidth="1.5" strokeDasharray="3 3" />
      <path d="M14 22 q6 8 12 0 M16 16 h8" stroke="#1b2a4a" strokeWidth="2.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}

export function Hero({ subtitle }: { subtitle?: string }) {
  return (
    <header className="hero">
      <h1>Food Camp Hunt</h1>
      <p>{subtitle ?? 'ทายอาหาร ล่าสมบัติ สะสมโทเคนให้ทีม'}</p>
      <div className="deco" style={{ display: 'flex', alignItems: 'flex-end', gap: 2 }}>
        <Tree size={46} />
        <Tent size={84} />
      </div>
    </header>
  );
}
