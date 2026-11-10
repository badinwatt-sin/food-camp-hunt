'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import { useVisibleRefresh } from '@/lib/use-visible-refresh';
import AppIcon from '@/components/AppIcon';
import { MG_INFO, MG_SUCCESS_RULES, MYSTERY, SPOT, type MgGame } from '@/lib/minigames/config';

type GameStatus = { open: boolean; used: number; max: number; inProgress: boolean; claimed: boolean; best: number; scores: number[]; rewardTokens: number; successRule: string; top: { tokens: number; name: string; team: string; me: boolean }[] };
type Status = { games: Record<MgGame, GameStatus>; isObserver: boolean };
type Result = { tokens: number; awarded: number; best: number; success: boolean; claimed: boolean; rewardTokens: number };
type Props = { onBalance: () => void; onAuthLost: (e: unknown) => void; isObserver?: boolean };

const mmss = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

/** Hub: pick one of the 3 solo games. */
export default function MiniGames({ onBalance, onAuthLost, isObserver = false }: Props) {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [play, setPlay] = useState<MgGame | null>(null);
  const authLost = useRef(onAuthLost);
  authLost.current = onAuthLost;
  const load = useCallback(async () => {
    try { setSt(await api<Status>('/api/minigames')); setErr(''); } catch (e) { authLost.current(e); setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useVisibleRefresh(load, play === null);
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [play]);

  const readOnly = isObserver || !!st?.isObserver;
  if (play && !readOnly) {
    const exit = () => { setPlay(null); load(); onBalance(); };
    const p = { onExit: exit, onAuthLost, rewardTokens: st?.games[play].rewardTokens ?? 0 };
    return play === 'spot' ? <SpotGame {...p} /> : play === 'memory' ? <MemoryGame {...p} /> : <MysteryGame {...p} />;
  }
  return (
    <>
      <div className="card center weekly-hub">
        <h2 className="page-heading" style={{ fontSize: 22 }}><AppIcon name="weekly" />ภารกิจประจำสัปดาห์</h2>
        <div className="muted">ทำภารกิจให้สำเร็จเพื่อรับโทเคนตามที่ผู้จัดกำหนดเข้ากระเป๋าทีม · รับรางวัลครั้งเดียวต่อคนต่อภารกิจ · ลองได้ภารกิจละ 3 ครั้ง</div>
      </div>
      {readOnly && <div className="banner">คณะทำงาน · ดูรายละเอียดภารกิจและความเคลื่อนไหวได้ โดยไม่เข้าร่วมเล่นหรือรับโทเคน</div>}
      {err && <div className="error">{err}</div>}
      {!st && !err && <div className="spinner" />}
      {st && (['spot', 'memory', 'mystery'] as MgGame[]).map((g) => {
        const x = st.games[g], info = MG_INFO[g];
        const left = x.max - x.used;
        return (
          <div className="card weekly-mission-card" key={g}>
            <div className="mission">
              <div className="m-ic" style={{ background: info.color }}><AppIcon name={g === 'spot' ? 'scan' : g === 'memory' ? 'weekly' : 'quiz'} size={32} /></div>
              <div className="m-body"><h2>{info.title}</h2><div className="muted">{info.en}</div></div>
            </div>
            <p style={{ margin: '10px 0 6px' }}>{info.how}</p>
            <div className="row mission-meta" style={{ gap: 8, flexWrap: 'wrap' }}>
              <span className="pill" style={{ background: 'var(--green)', fontSize: 13, padding: '2px 10px' }}>สำเร็จรับ {x.rewardTokens} Tokens</span>
              {!readOnly && <span className="pill" style={{ background: '#f4ead0', fontSize: 13, padding: '2px 10px' }}>ลองแล้ว {x.used}/{x.max} ครั้ง</span>}
              {x.claimed && <span className="pill" style={{ background: '#d9ecd5', fontSize: 13 }}>✓ รับรางวัลแล้ว</span>}
            </div>
            <div className="muted" style={{ marginTop: 8 }}>เงื่อนไขสำเร็จ: {x.successRule || MG_SUCCESS_RULES[g]} · รางวัลเข้ากระเป๋าทีมครั้งเดียว</div>
            {!x.open && <div className="banner" style={{ marginTop: 10 }}>เกมนี้ยังไม่เปิด หรือปิดแล้ว</div>}
            <button className="btn" style={{ marginTop: 12 }} disabled={readOnly || !x.open || x.claimed || (left <= 0 && !x.inProgress)} onClick={() => setPlay(g)}>
              {readOnly ? 'คณะทำงาน · ดูได้อย่างเดียว' : x.claimed ? '✓ รับรางวัลแล้ว' : x.inProgress ? '▶️ ทำภารกิจต่อ' : left <= 0 ? 'ครบ 3 ครั้งแล้ว' : x.used === 0 ? 'เริ่มภารกิจ' : `ลองอีกครั้ง (ครั้งที่ ${x.used + 1})`}
            </button>
            {x.top.length > 0 && (
              <details style={{ marginTop: 10 }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600 }}><span className="action-icon"><AppIcon name="trophy" size={18} />ผลงานสมาชิก</span></summary>
                <ol style={{ margin: '8px 0 0', paddingLeft: 22 }}>
                  {x.top.map((t, i) => <li key={i} style={t.me ? { fontWeight: 700 } : undefined}>{t.name} <span className="muted">({t.team})</span> — {t.tokens}</li>)}
                </ol>
              </details>
            )}
          </div>
        );
      })}
    </>
  );
}

function ResultCard({ icon, title, lines, res, onExit }: { icon: string; title: string; lines: string[]; res: Result; onExit: () => void }) {
  const success = !!res.success;
  return (
    <div className="card center stack game-result" style={{ border: `3px solid ${success ? '#2f8f5b' : '#d2b56e'}` }}>
      <div style={{ fontSize: 54 }}>{icon}</div>
      <h2 style={{ margin: 0 }}>{title}</h2>
      {lines.map((l) => <div key={l} className="muted">{l}</div>)}
      <div className={`verdict ${success ? 'ok' : 'bad'}`} style={{ fontSize: 24 }}>
        {success ? '✓ ภารกิจสำเร็จ' : 'ยังไม่ผ่านเงื่อนไขภารกิจ'}
      </div>
      {res.awarded > 0 ? <div className="action-icon"><AppIcon name="token" size={22} /><strong>+{res.awarded} Tokens</strong> เข้ากระเป๋าทีมแล้ว</div>
        : !success ? <div className="muted">ยังไม่ได้รับโทเคน · กลับไปดูจำนวนครั้งที่เหลือและลองใหม่ได้</div>
        : res.rewardTokens === 0 ? <div className="muted">รางวัลที่ผู้จัดกำหนดสำหรับภารกิจนี้คือ 0 Tokens</div>
        : <div className="muted">คุณรับรางวัลภารกิจนี้แล้ว จึงไม่ได้รับโทเคนซ้ำ</div>}
      <div className="muted">รางวัลเมื่อสำเร็จ {res.rewardTokens} Tokens · รับครั้งเดียวต่อคนต่อภารกิจ</div>
      <button className="btn" onClick={onExit}>กลับไปภารกิจประจำสัปดาห์</button>
    </div>
  );
}

type GP = { onExit: () => void; onAuthLost: (e: unknown) => void; rewardTokens: number };

// ------------------------------------------------------------------ 1) spot the difference
function SpotGame({ onExit, onAuthLost, rewardTokens }: GP) {
  const [g, setG] = useState<any>(null);
  const [marks, setMarks] = useState<{ x: number; y: number }[]>([]);
  const [miss, setMiss] = useState<{ x: number; y: number; k: number }[]>([]);
  const [penalty, setPenalty] = useState(0);
  const [left, setLeft] = useState<number>(SPOT.seconds);
  const [res, setRes] = useState<(Result & { detail: any }) | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const base = useRef(0);
  const sending = useRef(false);
  const finishing = useRef(false);

  async function start() {
    setBusy(true); setErr('');
    try {
      const r = await api<any>('/api/minigames/spot', { action: 'start' }, 1);
      if (r.done) { setRes(r); return; }
      base.current = Date.now() - r.elapsed * 1000;
      setG(r); setMarks(r.found); setPenalty(r.penalty); setLeft(r.seconds - r.elapsed - r.penalty);
    } catch (e) { onAuthLost(e); setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function finish() {
    if (finishing.current || !g) return;
    finishing.current = true;
    try { setRes(await api('/api/minigames/spot', { action: 'finish', attemptId: g.attemptId }, 2)); }
    catch (e) { setErr((e as Error).message); finishing.current = false; }
  }
  useEffect(() => {
    if (!g || res) return;
    const t = setInterval(() => {
      const l = g.seconds - (Date.now() - base.current) / 1000 - penalty;
      setLeft(l);
      if (l <= 0) finish();
    }, 250);
    return () => clearInterval(t);
  });   // re-armed every render so it always sees the latest penalty

  async function tap(e: React.PointerEvent<HTMLDivElement>) {
    if (!g || res || sending.current) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    sending.current = true;
    try {
      const out = await api<any>('/api/minigames/spot', { action: 'click', attemptId: g.attemptId, x, y }, 1);
      if (out.hit) setMarks((m) => [...m, out.mark]);
      else { setPenalty(out.penalty); setMiss((m) => [...m, { x, y, k: Date.now() }]); setTimeout(() => setMiss((m) => m.slice(1)), 700); }
      if (out.done) setRes(out);
      else if (out.over) setRes(out);
    } catch (er) { onAuthLost(er); setErr((er as Error).message); }
    finally { sending.current = false; }
  }

  if (res) {
    const d = res.detail ?? {};
    return <ResultCard icon="🔍" title={res.success ? 'หาครบทุกจุด!' : `หาเจอ ${d.found ?? 0}/${SPOT.diffs} จุด`}
      lines={[`ใช้เวลา ${mmss(d.seconds ?? 0)} นาที${d.misses ? ` · กดพลาด ${d.misses} ครั้ง (+${d.misses * SPOT.missPenaltySec} วินาที)` : ''}`]} res={res} onExit={onExit} />;
  }
  if (!g) {
    return (
      <div className="card center stack game-intro">
        <div className="game-intro-icon"><AppIcon name="scan" size={52} /></div>
        <h2 style={{ margin: 0 }}>{MG_INFO.spot.title}</h2>
        <p style={{ margin: 0 }}>{MG_INFO.spot.how}</p>
        <strong>สำเร็จรับ {rewardTokens} Tokens เข้ากระเป๋าทีม</strong>
        <div className="banner" style={{ margin: 0 }}>⏱️ เวลาเริ่มนับทันทีที่กด “เริ่ม” และ<strong>นับต่อแม้ปิดหน้านี้</strong></div>
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy} onClick={start}>{busy ? 'กำลังเริ่ม…' : '▶️ เริ่มจับเวลา'}</button>
        <button className="btn ghost" onClick={onExit}>กลับ</button>
      </div>
    );
  }
  const Pic = ({ src, label }: { src: string; label: string }) => (
    <div style={{ marginBottom: 8 }}>
      <div className="muted" style={{ fontSize: 13, marginBottom: 2 }}>{label}</div>
      <div onPointerDown={tap} style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3', borderRadius: 14, overflow: 'hidden', touchAction: 'manipulation', cursor: 'crosshair', border: '2px solid var(--cream-deep)' }}>
        <img src={src} alt={label} draggable={false} style={{ width: '100%', height: '100%', display: 'block', userSelect: 'none', pointerEvents: 'none' }} />
        {marks.map((m, i) => <span key={i} aria-hidden style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: '14%', aspectRatio: '1', transform: 'translate(-50%,-50%)', border: '4px solid #e0573b', borderRadius: '50%', boxShadow: '0 0 0 2px #fff' }} />)}
        {miss.map((m) => <span key={m.k} aria-hidden style={{ position: 'absolute', left: `${m.x * 100}%`, top: `${m.y * 100}%`, transform: 'translate(-50%,-50%)', fontSize: 30, color: '#d02b20', fontWeight: 800 }}>✕</span>)}
      </div>
    </div>
  );
  return (
    <>
      <div className="card game-toolbar" style={{ position: 'sticky', top: 0, zIndex: 5 }}>
        <div className="row game-status-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <strong className="action-icon" style={{ fontSize: 24, color: left < 30 ? '#d02b20' : 'var(--navy)' }}><AppIcon name="clock" size={22} />{mmss(left)}</strong>
          <span><strong>{marks.length}</strong>/{SPOT.diffs} จุด</span>
          <span className="muted" style={{ fontSize: 13 }}>รอบที่ {g.n}/3 · {g.scene}</span>
        </div>
        {penalty > 0 && <div className="muted" style={{ fontSize: 13 }}>โดนบวกเวลาจากการกดพลาด {penalty} วินาที</div>}
      </div>
      <div className="card">
        <div className="muted" style={{ marginBottom: 6 }}>แตะจุดที่ต่างกัน (แตะที่ภาพไหนก็ได้)</div>
        <Pic src={g.a} label="ภาพ A" />
        <Pic src={g.b} label="ภาพ B" />
        {err && <div className="error">{err}</div>}
        <button className="btn ghost" onClick={() => { if (confirm('จบรอบนี้เลยไหม? ต้องหาครบทุกจุดจึงจะได้รับโทเคน')) finish(); }}>🏳️ จบรอบนี้</button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ 2) memory flip
type Face = { id: string; emoji: string; name: string };
function MemoryGame({ onExit, onAuthLost, rewardTokens }: GP) {
  const [a, setA] = useState<{ attemptId: string; n: number } | null>(null);
  const [faces, setFaces] = useState<Record<number, Face>>({});         // cards currently turned up
  const [done, setDone] = useState<Set<number>>(new Set());              // matched cards
  const [moves, setMoves] = useState(0);
  const [lock, setLock] = useState(false);
  const [firstIdx, setFirstIdx] = useState<number | null>(null);
  const [res, setRes] = useState<(Result & { detail: any }) | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true); setErr('');
    try {
      const r = await api<any>('/api/minigames/memory', { action: 'start' }, 1);
      if (r.done) { setMoves(r.detail?.moves ?? 0); setRes(r); return; }
      setA({ attemptId: r.attemptId, n: r.n }); setMoves(r.moves);
      const f: Record<number, Face> = {};
      r.matched.forEach((m: any) => { f[m.i] = m; });
      if (r.open) { f[r.open.i] = r.open; setFirstIdx(r.open.i); }
      setFaces(f); setDone(new Set<number>(r.matched.map((m: any) => m.i)));
    } catch (e) { onAuthLost(e); setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function flip(i: number) {
    if (!a || lock || done.has(i) || faces[i]) return;
    setLock(true); setErr('');
    try {
      const r = await api<any>('/api/minigames/memory', { action: 'flip', attemptId: a.attemptId, index: i }, 1);
      if (r.done && !r.card) { setMoves(r.detail?.moves ?? moves); setRes(r); setLock(false); return; }
      setFaces((f) => ({ ...f, [i]: r.card }));
      if (r.phase === 'first') { setFirstIdx(i); setLock(false); return; }
      setMoves(r.moves);
      const first = r.first as number;
      setFirstIdx(null);
      if (r.match) {
        setDone((d) => new Set([...d, first, i]));
        if (r.done) setTimeout(() => setRes(r), 900);
        setLock(false);
      } else {
        setTimeout(() => { setFaces((f) => { const n = { ...f }; delete n[first]; delete n[i]; return n; }); setLock(false); }, 900);
      }
    } catch (e) { onAuthLost(e); setErr((e as Error).message); setLock(false); }
  }

  if (res) return <ResultCard icon="🃏" title="จับคู่ครบแล้ว!" lines={[`ใช้ ${moves} ครั้ง (ต่ำสุดที่เป็นไปได้ 6 ครั้ง)`]} res={res} onExit={onExit} />;
  if (!a) {
    return (
      <div className="card center stack game-intro">
        <div className="game-intro-icon"><AppIcon name="weekly" size={52} /></div>
        <h2 style={{ margin: 0 }}>{MG_INFO.memory.title}</h2>
        <p style={{ margin: 0 }}>{MG_INFO.memory.how}</p>
        <strong>สำเร็จรับ {rewardTokens} Tokens เข้ากระเป๋าทีม</strong>
        <div className="banner" style={{ margin: 0 }}>แตะการ์ดทีละใบ · เปิด 2 ใบนับเป็น 1 ครั้ง · ไม่จับเวลา</div>
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy} onClick={start}>{busy ? 'กำลังเริ่ม…' : '▶️ เริ่มเล่น'}</button>
        <button className="btn ghost" onClick={onExit}>กลับ</button>
      </div>
    );
  }
  return (
    <div className="card center memory-game">
      <div className="row game-status-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>ครั้งที่เปิด: {moves}</strong>
        <span>คู่ที่เจอ {done.size / 2}/6</span>
        <span className="muted" style={{ fontSize: 13 }}>รอบที่ {a.n}/3</span>
      </div>
      <div className="muted" style={{ fontSize: 13, margin: '4px 0 10px' }}>จับคู่ครบทั้ง 6 คู่ รับ {rewardTokens} Tokens · ไม่ลดรางวัลตามจำนวนครั้งที่เปิด</div>
      <div className="memory-board" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {Array.from({ length: 12 }, (_, i) => {
          const f = faces[i], ok = done.has(i);
          return (
            <button key={i} onClick={() => flip(i)} disabled={lock || ok || !!f} aria-label={f ? f.name : `การ์ดใบที่ ${i + 1}`}
              style={{
                aspectRatio: '3 / 4', borderRadius: 14, border: ok ? '3px solid #2f8f5b' : '3px solid #fff', fontSize: 34, cursor: 'pointer',
                background: ok ? '#e2f3dc' : f ? '#fffaf0' : 'linear-gradient(135deg,#2f6b45,#1f4d33)', color: '#fff',
                boxShadow: '0 2px 6px rgba(0,0,0,.18)', display: 'grid', placeItems: 'center', padding: 2, lineHeight: 1.1,
              }}>
              {f ? <span style={{ color: '#222' }}>{f.emoji}<br /><span style={{ fontSize: 11 }}>{f.name}</span></span> : <span aria-hidden style={{ fontSize: 26, opacity: 0.8 }}>🍴</span>}
            </button>
          );
        })}
      </div>
      {firstIdx !== null && !lock && <div className="muted" style={{ marginTop: 8 }}>เลือกการ์ดใบที่สองได้เลย</div>}
      {err && <div className="error" style={{ marginTop: 8 }}>{err}</div>}
    </div>
  );
}

// ------------------------------------------------------------------ 3) mystery ingredient
type Q = { round: number; total: number; seconds: number; elapsed: number; emoji: string; ox: number; oy: number; options: Face[] };
function MysteryGame({ onExit, onAuthLost, rewardTokens }: GP) {
  const [a, setA] = useState<{ attemptId: string; n: number } | null>(null);
  const [q, setQ] = useState<Q | null>(null);
  const [fb, setFb] = useState<any>(null);                 // feedback after an answer
  const [res, setRes] = useState<(Result & { detail: any }) | null>(null);
  const [taps, setTaps] = useState(0);
  const [t, setT] = useState(0);                            // seconds since the picture appeared
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const base = useRef(0);
  const sent = useRef(false);

  async function loadRound(attemptId: string) {
    const r = await api<Q | (Result & { done: true; detail: any })>('/api/minigames/mystery', { action: 'round', attemptId }, 1);
    if ('done' in r) { setRes(r); return; }
    base.current = Date.now() - r.elapsed * 1000;
    sent.current = false; setTaps(0); setT(r.elapsed); setFb(null); setQ(r);
  }
  async function start() {
    setBusy(true); setErr('');
    try {
      const r = await api<any>('/api/minigames/mystery', { action: 'start' }, 1);
      if (r.done) { setRes(r); return; }
      setA({ attemptId: r.attemptId, n: r.n });
      await loadRound(r.attemptId);
    } catch (e) { onAuthLost(e); setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  async function pick(id: string) {
    if (!a || !q || sent.current) return;
    sent.current = true;
    try {
      const r = await api<any>('/api/minigames/mystery', { action: 'answer', attemptId: a.attemptId, pick: id }, 1);
      setFb({ ...r, pick: id });
    } catch (e) { sent.current = false; onAuthLost(e); setErr((e as Error).message); }
  }
  useEffect(() => {
    if (!q || fb) return;
    const i = setInterval(() => {
      const s = (Date.now() - base.current) / 1000;
      setT(s);
      if (s > q.seconds && !sent.current) pick('');           // out of time = counts as a wrong answer
    }, 100);
    return () => clearInterval(i);
  });

  if (res) return <ResultCard icon="🥬" title="ครบ 5 ข้อแล้ว!" lines={[`ตอบถูก ${res.detail?.correct ?? 0}/${MYSTERY.rounds} ข้อ`]} res={res} onExit={onExit} />;
  if (!a || !q) {
    return (
      <div className="card center stack game-intro">
        <div className="game-intro-icon"><AppIcon name="quiz" size={52} /></div>
        <h2 style={{ margin: 0 }}>{MG_INFO.mystery.title}</h2>
        <p style={{ margin: 0 }}>{MG_INFO.mystery.how}</p>
        <strong>ตอบถูกครบ 5 ข้อ รับ {rewardTokens} Tokens เข้ากระเป๋าทีม</strong>
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy} onClick={start}>{busy ? 'กำลังเริ่ม…' : '▶️ เริ่มเล่น'}</button>
        <button className="btn ghost" onClick={onExit}>กลับ</button>
      </div>
    );
  }
  const reveal = fb ? 1 : Math.min(1, Math.max(t / (q.seconds * 0.8), taps * 0.25));
  return (
    <div className="card center stack mystery-game">
      <div className="row game-status-row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>ข้อ {q.round}/{q.total}</strong>
        <span className="muted" style={{ fontSize: 13 }}>รอบที่ {a.n}/3</span>
        {!fb && <strong className="action-icon" style={{ color: t > q.seconds - 5 ? '#d02b20' : 'var(--navy)' }}><AppIcon name="clock" size={20} />{Math.max(0, Math.ceil(q.seconds - t))} วิ</strong>}
      </div>
      {!fb && <div style={{ height: 8, borderRadius: 4, background: 'var(--cream-deep)', overflow: 'hidden' }}><div style={{ height: '100%', width: `${Math.max(0, 100 - (t / q.seconds) * 100)}%`, background: 'var(--forest)', transition: 'width .1s linear' }} /></div>}
      <button type="button" aria-label="แตะเพื่อเปิดภาพเพิ่ม" disabled={!!fb || taps >= 4} onClick={() => setTaps((n) => n + 1)}
        style={{ width: '100%', maxWidth: 300, aspectRatio: '1', margin: '0 auto', borderRadius: 22, overflow: 'hidden', border: '4px solid #fff', boxShadow: '0 2px 10px rgba(0,0,0,.2)', background: '#fffaf0', padding: 0, cursor: 'pointer', position: 'relative' }}>
        <span style={{
          position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', fontSize: 200, lineHeight: 1,
          transform: `scale(${1 + 11 * (1 - reveal)})`, transformOrigin: `${q.ox}% ${q.oy}%`, filter: `blur(${(1 - reveal) * 9}px)`, transition: 'transform .35s, filter .35s',
        }}>{q.emoji}</span>
      </button>
      {!fb && <div className="muted" style={{ fontSize: 14 }}>👆 แตะที่ภาพเพื่อเปิดเพิ่ม ({taps}/4) หรือรอให้ชัดขึ้น · ตอบถูกครบ 5 ข้อรับ {rewardTokens} Tokens</div>}
      {fb ? (
        <>
          <div className={`verdict ${fb.correct ? 'ok' : 'bad'}`} style={{ fontSize: 18 }}>
            {fb.correct ? `✅ ถูกต้อง! (${fb.correctCount ?? q.round}/${MYSTERY.rounds} ข้อ)` : fb.timedOut || !fb.pick ? `⌛ หมดเวลา · เฉลย ${fb.answer.emoji} ${fb.answer.name}` : `❌ ไม่ถูก · เฉลย ${fb.answer.emoji} ${fb.answer.name}`}
          </div>
          {fb.done === false
            ? <button className="btn" onClick={() => a && loadRound(a.attemptId).catch((e) => { onAuthLost(e); setErr((e as Error).message); })}>ข้อต่อไป ➡️</button>
            : <button className="btn" onClick={() => setRes(fb)}>ดูผลรวม</button>}
        </>
      ) : (
        <div className="mystery-options" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {q.options.map((o) => (
            <button key={o.id} className="btn ghost" style={{ display: 'grid', placeItems: 'center', padding: 8, minHeight: 92, fontSize: 40, lineHeight: 1.1 }} onClick={() => pick(o.id)}>
              {o.emoji}<span style={{ fontSize: 14, fontWeight: 600 }}>{o.name}</span>
            </button>
          ))}
        </div>
      )}
      {err && <div className="error">{err}</div>}
    </div>
  );
}
