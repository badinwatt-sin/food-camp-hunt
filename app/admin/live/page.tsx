'use client';

import { useEffect, useState } from 'react';
import { CampTent, Coin, Pot } from '@/components/Icons';
import { liveRank, liveTeams } from '@/lib/live-board';

type Team = {
  id: string; name: string; lineGroupCode: string | null; balance: number; spent: number; participants: number; completed: number;
  inProgress: number; huntFound: number; quizTokens: number; huntTokens: number; puzzleTokens: number; goalNeed: number; goalMet: boolean;
};
type Live = {
  open: boolean; huntOpen: boolean; puzzleOpen: boolean; totalSpots: number; goalPct: number; teams: Team[];
  feed: { at: string; kind: 'hunt' | 'redeem' | 'quiz' | 'puzzle'; teamId: string; team: string; text: string }[];
};

const ICON = { hunt: '🧭', redeem: '🛒', quiz: '✅', puzzle: '🧩' } as const;
const MEDAL = ['🥇', '🥈', '🥉', '🎖️'];
const clock = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

export default function LivePage() {
  const [d, setD] = useState<Live | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'noauth' | 'error'>('loading');
  const [now, setNow] = useState('');

  useEffect(() => {
    let stop = false;
    async function tick() {
      try {
        const res = await fetch('/api/admin/live', { cache: 'no-store' });
        if (res.status === 401 || res.status === 403) { if (!stop) setState('noauth'); return; }
        if (!res.ok) throw new Error();
        const j = await res.json();
        if (!stop) { setD(j); setState('ok'); }
      } catch { if (!stop) setState((s) => (s === 'ok' ? 'ok' : 'error')); } // keep last data if a refresh fails
    }
    tick();
    const t = setInterval(tick, 5000);
    const c = setInterval(() => setNow(new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })), 1000);
    return () => { stop = true; clearInterval(t); clearInterval(c); };
  }, []);

  if (state === 'noauth') {
    return <div className="live"><div className="live-msg"><h1>ต้องเข้าสู่ระบบผู้จัดก่อน</h1><a href="/admin">ไปหน้า /admin แล้วกลับมาที่หน้านี้</a></div><Style /></div>;
  }
  if (!d) return <div className="live"><div className="live-msg"><h1>{state === 'error' ? 'เชื่อมต่อไม่ได้ กำลังลองใหม่…' : 'กำลังโหลด…'}</h1></div><Style /></div>;

  const ranked = liveTeams(d.teams);
  const names = new Map(ranked.map((team) => [team.id, team.name]));
  const feed = d.feed.filter((entry) => names.has(entry.teamId)).map((entry) => ({ ...entry, team: names.get(entry.teamId)! }));
  const hasTokens = ranked.some((team) => team.balance > 0);
  const max = Math.max(1, ...ranked.map((t) => t.balance));
  const totalDone = ranked.reduce((n, t) => n + t.completed, 0);
  const totalP = ranked.reduce((n, t) => n + t.participants, 0);
  const totalTokens = ranked.reduce((n, t) => n + t.balance, 0);
  const huntDone = ranked.reduce((n, t) => n + t.huntFound, 0);

  return (
    <div className="live">
      <header className="live-top">
        <div>
          <div className="live-kicker">Agency Camp · Food</div>
          <h1>Food Camp Hunt</h1>
          <div className="live-sub">
            <span className={`dot ${d.open ? 'on' : ''}`} /> ควิซ {d.open ? 'เปิด' : 'ปิด'}
            <span className={`dot ${d.huntOpen ? 'on' : ''}`} style={{ marginLeft: 22 }} /> ล่าสมบัติ {d.huntOpen ? 'เปิด' : 'ปิด'}
            <span className={`dot ${d.puzzleOpen ? 'on' : ''}`} style={{ marginLeft: 22 }} /> ภารกิจทีม {d.puzzleOpen ? 'เปิด' : 'ปิด'}
          </div>
          <div className="live-ranking-note">{hasTokens ? 'อันดับปัจจุบันตาม Tokens คงเหลือ' : 'รอเริ่มสะสม Tokens · ยังไม่จัดอันดับ'}</div>
        </div>
        <div className="live-stats">
          <div><b>{totalDone}/{totalP}</b><span>เล่นควิซจบ</span></div>
          <div><b>{huntDone}</b><span>จุดที่พบ (รวมทุกทีม)</span></div>
          <div><b>{totalTokens}</b><span>โทเคนคงเหลือรวม</span></div>
          <div className="live-clock">{now}</div>
        </div>
        <button className="live-fs" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>เต็มจอ</button>
      </header>

      <main className="live-main">
        <section className="live-board">
          {ranked.length === 0 && <div className="live-msg">ยังไม่พบทีมแข่งขัน<br />ให้ Admin ตรวจรหัสกลุ่ม LINE D / C / A / O ของทีม</div>}
          {ranked.map((t) => {
            const rank = liveRank(t.balance, ranked);
            const tied = rank !== null && ranked.some((other) => other.id !== t.id && other.balance === t.balance);
            return (
              <div className="live-row" key={t.id}>
                <div className="live-rank" role="img" aria-label={rank === null ? 'รอเริ่มสะสม Tokens' : `อันดับ ${rank}${tied ? ' ร่วม' : ''}`}>
                  <span aria-hidden="true">{rank === null ? '🏕️' : MEDAL[rank - 1]}</span>
                  {tied && <small aria-hidden="true">ร่วม</small>}
                </div>
                <div className="live-body">
                  <div className="live-name"><span>{t.name}</span><span className="live-coins"><Coin size={40} /> {t.balance}</span></div>
                  <div className="live-bar"><i style={{ width: `${(t.balance / max) * 100}%` }} /></div>
                  {d.goalPct > 0 && (
                    <div className="live-goal">
                      <div className="live-gbar">
                        <i className={t.goalMet ? 'ok' : ''} style={{ width: `${t.participants ? Math.min(100, (t.completed / t.participants) * 100) : 0}%` }} />
                        <b style={{ left: `${d.goalPct}%` }} />
                      </div>
                      <span>{t.goalMet ? '🔓 ถึงเป้า ปลดล็อกสินค้าพิเศษแล้ว' : `🔒 เป้า ${d.goalPct}% · อีก ${t.goalNeed} คน`}</span>
                    </div>
                  )}
                  <div className="live-meta">
                    <span>ควิซ {t.completed}/{t.participants} คน · +{t.quizTokens}</span>
                    <span>🧭 พบ {t.huntFound} ครั้ง · +{t.huntTokens}</span>
                    <span>🧩 ภารกิจทีม +{t.puzzleTokens}</span>
                    <span>ใช้ไปแล้ว {t.spent}</span>
                  </div>
                </div>
              </div>
            );
          })}
        </section>

        <aside className="live-feed">
          <h2>ความเคลื่อนไหวล่าสุด</h2>
          {feed.length === 0 && <p className="live-empty">ยังไม่มีความเคลื่อนไหว</p>}
          <ul>
            {feed.map((f, i) => (
              <li key={i}>
                <span className="live-ic">{ICON[f.kind]}</span>
                <span><b>{f.team}</b> {f.text}</span>
                <time>{clock(f.at)}</time>
              </li>
            ))}
          </ul>
          <div className="live-deco"><Pot size={64} /><CampTent size={130} /></div>
        </aside>
      </main>
      <Style />
    </div>
  );
}

function Style() {
  return (
    <style>{`
    body{background:#fbf8f0}
    .live{height:100dvh;overflow:hidden;background:linear-gradient(180deg,#cfe7f2 0,#e9f4ea 24%,#fbf8f0 58%);color:#1f2f4d;padding:2vh 3vw;display:flex;flex-direction:column;gap:2vh;font-size:clamp(13px,min(1.4vw,2.3vh),26px)}
    .live-msg{margin:auto;text-align:center}.live-msg a{color:#2f6b4a;font-weight:700}
    .live-top{display:flex;align-items:center;justify-content:space-between;gap:2vw;flex-wrap:wrap}
    .live-kicker{font-size:.55em;letter-spacing:.32em;font-weight:700;color:#2f6b4a;text-transform:uppercase}
    .live-top h1{margin:0;font-size:2.6em;line-height:1.1;color:#1f2f4d}
    .live-sub{color:#35523f;margin-top:.3em;font-weight:600}
    .live-ranking-note{margin-top:.3em;font-size:.75em;color:#4a5a74}
    .dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;background:#c2504a;margin-right:.4em}.dot.on{background:#3ea85f;box-shadow:0 0 10px #7ed49a}
    .live-stats{display:flex;gap:2.4vw;align-items:center}
    .live-stats div{text-align:center}.live-stats b{display:block;font-size:2em;line-height:1;color:#1f2f4d}.live-stats span{color:#4a5a74;font-size:.8em}
    .live-clock{font-size:2.2em;font-weight:700;font-variant-numeric:tabular-nums}
    .live-fs{background:#fff;border:2px solid rgba(31,47,77,.2);color:#1f2f4d;border-radius:12px;padding:.4em 1em;cursor:pointer;font-size:.8em}
    @media(display-mode:fullscreen){.live-fs{display:none}}
    .live-main{flex:1;display:grid;grid-template-columns:2.2fr 1fr;gap:2.4vw;min-height:0}
    @media(max-width:900px){.live-main{grid-template-columns:1fr}}
    .live-board{display:flex;flex-direction:column;gap:1.6vh;min-height:0}
    .live-row{flex:1;min-height:0;display:flex;gap:1.6vw;align-items:center;background:#fff;border-radius:22px;padding:1vh 1.8vw;box-shadow:0 8px 22px rgba(60,50,30,.12)}
    .live-rank{flex:none;font-size:2.4em;width:1.3em;text-align:center;font-weight:700}
    .live-rank small{display:block;font-size:.28em;line-height:1.2;color:#4a5a74}
    .live-body{flex:1;min-width:0}
    .live-name{display:flex;justify-content:space-between;align-items:center;font-size:1.9em;font-weight:700}
    .live-coins{display:flex;align-items:center;gap:.3em;font-variant-numeric:tabular-nums}
    .live-bar{height:.9em;background:#eadfc6;border-radius:99px;overflow:hidden;margin:.35em 0}
    .live-bar i{display:block;height:100%;background:linear-gradient(90deg,#5f9e6f,#e8b95a);border-radius:99px;transition:width 1s ease}
    .live-goal{display:flex;align-items:center;gap:1.2vw;margin:.2em 0 .5em;font-size:.85em;color:#35523f}
    .live-gbar{flex:0 0 40%;position:relative;height:.55em;background:#eadfc6;border-radius:99px}
    .live-gbar i{display:block;height:100%;background:#5f9e6f;border-radius:99px;transition:width 1s}.live-gbar i.ok{background:#2f8f5b}
    .live-gbar b{position:absolute;top:-.3em;width:3px;height:1.15em;background:#1f2f4d}
    .live-meta{display:flex;gap:2vw;flex-wrap:wrap;color:#4a5a74;font-size:.9em}
    .live-feed{background:#fff;border-radius:22px;padding:1.6vw;position:relative;overflow:hidden;min-height:0;box-shadow:0 8px 22px rgba(60,50,30,.12)}
    .live-feed h2{margin:0 0 .6em;font-size:1.4em}
    .live-feed ul{list-style:none;margin:0;padding:0}
    .live-feed li{display:flex;gap:.7em;align-items:baseline;padding:.55em 0;border-bottom:1px dashed #eadfc6;font-size:.95em}
    .live-feed li time{margin-left:auto;color:#4a5a74;font-variant-numeric:tabular-nums}
    .live-empty{color:#4a5a74}
    .live-deco{position:absolute;right:1vw;bottom:0;opacity:.9;display:flex;align-items:flex-end}
    .live-name{gap:12px;flex-wrap:wrap}.live-name>span:first-child{min-width:0;overflow-wrap:anywhere}.live-coins{flex:none}
    .live-board{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin}.live-row{flex:1 0 auto}
    .live-feed li>span{min-width:0;overflow-wrap:anywhere}.live-feed li time{flex:none}
    @media(max-width:900px){
      .live{height:auto;min-height:100dvh;overflow:visible;padding:20px 14px;gap:18px}
      .live-top>div{min-width:0}.live-top h1{font-size:clamp(26px,6vw,38px)}
      .live-sub{font-size:13px;line-height:1.8}.live-ranking-note{font-size:12px}
      .live-stats{gap:16px;flex-wrap:wrap}.live-stats b{font-size:26px}.live-stats span{font-size:12px}.live-clock{font-size:22px}
      .live-fs{min-height:44px;font-size:14px}.live-main{flex:none;grid-template-columns:minmax(0,1fr);gap:16px}
      .live-board{overflow:visible;gap:12px}.live-row{flex:none;min-height:125px;padding:16px;gap:12px}
      .live-rank{font-size:30px}.live-name{font-size:22px;line-height:1.4}.live-coins{font-size:24px}.live-coins svg{width:28px;height:28px}
      .live-meta{font-size:12px;gap:4px 12px}.live-goal{font-size:12px;flex-wrap:wrap}.live-gbar{flex-basis:100%}
      .live-feed{min-height:220px;padding:18px}.live-feed h2{font-size:22px}.live-feed li{font-size:14px}.live-deco{opacity:.3;pointer-events:none}
    }
    `}</style>
  );
}
