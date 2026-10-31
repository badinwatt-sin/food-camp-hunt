'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Coin, Hero, Pot } from '@/components/Icons';

type Question = { id: string; position: number; prompt: string; image_url: string | null; options: string[] };
type Goal = { goalPct: number; completed: number; participants: number; met: boolean; need: number };
type Me = {
  participant: { name: string; status: 'not_started' | 'in_progress' | 'completed' };
  team: { name: string; balance: number };
  squad: string | null;
  goal: Goal;
  game: { open: boolean; tokensPerCorrect: number };
  total: number;
  answered: number;
  current: Question | null;
  result: { correct: number; tokens: number } | null;
  history: { item: string; qty: number; cost: number; at: string }[];
  market: { name: string; category: string; price: number; stock: number; requires_goal: boolean }[];
};
type PuzzleData = {
  open: boolean; squad: string | null; groupSize: number;
  puzzles: { id: string; prompt: string; options: string[]; tokens: number; clueTotal: number;
    myClues: { no: number; text: string }[]; maxAttempts: number; used: number; left: number; solved: boolean; solvedBy: string | null }[];
};
type HuntData = {
  open: boolean;
  team: { name: string; balance: number };
  groupSize: number;
  spots: { id: string; title: string; tokens: number; hint: string; found: boolean; foundBy: string | null;
    coop: { need: number; windowSec: number; have: number; iScanned: boolean } | null }[];
  found: number;
  earned: number;
  squad: string | null;
  squads: { id: string; name: string; mine: boolean; found: number }[];
  goal: Goal;
};
type Feedback = { selected: number; correctIndex: number; isCorrect: boolean; answered: number };

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** fetch with automatic retry on network errors / 5xx. Safe because the server is idempotent. */
async function api<T = any>(path: string, body?: unknown, tries = 3): Promise<T> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data as T;
      if (res.status >= 500 && i < tries - 1) { await new Promise((r) => setTimeout(r, 600 * (i + 1))); continue; }
      throw new ApiError(res.status, data.message ?? 'เกิดข้อผิดพลาด');
    } catch (e) {
      if (e instanceof ApiError) throw e;
      await new Promise((r) => setTimeout(r, 600 * (i + 1)));
    }
  }
  throw new ApiError(0, 'เชื่อมต่อไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่ (ข้อมูลของคุณไม่หาย)');
}

const LETTERS = ['ก', 'ข', 'ค', 'ง'];
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Page() {
  const [loading, setLoading] = useState(true);
  const [me, setMe] = useState<Me | null>(null);
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [view, setView] = useState<'main' | 'wallet' | 'hunt'>('main');
  const [pendingSpot, setPendingSpot] = useState('');
  const completing = useRef(false);

  const load = useCallback(async () => {
    try {
      const data = await api<Me>('/api/me');
      setMe(data);
      setErr('');
      return data;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else setErr((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // QR codes open /?spot=CODE. Remember it (also across the login step) and strip it from the address bar.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const spot = u.searchParams.get('spot');
      if (spot) {
        sessionStorage.setItem('fc_spot', spot);
        u.searchParams.delete('spot');
        window.history.replaceState(null, '', u.pathname + u.search);
      }
      const saved = sessionStorage.getItem('fc_spot');
      if (saved) setPendingSpot(saved);
    } catch { /* storage blocked: player can type the code instead */ }
  }, []);
  useEffect(() => {
    if (me && pendingSpot) setView('hunt');
  }, [me, pendingSpot]);

  // If every question is answered but the finish step didn't run (e.g. connection dropped), finish now.
  useEffect(() => {
    if (!me || completing.current) return;
    if (me.participant.status === 'in_progress' && me.total > 0 && me.answered >= me.total && !feedback) {
      completing.current = true;
      api('/api/complete', {}).then(() => load()).catch((e) => setErr(e.message)).finally(() => { completing.current = false; });
    }
  }, [me, feedback, load]);

  // A 401 while logged in means the code was revoked/replaced: go back to the login screen.
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401 && me) { setMe(null); setFeedback(null); setSelected(null); setErr('รหัสนี้ถูกยกเลิกหรือเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่'); }
    else setErr((e as Error).message);
  };

  async function login() {
    setBusy(true); setErr('');
    try { await api('/api/login', { code }, 1); await load(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function logout() {
    await api('/api/logout', {}, 1).catch(() => {});
    setMe(null); setCode(''); setFeedback(null); setSelected(null); setView('main'); setPendingSpot('');
    try { sessionStorage.removeItem('fc_spot'); } catch { /* ignore */ }
  }
  async function start() {
    setBusy(true); setErr('');
    try { await api('/api/start', {}); await load(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!me?.current || selected === null) return;
    setBusy(true); setErr('');
    try {
      const r = await api<Feedback & { isCorrect: boolean }>('/api/answer', { questionId: me.current.id, selected });
      setFeedback({ selected: r.selected, correctIndex: r.correctIndex, isCorrect: r.isCorrect, answered: r.answered });
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function next() {
    if (!me) return;
    setBusy(true); setErr('');
    try {
      const fb = feedback;
      setFeedback(null); setSelected(null);
      if (fb && fb.answered >= me.total) {
        completing.current = true;
        await api('/api/complete', {});
        completing.current = false;
      }
      await load();
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }

  // ------------------------------------------------------------- render
  if (loading) return <Shell><div className="spinner" /></Shell>;

  // 1. Login
  if (!me) {
    return (
      <Shell>
        <div className="card stack">
          <h2>เข้าสู่เกม</h2>
          <p className="muted" style={{ margin: 0 }}>กรอกรหัสเข้าเกม 8 ตัวอักษรจากบัตรของคุณ</p>
          <input
            className="input" inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off"
            placeholder="XXXX-XXXX" value={code} maxLength={9}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && code.length >= 8 && login()}
          />
          {err && <div className="error">{err}</div>}
          <button className="btn" disabled={busy || code.replace(/[^a-zA-Z0-9]/g, '').length < 8} onClick={login}>
            {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่เกม'}
          </button>
        </div>
        <p className="muted center">ไม่มีรหัส? สอบถามทีมงานผู้จัด</p>
      </Shell>
    );
  }

  const { participant, team } = me;

  if (view === 'hunt') {
    return (
      <Shell subtitle={`ทีม ${team.name}`}>
        <Activities
          pending={pendingSpot}
          clearPending={() => { setPendingSpot(''); try { sessionStorage.removeItem('fc_spot'); } catch { /* ignore */ } }}
          onBalance={() => load()}
          onAuthLost={fail}
        />
        <button className="btn ghost" onClick={() => setView('main')}>กลับ</button>
      </Shell>
    );
  }

  // Wallet view (available any time)
  if (view === 'wallet') {
    return (
      <Shell subtitle={`ทีม ${team.name}`}>
        <Wallet me={me} />
        {err && <div className="error">{err}</div>}
        <div className="stack">
          <button className="btn ghost" onClick={async () => { await load(); }}>รีเฟรชยอดโทเคน</button>
          <button className="btn" onClick={() => setView('main')}>กลับ</button>
        </div>
      </Shell>
    );
  }

  // 2. Confirm identity
  if (participant.status === 'not_started') {
    return (
      <Shell>
        <div className="card center stack">
          <Pot size={56} />
          <h2>ใช่คุณหรือไม่?</h2>
          <div style={{ fontSize: 26, fontWeight: 700 }}>{participant.name}</div>
          <div><span className="pill">ทีม {team.name}</span>{me.squad && <> <span className="pill" style={{ background: '#f2c46d' }}>{me.squad}</span></>}</div>
          <GoalCard goal={me.goal} />
          {!me.game.open && <div className="banner">เกมยังไม่เปิด รอทีมงานประกาศสักครู่นะ</div>}
          {err && <div className="error">{err}</div>}
          <button className="btn" disabled={busy || !me.game.open} onClick={start}>
            {busy ? 'กำลังเริ่ม…' : 'ใช่ เริ่มเล่นเลย'}
          </button>
          {!me.game.open && <button className="btn ghost" onClick={() => load()}>ตรวจสอบอีกครั้ง</button>}
          <button className="btn green" onClick={() => setView('hunt')}>🧭 กิจกรรม: ล่าสมบัติ & ภารกิจทีม</button>
          <button className="btn ghost" onClick={logout}>ไม่ใช่ฉัน</button>
        </div>
      </Shell>
    );
  }

  // 3/4. Quiz + feedback
  if (participant.status === 'in_progress') {
    const q = me.current;
    if (!q && !feedback) {
      return (
        <Shell>
          <div className="card center">
            {!me.game.open && me.answered < me.total ? (
              <>
                <h2>เกมปิดแล้ว</h2>
                <p className="muted">ติดต่อทีมงานผู้จัดหากต้องการเล่นต่อ</p>
                <button className="btn ghost" onClick={() => load()}>ตรวจสอบอีกครั้ง</button>
              </>
            ) : (<><div className="spinner" /><p className="muted">กำลังสรุปคะแนน…</p></>)}
            {err && <div className="error">{err}</div>}
          </div>
        </Shell>
      );
    }
    // While showing feedback, keep showing the question just answered.
    const shown = q;
    const idx = feedback ? feedback.answered : me.answered + 1;
    const pct = ((feedback ? feedback.answered : me.answered) / me.total) * 100;
    return (
      <Shell subtitle={`ทีม ${team.name}`}>
        <button className="btn small ghost" style={{ margin: '14px 0 10px', background: '#fff' }} onClick={() => setView('hunt')}>🧭 ล่าสมบัติ & ภารกิจทีม</button>
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <strong>ข้อ {Math.min(idx, me.total)} / {me.total}</strong>
            <span className="muted">{participant.name}</span>
          </div>
          <div className="progress"><i style={{ width: `${pct}%` }} /></div>

          {shown && (
            <>
              {shown.image_url && <img className="qimg" src={shown.image_url} alt="" />}
              <h2 style={{ fontSize: 19 }}>{shown.prompt}</h2>
              {shown.options.map((o, i) => {
                let cls = 'opt';
                if (feedback) {
                  if (i === feedback.correctIndex) cls += ' right';
                  else if (i === feedback.selected) cls += ' wrong';
                } else if (selected === i) cls += ' sel';
                return (
                  <button key={i} className={cls} disabled={!!feedback || busy} onClick={() => setSelected(i)}>
                    <span className="letter">{LETTERS[i]}</span>
                    <span>{o}</span>
                  </button>
                );
              })}
            </>
          )}

          {feedback && (
            <>
              <div className={`verdict ${feedback.isCorrect ? 'ok' : 'bad'}`}>
                {feedback.isCorrect ? `ถูกต้อง! +${me.game.tokensPerCorrect} โทเคน` : 'ยังไม่ถูกนะ ข้อที่ถูกคือข้อที่ไฮไลต์สีเขียว'}
              </div>
            </>
          )}
          {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
          <div style={{ marginTop: 14 }}>
            {!feedback ? (
              <button className="btn" disabled={selected === null || busy} onClick={submit}>
                {busy ? 'กำลังส่ง…' : 'ส่งคำตอบ'}
              </button>
            ) : (
              <button className="btn green" disabled={busy} onClick={next}>
                {feedback.answered >= me.total ? 'ดูคะแนนของฉัน' : 'ข้อต่อไป'}
              </button>
            )}
          </div>
        </div>
      </Shell>
    );
  }

  // 5. Result (completed)
  const r = me.result ?? { correct: 0, tokens: 0 };
  return (
    <Shell subtitle={`ทีม ${team.name}`}>
      <div className="card center stack">
        <h2>เล่นจบแล้ว เก่งมาก {participant.name}!</h2>
        <div className="bigscore">{r.correct}/{me.total}</div>
        <div className="muted">คุณได้ <strong>{r.tokens}</strong> โทเคน เข้ากระเป๋าทีมเรียบร้อย</div>
        <hr style={{ border: 0, borderTop: '1px dashed #f1e8d0', width: '100%' }} />
        <div className="muted">โทเคนรวมของทีม {team.name}</div>
        <div className="coin-row"><Coin size={44} /> {team.balance}</div>
        {err && <div className="error">{err}</div>}
        <button className="btn green" onClick={() => setView('hunt')}>🧭 กิจกรรม: ล่าสมบัติ & ภารกิจทีม</button>
        <button className="btn" onClick={() => setView('wallet')}>ดูกระเป๋าทีมและของที่แลกได้</button>
        <button className="btn ghost" onClick={logout}>ออกจากระบบ</button>
      </div>
      <GoalCard goal={me.goal} mine />
    </Shell>
  );
}

/** Team goal: "everyone plays" progress. Hidden when the organiser has switched the goal off. */
function GoalCard({ goal, mine }: { goal: Goal; mine?: boolean }) {
  if (!goal.goalPct) return null;
  const pct = goal.participants ? Math.round((goal.completed / goal.participants) * 100) : 0;
  return (
    <div className="card" style={{ border: `3px solid ${goal.met ? '#2f8f5b' : '#f1e8d0'}` }}>
      <strong>🎯 เป้าหมายร่วมของทีม: สมาชิกเล่นควิซจบ {goal.goalPct}%</strong>
      <div className="progress" style={{ position: 'relative', margin: '12px 0 8px' }}>
        <i style={{ width: `${Math.min(100, pct)}%`, background: goal.met ? 'var(--ok)' : undefined }} />
        <b style={{ position: 'absolute', left: `${goal.goalPct}%`, top: -4, height: 18, width: 3, background: 'var(--navy)' }} />
      </div>
      <div className="muted">
        เล่นจบแล้ว {goal.completed}/{goal.participants} คน ({pct}%) ·{' '}
        {goal.met ? '🔓 ปลดล็อกสินค้าพิเศษในตลาดแล้ว!' : `🔒 อีก ${goal.need} คน จะปลดล็อกสินค้าพิเศษ${mine ? '' : ' — ชวนเพื่อนในทีมมาเล่นกัน'}`}
      </div>
    </div>
  );
}

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <div className="app">
      <Hero subtitle={subtitle} />
      <main className="main">{children}</main>
    </div>
  );
}


/** Activities screen: tabs for the treasure hunt and the team puzzles. A scanned QR code always opens the hunt tab. */
function Activities(props: { pending: string; clearPending: () => void; onBalance: () => void; onAuthLost: (e: unknown) => void }) {
  const [tab, setTab] = useState<'hunt' | 'puzzle'>('hunt');
  return (
    <>
      <div className="tabs" style={{ marginTop: 14 }}>
        <button className={tab === 'hunt' ? 'on' : ''} onClick={() => setTab('hunt')}>🧭 ล่าสมบัติ</button>
        <button className={tab === 'puzzle' ? 'on' : ''} onClick={() => setTab('puzzle')}>🧩 ภารกิจทีม</button>
      </div>
      {tab === 'hunt' || props.pending ? <HuntView {...props} /> : <PuzzleView onBalance={props.onBalance} onAuthLost={props.onAuthLost} />}
    </>
  );
}

function PuzzleView({ onBalance, onAuthLost }: { onBalance: () => void; onAuthLost: (e: unknown) => void }) {
  const [d, setD] = useState<PuzzleData | null>(null);
  const [pick, setPick] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [err, setErr] = useState('');
  const cb = useRef({ onBalance, onAuthLost });
  cb.current = { onBalance, onAuthLost };

  const load = useCallback(async () => {
    try { setD(await api<PuzzleData>('/api/puzzles')); } catch (e) { cb.current.onAuthLost(e); setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 6000); return () => clearInterval(t); }, [load]); // teammates may solve it

  async function send(z: PuzzleData['puzzles'][number]) {
    const sel = pick[z.id];
    if (sel === undefined) return;
    if (!confirm(`ตกลงกับเพื่อนในสควอดแล้วใช่ไหม?\nคำตอบ: ${z.options[sel]}\n(ทั้งสควอดเหลือสิทธิ์ตอบ ${z.left} ครั้ง)`)) return;
    setBusy(z.id); setErr('');
    try {
      const r = await api<{ correct: boolean; already: boolean; tokens: number; left: number }>('/api/puzzles/answer', { puzzleId: z.id, selected: sel });
      setNote({ ...note, [z.id]: r.correct
        ? { ok: true, text: r.already ? 'สควอดของคุณไขภารกิจนี้ได้แล้ว' : `ถูกต้อง! +${r.tokens} โทเคนเข้ากระเป๋าทีม` }
        : { ok: false, text: r.left > 0 ? `ยังไม่ถูก ลองคุยกับเพื่อนอีกครั้ง (เหลือสิทธิ์ ${r.left} ครั้ง)` : 'ยังไม่ถูก และสิทธิ์ตอบของสควอดหมดแล้ว' } });
      if (r.correct) cb.current.onBalance();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) cb.current.onAuthLost(e);
      setErr((e as Error).message);
    } finally { setBusy(''); await load(); }
  }

  if (!d) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;
  return (
    <>
      <div className="card">
        <h2>🧩 ภารกิจทีม</h2>
        <p className="muted" style={{ margin: 0 }}>
          เบาะแสถูก<strong>แบ่งกัน</strong>ในสควอด{d.squad ? ` ${d.squad}` : ''} ({d.groupSize} คน) — คุณเห็นแค่ส่วนของคุณ
          ต้องเดินไปคุยกับเพื่อนเพื่อรวมเบาะแสแล้วช่วยกันตอบ ใครก็ส่งคำตอบแทนสควอดได้ แต่จำกัดจำนวนครั้ง
        </p>
        {!d.open && <div className="banner" style={{ marginTop: 12 }}>กิจกรรมยังไม่เปิด หรือปิดแล้ว</div>}
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      </div>
      {d.puzzles.length === 0 && <div className="card center muted">ยังไม่มีภารกิจ</div>}
      {d.puzzles.map((z, n) => (
        <div className="card" key={z.id} style={z.solved ? { border: '3px solid #2f8f5b' } : undefined}>
          <strong>ภารกิจที่ {n + 1} · {z.tokens} โทเคน</strong>
          <h2 style={{ fontSize: 19, marginTop: 6 }}>{z.prompt}</h2>
          <div style={{ background: '#fff3d6', borderRadius: 14, padding: '12px 14px', margin: '8px 0 12px' }}>
            <div className="muted">🔎 เบาะแสของคุณ (ชิ้นที่ {z.myClues.map((c) => c.no).join(', ')} จากทั้งหมด {z.clueTotal})</div>
            {z.myClues.map((c) => <div key={c.no} style={{ fontWeight: 600, marginTop: 4 }}>“{c.text}”</div>)}
          </div>
          {z.options.map((o, i) => (
            <button key={i} className={`opt${pick[z.id] === i ? ' sel' : ''}`} disabled={z.solved || z.left === 0 || !d.open || busy === z.id}
              onClick={() => setPick({ ...pick, [z.id]: i })}>
              <span className="letter">{LETTERS[i]}</span><span>{o}</span>
            </button>
          ))}
          {z.solved ? (
            <div className="verdict ok">✅ สควอดไขได้แล้ว{z.solvedBy ? ` (ส่งโดย ${z.solvedBy})` : ''}</div>
          ) : z.left === 0 ? (
            <div className="verdict bad" style={{ fontSize: 16 }}>สิทธิ์ตอบของสควอดหมดแล้ว</div>
          ) : (
            <div style={{ marginTop: 14 }}>
              <div className="muted" style={{ marginBottom: 8 }}>สิทธิ์ตอบที่เหลือของทั้งสควอด: {z.left}/{z.maxAttempts}</div>
              <button className="btn" disabled={pick[z.id] === undefined || busy === z.id || !d.open} onClick={() => send(z)}>
                {busy === z.id ? 'กำลังส่ง…' : 'ส่งคำตอบของสควอด'}
              </button>
            </div>
          )}
          {note[z.id] && <div className={`verdict ${note[z.id].ok ? 'ok' : 'bad'}`} style={{ fontSize: 16 }}>{note[z.id].text}</div>}
        </div>
      ))}
    </>
  );
}

function HuntView({ pending, clearPending, onBalance, onAuthLost }: {
  pending: string; clearPending: () => void; onBalance: () => void; onAuthLost: (e: unknown) => void;
}) {
  const [h, setH] = useState<HuntData | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [win, setWin] = useState<{ title: string; tokens: number; already: boolean; pending?: { have: number; need: number; windowSec: number } } | null>(null);
  const claimed = useRef(false);
  // Parent callbacks change every render; keep them in a ref so effects don't re-run in a loop.
  const cb = useRef({ clearPending, onBalance, onAuthLost });
  cb.current = { clearPending, onBalance, onAuthLost };

  const loadHunt = useCallback(async () => {
    try { setH(await api<HuntData>('/api/hunt')); } catch (e) { cb.current.onAuthLost(e); setErr((e as Error).message); }
  }, []);

  const claim = useCallback(async (c: string) => {
    setBusy(true); setErr(''); setWin(null);
    try {
      const r = await api<{ already: boolean; pending: boolean; title: string; tokens: number; have: number; need: number; windowSec: number }>('/api/hunt/claim', { code: c });
      setWin({ title: r.title, tokens: r.tokens, already: r.already, pending: r.pending ? { have: r.have, need: r.need, windowSec: r.windowSec } : undefined });
      setCode('');
      cb.current.onBalance();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) cb.current.onAuthLost(e);
      setErr((e as Error).message);
    } finally { setBusy(false); await loadHunt(); }
  }, [loadHunt]);

  useEffect(() => { loadHunt(); }, [loadHunt]);
  // While a co-op spot is waiting for teammates, refresh so everyone sees the progress (and the win) quickly.
  const waiting = !!h?.spots.some((x) => x.coop && !x.found && x.coop.have > 0);
  const wasFound = useRef(0);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(loadHunt, 4000);
    return () => clearInterval(t);
  }, [waiting, loadHunt]);
  useEffect(() => {
    if (!h) return;
    if (h.found > wasFound.current && wasFound.current > 0) cb.current.onBalance();
    wasFound.current = h.found;
  }, [h]);
  // Arrived by scanning a QR: claim once, automatically.
  useEffect(() => {
    if (pending && !claimed.current) { claimed.current = true; const p = pending; cb.current.clearPending(); claim(p); }
  }, [pending, claim]);

  if (!h) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;
  const total = h.spots.length;
  return (
    <>
      <div className="card center">
        <h2>🧭 ล่าสมบัติ</h2>
        <div className="muted">
          {h.squad ? <>สควอด <strong>{h.squad}</strong> (ทีม {h.team.name}) เจอแล้ว</> : <>ทีม {h.team.name} เจอแล้ว</>} {h.found}/{total} จุด · ได้ {h.earned} โทเคน
        </div>
        <div className="progress"><i style={{ width: `${total ? (h.found / total) * 100 : 0}%` }} /></div>
        <div className="coin-row"><Coin size={36} /> {h.team.balance}</div>
        {!h.open && <div className="banner" style={{ marginTop: 12 }}>กิจกรรมล่าสมบัติยังไม่เปิด หรือปิดแล้ว</div>}
      </div>

      {h.squads.length > 0 && (
        <div className="card">
          <strong>🏕️ สควอดในทีมของคุณ</strong>
          <ul className="list">
            {h.squads.map((q) => (
              <li key={q.id}><span>{q.mine ? '⭐ ' : ''}{q.name}</span><strong>{q.found}/{total} จุด</strong></li>
            ))}
          </ul>
          <p className="muted" style={{ margin: 0 }}>แต่ละสควอดเก็บแต่ละจุดได้ 1 ครั้ง · โทเคนเข้ากระเป๋าทีมรวม ช่วยกันกระจายหาคนละทาง!</p>
        </div>
      )}

      {win?.pending && (
        <div className="card center" style={{ border: '3px solid #f2c46d' }}>
          <div className="verdict" style={{ color: '#8a6100' }}>👥 สแกนแล้ว! รอเพื่อนอีก {Math.max(0, win.pending.need - win.pending.have)} คน</div>
          <div>{win.title} · ต้องมีสมาชิก {win.pending.need} คนสแกนจุดนี้ภายใน {Math.round(win.pending.windowSec / 60 * 10) / 10} นาที</div>
          <div className="muted">ชวนเพื่อนในสควอดมาสแกนที่จุดนี้ — ตอนนี้สแกนแล้ว {win.pending.have}/{win.pending.need}</div>
        </div>
      )}
      {win && !win.pending && (
        <div className={`card center ${win.already ? '' : 'stack'}`} style={{ border: `3px solid ${win.already ? '#f1e8d0' : '#2f8f5b'}` }}>
          <div className={`verdict ${win.already ? '' : 'ok'}`}>{win.already ? (h.squad ? 'สควอดของคุณเจอจุดนี้แล้ว' : 'ทีมคุณเจอจุดนี้แล้ว') : `เจอแล้ว! +${win.tokens} โทเคนเข้ากระเป๋าทีม`}</div>
          <div>{win.title}</div>
        </div>
      )}

      <div className="card stack">
        <strong>กรอกรหัสที่จุด (หรือสแกน QR ด้วยกล้องมือถือ)</strong>
        <input className="input" autoCapitalize="characters" autoComplete="off" autoCorrect="off" placeholder="รหัสจุด" value={code}
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code.trim().length >= 4 && claim(code)} />
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy || code.replace(/[^a-zA-Z0-9]/g, '').length < 4 || !h.open} onClick={() => claim(code)}>
          {busy ? 'กำลังตรวจสอบ…' : 'ยืนยันรหัส'}
        </button>
      </div>

      <GoalCard goal={h.goal} mine />

      <div className="card">
        <strong>จุดทั้งหมด</strong>
        <ul className="list">
          {h.spots.map((s) => (
            <li key={s.id}>
              <span>{s.found ? '✅' : '🔒'} {s.found ? s.title : `จุดลับ`}<br />
                <span className="muted">{s.found ? `พบโดย ${s.foundBy ?? '-'}` : s.hint || 'ไม่มีคำใบ้'}</span>
                {!s.found && s.coop && <><br /><span className="pill" style={{ background: '#f2c46d' }}>👥 ต้องสแกนพร้อมกัน {s.coop.need} คน · ตอนนี้ {s.coop.have}/{s.coop.need}{s.coop.iScanned ? ' (คุณสแกนแล้ว)' : ''}</span></>}</span>
              <strong>{s.tokens}</strong>
            </li>
          ))}
          {total === 0 && <li className="muted">ยังไม่มีจุดล่าสมบัติ</li>}
        </ul>
      </div>
    </>
  );
}

function Wallet({ me }: { me: Me }) {
  const [tab, setTab] = useState<'history' | 'market'>('history');
  return (
    <>
      <GoalCard goal={me.goal} mine />
      <div className="card center">
        <div className="muted">โทเคนของทีม</div>
        <div className="coin-row"><Coin size={44} /> {me.team.balance}</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          ให้ตัวแทนทีมแจ้งทีมงานเพื่อแลกของ ทีมงานจะเป็นผู้บันทึกการแลกเท่านั้น
        </p>
      </div>
      <div className="tabs">
        <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>ประวัติการแลก</button>
        <button className={tab === 'market' ? 'on' : ''} onClick={() => setTab('market')}>ของที่แลกได้</button>
      </div>
      <div className="card">
        {tab === 'history' ? (
          me.history.length === 0 ? <p className="muted center" style={{ margin: 0 }}>ยังไม่มีการแลกของ</p> : (
            <ul className="list">
              {me.history.map((h, i) => (
                <li key={i}>
                  <span>{h.item} ×{h.qty}<br /><span className="muted">{fmtTime(h.at)}</span></span>
                  <strong>−{h.cost}</strong>
                </li>
              ))}
            </ul>
          )
        ) : (
          me.market.length === 0 ? <p className="muted center" style={{ margin: 0 }}>ยังไม่มีสินค้า</p> : (
            <ul className="list">
              {me.market.map((m, i) => (
                <li key={i}>
                  <span>{m.requires_goal && !me.goal.met ? '🔒 ' : m.requires_goal ? '🎯 ' : ''}{m.name}<br /><span className="muted">{m.requires_goal ? (me.goal.met ? 'สินค้าพิเศษ ปลดล็อกแล้ว · ' : 'สินค้าพิเศษ ต้องถึงเป้าหมายทีมก่อน · ') : ''}เหลือ {m.stock} ชิ้น</span></span>
                  <strong>{m.price} <span className="muted">โทเคน</span></strong>
                </li>
              ))}
            </ul>
          )
        )}
      </div>
    </>
  );
}
