'use client';

import { useEffect, useState } from 'react';
import { CampTent, Coin, Pot } from '@/components/Icons';
import AppIcon from '@/components/AppIcon';

type Team = {
  id: string; name: string; balance: number; spent: number; participants: number; completed: number;
  inProgress: number; huntFound: number; quizTokens: number; huntTokens: number; puzzleTokens: number; goalNeed: number; goalMet: boolean;
};
type Live = {
  open: boolean; huntOpen: boolean; puzzleOpen: boolean; totalSpots: number; goalPct: number; teams: Team[];
  feed: { at: string; kind: 'hunt' | 'redeem' | 'quiz' | 'puzzle'; team: string; text: string }[];
};

const ICON = { hunt: 'hunt', redeem: 'shop', quiz: 'check', puzzle: 'camera' } as const;
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
          <div className="live-kicker">Agency Camp · Food</div>
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
        <button className="live-fs" onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}><AppIcon name="overview" size={18} /> เต็มจอ</button>
      </header>

      <main className="live-main">
        <section className="live-board">
          {ranked.map((t, i) => (
            <div className="live-row" key={t.id}>
              <div className={`live-rank${i < 3 ? ` place-${i + 1}` : ''}`}><span className="live-rank-icon" aria-hidden>{i < 3 ? <AppIcon name="trophy" size={26} /> : null}</span><span>{i + 1}</span></div>
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
                <span className="live-ic"><AppIcon name={ICON[f.kind]} size={22} /></span>
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
    .dot{display:inline-block;width:.7em;height:.7em;border-radius:50%;background:#c2504a;margin-right:.4em}.dot.on{background:#3ea85f;box-shadow:0 0 10px #7ed49a}
    .live-stats{display:flex;gap:2.4vw;align-items:center}
    .live-stats div{text-align:center}.live-stats b{display:block;font-size:2em;line-height:1;color:#1f2f4d}.live-stats span{color:#4a5a74;font-size:.8em}
    .live-clock{font-size:2.2em;font-weight:700;font-variant-numeric:tabular-nums}
    .live-fs{background:#fff;border:2px solid rgba(31,47,77,.2);color:#1f2f4d;border-radius:12px;padding:.4em 1em;cursor:pointer;font-size:.8em}
    .live-main{flex:1;display:grid;grid-template-columns:2.2fr 1fr;gap:2.4vw;min-height:0}
    @media(max-width:900px){.live-main{grid-template-columns:1fr}}
    .live-board{display:flex;flex-direction:column;gap:1.6vh;min-height:0}
    .live-row{flex:1;min-height:0;display:flex;gap:1.6vw;align-items:center;background:#fff;border-radius:22px;padding:1vh 1.8vw;box-shadow:0 8px 22px rgba(60,50,30,.12)}
    .live-rank{font-size:2.4em;width:1.3em;text-align:center;font-weight:700}
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
    .live-fs{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:44px}
    .live-rank{display:flex;flex-direction:column;align-items:center;justify-content:center;line-height:1.15;gap:.12em}
    .live-rank-icon{display:flex;align-items:center;justify-content:center}
    .live-rank.place-1{color:#a36a13}.live-rank.place-2{color:#69758a}.live-rank.place-3{color:#a65d36}
    .live-top>div,.live-row,.live-feed li>span{min-width:0}
    .live-sub{display:flex;align-items:center;flex-wrap:wrap;gap:.3em}
    .live-name>span:first-child,.live-feed li>span,.live-msg{overflow-wrap:anywhere}
    @media(min-width:901px){
      .live-board{overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;padding:2px 4px 8px 2px}
      .live-row{flex:1 0 auto}
    }
    @media(max-width:1100px){
      .live{font-size:clamp(14px,1.55vw,20px)}
      .live-top h1{font-size:2.15em}
      .live-stats{gap:1.2vw}
    }
    @media(min-width:901px) and (max-height:850px){
      .live{font-size:clamp(13px,1.8vh,18px)}
    }
    @media(max-width:900px){
      .live{height:auto;min-height:100dvh;overflow:visible}
      .live-main{flex:none;min-height:0}
      .live-row{min-height:140px}
      .live-feed{min-height:220px}
    }
    @media(max-width:767px){
      .live{height:auto;min-height:100dvh;overflow:visible;padding:20px 14px 28px;gap:18px;font-size:16px}
      .live-top{gap:14px;align-items:flex-start}
      .live-top>div:first-child{flex:1 1 100%}
      .live-top h1{font-size:clamp(26px,7vw,36px);line-height:1.15}
      .live-kicker{font-size:11px;letter-spacing:.2em}
      .live-sub{font-size:13px;line-height:1.8}
      .live-sub .dot{margin-left:10px!important;margin-right:0}
      .live-sub .dot:first-child{margin-left:0!important}
      .live-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%;text-align:left}
      .live-stats>div{min-width:0}.live-stats b{font-size:24px}.live-stats span{font-size:12px;line-height:1.4;display:block}
      .live-clock{grid-column:1/-1;font-size:17px;text-align:right}
      .live-fs{width:100%;font-size:15px}
      .live-main{display:grid;grid-template-columns:minmax(0,1fr);flex:none;gap:18px;min-height:0}
      .live-board{gap:12px}.live-row{min-height:0;gap:10px}.live-rank{font-size:20px;width:32px;flex:none}
      .live-rank-icon svg{width:22px;height:22px}.live-row{padding:14px;border-radius:18px;min-width:0}
      .live-name{font-size:21px;gap:10px;flex-wrap:wrap;line-height:1.35}.live-coins{font-size:24px}.live-coins svg{width:30px;height:30px}
      .live-meta{font-size:12px;line-height:1.7;gap:3px 12px}.live-goal{font-size:12px;line-height:1.6;flex-wrap:wrap;gap:7px}.live-gbar{flex-basis:100%}
      .live-feed{padding:16px;border-radius:18px;min-height:200px}.live-feed h2{font-size:20px}
      .live-feed li{font-size:14px;gap:8px}.live-feed time{font-size:12px}.live-ic{width:24px;flex:none}
      .live-deco{opacity:.25;pointer-events:none}
    }
    @media(display-mode:fullscreen){.live-fs{display:none}}
    `}</style>
  );
}
