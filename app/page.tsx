'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Coin, Hero, IconMission, IconShop, IconTeam, Pot } from '@/components/Icons';

type Question = { id: string; position: number; prompt: string; image_url: string | null; options: string[] };
type Goal = { goalPct: number; completed: number; participants: number; met: boolean; need: number };
type Me = {
  participant: { name: string; fullName: string; status: 'not_started' | 'in_progress' | 'completed' };
  team: { name: string; balance: number };
  squad: string | null;
  goal: Goal;
  isLeader: boolean;
  leaderName: string | null;
  marketOpen: boolean;
  inventory: { item: string; image_url: string | null; qty: number; handed: number; pending: number; spent: number }[];
  game: { open: boolean; tokensPerCorrect: number };
  total: number;
  answered: number;
  current: Question | null;
  result: { correct: number; tokens: number } | null;
  history: { item: string; qty: number; cost: number; at: string }[];
  market: { id: string; name: string; category: string; price: number; stock: number; requires_goal: boolean; image_url: string | null }[];
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
  const [view, setView] = useState<'home' | 'missions' | 'quiz' | 'hunt' | 'team' | 'market'>('home');
  const [huntTab, setHuntTab] = useState<'hunt' | 'puzzle'>('hunt');
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
    if (e instanceof ApiError && e.status === 401 && me) { setMe(null); setFeedback(null); setSelected(null); setErr('ID นี้ถูกยกเลิกหรือเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่'); }
    else setErr((e as Error).message);
  };

  async function login() {
    setBusy(true); setErr('');
    try { await api('/api/login', { id: code }, 1); await load(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function logout() {
    await api('/api/logout', {}, 1).catch(() => {});
    setMe(null); setCode(''); setFeedback(null); setSelected(null); setView('home'); setPendingSpot('');
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
          <p className="muted" style={{ margin: 0 }}>กรอก ID ของคุณ (ที่ทีมงานแจ้งไว้) เพื่อเข้าเกม</p>
          <input
            className="input" inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
            placeholder="ID ของคุณ" value={code} maxLength={40}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && code.trim() && login()}
          />
          {err && <div className="error">{err}</div>}
          <button className="btn" disabled={busy || !code.trim()} onClick={login}>
            {busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่เกม'}
          </button>
        </div>
        <p className="muted center">ไม่มี ID หรือเข้าไม่ได้? สอบถามทีมงานผู้จัด</p>
      </Shell>
    );
  }

  const { participant, team } = me;
  const subtitle = `ทีม ${team.name}${me.isLeader ? ' · ⭐ หัวหน้าทีม' : ''}`;
  const goHome = () => setView('home');
  const QuizBack = ({ label = 'กลับไปภารกิจ' }: { label?: string }) => <button className="btn ghost" onClick={() => setView('missions')}>{label}</button>;

  // ---- Treasure hunt + team puzzles
  if (view === 'hunt') {
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <Activities
          initialTab={huntTab}
          pending={pendingSpot}
          clearPending={() => { setPendingSpot(''); try { sessionStorage.removeItem('fc_spot'); } catch { /* ignore */ } }}
          onBalance={() => load()}
          onAuthLost={fail}
        />
        <QuizBack />
      </Shell>
    );
  }

  // ---- Market: items, token price, stock; the team leader redeems here
  if (view === 'market') {
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <MarketView me={me} onRefresh={load} />
        {err && <div className="error">{err}</div>}
        <button className="btn ghost" onClick={goHome}>กลับหน้าหลัก</button>
      </Shell>
    );
  }

  // ---- Team members and what each one does
  if (view === 'team') {
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <TeamView me={me} onAuthLost={fail} />
        <button className="btn ghost" onClick={goHome}>กลับหน้าหลัก</button>
      </Shell>
    );
  }

  // ---- Missions menu: quiz, treasure hunt, team puzzles
  if (view === 'missions') {
    const st = participant.status;
    const quizLine = st === 'completed'
      ? `เล่นจบแล้ว ${me.result?.correct ?? 0}/${me.total} ข้อ · ได้ ${me.result?.tokens ?? 0} โทเคน`
      : st === 'in_progress' ? `ตอบแล้ว ${me.answered}/${me.total} ข้อ` : `${me.total} ข้อ · ข้อละ ${me.game.tokensPerCorrect} โทเคน`;
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <div className="card center" style={{ paddingBottom: 14 }}>
          <h2 style={{ fontSize: 22 }}>🚩 เลือกภารกิจ</h2>
          <div className="muted">ทำภารกิจเพื่อสะสมโทเคนเข้ากระเป๋าทีม</div>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#fde7b0' }}>🍜</div>
            <div className="m-body"><h2>ควิซทายอาหาร</h2><div className="muted">{quizLine}</div></div>
          </div>
          {!me.game.open && st !== 'completed' && <div className="banner" style={{ marginTop: 10 }}>ควิซยังไม่เปิด หรือปิดแล้ว รอทีมงานประกาศ</div>}
          <button className="btn" style={{ marginTop: 12 }} disabled={st !== 'completed' && !me.game.open} onClick={() => setView('quiz')}>
            {st === 'completed' ? 'ดูผลคะแนน' : st === 'in_progress' ? 'เล่นต่อ' : 'เริ่มเล่นควิซ'}
          </button>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#d8ecf5' }}>🧭</div>
            <div className="m-body"><h2>ล่าสมบัติ</h2><div className="muted">สแกน QR หรือกรอกรหัสตามจุดต่าง ๆ ในแคมป์</div></div>
          </div>
          <button className="btn green" style={{ marginTop: 12 }} onClick={() => { setHuntTab('hunt'); setView('hunt'); }}>ไปล่าสมบัติ</button>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#e8dcf5' }}>🧩</div>
            <div className="m-body"><h2>ภารกิจทีม</h2><div className="muted">รวมเบาะแสของเพื่อนในสควอดเพื่อไขปริศนา</div></div>
          </div>
          <button className="btn green" style={{ marginTop: 12 }} onClick={() => { setHuntTab('puzzle'); setView('hunt'); }}>เปิดภารกิจทีม</button>
        </div>
        <GoalCard goal={me.goal} mine />
        <button className="btn ghost" onClick={goHome}>กลับหน้าหลัก</button>
      </Shell>
    );
  }

  // ---- Quiz (start / questions / result)
  if (view === 'quiz') {
    if (participant.status === 'not_started') {
      return (
        <Shell subtitle={subtitle} onHome={goHome}>
          <div className="card center stack">
            <Pot size={64} />
            <h2>พร้อมเริ่มควิซทายอาหารหรือยัง?</h2>
            <div className="muted">{me.total} ข้อ · ตอบถูกข้อละ {me.game.tokensPerCorrect} โทเคน เข้ากระเป๋าทีม</div>
            {!me.game.open && <div className="banner">เกมยังไม่เปิด รอทีมงานประกาศสักครู่นะ</div>}
            {err && <div className="error">{err}</div>}
            <button className="btn" disabled={busy || !me.game.open} onClick={start}>{busy ? 'กำลังเริ่ม…' : 'เริ่มเล่นเลย'}</button>
            {!me.game.open && <button className="btn ghost" onClick={() => load()}>ตรวจสอบอีกครั้ง</button>}
            <QuizBack />
          </div>
        </Shell>
      );
    }

    if (participant.status === 'in_progress') {
      const q = me.current;
      if (!q && !feedback) {
        return (
          <Shell subtitle={subtitle} onHome={goHome}>
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
        <Shell subtitle={subtitle} onHome={goHome}>
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
              <div className={`verdict ${feedback.isCorrect ? 'ok' : 'bad'}`}>
                {feedback.isCorrect ? `ถูกต้อง! +${me.game.tokensPerCorrect} โทเคน` : 'ยังไม่ถูกนะ ข้อที่ถูกคือข้อที่ไฮไลต์สีเขียว'}
              </div>
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

    // Result (completed)
    const r = me.result ?? { correct: 0, tokens: 0 };
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <div className="card center stack">
          <h2>เล่นจบแล้ว เก่งมาก {participant.name}! 🎉</h2>
          <div className="bigscore">{r.correct}/{me.total}</div>
          <div className="muted">คุณได้ <strong>{r.tokens}</strong> โทเคน เข้ากระเป๋าทีมเรียบร้อย</div>
          <hr style={{ border: 0, borderTop: '1px dashed #eadfc4', width: '100%' }} />
          <div className="muted">โทเคนรวมของทีม {team.name}</div>
          <div className="coin-row"><Coin size={44} /> {team.balance}</div>
          {err && <div className="error">{err}</div>}
          <button className="btn green" onClick={() => { setHuntTab('hunt'); setView('hunt'); }}>🧭 ไปล่าสมบัติ & ภารกิจทีม</button>
          <button className="btn green" onClick={() => setView('market')}>🛒 ตลาดของ</button>
          <QuizBack />
        </div>
        <GoalCard goal={me.goal} mine />
      </Shell>
    );
  }

  // ---- Home: who am I + three big buttons
  const initial = Array.from(participant.name)[0] ?? '🏕️';
  return (
    <Shell subtitle={subtitle}>
      <div className="card">
        <div className="profile">
          <div className="avatar" aria-hidden>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>สวัสดี {participant.name}</div>
            {participant.fullName && participant.fullName !== participant.name && <div className="muted" style={{ fontSize: 14 }}>{participant.fullName}</div>}
            <div className="row" style={{ marginTop: 8, gap: 6 }}>
              <span className={`role ${me.isLeader ? 'leader' : 'member'}`}>{me.isLeader ? '⭐ หัวหน้าทีม' : '🏕️ สมาชิกทีม'}</span>
              <span className="pill">ทีม {team.name}</span>
              {me.squad && <span className="pill" style={{ background: '#f9dca0' }}>{me.squad}</span>}
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span className="muted">{me.isLeader ? 'คุณมีสิทธิ์แลกสินค้าให้ทีม' : 'หัวหน้าทีมเป็นผู้แลกสินค้า'}</span>
          <span className="coin-row" style={{ fontSize: 22, gap: 6 }}><Coin size={26} /> {team.balance}</span>
        </div>
      </div>

      <div className="tiles">
        <button className="tile fire" onClick={() => setView('missions')}>
          <span className="t-icon"><IconMission size={76} /></span>
          <span><div className="t-title">เริ่มภารกิจ</div><div className="t-desc">ควิซ · ล่าสมบัติ · ภารกิจทีม</div></span>
          <span className="t-go" aria-hidden>›</span>
        </button>
        <button className="tile forest" onClick={() => setView('team')}>
          <span className="t-icon"><IconTeam size={76} /></span>
          <span><div className="t-title">สมาชิกในทีม</div><div className="t-desc">ใครอยู่ทีมเรา ใครทำหน้าที่อะไร</div></span>
          <span className="t-go" aria-hidden>›</span>
        </button>
        <button className="tile wood" onClick={() => setView('market')}>
          <span className="t-icon"><IconShop size={76} /></span>
          <span><div className="t-title">ตลาดของ</div><div className="t-desc">ดูของ ราคา สต็อก และของของทีม</div></span>
          <span className="t-go" aria-hidden>›</span>
        </button>
      </div>
      <p className="center" style={{ marginTop: 18 }}>
        <button className="btn small ghost" onClick={logout}>ไม่ใช่คุณ? ออกจากระบบ</button>
      </p>
    </Shell>
  );
}

/** Team page: who is in the team, who leads, which squad each person is in. */
function TeamView({ me, onAuthLost }: { me: Me; onAuthLost: (e: unknown) => void }) {
  type Member = { name: string; isLeader: boolean; isMe: boolean; squad: string | null; quizDone: boolean };
  const [d, setD] = useState<{ team: string; total: number; quizDone: number; squads: string[]; members: Member[] } | null>(null);
  const [err, setErr] = useState('');
  const cb = useRef(onAuthLost);
  cb.current = onAuthLost;
  useEffect(() => {
    api('/api/team').then(setD).catch((e) => { cb.current(e); setErr((e as Error).message); });
  }, []);
  if (!d) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;

  const leader = d.members.find((m) => m.isLeader);
  const groups: { title: string; list: Member[] }[] = [
    ...d.squads.map((sq) => ({ title: sq, list: d.members.filter((m) => m.squad === sq) })),
    { title: 'ยังไม่ได้อยู่สควอด', list: d.members.filter((m) => !m.squad) },
  ].filter((g) => g.list.length > 0);
  const row = (m: Member, k: number) => (
    <div className="m-row" key={k}>
      <div className={`m-av ${m.isLeader ? 'leader' : ''}`} aria-hidden>{Array.from(m.name)[0] ?? '🏕️'}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <strong>{m.name}</strong>{m.isMe && <span className="me-tag">คุณ</span>}
        <div className="muted" style={{ fontSize: 14 }}>{m.isLeader ? '⭐ หัวหน้าทีม · แลกสินค้าให้ทีม' : '🏕️ สมาชิก · ทำภารกิจเก็บโทเคน'}</div>
      </div>
      <span title={m.quizDone ? 'เล่นควิซจบแล้ว' : 'ยังไม่จบควิซ'} style={{ fontSize: 20 }}>{m.quizDone ? '✅' : '⏳'}</span>
    </div>
  );
  return (
    <>
      <div className="card center">
        <h2 style={{ fontSize: 22 }}>👥 สมาชิกทีม {d.team}</h2>
        <div className="muted">ทั้งหมด {d.total} คน · เล่นควิซจบแล้ว {d.quizDone}/{d.total}</div>
        <div className="progress" style={{ margin: '10px 0 0' }}><i style={{ width: `${d.total ? (d.quizDone / d.total) * 100 : 0}%` }} /></div>
      </div>
      <div className="card" style={{ border: '3px solid #f4b860', background: '#fff9e8' }}>
        <div className="muted" style={{ marginBottom: 4 }}>⭐ หัวหน้าทีม</div>
        {leader ? (
          <div className="members">{row(leader, -1)}</div>
        ) : (
          <div className="muted">ยังไม่ได้กำหนดหัวหน้าทีม · สอบถามทีมงาน</div>
        )}
        <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>หัวหน้าทีมเป็นผู้ใช้โทเคนทีมแลกสินค้าที่ตลาด</div>
      </div>
      {groups.map((g) => (
        <div className="card members" key={g.title}>
          <strong>🏕️ {g.title} <span className="muted" style={{ fontWeight: 400 }}>({g.list.length} คน)</span></strong>
          <div style={{ marginTop: 4 }}>{g.list.map(row)}</div>
        </div>
      ))}
      {d.squads.length > 0 && <p className="muted center" style={{ margin: '0 0 14px' }}>คนในสควอดเดียวกันช่วยกันรวมเบาะแสภารกิจทีมและกระจายกันหาจุดล่าสมบัติ</p>}
    </>
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

function Shell({ children, subtitle, onHome }: { children: React.ReactNode; subtitle?: string; onHome?: () => void }) {
  return (
    <div className="app">
      <Hero subtitle={subtitle} onHome={onHome} />
      <main className="main">{children}</main>
    </div>
  );
}


/** Activities screen: tabs for the treasure hunt and the team puzzles. A scanned QR code always opens the hunt tab. */
function Activities(props: { initialTab?: 'hunt' | 'puzzle'; pending: string; clearPending: () => void; onBalance: () => void; onAuthLost: (e: unknown) => void }) {
  const [tab, setTab] = useState<'hunt' | 'puzzle'>(props.initialTab ?? 'hunt');
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

/** Market list: picture, price in tokens, stock status; the team leader also gets a "redeem" button. */
function MarketList({ me, onRedeem }: { me: Me; onRedeem?: (m: Me['market'][number]) => void }) {
  const [zoom, setZoom] = useState<string | null>(null);
  if (me.market.length === 0) return <p className="muted center" style={{ margin: 0 }}>ยังไม่มีสินค้า</p>;
  const items = [...me.market].sort((a, b) => Number(a.stock === 0) - Number(b.stock === 0) || a.price - b.price);
  const owned = new Map(me.inventory.map((i) => [i.item, i.qty]));
  return (
    <>
      {zoom && (
        <div onClick={() => setZoom(null)} role="dialog" aria-label="รูปสินค้า"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50, cursor: 'zoom-out' }}>
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '85dvh', borderRadius: 16 }} />
        </div>
      )}
      <ul className="list">
        {items.map((m) => {
          const out = m.stock <= 0;
          const locked = m.requires_goal && !me.goal.met;
          const low = !out && m.stock <= 3;
          const afford = me.team.balance >= m.price;
          const have = owned.get(m.name) ?? 0;
          const canBuy = !!onRedeem && !out && !locked && afford;
          return (
            <li key={m.id} style={{ alignItems: 'center', opacity: out ? 0.55 : 1, flexWrap: 'wrap' }}>
              <button type="button" aria-label={`ดูรูป ${m.name}`} disabled={!m.image_url} onClick={() => m.image_url && setZoom(m.image_url)}
                style={{ flex: 'none', width: 64, height: 64, padding: 0, border: 0, borderRadius: 12, overflow: 'hidden', background: 'var(--cream-deep)', cursor: m.image_url ? 'zoom-in' : 'default' }}>
                {m.image_url ? <img src={m.image_url} alt={m.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 28 }}>🍽️</span>}
              </button>
              <span style={{ flex: 1, minWidth: 140 }}>
                <strong>{locked ? '🔒 ' : m.requires_goal ? '🎯 ' : ''}{m.name}</strong>
                <br />
                <span className="pill" style={{ background: out ? '#f1d4d1' : low ? '#f2c46d' : 'var(--green)', fontSize: 13, padding: '2px 10px' }}>
                  {out ? '⛔ หมดแล้ว' : low ? `⚠️ เหลือน้อย ${m.stock} ชิ้น` : `✅ มีของ เหลือ ${m.stock} ชิ้น`}
                </span>
                {have > 0 && <><br /><span className="muted" style={{ fontSize: 13 }}>🎒 ทีมเรามีแล้ว ×{have}</span></>}
                {m.requires_goal && (
                  <><br /><span className="muted" style={{ fontSize: 13 }}>{locked ? 'สินค้าพิเศษ: ทีมต้องถึงเป้าหมายก่อนจึงแลกได้' : 'สินค้าพิเศษ ปลดล็อกแล้ว'}</span></>
                )}
                {!out && !locked && !afford && <><br /><span className="muted" style={{ fontSize: 13 }}>โทเคนทีมยังไม่พอ (ขาดอีก {m.price - me.team.balance})</span></>}
              </span>
              <strong style={{ textAlign: 'right' }}>{m.price}<br /><span className="muted" style={{ fontWeight: 400 }}>โทเคน</span></strong>
              {onRedeem && (
                <button className="btn small" style={{ flexBasis: '100%', marginTop: 6 }} disabled={!canBuy} onClick={() => onRedeem(m)}>
                  {out ? 'สินค้าหมด' : locked ? 'ยังล็อกอยู่' : !afford ? 'โทเคนไม่พอ' : 'แลกสินค้านี้'}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

/** What the team already owns, and what is still waiting to be handed over at the counter. */
function TeamInventory({ me }: { me: Me }) {
  const inv = me.inventory;
  const totalSpent = inv.reduce((n, i) => n + i.spent, 0);
  const totalQty = inv.reduce((n, i) => n + i.qty, 0);
  if (inv.length === 0) {
    return <p className="muted center" style={{ margin: 0 }}>ทีมเรายังไม่มีสินค้า{me.leaderName ? ` · หัวหน้าทีม ${me.leaderName} เป็นผู้แลก` : ''}<br />ไปที่แท็บ “แลกของ” เพื่อดูว่ามีอะไรให้แลกบ้าง</p>;
  }
  return (
    <>
      <div className="muted" style={{ marginBottom: 6 }}>รวม {totalQty} ชิ้น · ใช้โทเคนไปแล้ว {totalSpent}</div>
      <ul className="list">
        {inv.map((i) => (
          <li key={i.item} style={{ alignItems: 'center' }}>
            <span style={{ flex: 'none', width: 56, height: 56, borderRadius: 12, overflow: 'hidden', background: 'var(--cream-deep)', display: 'grid', placeItems: 'center' }}>
              {i.image_url ? <img src={i.image_url} alt={i.item} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 26 }}>🍽️</span>}
            </span>
            <span style={{ flex: 1 }}>
              <strong>{i.item}</strong>
              <br />
              <span className="muted" style={{ fontSize: 14 }}>
                {i.pending > 0 ? `⏳ รอรับของ ${i.pending}` : ''}{i.pending > 0 && i.handed > 0 ? ' · ' : ''}{i.handed > 0 ? `✅ รับของแล้ว ${i.handed}` : ''}
              </span>
            </span>
            <strong style={{ fontSize: 22 }}>×{i.qty}</strong>
          </li>
        ))}
      </ul>
      <p className="muted" style={{ margin: '8px 0 0' }}>ไปรับของที่ทีมงานเมื่อถึงเวลา แจ้งชื่อทีม หัวหน้าทีมเป็นผู้ดำเนินการ</p>
    </>
  );
}

/** Full-page market: "แลกของ" (buy, leader only) and "ของของทีม" (inventory). Stock refreshes by itself. */
function MarketView({ me, onRefresh }: { me: Me; onRefresh: () => unknown }) {
  const [tab, setTab] = useState<'buy' | 'mine'>('buy');
  const [sel, setSel] = useState<Me['market'][number] | null>(null);
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const keyRef = useRef('');
  const refresh = useRef(onRefresh);
  refresh.current = onRefresh;
  useEffect(() => {
    const t = setInterval(() => { refresh.current(); }, 15000);
    return () => clearInterval(t);
  }, []);

  function open(m: Me['market'][number]) {
    setSel(m); setQty(1); setErr(''); setDone('');
    keyRef.current = crypto.randomUUID(); // reused if the same request is retried -> never charged twice
  }
  async function confirmBuy() {
    if (!sel) return;
    setBusy(true); setErr('');
    try {
      const r = await api<{ already: boolean; totalCost: number; balance: number }>('/api/redeem', { itemId: sel.id, qty, key: keyRef.current });
      setDone(r.already ? 'รายการนี้ถูกบันทึกไปแล้ว (ไม่หักโทเคนซ้ำ)' : `แลก ${sel.name} ×${qty} สำเร็จ หักไป ${r.totalCost} โทเคน เหลือ ${r.balance}`);
      setSel(null); setTab('mine');
      await refresh.current();
    } catch (e) { setErr((e as Error).message); await refresh.current(); }
    finally { setBusy(false); }
  }

  const canRedeem = me.isLeader && me.marketOpen;
  const maxQty = sel ? Math.max(1, Math.min(20, sel.stock, Math.floor(me.team.balance / sel.price))) : 1;
  return (
    <>
      <div className="card center">
        <h2>🛒 ตลาด / แลกของ</h2>
        <div className="muted">โทเคนของทีม {me.team.name}</div>
        <div className="coin-row"><Coin size={40} /> {me.team.balance}</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {me.isLeader
            ? (me.marketOpen ? 'คุณเป็นหัวหน้าทีม: กด “แลกสินค้านี้” เพื่อใช้โทเคนของทีม' : 'คุณเป็นหัวหน้าทีม · ตลาดยังไม่เปิดให้แลกเอง รอทีมงานประกาศ')
            : `เฉพาะหัวหน้าทีม${me.leaderName ? ` (${me.leaderName})` : ''} เท่านั้นที่แลกสินค้าได้ · คุณดูของและสต็อกได้`}
        </p>
      </div>
      <div className="tabs">
        <button className={tab === 'buy' ? 'on' : ''} onClick={() => setTab('buy')}>🛒 แลกของ</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>🎒 ของของทีม</button>
      </div>
      {done && <div className="card center" style={{ border: '3px solid #2f8f5b' }}><div className="verdict ok" style={{ fontSize: 17 }}>{done}</div></div>}
      {tab === 'buy' && <GoalCard goal={me.goal} mine />}
      <div className="card">{tab === 'buy' ? <MarketList me={me} onRedeem={canRedeem ? open : undefined} /> : <TeamInventory me={me} />}</div>

      {sel && (
        <div role="dialog" aria-label="ยืนยันการแลก" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'end center', zIndex: 60 }}>
          <div className="card" style={{ width: '100%', maxWidth: 480, borderRadius: '22px 22px 0 0', margin: 0 }}>
            <h2>ยืนยันการแลก</h2>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{sel.name}</div>
            <div className="muted">ราคา {sel.price} โทเคน/ชิ้น · เหลือ {sel.stock} ชิ้น</div>
            <div className="row" style={{ margin: '14px 0', justifyContent: 'center' }}>
              <button className="btn small ghost" disabled={qty <= 1 || busy} onClick={() => { setQty(qty - 1); keyRef.current = crypto.randomUUID(); }} aria-label="ลด">−</button>
              <strong style={{ fontSize: 28, minWidth: 48, textAlign: 'center' }}>{qty}</strong>
              <button className="btn small ghost" disabled={qty >= maxQty || busy} onClick={() => { setQty(qty + 1); keyRef.current = crypto.randomUUID(); }} aria-label="เพิ่ม">+</button>
            </div>
            <div className="center">รวม <strong>{sel.price * qty}</strong> โทเคน · ทีมเหลือ <strong>{me.team.balance - sel.price * qty}</strong></div>
            {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
            <div className="stack" style={{ marginTop: 12 }}>
              <button className="btn" disabled={busy} onClick={confirmBuy}>{busy ? 'กำลังบันทึก…' : 'ยืนยันแลก (ใช้โทเคนของทีม)'}</button>
              <button className="btn ghost" disabled={busy} onClick={() => setSel(null)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
      <button className="btn ghost" onClick={() => { refresh.current(); }}>รีเฟรชสต็อกตอนนี้</button>
    </>
  );
}
