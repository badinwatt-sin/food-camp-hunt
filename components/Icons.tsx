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

export function HomeIcon({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10v9.5a1 1 0 0 0 1 1H10v-5.5h4v5.5h3.5a1 1 0 0 0 1-1V10" />
    </svg>
  );
}
export function Campfire({ size = 56 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <path d="M32 6c3 8 12 12 12 24a12 12 0 0 1-24 0c0-6 3-9 5-12 1 4 3 5 5 5-2-6-1-11 2-17z" fill="#ee7d3b" />
      <path d="M32 24c2 5 7 7 7 14a7 7 0 0 1-14 0c0-4 2-6 4-8 0 3 1 4 3 4-1-4-1-7 0-10z" fill="#f7c35a" />
      <rect x="10" y="50" width="44" height="7" rx="3.5" fill="#8a5a2b" transform="rotate(-8 32 53)" />
      <rect x="10" y="50" width="44" height="7" rx="3.5" fill="#6e4520" transform="rotate(8 32 53)" />
    </svg>
  );
}
/** Mission: a flag planted on a peak. */
export function IconMission({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden>
      <path d="M4 62 28 22l12 18 8-11 20 33z" fill="#fff" opacity=".9" />
      <path d="M28 22 40 40l-6 3-6-5-6 8z" fill="#cfe8c4" />
      <rect x="44" y="8" width="3.5" height="30" rx="1.7" fill="#6e4520" />
      <path d="M47.5 9h18l-6 7 6 7h-18z" fill="#ee7d3b" />
      <circle cx="16" cy="16" r="5" fill="#f7c35a" />
    </svg>
  );
}
/** Team: a ring of three campers. */
export function IconTeam({ size = 72 }: { size?: number }) {
  const person = (x: number, c: string) => (
    <g key={x}>
      <circle cx={x} cy="30" r="9" fill="#fff" />
      <path d={`M${x - 15} 62c0-12 7-20 15-20s15 8 15 20z`} fill={c} />
    </g>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden>
      {person(14, '#cfe8c4')}
      {person(58, '#f7c35a')}
      {person(36, '#fff')}
      <path d="M2 66h68" stroke="#fff" strokeWidth="3" strokeLinecap="round" opacity=".6" />
    </svg>
  );
}
/** Market: a stall with a striped awning. */
export function IconShop({ size = 72 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 72 72" aria-hidden>
      <path d="M6 24 12 8h48l6 16z" fill="#fff" />
      {[0, 1, 2, 3, 4].map((k) => (
        <path key={k} d={`M${6 + k * 12} 24 ${12 + k * 9.6} 8h9.6L${18 + k * 12} 24z`} fill={k % 2 ? '#fff' : '#ee7d3b'} />
      ))}
      <path d="M6 24a6 6 0 0 0 12 0 6 6 0 0 0 12 0 6 6 0 0 0 12 0 6 6 0 0 0 12 0 6 6 0 0 0 12 0" fill="#f7c35a" />
      <rect x="10" y="32" width="52" height="32" rx="3" fill="#fff" opacity=".9" />
      <rect x="16" y="40" width="14" height="14" rx="3" fill="#ee7d3b" />
      <circle cx="46" cy="47" r="8" fill="#f7c35a" />
      <rect x="38" y="56" width="18" height="4" rx="2" fill="#6fae6b" />
    </svg>
  );
}

/** Camp tent in earth tones (sand canvas, clay stripe, navy door). */
export function CampTent({ size = 80 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden>
      <path d="M6 88 50 14l44 74z" fill="#efe3c6" />
      <path d="M50 14 94 88H64L50 58z" fill="#d8c79f" />
      <path d="M50 14 50 88H6z" fill="#f6edd6" opacity=".6" />
      <path d="M50 14 6 88h12L50 30z" fill="#c4764a" />
      <path d="M50 88V58l-13 30z" fill="#1f2f4d" />
      <path d="M50 14V6" stroke="#8a5a2b" strokeWidth="3" strokeLinecap="round" />
      <path d="M50 6l13 4-13 4z" fill="#2f6b4a" />
    </svg>
  );
}

/** Daytime camp header: sky, sun, clouds, green hills, pines, an earth-tone tent, a campfire pot and carrots. */
export function Hero({ subtitle, onHome, compact, actions, title }: { subtitle?: string; onHome?: () => void; compact?: boolean; actions?: React.ReactNode; title?: string }) {
  return (
    <header className={`hero${compact ? ' compact' : ''}`}>
      <svg className="hero-scene" viewBox="0 0 480 170" preserveAspectRatio="xMidYMax slice" aria-hidden>
        <circle cx="420" cy="38" r="30" fill="#fbe39a" opacity=".45" />
        <circle cx="420" cy="38" r="19" fill="#f7d774" />
        <g fill="#fff" opacity=".92">
          <ellipse cx="300" cy="34" rx="30" ry="9" /><ellipse cx="322" cy="28" rx="20" ry="9" /><ellipse cx="282" cy="30" rx="16" ry="7" />
          <ellipse cx="120" cy="22" rx="26" ry="7" /><ellipse cx="138" cy="17" rx="16" ry="7" />
        </g>
        <path d="M0 118 60 82l54 30 64-46 70 50 60-34 84 48 88-36v76H0z" fill="#b9d9b4" />
        <path d="M0 138 70 106l60 26 74-34 80 38 70-28 70 26 56-22v60H0z" fill="#7fb283" />
        <path d="M0 154 60 132l70 16 80-20 90 22 70-16 70 16 40-10v10H0z" fill="#4f8f64" />
        {[[28, 132], [54, 140], [338, 134], [362, 142], [386, 130], [446, 138]].map(([x, y], k) => (
          <path key={k} d={`M${x} ${y - 32} ${x + 11} ${y} ${x - 11} ${y}z M${x} ${y - 21} ${x + 14} ${y + 8} ${x - 14} ${y + 8}z`} fill="#2f6b4a" />
        ))}
      </svg>
      <div className="hero-row">
        {onHome && (
          <button className="home-btn" onClick={onHome} aria-label="กลับหน้าหลัก" title="หน้าหลัก"><HomeIcon size={24} /></button>
        )}
        <div className="hero-text">
          <div className="kicker">Agency Camp · Food</div>
          <h1>{title ?? 'Food Camp Hunt'}</h1>
          <p>{subtitle ?? 'ทายอาหาร ล่าสมบัติ สะสมโทเคนให้ทีม'}</p>
        </div>
        {actions && <div className="hero-actions">{actions}</div>}
      </div>
      <div className="deco" aria-hidden>
        <Carrot size={30} />
        <CampTent size={74} />
        <Pot size={36} />
      </div>
    </header>
  );
}
