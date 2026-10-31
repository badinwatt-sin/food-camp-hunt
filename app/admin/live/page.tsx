'use client';

import { useEffect, useState } from 'react';
import { Coin, Tent, Tree } from '@/components/Icons';

type Team = {
  id: string; name: string; balance: number; spent: number; participants: number; completed: number;
  inProgress: number; huntFound: number; quizTokens: number; huntTokens: number; puzzleTokens: number; goalNeed: number; goalMet: boolean;
};
type Live = {
  open: boolean; huntOpen: boolean; puzzleOpen: boolean; totalSpots: number; goalPct: number; teams: Team[];
  feed: { at: string; kind: 'hunt' | 'redeem' | 'quiz' | 'puzzle'; team: string; text: string }[];
};

const ICON = { hunt: '🧭', redeem: '🛒', quiz: '✅', puzzle: '🧩' } as const;
const MEDAL = ['🥇', '🥈', '🥉'];
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

  const ranked = [...d.teams].sort((a, b) => b.balance - a.balance || a.name.localeCompare(b.name));
  const max = Math.max(1, ...ranked.map((t) => t.balance));
  const totalDone = d.teams.reduce((n, t) => n + t.completed, 0);
  const totalP = d.teams.reduce((n, t) => n + t.participants, 0);
  const totalTokens = d.teams.reduce((n, t) => n + t.balance, 0);
  const huntDone = d.teams.reduce((n, t) => n + t.huntFound, 0);

  return (
    <div className="live">
      <header className="live-top">
        <div>
          <h1>Food Camp Hunt</h1>
          <div className="live-sub">
            <span className={`dot ${d.open ? 'on' : ''}`} /> ควิซ {d.open ? 'เปิด' : 'ปิด'}
            <span className={`dot ${d.huntOpen ? 'on' : ''}`} style={{ marginLeft: 22 }} /> ล่าสมบัติ {d.huntOpen ? 'เปิด' : 'ปิด'}
            <span className={`dot ${d.puzzleOpen ? 'on' : ''}`} style={{ marginLeft: 22 }} /> ภารกิจทีม {d.puzzleOpen ? 'เปิด' : 'ปิด'}
          </div>
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
          {ranked.map((t, i) => (
            <div className="live-row" key={t.id}>
              <div className="live-rank">{MEDAL[i] ?? i + 1}</div>
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
          ))}
        </section>

        <aside className="live-feed">
          <h2>ความเคลื่อนไหวล่าสุด</h2>
          {d.feed.length === 0 && <p className="live-empty">ยังไม่มีความเคลื่อนไหว</p>}
          <ul>
            {d.feed.map((f, i) => (
              <li key={i}>
                <span className="live-ic">{ICON[f.kind]}</span>
                <span><b>{f.team}</b> {f.text}</span>
                <time>{clock(f.at)}</time>
              </li>
            ))}
          </ul>
          <div className="live-deco"><Tree size={70} /><Tent size={120} /></div>
        </aside>
      </main>
      <Style />
    </div>
  );
}

function Style() {
  return (
    <style>{`
    body{background:#111c36}
    .live{height:100dvh;overflow:hidden;background:#111c36;color:#fbf6e9;padding:2vh 3vw;display:flex;flex-direction:column;gap:2vh;font-size:clamp(13px,min(1.4vw,2.3vh),26px)}
    .live-msg{margin:auto;text-align:center}.live-msg a{color:#bfe3c8}
    .live-top{display:flex;align-items:center;justify-content:space-between;gap:2vw;flex-wrap:wrap}
    .live-top h1{margin:0;font-size:2.6em;line-height:1.1}
    .live-sub{color:#bfe3c8;margin-top:.3em}
    .dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;background:#c2504a;margin-right:.4em}.dot.on{background:#5fd08a;box-shadow:0 0 12px #5fd08a}
    .live-stats{display:flex;gap:2.4vw;align-items:center}
    .live-stats div{text-align:center}.live-stats b{display:block;font-size:2em;line-height:1}.live-stats span{color:#bfe3c8;font-size:.8em}
    .live-clock{font-size:2.2em;font-weight:700;font-variant-numeric:tabular-nums}
    .live-fs{background:transparent;border:2px solid #2d416b;color:#fbf6e9;border-radius:12px;padding:.4em 1em;cursor:pointer;font-size:.8em}
    @media(display-mode:fullscreen){.live-fs{display:none}}
    .live-main{flex:1;display:grid;grid-template-columns:2.2fr 1fr;gap:2.4vw;min-height:0}
    @media(max-width:900px){.live-main{grid-template-columns:1fr}}
    .live-board{display:flex;flex-direction:column;gap:1.6vh;min-height:0}
    .live-row{flex:1;min-height:0;display:flex;gap:1.6vw;align-items:center;background:#1b2a4a;border-radius:20px;padding:1vh 1.8vw}
    .live-rank{font-size:2.4em;width:1.3em;text-align:center;font-weight:700}
    .live-body{flex:1;min-width:0}
    .live-name{display:flex;justify-content:space-between;align-items:center;font-size:1.9em;font-weight:700}
    .live-coins{display:flex;align-items:center;gap:.3em;font-variant-numeric:tabular-nums}
    .live-bar{height:.9em;background:#2d416b;border-radius:99px;overflow:hidden;margin:.35em 0}
    .live-bar i{display:block;height:100%;background:linear-gradient(90deg,#7fbf93,#f2c46d);border-radius:99px;transition:width 1s ease}
    .live-goal{display:flex;align-items:center;gap:1.2vw;margin:.2em 0 .5em;font-size:.85em;color:#bfe3c8}
    .live-gbar{flex:0 0 40%;position:relative;height:.55em;background:#2d416b;border-radius:99px}
    .live-gbar i{display:block;height:100%;background:#7fbf93;border-radius:99px;transition:width 1s}.live-gbar i.ok{background:#5fd08a}
    .live-gbar b{position:absolute;top:-.3em;width:3px;height:1.15em;background:#fbf6e9}
    .live-meta{display:flex;gap:2vw;flex-wrap:wrap;color:#bfe3c8;font-size:.9em}
    .live-feed{background:#1b2a4a;border-radius:20px;padding:1.6vw;position:relative;overflow:hidden;min-height:0}
    .live-feed h2{margin:0 0 .6em;font-size:1.4em}
    .live-feed ul{list-style:none;margin:0;padding:0}
    .live-feed li{display:flex;gap:.7em;align-items:baseline;padding:.55em 0;border-bottom:1px dashed #2d416b;font-size:.95em}
    .live-feed li time{margin-left:auto;color:#bfe3c8;font-variant-numeric:tabular-nums}
    .live-empty{color:#bfe3c8}
    .live-deco{position:absolute;right:1vw;bottom:0;opacity:.35;display:flex;align-items:flex-end}
    `}</style>
  );
}
