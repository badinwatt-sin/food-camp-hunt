'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Coin, Hero, IconMission, IconShop, IconTeam, Pot } from '@/components/Icons';
import { AVATAR_EMOJIS } from '@/lib/avatar-list';
import jsQR from 'jsqr';
import { ApiError, api } from '@/lib/client-api';
import MiniGames from '@/components/MiniGames';
import AppIcon from '@/components/AppIcon';
import LineCheckin, { LineInvitationProvider, useLineInvitation } from '@/components/LineCheckin';
import LineLogo from '@/components/LineLogo';
import type { LineStatus } from '@/lib/line-types';
import type { MenuAccess } from '@/lib/menu-access';
import { MARKET_CATS, marketCat } from '@/lib/market-cats';

type Question = { id: string; position: number; prompt: string; image_url: string | null; options: string[] };
type Goal = { goalPct: number; completed: number; participants: number; met: boolean; need: number };
type Me = {
  participant: { name: string; fullName: string; status: 'not_started' | 'in_progress' | 'completed' };
  team: { name: string; balance: number };
  squad: string | null;
  goal: Goal;
  avatar: { url: string | null; emoji: string | null };
  checkin: { open: boolean; done: boolean; at: string | null };
  isLeader: boolean;
  isObserver?: boolean;
  leaderName: string | null;
  marketOpen: boolean;
  menus: MenuAccess;
  line: LineStatus;
  inventory: { item: string; image_url: string | null; qty: number; handed: number; pending: number; spent: number }[];
  game: { open: boolean; tokensPerCorrect: number };
  total: number;
  answered: number;
  current: Question | null;
  result: { correct: number; tokens: number } | null;
  history: { item: string; qty: number; cost: number; at: string }[];
  market: { id: string; name: string; category: string; price: number; stock: number; requires_goal: boolean; image_url: string | null }[];
};
type PhotoData = {
  open: boolean; isLeader: boolean; leaderName: string | null; team: string;
  missions: { id: string; title: string; description: string; category: string; refImageUrl: string | null; tokens: number;
    submission: { status: 'pending' | 'approved' | 'rejected'; url: string; tokens: number; reason: string | null; at: string; reviewedAt: string | null; by: string } | null }[];
};
type CheckinNotice = { kind: 'checkin'; id: string };
type PhotoNotice = { id: string; status: 'approved' | 'rejected'; tokens: number; reason: string | null; at: string; title: string };
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
  const [view, setView] = useState<'home' | 'missions' | 'quiz' | 'hunt' | 'team' | 'market' | 'checkin' | 'games'>('home');
  const [pendingCheckin, setPendingCheckin] = useState('');
  const [huntTab, setHuntTab] = useState<'hunt' | 'puzzle'>('hunt');
  const [editAvatar, setEditAvatar] = useState(false);
  const [pendingSpot, setPendingSpot] = useState('');
  const completing = useRef(false);
  const sessionEpoch = useRef(0);
  const endingSession = useRef(false);
  const loadRequest = useRef(0);

  // A newly opened screen starts at its heading, including when leaving a long list.
  useEffect(() => { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [view]);

  const load = useCallback(async () => {
    if (endingSession.current) return null;
    const epoch = sessionEpoch.current;
    const request = ++loadRequest.current;
    try {
      const data = await api<Me>('/api/me');
      if (epoch !== sessionEpoch.current || request !== loadRequest.current) return null;
      setMe(data);
      setErr('');
      return data;
    } catch (e) {
      if (epoch !== sessionEpoch.current || request !== loadRequest.current) return null;
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
    if (me?.menus.hunt && pendingSpot && (!me.line.open || !me.line.configured || me.line.joined)) { setHuntTab('hunt'); setView('hunt'); }
  }, [me, pendingSpot]);

  // The staff check-in QR opens /?checkin=CODE: keep the code across the login step, then show the confirm screen.
  useEffect(() => {
    try {
      const u = new URL(window.location.href);
      const c = u.searchParams.get('checkin');
      if (c) {
        sessionStorage.setItem('fc_checkin', c);
        u.searchParams.delete('checkin');
        window.history.replaceState(null, '', u.pathname + u.search);
      }
      const saved = sessionStorage.getItem('fc_checkin');
      if (saved) setPendingCheckin(saved);
    } catch { /* storage blocked: the player can type the code instead */ }
  }, []);
  useEffect(() => {
    if (me?.menus.checkin && !me.isObserver && pendingCheckin && (!me.line.open || !me.line.configured || me.line.joined)) setView('checkin');
  }, [me, pendingCheckin]);

  // Photo-mission decisions from staff: poll lightly and pop up "confirmed +N" / "not accepted" for the whole team.
  const loggedIn = !!me;
  // Refresh switches and group progress after LINE returns and while teammates check in.
  useEffect(() => {
    if (!loggedIn) return;
    const refresh = () => { if (document.visibilityState !== 'hidden') void load(); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [loggedIn, load]);
  useEffect(() => {
    if (!loggedIn) return;
    noticeStore.onClose = () => { load(); };
    noticeStore.onCheckin = () => setView('checkin');
    let stop = false;
    const tick = async () => {
      if (document.visibilityState === 'hidden' || noticeStore.get()) return;
      try {
        const r = await api<{ photos: PhotoNotice[]; checkin: { announcedAt: string } | null }>('/api/notices', undefined, 1);
        if (stop) return;
        const seen = readSeen();
        const ci = r.checkin ? { kind: 'checkin' as const, id: `checkin:${r.checkin.announcedAt}` } : null;
        const next: PhotoNotice | CheckinNotice | undefined = (ci && !seen.has(ci.id) ? ci : undefined) ?? r.photos.find((x) => !seen.has(x.id));
        if (next && !noticeStore.get()) noticeStore.set(next);
      } catch { /* offline or logged out: try again later */ }
    };
    tick();
    const t = setInterval(tick, 15000);
    const vis = () => { if (document.visibilityState === 'visible') tick(); };
    document.addEventListener('visibilitychange', vis);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', vis); noticeStore.onClose = undefined; noticeStore.onCheckin = undefined; };
  }, [loggedIn, load]);

  // If every question is answered but the finish step didn't run (e.g. connection dropped), finish now.
  useEffect(() => {
    if (!me || me.isObserver || !me.menus.quiz || completing.current) return;
    if (me.participant.status === 'in_progress' && me.total > 0 && me.answered >= me.total && !feedback) {
      completing.current = true;
      api('/api/complete', {}).then(() => load()).catch((e) => setErr(e.message)).finally(() => { completing.current = false; });
    }
  }, [me, feedback, load]);

  // A 401 while logged in means the code was revoked/replaced: go back to the login screen.
  const fail = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401 && me) { sessionEpoch.current += 1; setMe(null); setView('home'); setFeedback(null); setSelected(null); setErr('ID นี้ถูกยกเลิกหรือเปลี่ยนแล้ว กรุณาเข้าสู่ระบบใหม่'); }
    else setErr((e as Error).message);
  };

  async function login() {
    setBusy(true); setErr('');
    try { await api('/api/login', { id: code }, 1); sessionEpoch.current += 1; setView('home'); await load(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function logout() {
    if (endingSession.current) return;
    endingSession.current = true;
    sessionEpoch.current += 1;
    await api('/api/logout', {}, 1).catch(() => {});
    sessionEpoch.current += 1;
    endingSession.current = false;
    setMe(null); setCode(''); setFeedback(null); setSelected(null); setView('home'); setPendingSpot('');
    try { sessionStorage.removeItem('fc_spot'); sessionStorage.removeItem('fc_checkin'); } catch { /* ignore */ }
    setPendingCheckin('');
  }
  async function start() {
    if (me?.isObserver) return;
    setBusy(true); setErr('');
    try { await api('/api/start', {}); await load(); }
    catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function submit() {
    if (!me?.current || me.isObserver || selected === null) return;
    setBusy(true); setErr('');
    try {
      const r = await api<Feedback & { isCorrect: boolean }>('/api/answer', { questionId: me.current.id, selected });
      setFeedback({ selected: r.selected, correctIndex: r.correctIndex, isCorrect: r.isCorrect, answered: r.answered });
    } catch (e) { fail(e); }
    finally { setBusy(false); }
  }
  async function next() {
    if (!me || me.isObserver) return;
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

  // Keep one global LINE invitation mounted while the player changes screens.
  const renderPage = () => {
  // ------------------------------------------------------------- render
  if (loading) return <Shell><div className="spinner" /></Shell>;

  // 1. Login
  if (!me) {
    return (
      <Shell>
        <div className="card stack player-login-card">
          <h2>เข้าสู่เกม</h2>
          <p className="muted" style={{ margin: 0 }}>กรอก ID ของคุณ (ที่ทีมงานแจ้งไว้) เพื่อเข้าเกม</p>
          <input
            className="input" inputMode="text" autoCapitalize="characters" autoComplete="off" autoCorrect="off" spellCheck={false}
            aria-label="ID ของคุณ" placeholder="ID ของคุณ" value={code} maxLength={40}
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
  const subtitle = `ทีม ${team.name}${me.isObserver ? ' · คณะทำงาน' : me.isLeader ? ' · ⭐ หัวหน้าทีม' : ''}`;
  const goHome = () => setView('home');
  const QuizBack = ({ label = 'กลับไปภารกิจ' }: { label?: string }) => <button className="btn ghost" onClick={() => setView('missions')}><AppIcon name="back" size={20} />{label}</button>;

  const closed = (view === 'missions' && !me.menus.missions)
    || (view === 'quiz' && !me.menus.quiz)
    || (view === 'games' && !me.menus.games)
    || (view === 'hunt' && !(huntTab === 'hunt' ? me.menus.hunt : me.menus.photos))
    || (view === 'market' && !me.menus.market)
    || (view === 'checkin' && !me.menus.checkin);
  if (closed) return (
    <Shell subtitle={subtitle} onHome={goHome}>
      <div className="card center stack" role="status">
        <h2 className="page-heading"><AppIcon name="shield" />เมนูนี้ยังไม่เปิดใช้งาน</h2>
        <p className="muted">รอทีมงานประกาศเปิดใช้งาน แล้วกลับมาอีกครั้ง</p>
        <button className="btn ghost" onClick={goHome}>กลับหน้าหลัก</button>
      </div>
    </Shell>
  );

  // ---- Solo mini-games
  if (view === 'games') {
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <MiniGames isObserver={!!me.isObserver} onBalance={() => load()} onAuthLost={fail} />
        <QuizBack />
      </Shell>
    );
  }

  // ---- Treasure hunt + team puzzles
  if (view === 'hunt') {
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <Activities
          tab={huntTab}
          onTabChange={setHuntTab}
          access={me.menus}
          readOnly={!!me.isObserver}
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

  // ---- Event-day check-in (scan the staff QR, then confirm)
  if (view === 'checkin' && !me.isObserver) {
    return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <CheckinView me={me} pendingCode={pendingCheckin}
          clearPending={() => { setPendingCheckin(''); try { sessionStorage.removeItem('fc_checkin'); } catch { /* ignore */ } }}
          onDone={() => load()} onAuthLost={fail} />
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
          <h2 className="page-heading" style={{ fontSize: 22 }}><AppIcon name="missions" />เลือกภารกิจ</h2>
          <div className="muted">ทำภารกิจเพื่อสะสมโทเคนเข้ากระเป๋าทีม</div>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#fde7b0' }}><AppIcon name="quiz" size={32} /></div>
            <div className="m-body"><h2>ควิซทายอาหาร</h2><div className="muted">{quizLine}</div></div>
          </div>
          {!me.menus.quiz && <div className="banner" style={{ marginTop: 10 }}>ควิซยังไม่เปิด หรือปิดแล้ว รอทีมงานประกาศ</div>}
          <button className="btn" style={{ marginTop: 12 }} disabled={!me.menus.quiz} onClick={() => setView('quiz')}>
            {st === 'completed' ? 'ดูผลคะแนน' : st === 'in_progress' ? 'เล่นต่อ' : 'เริ่มเล่นควิซ'}
          </button>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#d9efd8' }}><AppIcon name="weekly" size={32} /></div>
            <div className="m-body"><h2>ภารกิจประจำสัปดาห์</h2><div className="muted">จับผิดภาพ · จับคู่การ์ด · ทายวัตถุดิบ — เล่นคนเดียว สะสมโทเคนให้ทีม</div></div>
          </div>
          <button className="btn green" style={{ marginTop: 12 }} disabled={!me.menus.games} onClick={() => setView('games')}>{me.menus.games ? 'ดูภารกิจประจำสัปดาห์' : '🔒 ยังไม่เปิดใช้งาน'}</button>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#d8ecf5' }}><AppIcon name="hunt" size={32} /></div>
            <div className="m-body"><h2>ล่าสมบัติ</h2><div className="muted">สแกน QR หรือกรอกรหัสตามจุดต่าง ๆ ในแคมป์</div></div>
          </div>
          <button className="btn green" style={{ marginTop: 12 }} disabled={!me.menus.hunt} onClick={() => { setHuntTab('hunt'); setView('hunt'); }}>{me.menus.hunt ? 'ไปล่าสมบัติ' : '🔒 ยังไม่เปิดใช้งาน'}</button>
        </div>
        <div className="card">
          <div className="mission">
            <div className="m-ic" style={{ background: '#e8dcf5' }}><AppIcon name="camera" size={32} /></div>
            <div className="m-body"><h2>ภารกิจทีม</h2><div className="muted">ถ่ายภาพทั้งทีมตามโจทย์ · หัวหน้าทีมเป็นผู้อัปโหลด</div></div>
          </div>
          <button className="btn green" style={{ marginTop: 12 }} disabled={!me.menus.photos} onClick={() => { setHuntTab('puzzle'); setView('hunt'); }}>{me.menus.photos ? 'เปิดภารกิจทีม' : '🔒 ยังไม่เปิดใช้งาน'}</button>
        </div>
        <GoalCard goal={me.goal} mine />
        <button className="btn ghost" onClick={goHome}>กลับหน้าหลัก</button>
      </Shell>
    );
  }

  // ---- Quiz (start / questions / result)
  if (view === 'quiz') {
    if (me.isObserver) return (
      <Shell subtitle={subtitle} onHome={goHome}>
        <div className="card center stack"><Pot size={64} /><h2>ควิซทายอาหาร</h2>
          <p className="muted">{me.total} ข้อ · สมาชิกตอบถูกได้รับ {me.game.tokensPerCorrect} โทเคนต่อข้อเข้ากระเป๋าทีม</p>
          <p className="observer-note">คณะทำงานดูข้อมูลกิจกรรมได้ แต่ไม่ส่งคำตอบหรือรับคะแนน</p>
          <GoalCard goal={me.goal} mine /><QuizBack />
        </div>
      </Shell>
    );
    if (participant.status === 'not_started') {
      return (
        <Shell subtitle={subtitle} onHome={goHome}>
          <div className="card center stack">
            <Pot size={64} />
            <h2>พร้อมเริ่มควิซทายอาหารหรือยัง?</h2>
            <div className="muted">{me.total} ข้อ · ตอบถูกข้อละ {me.game.tokensPerCorrect} โทเคน เข้ากระเป๋าทีม</div>
            {!me.game.open && <div className="banner">เกมยังไม่เปิด รอทีมงานประกาศสักครู่นะ</div>}
            {err && <div className="error">{err}</div>}
            <button className="btn" disabled={busy || !me.game.open || me.isObserver} onClick={start}>{me.isObserver ? 'คณะทำงาน · ดูข้อมูลเท่านั้น' : busy ? 'กำลังเริ่ม…' : 'เริ่มเล่นเลย'}</button>
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
          <div className="card quiz-card">
            <div className="row quiz-status-row" style={{ justifyContent: 'space-between' }}>
              <strong>ข้อ {Math.min(idx, me.total)} / {me.total}</strong>
              <span className="muted">{participant.name}</span>
            </div>
            <div className="progress"><i style={{ width: `${pct}%` }} /></div>

            {shown && (
              <>
                {shown.image_url && <img className="qimg" src={shown.image_url} alt="" />}
                <h2 className="quiz-question" style={{ fontSize: 19 }}>{shown.prompt}</h2>
                {shown.options.map((o, i) => {
                  let cls = 'opt';
                  if (feedback) {
                    if (i === feedback.correctIndex) cls += ' right';
                    else if (i === feedback.selected) cls += ' wrong';
                  } else if (selected === i) cls += ' sel';
                  return (
                    <button key={i} className={cls} disabled={!!feedback || busy || me.isObserver} onClick={() => setSelected(i)}>
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
                <button className="btn" disabled={selected === null || busy || me.isObserver} onClick={submit}>
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
          <button className="btn green" disabled={!me.menus.hunt && !me.menus.photos} onClick={() => { setHuntTab(me.menus.hunt ? 'hunt' : 'puzzle'); setView('hunt'); }}><AppIcon name="hunt" size={20} />ไปล่าสมบัติ & ภารกิจทีม</button>
          <button className="btn green" onClick={() => setView('market')}><AppIcon name="shop" size={20} />ตลาดของ</button>
          <QuizBack />
        </div>
        <GoalCard goal={me.goal} mine />
      </Shell>
    );
  }

  // ---- Home: who am I + three big buttons
  return (
    <Shell subtitle={subtitle}>
      {me.checkin.open && !me.checkin.done && !me.isObserver && (
        <div className="card" style={{ border: '3px solid #f0c36a', background: '#fff9e8' }}>
          <div className="row checkin-prompt-row" style={{ justifyContent: 'space-between' }}>
            <div><strong className="action-icon"><AppIcon name="checkin" size={22} />ถึงสถานที่จัดงานแล้วใช่ไหม?</strong><div className="muted" style={{ fontSize: 14 }}>เช็กอินกับทีมงานหน้างาน: สแกน QR แล้วกดยืนยันการเข้าร่วม</div></div>
            <button className="btn small" style={{ flex: 'none' }} onClick={() => setView('checkin')}>เช็กอิน</button>
          </div>
        </div>
      )}
      {editAvatar && <AvatarSheet me={me} onClose={() => setEditAvatar(false)} onSaved={() => load()} onAuthLost={fail} />}
      <div className="card">
        <div className="profile">
          <button className="avatar" onClick={() => setEditAvatar(true)} aria-label="เปลี่ยนรูปโปรไฟล์" title="เปลี่ยนรูปโปรไฟล์">
            <Avatar url={me.avatar.url} emoji={me.avatar.emoji} name={participant.name} />
            <span className="edit" aria-hidden><AppIcon name="edit" size={14} /></span>
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="profile-name" style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.25 }}>สวัสดี {participant.name}</div>
            {participant.fullName && participant.fullName !== participant.name && <div className="muted" style={{ fontSize: 14 }}>{participant.fullName}</div>}
            <div className="row profile-meta" style={{ marginTop: 8, gap: 6 }}>
              <span className={`role ${me.isLeader && !me.isObserver ? 'leader' : 'member'}`}>{me.isObserver ? '👁 คณะทำงาน' : me.isLeader ? '⭐ หัวหน้าทีม' : '🏕️ สมาชิกทีม'}</span>
              <span className="pill">ทีม {team.name}</span>
              {me.squad && <span className="pill" style={{ background: '#f9dca0' }}>{me.squad}</span>}
              {me.checkin.done && <span className="pill" style={{ background: '#cfe9c9' }}>✅ เช็กอินแล้ว{me.checkin.at ? ` ${new Date(me.checkin.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}` : ''}</span>}
            </div>
          </div>
        </div>
        {!me.avatar.url && !me.avatar.emoji && <div className="muted" style={{ marginTop: 10, fontSize: 14 }}>👆 แตะที่วงกลมเพื่อเลือกรูปโปรไฟล์ของคุณ</div>}
        <div className="row profile-wallet" style={{ marginTop: 12, justifyContent: 'space-between' }}>
          <span className="muted">{me.isObserver ? 'ติดตามความเคลื่อนไหวของทีม' : me.isLeader ? 'คุณมีสิทธิ์แลกสินค้าให้ทีม' : 'หัวหน้าทีมเป็นผู้แลกสินค้า'}</span>
          <span className="coin-row" style={{ fontSize: 22, gap: 6 }}><Coin size={26} /> {team.balance}</span>
        </div>
      </div>

      <div className="tiles">
        <button className="tile t-green" disabled={!me.menus.missions} onClick={() => setView('missions')}>
          <span className="t-icon"><IconMission size={76} /></span>
          <span><div className="t-title">เริ่มภารกิจ</div><div className="t-desc">{me.menus.missions ? 'ควิซ · ล่าสมบัติ · ภารกิจทีม' : '🔒 รอทีมงานเปิดใช้งาน'}</div></span>
          <span className="t-go" aria-hidden>›</span>
        </button>
        <button className="tile t-navy" onClick={() => setView('team')}>
          <span className="t-icon"><IconTeam size={76} /></span>
          <span><div className="t-title">สมาชิกในทีม</div><div className="t-desc">ใครอยู่ทีมเรา ใครทำหน้าที่อะไร</div></span>
          <span className="t-go" aria-hidden>›</span>
        </button>
        <button className="tile t-clay" disabled={!me.menus.market} onClick={() => setView('market')}>
          <span className="t-icon"><IconShop size={76} /></span>
          <span><div className="t-title">ตลาดของ</div><div className="t-desc">{me.menus.market ? 'ดูของ ราคา สต็อก และของของทีม' : '🔒 รอทีมงานเปิดใช้งาน'}</div></span>
          <span className="t-go" aria-hidden>›</span>
        </button>
      </div>
      <LineCheckin status={me.line} onRefresh={load} onAuthLost={fail} />
      <p className="center" style={{ marginTop: 18 }}>
        <button className="btn small ghost" onClick={logout}><AppIcon name="logout" size={18} />ไม่ใช่คุณ? ออกจากระบบ</button>
      </p>
    </Shell>
  );
  };
  return <LineInvitationProvider status={me?.line ?? null} onRefresh={load} onAuthLost={fail}>{renderPage()}</LineInvitationProvider>;
}

/** Event-day check-in: (1) scan the staff QR (the app opens with its code), (2) press confirm. */
function CheckinView({ me, pendingCode, clearPending, onDone, onAuthLost }: {
  me: Me; pendingCode: string; clearPending: () => void; onDone: () => unknown; onAuthLost: (e: unknown) => void;
}) {
  const [code, setCode] = useState(pendingCode);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [justDone, setJustDone] = useState(false);
  const name = me.participant.name;
  const at = me.checkin.at ? new Date(me.checkin.at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '';

  async function confirm() {
    setBusy(true); setErr('');
    try {
      await api('/api/checkin', { code, confirm: true }, 1);
      setJustDone(true); clearPending(); await onDone();
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthLost(e);
      setErr((e as Error).message);
      if (e instanceof ApiError && e.status === 400) setCode(''); // wrong QR / code: scan or type again
    } finally { setBusy(false); }
  }

  if (me.checkin.done || justDone) {
    return (
      <div className="card center stack" style={{ border: '3px solid #2f8f5b' }}>
        <div style={{ fontSize: 64, lineHeight: 1 }}>🎉</div>
        <h2 style={{ margin: 0 }}>เช็กอินสำเร็จ!</h2>
        <div className="muted">ยินดีต้อนรับ <strong>{name}</strong> · ทีม {me.team.name}{at ? ` · เช็กอินเมื่อ ${at}` : ''}</div>
        <div className="muted">เตรียมพร้อมสนุกกับกิจกรรมได้เลย</div>
      </div>
    );
  }
  if (!me.checkin.open) {
    return (
      <div className="card center stack">
        <div style={{ fontSize: 56, lineHeight: 1 }}>⏳</div>
        <h2 style={{ margin: 0 }}>ยังไม่เปิดให้เช็กอิน</h2>
        <div className="muted">ทีมงานจะประกาศเมื่อเปิดเช็กอิน (จะมีข้อความแจ้งเตือนขึ้นบนหน้าจอ)</div>
        <button className="btn ghost" onClick={() => onDone()}>ตรวจสอบอีกครั้ง</button>
      </div>
    );
  }
  if (code) {   // step 2: confirm
    return (
      <div className="card center stack" style={{ border: '3px solid #f0c36a' }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>📍</div>
        <h2 style={{ margin: 0 }}>ยืนยันการเข้าร่วมงาน</h2>
        <div className="avatar" style={{ margin: '0 auto', cursor: 'default' }}><Avatar url={me.avatar.url} emoji={me.avatar.emoji} name={name} /></div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{name}</div>
        <div className="muted">{me.participant.fullName !== name ? `${me.participant.fullName} · ` : ''}ทีม {me.team.name}{me.squad ? ` · ${me.squad}` : ''}</div>
        <div className="banner" style={{ margin: 0 }}>สแกน QR เช็กอินของทีมงานแล้ว · กดยืนยันเมื่อคุณ <strong>มาถึงสถานที่จัดงานแล้ว</strong></div>
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy} onClick={confirm}>{busy ? 'กำลังบันทึก…' : '✅ ยืนยันการเข้าร่วม ฉันมาถึงแล้ว'}</button>
        <button className="btn ghost" disabled={busy} onClick={() => { setCode(''); clearPending(); setErr(''); }}>ไม่ใช่ / สแกนใหม่</button>
      </div>
    );
  }
  return (   // step 1: the camera opens straight away; a QR code leads directly to the confirm screen
    <div className="card center stack">
      <h2 className="page-heading" style={{ margin: 0 }}><AppIcon name="scan" />สแกน QR Code เช็กอิน</h2>
      <div className="muted">ส่องกล้องไปที่ QR Code ของทีมงานหน้างาน</div>
      {err && <div className="error">{err}</div>}
      <QrScanner onCode={(c) => { setErr(''); setCode(c); }} />
    </div>
  );
}

/** Pulls the check-in code out of what the QR contains (our link /?checkin=CODE, or the bare code). */
function checkinCodeFrom(text: string): string | null {
  const t = text.trim();
  try { const c = new URL(t).searchParams.get('checkin'); if (c) return c; } catch { /* not a URL */ }
  return /^[A-Za-z0-9]{6,12}$/.test(t) ? t : null;
}

/** In-app camera QR scanner (works on iPhone and Android browsers; needs the camera permission). */
function QrScanner({ onCode }: { onCode: (code: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'starting' | 'scanning' | 'denied' | 'unsupported'>('starting');
  const [attempt, setAttempt] = useState(0);
  const [wrong, setWrong] = useState(false);
  const cb = useRef(onCode);
  cb.current = onCode;

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = 0;
    const canvas = document.createElement('canvas');
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setState('unsupported'); return; }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false });
      } catch { setState('denied'); return; }
      if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!;
      v.srcObject = stream;
      v.setAttribute('playsinline', 'true');
      await v.play().catch(() => {});
      setState('scanning');
      const tick = (now: number) => {
        if (stopped) return;
        raf = requestAnimationFrame(tick);
        if (now - last < 120 || v.readyState < 2 || !v.videoWidth) return;   // ~8 looks per second is plenty
        last = now;
        const scale = Math.min(1, 640 / v.videoWidth);
        canvas.width = Math.round(v.videoWidth * scale); canvas.height = Math.round(v.videoHeight * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const hit = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
        if (!hit) return;
        const c = checkinCodeFrom(hit.data);
        if (c) { stopped = true; navigator.vibrate?.(80); cb.current(c); }
        else setWrong(true);   // some other QR code: keep looking
      };
      raf = requestAnimationFrame(tick);
    }
    start();
    return () => { stopped = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [attempt]);

  if (state === 'denied' || state === 'unsupported') {
    return (
      <div className="stack" style={{ width: '100%' }}>
        <div className="banner" style={{ margin: 0 }}>
          {state === 'denied'
            ? 'เปิดกล้องไม่ได้ กรุณากดอนุญาตการใช้กล้องของเบราว์เซอร์ (หรือไปที่การตั้งค่าของเบราว์เซอร์แล้วอนุญาตกล้อง)'
            : 'เบราว์เซอร์นี้เปิดกล้องในแอปไม่ได้'}
        </div>
        <button className="btn" onClick={() => { setState('starting'); setAttempt((n) => n + 1); }}><AppIcon name="camera" size={20} />ลองเปิดกล้องอีกครั้ง</button>
        <div className="muted" style={{ fontSize: 14 }}>หรือใช้ <strong>กล้องของมือถือ</strong> (แอปกล้อง) สแกน QR Code ของทีมงาน แล้วเปิดลิงก์ที่ขึ้นมา จะมาที่หน้ายืนยันการเข้าร่วมทันที</div>
      </div>
    );
  }
  return (
    <div style={{ width: '100%' }}>
      <div style={{ position: 'relative', width: '100%', aspectRatio: '1 / 1', borderRadius: 20, overflow: 'hidden', background: '#16301f' }}>
        <video ref={video} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        {state === 'starting' && <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: '#fff' }}>กำลังเปิดกล้อง…</div>}
        {/* viewfinder corners */}
        <div aria-hidden style={{ position: 'absolute', inset: '14%', border: '3px solid rgba(255,255,255,.9)', borderRadius: 18, boxShadow: '0 0 0 9999px rgba(0,0,0,.28)' }} />
      </div>
      {wrong && <div className="muted" style={{ marginTop: 8 }}>นี่ไม่ใช่ QR Code เช็กอินของงาน ลองสแกน QR ของทีมงานอีกครั้ง</div>}
    </div>
  );
}

/** Profile picture: uploaded photo, else the chosen emoji, else the first letter of the name. */
function Avatar({ url, emoji, name }: { url: string | null; emoji: string | null; name: string }) {
  if (url) return <img src={url} alt="" loading="lazy" />;
  if (emoji) return <span aria-hidden>{emoji}</span>;
  return <span aria-hidden>{Array.from(name)[0] ?? '🏕️'}</span>;
}

/** Centre-crops a picture to a small square JPEG (fast upload, privacy-friendly size). */
async function squareJpeg(file: File, side = 320): Promise<File> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('เปิดไฟล์ภาพนี้ไม่ได้ ลองเลือกรูปอื่น (JPG / PNG)');
  const crop = Math.min(bmp.width, bmp.height);
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = side;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, side, side);
  ctx.drawImage(bmp, (bmp.width - crop) / 2, (bmp.height - crop) / 2, crop, crop, 0, 0, side, side);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('แปลงภาพไม่สำเร็จ');
  return new File([blob], 'me.jpg', { type: 'image/jpeg' });
}

/** Bottom sheet: take/choose a photo, or pick an emoji. */
function AvatarSheet({ me, onClose, onSaved, onAuthLost }: { me: Me; onClose: () => void; onSaved: () => unknown; onAuthLost: (e: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function run(fn: () => Promise<unknown>) {
    setBusy(true); setErr('');
    try { await fn(); await onSaved(); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onAuthLost(e); setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  const pickEmoji = (emoji: string) => run(() => api('/api/profile', { emoji }));
  const removePhoto = () => run(() => api('/api/profile', { removePhoto: true }));
  const upload = (file: File) => run(async () => {
    const small = await squareJpeg(file);
    const fd = new FormData(); fd.append('file', small);
    const res = await fetch('/api/profile/photo', { method: 'POST', body: fd });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, data.message ?? 'อัปโหลดรูปไม่สำเร็จ');
  });
  return (
    <div className="player-dialog-overlay" role="dialog" aria-modal="true" aria-label="เลือกรูปโปรไฟล์" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(31,47,77,.55)', display: 'grid', placeItems: 'end center', zIndex: 60 }}>
      <div className="card player-dialog-panel avatar-sheet" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 480, borderRadius: '24px 24px 0 0', margin: 0 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>รูปโปรไฟล์ของฉัน</h2>
          <button className="btn small ghost" onClick={onClose}>ปิด</button>
        </div>
        <div className="center" style={{ margin: '14px 0' }}>
          <div className="avatar" style={{ width: 110, height: 110, fontSize: 56, margin: '0 auto', cursor: 'default' }}>
            <Avatar url={me.avatar.url} emoji={me.avatar.emoji} name={me.participant.name} />
          </div>
        </div>
        <label className="btn avatar-upload-action" style={{ textAlign: 'center', opacity: busy ? 0.5 : 1 }}>
          <AppIcon name="camera" size={20} />ถ่ายรูป / เลือกรูปจากเครื่อง
          <input type="file" accept="image/*" disabled={busy} hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        </label>
        {me.avatar.url && <button className="btn ghost" style={{ marginTop: 8 }} disabled={busy} onClick={removePhoto}>ลบรูปนี้</button>}
        <div className="muted" style={{ margin: '14px 0 8px' }}>หรือเลือกอีโมจิน่ารัก ๆ</div>
        <div className="emoji-grid">
          {AVATAR_EMOJIS.map((e) => (
            <button key={e} className={me.avatar.emoji === e && !me.avatar.url ? 'on' : ''} disabled={busy} onClick={() => pickEmoji(e)} aria-label={`เลือก ${e}`}>{e}</button>
          ))}
        </div>
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
        <p className="muted" style={{ margin: '12px 0 0', fontSize: 13.5 }}>รูปที่อัปโหลดเพื่อนร่วมทีมและทีมงานเห็นได้ ใช้เฉพาะรูปที่เหมาะสมนะ</p>
      </div>
    </div>
  );
}

/** The team screen leads with LINE participation and keeps staff outside every denominator. */
function TeamView({ me, onAuthLost }: { me: Me; onAuthLost: (e: unknown) => void }) {
  type Member = { id?: string; name: string; isLeader: boolean; isMe: boolean; isObserver?: boolean;
    squad: string | null; squadId?: string | null; quizDone: boolean; lineJoined: boolean; avatarUrl: string | null; avatarEmoji: string | null };
  type TeamData = { team: string; total: number; quizDone: number; squads: string[]; members: Member[];
    squadOptions?: { id: string; name: string }[]; canManageSquads?: boolean; observerTotal?: number;
    line?: { joined: number; total: number; missing: number; missingPct: number } };
  const [d, setD] = useState<TeamData | null>(null);
  const [err, setErr] = useState('');
  const [message, setMessage] = useState('');
  const [newSquad, setNewSquad] = useState('');
  const [saving, setSaving] = useState<string | null>(null);
  const cb = useRef(onAuthLost);
  cb.current = onAuthLost;
  const load = useCallback(async () => {
    try { setD(await api<TeamData>('/api/team')); setErr(''); }
    catch (e) { cb.current(e); setErr((e as Error).message); }
  }, []);
  useEffect(() => {
    void load();
    const timer = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 15000);
    return () => clearInterval(timer);
  }, [load]);

  async function createSquad() {
    if (!newSquad.trim() || saving) return;
    setSaving('create'); setErr(''); setMessage('');
    try {
      await api('/api/team/squads', { action: 'create', name: newSquad.trim() });
      setNewSquad(''); await load(); setMessage('สร้าง Squad แล้ว เลือกสมาชิกด้านล่างเพื่อจัดเข้ากลุ่มได้เลย');
    } catch (e) { cb.current(e); setErr((e as Error).message); }
    finally { setSaving(null); }
  }
  async function assignSquad(member: Member, squadId: string) {
    if (!member.id || saving) return;
    setSaving(member.id); setErr(''); setMessage('');
    try {
      await api('/api/team/squads', { action: 'assign', participantId: member.id, squadId: squadId || null });
      await load(); setMessage(`บันทึก Squad ของ ${member.name} แล้ว`);
    } catch (e) { cb.current(e); setErr((e as Error).message); }
    finally { setSaving(null); }
  }
  if (!d) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;

  const members = d.members.filter((m) => !m.isObserver);
  const observers = d.members.filter((m) => m.isObserver);
  const leader = members.find((m) => m.isLeader);
  const total = d.line?.total ?? members.length;
  const joined = d.line?.joined ?? members.filter((m) => m.lineJoined).length;
  const missing = d.line?.missing ?? Math.max(0, total - joined);
  const missingPct = d.line?.missingPct ?? (total ? Math.ceil(missing * 1000 / total) / 10 : 0);
  const progress = total ? Math.min(100, joined * 100 / total) : 0;
  const squadOptions = d.squadOptions ?? [];
  const canManage = !!d.canManageSquads && !me.isObserver;
  const groups = [
    ...d.squads.map((name) => ({ title: name, list: members.filter((m) => !m.isLeader && m.squad === name) })),
    { title: 'ยังไม่ได้อยู่ Squad', list: members.filter((m) => !m.isLeader && !m.squad) },
  ].filter((group) => group.list.length);
  const row = (m: Member, index: number) => (
    <div className="m-row team-member-row" key={m.id ?? index}>
      <div className={`m-av ${m.isLeader ? 'leader' : ''}`} aria-hidden><Avatar url={m.avatarUrl} emoji={m.avatarEmoji} name={m.name} /></div>
      <div className="team-member-info">
        <strong>{m.name}</strong>{m.isMe && <span className="me-tag">คุณ</span>}
        <div className="muted" style={{ fontSize: 13 }}>{m.isObserver ? 'คณะทำงาน · ดูความเคลื่อนไหวของทีม' : m.isLeader ? '⭐ หัวหน้าทีม' : 'สมาชิกทีม'}</div>
        {!m.isObserver && <div className={`line-member-state ${m.lineJoined ? 'joined' : ''}`}>{m.lineJoined ? '✓ เข้า LINE แล้ว' : 'ยังไม่ได้เข้ากลุ่ม LINE'}</div>}
        {canManage && !m.isObserver && m.id && <label className="squad-member-control">
          <span>Squad</span>
          <select aria-label={`Squad ของ ${m.name}`} value={m.squadId ?? ''} disabled={!!saving}
            onChange={(event) => void assignSquad(m, event.target.value)}>
            <option value="">ยังไม่กำหนด Squad</option>
            {squadOptions.map((squad) => <option key={squad.id} value={squad.id}>{squad.name}</option>)}
          </select>
          {saving === m.id && <span className="muted">กำลังบันทึก…</span>}
        </label>}
        {!canManage && !m.isObserver && m.squad && <span className="muted" style={{ fontSize: 13 }}>Squad {m.squad}</span>}
      </div>
    </div>
  );
  return (
    <>
      <div className="card team-line-summary">
        <div className="row team-summary-heading" style={{ gap: 10 }}><LineLogo size={42} /><h2 style={{ margin: 0 }}>สมาชิกทีม {d.team}</h2></div>
        <div className="team-line-numbers"><strong>{joined}<span> / {total} คน</span></strong><span>เข้ากลุ่ม LINE แล้ว</span></div>
        <div className="progress" role="progressbar" aria-label="สมาชิกที่เข้ากลุ่ม LINE แล้ว" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={joined}>
          <i style={{ width: `${progress}%`, background: '#06c755' }} />
        </div>
        <div className="line-progress-status" role="status">{missing > 0 ? <>ยังขาด <strong>{missing} คน</strong> · อีก <strong>{missingPct}%</strong></> : total > 0 ? '✓ สมาชิกเข้ากลุ่ม LINE ครบแล้ว 100%' : 'ยังไม่มีสมาชิกในทีม'}</div>
        {observers.length > 0 && <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>คณะทำงาน {observers.length} คน ไม่รวมในจำนวนสมาชิกและสัดส่วนนี้</div>}
      </div>
      {canManage && <div className="card stack">
        <h2 className="page-heading"><AppIcon name="team" />จัด Squad ของทีม</h2>
        <p className="muted" style={{ margin: 0 }}>สร้าง Squad แล้วเลือกกลุ่มให้สมาชิกแต่ละคน ระบบจะบันทึกให้ทันที</p>
        <form className="squad-create-form" onSubmit={(event) => { event.preventDefault(); void createSquad(); }}>
          <label className="grow"><span className="lbl">ชื่อ Squad ใหม่</span><input className="field" aria-label="ชื่อ Squad ใหม่" value={newSquad} maxLength={60} disabled={!!saving} onChange={(event) => setNewSquad(event.target.value)} placeholder="เช่น ครัวที่ 1" /></label>
          <button className="btn small" type="submit" disabled={!!saving || !newSquad.trim()}>{saving === 'create' ? 'กำลังสร้าง…' : 'สร้าง Squad'}</button>
        </form>
      </div>}
      {err && <div className="error" role="alert">{err}</div>}
      {message && <div className="team-save-status" role="status">✓ {message}</div>}
      <div className="card" style={{ border: '2px solid #f0d99e', background: '#fffdf6' }}>
        <h2 className="page-heading" style={{ fontSize: 17 }}><AppIcon name="shield" size={20} />หัวหน้าทีม</h2>
        {leader ? <div className="members">{row(leader, -1)}</div> : <div className="muted">ยังไม่ได้กำหนดหัวหน้าทีม · สอบถามทีมงาน</div>}
        <p className="muted" style={{ fontSize: 13, margin: '8px 0 0' }}>หัวหน้าทีมจัด Squad และแลกสินค้าด้วยโทเคนของทีมได้</p>
      </div>
      {groups.map((group) => <div className="card members" key={group.title}><strong className="action-icon"><AppIcon name="users" size={20} />{group.title} <span className="muted" style={{ fontWeight: 400 }}>({group.list.length} คน)</span></strong><div style={{ marginTop: 4 }}>{group.list.map(row)}</div></div>)}
      {observers.length > 0 && <div className="card members"><h2 className="page-heading" style={{ fontSize: 18 }}><AppIcon name="users" size={22} />คณะทำงาน <span className="muted">({observers.length} คน)</span></h2><p className="muted" style={{ margin: '0 0 6px', fontSize: 13 }}>ติดตามความเคลื่อนไหวของทีม ไม่นับคะแนนหรือสัดส่วนกิจกรรม</p>{observers.map(row)}</div>}
    </>
  );
}

/** Team goal: "everyone plays" progress. Hidden when the organiser has switched the goal off. */
function GoalCard({ goal, mine }: { goal: Goal; mine?: boolean }) {
  if (!goal.goalPct) return null;
  const pct = goal.participants ? Math.round((goal.completed / goal.participants) * 100) : 0;
  return (
    <div className="card" style={{ border: `3px solid ${goal.met ? '#2f8f5b' : '#f1e8d0'}` }}>
      <strong className="action-icon"><AppIcon name="missions" size={21} />เป้าหมายร่วมของทีม: สมาชิกเล่นควิซจบ {goal.goalPct}%</strong>
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

// ---- pop-up for staff decisions on team photos (shown on whatever page the player is on)
const SEEN_KEY = 'fc_seen_photos';
const noticeStore = {
  current: null as PhotoNotice | CheckinNotice | null,
  listeners: new Set<() => void>(),
  onClose: undefined as (() => void) | undefined,
  onCheckin: undefined as (() => void) | undefined,
  get() { return noticeStore.current; },
  set(n: PhotoNotice | CheckinNotice | null) { noticeStore.current = n; noticeStore.listeners.forEach((l) => l()); },
  subscribe(l: () => void) { noticeStore.listeners.add(l); return () => { noticeStore.listeners.delete(l); }; },
};
function readSeen(): Set<string> {
  try { return new Set<string>(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]')); } catch { return new Set<string>(); }
}
function markSeen(id: string) {
  try { const s = Array.from(readSeen()); s.push(id); localStorage.setItem(SEEN_KEY, JSON.stringify(s.slice(-100))); } catch { /* storage blocked: it may show again, harmless */ }
}
function NoticeModal() {
  const n = useSyncExternalStore(noticeStore.subscribe, noticeStore.get, () => null);
  if (!n) return null;
  if ('kind' in n) {   // admin opened event-day check-in
    const later = () => { markSeen(n.id); noticeStore.set(null); };
    const go = () => { markSeen(n.id); noticeStore.set(null); noticeStore.onCheckin?.(); };
    return (
      <div className="player-dialog-overlay" role="alertdialog" aria-modal="true" aria-label="เช็กอินวันงาน" onClick={later}
        style={{ position: 'fixed', inset: 0, background: 'rgba(31,47,77,.6)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
        <div className="card center stack player-dialog-panel" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, margin: 0, border: '4px solid #f0c36a' }}>
          <div className="dialog-feature-icon"><AppIcon name="checkin" size={52} /></div>
          <h2 style={{ margin: 0 }}>ถึงสถานที่จัดงานแล้วใช่ไหม?</h2>
          <div className="muted">ทีมงานเปิดให้ <strong>เช็กอิน</strong> แล้ว สแกน QR Code เช็กอินที่ทีมงานหน้างานด้วยกล้องมือถือ แล้วกด <strong>ยืนยันการเข้าร่วม</strong></div>
          <button className="btn" onClick={go}><AppIcon name="scan" size={20} />ไปเช็กอิน</button>
          <button className="btn ghost" onClick={later}>ไว้ทีหลัง</button>
        </div>
      </div>
    );
  }
  const ok = n.status === 'approved';
  const close = () => { markSeen(n.id); noticeStore.set(null); noticeStore.onClose?.(); };
  return (
    <div className="player-dialog-overlay" role="alertdialog" aria-modal="true" aria-label="ผลการตรวจภาพภารกิจ" onClick={close}
      style={{ position: 'fixed', inset: 0, background: 'rgba(31,47,77,.6)', display: 'grid', placeItems: 'center', zIndex: 100 }}>
      <div className="card center stack player-dialog-panel" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 420, margin: 0, border: `4px solid ${ok ? '#2f8f5b' : '#d98b86'}` }}>
        <div className="dialog-feature-icon"><AppIcon name={ok ? 'check' : 'info'} size={52} /></div>
        <h2 style={{ margin: 0 }}>{ok ? 'ภารกิจผ่านแล้ว!' : 'ภาพยังไม่ผ่าน'}</h2>
        <div><strong>{n.title}</strong></div>
        {ok ? (
          <>
            <div className="muted">ทีมงานยืนยันภาพของทีมคุณแล้ว</div>
            <div className="coin-row" style={{ justifyContent: 'center' }}><Coin size={44} /> +{n.tokens}</div>
            <div className="muted">โทเคนเข้ากระเป๋าทีมเรียบร้อย</div>
          </>
        ) : (
          <>
            <div className="error" style={{ textAlign: 'left' }}>{n.reason ? `เหตุผล: ${n.reason}` : 'ภาพไม่ตรงกับโจทย์'}</div>
            <div className="muted">ให้หัวหน้าทีมถ่ายภาพใหม่ให้ตรงโจทย์ แล้วส่งอีกครั้งได้เลย</div>
          </>
        )}
        <button className="btn" onClick={close}>ตกลง</button>
      </div>
    </div>
  );
}

function Shell({ children, subtitle, onHome, suppressNotices = false }: { children: React.ReactNode; subtitle?: string; onHome?: () => void; suppressNotices?: boolean }) {
  const invitation = useLineInvitation();
  return (
    <div className="app player-shell">
      <Hero subtitle={subtitle} onHome={onHome} />
      <main className="main player-main">{invitation?.isObserver && <div className="observer-note" role="status">👁 คณะทำงาน · ดูความเคลื่อนไหวของทีม ข้อมูลของคุณไม่รวมในการนับสมาชิกและคะแนน</div>}{children}</main>
      {!suppressNotices && !invitation?.promptOpen && <NoticeModal />}
    </div>
  );
}


/** Activities screen: tabs for the treasure hunt and the team puzzles. A scanned QR code always opens the hunt tab. */
function Activities(props: { tab: 'hunt' | 'puzzle'; onTabChange: (tab: 'hunt' | 'puzzle') => void; access: MenuAccess; readOnly?: boolean; pending: string; clearPending: () => void; onBalance: () => void; onAuthLost: (e: unknown) => void }) {
  const { tab, onTabChange, access } = props;
  return (
    <>
      <div className="tabs activity-tabs" style={{ marginTop: 14 }}>
        <button className={tab === 'hunt' ? 'on' : ''} disabled={!access.hunt} onClick={() => onTabChange('hunt')}><AppIcon name="hunt" size={20} />ล่าสมบัติ{!access.hunt && ' 🔒'}</button>
        <button className={tab === 'puzzle' ? 'on' : ''} disabled={!access.photos} onClick={() => onTabChange('puzzle')}><AppIcon name="camera" size={20} />ภารกิจทีม{!access.photos && ' 🔒'}</button>
      </div>
      {tab === 'hunt' && access.hunt ? <HuntView {...props} /> : access.photos ? <PhotoMissionsView readOnly={props.readOnly} onBalance={props.onBalance} onAuthLost={props.onAuthLost} /> : null}
    </>
  );
}

const CATEGORY: Record<string, { icon: string; label: string }> = {
  person: { icon: '👤', label: 'ภาพบุคคล' }, object: { icon: '📦', label: 'ภาพสิ่งของ' }, food: { icon: '🍜', label: 'ภาพอาหาร' },
  place: { icon: '📍', label: 'ภาพสถานที่' }, other: { icon: '🎯', label: 'โจทย์พิเศษ' },
};

/** Shrinks a photo to max 1600px JPEG in the browser (phone photos are several MB). */
async function fitJpeg(file: File, maxSide = 1600): Promise<File> {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('เปิดไฟล์ภาพนี้ไม่ได้ ลองถ่ายหรือเลือกภาพใหม่ (JPG / PNG)');
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('แปลงภาพไม่สำเร็จ');
  return new File([blob], 'mission.jpg', { type: 'image/jpeg' });
}

/** Team photo missions: everyone sees the brief; ONLY the team leader can upload the photo, and that completes the mission. */
function PhotoMissionsView({ onBalance, onAuthLost, readOnly = false }: { onBalance: () => void; onAuthLost: (e: unknown) => void; readOnly?: boolean }) {
  const [d, setD] = useState<PhotoData | null>(null);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  const [zoom, setZoom] = useState<string | null>(null);
  const cb = useRef({ onBalance, onAuthLost });
  cb.current = { onBalance, onAuthLost };
  const load = useCallback(async () => {
    try { setD(await api<PhotoData>('/api/photos')); } catch (e) { cb.current.onAuthLost(e); setErr((e as Error).message); }
  }, []);
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 12000); return () => clearInterval(t); }, [load]); // the leader may upload from another phone

  if (!d) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;
  const successCount = d.missions.filter((m) => m.submission?.status === 'approved').length;
  const waitingCount = d.missions.filter((m) => m.submission?.status === 'pending').length;
  return (
    <>
      {zoom && (
        <div className="image-preview-overlay" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label="ภาพ"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.82)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50, cursor: 'zoom-out' }}>
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '88dvh', borderRadius: 16 }} />
        </div>
      )}
      <div className="card">
        <h2 className="page-heading"><AppIcon name="camera" />ภารกิจทีม</h2>
        <p className="muted" style={{ margin: 0 }}>
          ถ่ายภาพ<strong>ทั้งทีม</strong>ตามโจทย์ที่กำหนด (ทุกคนอยู่ในภาพพร้อมกับสิ่งนั้น) แล้ว <strong>หัวหน้าทีมเท่านั้น</strong>เป็นผู้อัปโหลดภาพ ·
          <strong>ทีมงานจะตรวจภาพก่อน</strong> เมื่อกดยืนยันภารกิจจึงสำเร็จและทีมได้โทเคน (ถ้าไม่ตรงโจทย์จะถูกปฏิเสธ และถ่ายส่งใหม่ได้)
          {d.leaderName ? <> · หัวหน้าทีมของเรา: <strong>⭐ {d.leaderName}</strong></> : ' · ทีมนี้ยังไม่มีหัวหน้า ติดต่อทีมงาน'}
        </p>
        <div className="muted" style={{ marginTop: 6 }}>สำเร็จแล้ว {successCount}/{d.missions.length} ภารกิจ{waitingCount > 0 ? ` · ⏳ รอทีมงานตรวจ ${waitingCount}` : ''}</div>
        {(d.isLeader && !readOnly) && <div className="role leader" style={{ marginTop: 8 }}>⭐ คุณคือหัวหน้าทีม มีสิทธิ์อัปโหลดภาพ</div>}
        {!d.open && <div className="banner" style={{ marginTop: 12 }}>ภารกิจทีมยังไม่เปิด หรือปิดแล้ว รอทีมงานประกาศ</div>}
        {err && <div className="error" style={{ marginTop: 12 }}>{err}</div>}
      </div>
      {done && <div className="card center" style={{ border: '3px solid #2f8f5b' }}><div className="verdict ok" style={{ fontSize: 17 }}>{done}</div></div>}
      {d.missions.length === 0 && <div className="card center muted">ยังไม่มีภารกิจ</div>}
      {d.missions.map((m) => {
        const c = CATEGORY[m.category] ?? CATEGORY.other;
        const sub = m.submission;
        const border = sub?.status === 'approved' ? '3px solid #2f8f5b' : sub?.status === 'pending' ? '3px solid #f0c36a' : sub?.status === 'rejected' ? '3px solid #e0a29d' : undefined;
        const canUpload = (d.isLeader && !readOnly) && (!sub || sub.status === 'rejected' || sub.status === 'pending');
        return (
          <div className="card" key={m.id} style={border ? { border } : undefined}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="pill">{c.icon} {c.label}</span>
              <span className="pill" style={{ background: '#fbe7b8' }}>🪙 +{m.tokens}</span>
            </div>
            <h2 style={{ fontSize: 19, margin: '10px 0 4px' }}>{m.title}</h2>
            {m.description && <p style={{ margin: '0 0 10px', whiteSpace: 'pre-line' }}>{m.description}</p>}
            {m.refImageUrl && (
              <div style={{ marginBottom: 10 }}>
                <div className="muted" style={{ fontSize: 14, marginBottom: 4 }}>ภาพตัวอย่าง (แตะเพื่อขยาย)</div>
                <img src={m.refImageUrl} alt="ภาพตัวอย่าง" onClick={() => setZoom(m.refImageUrl)} loading="lazy"
                  style={{ width: '100%', maxHeight: 220, objectFit: 'cover', borderRadius: 14, cursor: 'zoom-in', background: 'var(--cream-deep)' }} />
              </div>
            )}
            {sub && (
              <>
                <img src={sub.url} alt="ภาพของทีม" onClick={() => setZoom(sub.url)} loading="lazy"
                  style={{ width: '100%', maxHeight: 260, objectFit: 'cover', borderRadius: 14, cursor: 'zoom-in', opacity: sub.status === 'rejected' ? 0.55 : 1 }} />
                {sub.status === 'pending' && <div className="banner" style={{ margin: '10px 0 0' }}>⏳ <strong>รอทีมงานตรวจสอบและยืนยัน</strong> · ส่งโดย ⭐ {sub.by} · ยังไม่ได้โทเคน</div>}
                {sub.status === 'approved' && <div className="verdict ok" style={{ fontSize: 16 }}>✅ ทีมงานยืนยันแล้ว · ได้ +{sub.tokens} โทเคน · ส่งโดย ⭐ {sub.by}</div>}
                {sub.status === 'rejected' && (
                  <div className="error" style={{ marginTop: 10 }}>
                    ❌ <strong>ภาพนี้ไม่ผ่าน</strong>{sub.reason ? `: ${sub.reason}` : ' (ไม่ตรงโจทย์)'}<br />
                    {(d.isLeader && !readOnly) ? 'ถ่ายภาพใหม่แล้วส่งอีกครั้งได้เลย' : `ให้หัวหน้าทีม ${d.leaderName ?? ''} ถ่ายภาพใหม่แล้วส่งอีกครั้ง`}
                  </div>
                )}
              </>
            )}
            {canUpload && (
              <div style={{ marginTop: 10 }}>
                <PhotoUpload mission={m} open={d.open} replacing={sub?.status === 'pending'}
                  onDone={async (text) => { setDone(text); cb.current.onBalance(); await load(); }} onAuthLost={onAuthLost} />
              </div>
            )}
            {!sub && !(d.isLeader && !readOnly) && (
              <div className="banner" style={{ margin: 0 }}>
                ⏳ ยังไม่ส่ง · {d.leaderName ? `รอหัวหน้าทีม ${d.leaderName} ถ่ายภาพทั้งทีมและอัปโหลด` : 'ทีมยังไม่มีหัวหน้า ติดต่อทีมงาน'}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

/** Leader only: pick/take the team photo, preview it, confirm everyone is in it, upload. */
function PhotoUpload({ mission, open, replacing, onDone, onAuthLost }: { mission: PhotoData['missions'][number]; open: boolean; replacing?: boolean; onDone: (text: string) => void | Promise<void>; onAuthLost: (e: unknown) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  async function pick(f: File) {
    setErr('');
    try {
      const small = await fitJpeg(f);
      setFile(small); setPreview(URL.createObjectURL(small)); setAll(false);
    } catch (e) { setErr((e as Error).message); }
  }
  async function upload() {
    if (!file) return;
    setBusy(true); setErr('');
    try {
      const fd = new FormData(); fd.append('file', file); fd.append('missionId', mission.id);
      const res = await fetch('/api/photos/submit', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new ApiError(res.status, data.message ?? 'อัปโหลดไม่สำเร็จ ลองใหม่อีกครั้ง');
      await onDone(data.already ? 'ภารกิจนี้ทีมของคุณผ่านการยืนยันแล้ว' : `ส่งภาพ “${mission.title}” แล้ว ⏳ รอทีมงานตรวจสอบและยืนยัน เมื่อยืนยันแล้วทีมจะได้ +${data.tokens} โทเคน`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onAuthLost(e);
      setErr((e as Error).message);
    } finally { setBusy(false); }
  }
  return (
    <div>
      {preview && <img src={preview} alt="ตัวอย่างภาพที่จะส่ง" style={{ width: '100%', maxHeight: 280, objectFit: 'cover', borderRadius: 14, marginBottom: 10 }} />}
      <label className={`btn ${preview ? 'ghost' : ''}`} style={{ display: 'block', textAlign: 'center', opacity: busy || !open ? 0.5 : 1 }}>
        {preview ? '📷 เปลี่ยนภาพ' : replacing ? '📷 เปลี่ยนภาพที่ส่งไปแล้ว (ก่อนทีมงานตรวจ)' : '📷 ถ่ายภาพ / เลือกภาพของทีม'}
        <input type="file" accept="image/*" hidden disabled={busy || !open} onChange={(e) => { const f = e.target.files?.[0]; if (f) pick(f); e.target.value = ''; }} />
      </label>
      {file && (
        <>
          <label className="row" style={{ margin: '12px 0', alignItems: 'flex-start', gap: 10 }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ width: 22, height: 22, marginTop: 2 }} />
            <span>ยืนยันว่า<strong>ทุกคนในทีมอยู่ในภาพ</strong>พร้อมกับสิ่งที่โจทย์กำหนดแล้ว</span>
          </label>
          <button className="btn" disabled={!all || busy || !open} onClick={upload}>{busy ? 'กำลังอัปโหลด…' : replacing ? 'ส่งภาพใหม่แทนภาพเดิม' : 'ส่งภาพให้ทีมงานตรวจ'}</button>
        </>
      )}
      {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
    </div>
  );
}

function HuntView({ pending, clearPending, onBalance, onAuthLost, readOnly = false }: {
  readOnly?: boolean; pending: string; clearPending: () => void; onBalance: () => void; onAuthLost: (e: unknown) => void;
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
    if (readOnly) return;
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
  }, [loadHunt, readOnly]);

  useEffect(() => { loadHunt(); }, [loadHunt]);
  // While a co-op spot is waiting for teammates, refresh so everyone sees the progress (and the win) quickly.
  const waiting = !!h?.spots.some((x) => x.coop && !x.found && x.coop.have > 0);
  const wasFound = useRef(0);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => { if (document.visibilityState === 'visible') loadHunt(); }, 6000);
    return () => clearInterval(t);
  }, [waiting, loadHunt]);
  useEffect(() => {
    if (!h) return;
    if (h.found > wasFound.current && wasFound.current > 0) cb.current.onBalance();
    wasFound.current = h.found;
  }, [h]);
  // Arrived by scanning a QR: claim once, automatically.
  useEffect(() => {
    if (pending && !readOnly && !claimed.current) { claimed.current = true; const p = pending; cb.current.clearPending(); claim(p); }
  }, [pending, claim, readOnly]);

  if (!h) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;
  const total = h.spots.length;
  return (
    <>
      <div className="card center">
        <h2 className="page-heading"><AppIcon name="hunt" />ล่าสมบัติ</h2>
        <div className="muted">
          {h.squad ? <>สควอด <strong>{h.squad}</strong> (ทีม {h.team.name}) เจอแล้ว</> : <>ทีม {h.team.name} เจอแล้ว</>} {h.found}/{total} จุด · ได้ {h.earned} โทเคน
        </div>
        <div className="progress"><i style={{ width: `${total ? (h.found / total) * 100 : 0}%` }} /></div>
        <div className="coin-row"><Coin size={36} /> {h.team.balance}</div>
        {!h.open && <div className="banner" style={{ marginTop: 12 }}>กิจกรรมล่าสมบัติยังไม่เปิด หรือปิดแล้ว</div>}
      </div>

      {h.squads.length > 0 && (
        <div className="card">
          <strong className="action-icon"><AppIcon name="users" size={20} />สควอดในทีมของคุณ</strong>
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

      {!readOnly && <div className="card stack">
        <strong>กรอกรหัสที่จุด (หรือสแกน QR ด้วยกล้องมือถือ)</strong>
        <input className="input" aria-label="รหัสจุด" autoCapitalize="characters" autoComplete="off" autoCorrect="off" placeholder="รหัสจุด" value={code}
          onChange={(e) => setCode(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && code.trim().length >= 4 && claim(code)} />
        {err && <div className="error">{err}</div>}
        <button className="btn" disabled={busy || code.replace(/[^a-zA-Z0-9]/g, '').length < 4 || !h.open} onClick={() => claim(code)}>
          {busy ? 'กำลังตรวจสอบ…' : 'ยืนยันรหัส'}
        </button>
      </div>}

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
  const [cat, setCat] = useState<'all' | 'ingredient' | 'decoration'>('all');
  if (me.market.length === 0) return <p className="muted center" style={{ margin: 0 }}>ยังไม่มีสินค้า</p>;
  const count = (k: string) => me.market.filter((m) => k === 'all' || marketCat(m.category) === k).length;
  const items = me.market.filter((m) => cat === 'all' || marketCat(m.category) === cat).sort((a, b) => Number(a.stock === 0) - Number(b.stock === 0) || a.price - b.price);
  const owned = new Map(me.inventory.map((i) => [i.item, i.qty]));
  return (
    <>
      {zoom && (
        <div className="image-preview-overlay" onClick={() => setZoom(null)} role="dialog" aria-modal="true" aria-label="รูปสินค้า"
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.8)', display: 'grid', placeItems: 'center', padding: 16, zIndex: 50, cursor: 'zoom-out' }}>
          <img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '85dvh', borderRadius: 16 }} />
        </div>
      )}
      <div className="tabs cats category-tabs" role="tablist" aria-label="หมวดสินค้า">
        <button role="tab" aria-selected={cat === 'all'} className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>ทั้งหมด ({count('all')})</button>
        {MARKET_CATS.map((c) => (
          <button key={c.key} role="tab" aria-selected={cat === c.key} className={cat === c.key ? 'on' : ''} onClick={() => setCat(c.key)}>{c.icon} {c.label} ({count(c.key)})</button>
        ))}
      </div>
      {items.length === 0 && <p className="muted center" style={{ margin: '8px 0' }}>ยังไม่มีสินค้าในหมวดนี้</p>}
      <ul className="list">
        {items.map((m) => {
          const out = m.stock <= 0;
          const locked = m.requires_goal && !me.goal.met;
          const low = !out && m.stock <= 3;
          const afford = me.team.balance >= m.price;
          const have = owned.get(m.name) ?? 0;
          const canBuy = !!onRedeem && !out && !locked && afford;
          return (
            <li className="market-product-row" key={m.id} style={{ alignItems: 'center', opacity: out ? 0.55 : 1, flexWrap: 'wrap' }}>
              <button className="market-product-media" type="button" aria-label={`ดูรูป ${m.name}`} disabled={!m.image_url} onClick={() => m.image_url && setZoom(m.image_url)}
                style={{ flex: 'none', width: 64, height: 64, padding: 0, border: 0, borderRadius: 12, overflow: 'hidden', background: 'var(--cream-deep)', cursor: m.image_url ? 'zoom-in' : 'default' }}>
                {m.image_url ? <img src={m.image_url} alt={m.name} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /> : <span style={{ fontSize: 28 }}>🍽️</span>}
              </button>
              <span className="market-product-info" style={{ flex: 1, minWidth: 0 }}>
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
              <strong className="market-product-price" style={{ textAlign: 'right' }}>{m.price}<br /><span className="muted" style={{ fontWeight: 400 }}>โทเคน</span></strong>
              {onRedeem && (
                <button className="btn small market-product-action" style={{ flexBasis: '100%', marginTop: 6 }} disabled={!canBuy} onClick={() => onRedeem(m)}>
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
          <li className="team-inventory-row" key={i.item} style={{ alignItems: 'center' }}>
            <span className="team-inventory-media" style={{ flex: 'none', width: 56, height: 56, borderRadius: 12, overflow: 'hidden', background: 'var(--cream-deep)', display: 'grid', placeItems: 'center' }}>
              {i.image_url ? <img src={i.image_url} alt={i.item} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ fontSize: 26 }}>🍽️</span>}
            </span>
            <span className="team-inventory-info" style={{ flex: 1, minWidth: 0 }}>
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
    const t = setInterval(() => { if (document.visibilityState === 'visible') refresh.current(); }, 30000);
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

  const canRedeem = me.isLeader && !me.isObserver && me.marketOpen;
  const maxQty = sel ? Math.max(1, Math.min(20, sel.stock, Math.floor(me.team.balance / sel.price))) : 1;
  return (
    <>
      <div className="card center">
        <h2 className="page-heading"><AppIcon name="shop" />ตลาด / แลกของ</h2>
        <div className="muted">โทเคนของทีม {me.team.name}</div>
        <div className="coin-row"><Coin size={40} /> {me.team.balance}</div>
        <p className="muted" style={{ marginBottom: 0 }}>
          {me.isLeader
            ? (me.marketOpen ? 'คุณเป็นหัวหน้าทีม: กด “แลกสินค้านี้” เพื่อใช้โทเคนของทีม' : 'คุณเป็นหัวหน้าทีม · ตลาดยังไม่เปิดให้แลกเอง รอทีมงานประกาศ')
            : `เฉพาะหัวหน้าทีม${me.leaderName ? ` (${me.leaderName})` : ''} เท่านั้นที่แลกสินค้าได้ · คุณดูของและสต็อกได้`}
        </p>
      </div>
      <div className="tabs market-tabs">
        <button className={tab === 'buy' ? 'on' : ''} onClick={() => setTab('buy')}><AppIcon name="shop" size={20} />แลกของ</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}><AppIcon name="team" size={20} />ของของทีม</button>
      </div>
      {done && <div className="card center" style={{ border: '3px solid #2f8f5b' }}><div className="verdict ok" style={{ fontSize: 17 }}>{done}</div></div>}
      {tab === 'buy' && <GoalCard goal={me.goal} mine />}
      <div className="card">{tab === 'buy' ? <MarketList me={me} onRedeem={canRedeem ? open : undefined} /> : <TeamInventory me={me} />}</div>

      {sel && (
        <div className="player-dialog-overlay" role="dialog" aria-modal="true" aria-label="ยืนยันการแลก" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', display: 'grid', placeItems: 'end center', zIndex: 60 }}>
          <div className="card player-dialog-panel market-dialog-panel" style={{ width: '100%', maxWidth: 480, borderRadius: '22px 22px 0 0', margin: 0 }}>
            <h2>ยืนยันการแลก</h2>
            <div className="market-product-name" style={{ fontSize: 20, fontWeight: 700 }}>{sel.name}</div>
            <div className="muted">ราคา {sel.price} โทเคน/ชิ้น · เหลือ {sel.stock} ชิ้น</div>
            <div className="row redemption-qty" style={{ margin: '14px 0', justifyContent: 'center' }}>
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
      <button className="btn ghost" onClick={() => { refresh.current(); }}><AppIcon name="refresh" size={20} />รีเฟรชสต็อกตอนนี้</button>
    </>
  );
}
