'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { Hero } from '@/components/Icons';
import { BULK_CONFIRM } from '@/lib/bulk';

type Role = 'admin' | 'staff';

async function call<T = any>(action: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/admin/${action}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  }).catch(() => { throw new Error('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ลองรีเฟรชหน้า'); });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? 'เกิดข้อผิดพลาด');
  return data as T;
}
const uuid = () => crypto.randomUUID();
const fmt = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';

export default function AdminPage() {
  const [role, setRole] = useState<Role | null | undefined>(undefined);
  useEffect(() => { call<{ role: Role | null }>('session').then((r) => setRole(r.role)).catch(() => setRole(null)); }, []);

  if (role === undefined) return <div className="spinner" />;
  if (!role) return <Login onDone={setRole} />;
  return <Dashboard role={role} onLogout={async () => { await call('logout', {}); setRole(null); }} />;
}

function Login({ onDone }: { onDone: (r: Role) => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr('');
    try { const r = await call<{ role: Role }>('login', { password: pw }); onDone(r.role); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <div className="app">
      <Hero title="Food Camp Hunt" subtitle="เข้าสู่ระบบผู้จัดงาน (Admin / Staff)" />
      <main className="main">
        <div className="card stack">
          <h2>🔑 เข้าสู่ระบบผู้จัด</h2>
          <input className="field" type="password" placeholder="รหัสผ่านผู้จัด" value={pw}
            onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && go()} autoComplete="current-password" />
          {err && <div className="error">{err}</div>}
          <button className="btn" disabled={busy || !pw} onClick={go}>{busy ? 'กำลังตรวจสอบ…' : 'เข้าสู่ระบบ'}</button>
        </div>
      </main>
    </div>
  );
}

type Tab = 'overview' | 'checkin' | 'market' | 'people' | 'questions' | 'hunt' | 'puzzles' | 'history' | 'export';

/** Bottom toast: always visible wherever you are on the page (the old banner sat at the top, out of sight). */
function Toast({ msg, onClose }: { msg: string; onClose: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onClose, 9000);
    return () => clearTimeout(t);
  }, [msg, onClose]);
  if (!msg) return null;
  const bad = /ไม่|ผิด|error|เกิดข้อผิดพลาด|ลบไม่ได้|ล้มเหลว/i.test(msg) && !/สำเร็จ|แล้ว$/.test(msg.split('\n')[0]);
  return (
    <div className={`toast${bad ? ' err' : ''}`} role="status" aria-live="polite">
      <span>{bad ? '⚠️ ' : '✅ '}{msg}</span>
      <button onClick={onClose} aria-label="ปิด">×</button>
    </div>
  );
}

function Dashboard({ role, onLogout }: { role: Role; onLogout: () => void }) {
  const [tab, setTab] = useState<Tab>('overview');
  const [msg, setMsg] = useState('');
  const closeMsg = useCallback(() => setMsg(''), []);
  const [rk, setRk] = useState(0); // bump to reload the open tab after a bulk delete
  const [pendingPhotos, setPendingPhotos] = useState(0);
  useEffect(() => {
    const poll = () => call<{ pendingPhotos: number }>('badges').then((b) => setPendingPhotos(b.pendingPhotos)).catch(() => {});
    poll(); const t = setInterval(poll, 15000);
    window.addEventListener('fc-photos-changed', poll); // a review was just made: update the menu badge now
    return () => { clearInterval(t); window.removeEventListener('fc-photos-changed', poll); };
  }, []);
  const tabs: [Tab, string, string, boolean][] = [
    ['overview', '📊', 'ภาพรวม', true], ['checkin', '📍', 'เช็กอินวันงาน', true], ['market', '🛒', 'ตลาดสินค้า', true],
    ['people', '👥', 'ทีมและผู้เล่น', role === 'admin'], ['questions', '🍜', 'คำถามควิซ', role === 'admin'],
    ['hunt', '🧭', 'ล่าสมบัติ', role === 'admin'], ['puzzles', '📸', 'ภารกิจทีม', true],
    ['history', '📜', 'ประวัติ', role === 'admin'], ['export', '⬇️', 'ส่งออก CSV', role === 'admin'],
  ];
  return (
    <>
      <Hero compact title="Food Camp Hunt" subtitle={`แดชบอร์ดผู้จัด · ${role === 'admin' ? 'Admin' : 'Staff'}`}
        actions={<>
          <a className="btn small" style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }} href="/admin/live" target="_blank" rel="noreferrer">📺 จอใหญ่ (Live)</a>
          <button className="btn small" onClick={onLogout}>ออกจากระบบ</button>
        </>} />
      <div className="admin-layout">
        <nav className="admin-nav" aria-label="เมนูผู้จัด">
          {tabs.filter((t) => t[3]).map(([k, icon, label]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setMsg(''); window.scrollTo({ top: 0 }); }}>
              <span className="n-ic" aria-hidden>{icon}</span><span className="n-label">{label}</span>
              {k === 'puzzles' && pendingPhotos > 0 && <span className="n-badge" title="ภาพที่รอตรวจ">{pendingPhotos}</span>}
            </button>
          ))}
        </nav>
        <div className="admin">
        {tab === 'overview' && <Overview key={rk} role={role} setMsg={setMsg} />}
        {tab === 'checkin' && <Checkin key={rk} role={role} setMsg={setMsg} />}
        {tab === 'market' && <Market key={rk} role={role} setMsg={setMsg} />}
        {tab === 'people' && <People key={rk} setMsg={setMsg} />}
        {tab === 'questions' && <Questions key={rk} setMsg={setMsg} />}
        {tab === 'hunt' && <Hunt key={rk} setMsg={setMsg} />}
        {tab === 'puzzles' && <Missions key={rk} role={role} setMsg={setMsg} />}
        {tab === 'history' && <History />}
        {tab === 'export' && <Export />}
        {role === 'admin' && BULK_FOR_TAB[tab] && <BulkDelete target={BULK_FOR_TAB[tab]!} setMsg={setMsg} onDone={() => setRk((n) => n + 1)} />}
        </div>
      </div>
      <Toast msg={msg} onClose={closeMsg} />
    </>
  );
}

// ------------------------------------------------------------------ danger zone (clear test data)
const BULK_FOR_TAB: Partial<Record<Tab, 'playdata' | 'items' | 'teams' | 'questions' | 'spots' | 'missions'>> = {
  overview: 'playdata', market: 'items', people: 'teams', questions: 'questions', hunt: 'spots', puzzles: 'missions',
};
const BULK_INFO: Record<string, { button: string; what: string; keeps: string }> = {
  playdata: {
    button: '🧹 รีเซ็ตผลการเล่นทั้งหมด (เริ่มรอบทดสอบใหม่)',
    what: 'ล้างคำตอบควิซ คะแนน โทเคนทุกประเภท ประวัติแลกของ/ล่าสมบัติ/ภาพภารกิจ และประวัติใช้งาน แล้วรีเซ็ตผู้เล่นให้เริ่มใหม่ ปิดสวิตช์ทั้งหมด',
    keeps: 'ทีม ผู้เล่น+ID หัวหน้าทีม สควอด คำถาม สินค้า ภารกิจ จุดล่าสมบัติ ยังอยู่ครบ · สต็อกสินค้าที่ถูกแลกไปแล้วจะไม่ถูกคืน (แก้ที่แท็บตลาดสินค้า)',
  },
  items: {
    button: '🗑️ ลบสินค้าทั้งหมด',
    what: 'ลบสินค้าในตลาดทุกชิ้น พร้อมประวัติการแลกและการจ่ายของ โทเคนที่ทีมเคยใช้แลกจะถูกคืนให้ทีม',
    keeps: 'ทีม ผู้เล่น และกิจกรรมอื่น ๆ ไม่ถูกแตะ',
  },
  teams: {
    button: '🗑️ ลบทีมทั้งหมด (รวมผู้เล่น)',
    what: 'ลบทุกทีม พร้อมผู้เล่นทั้งหมด ID สควอด หัวหน้าทีม โทเคน ประวัติทุกอย่าง และรูปโปรไฟล์/ภาพภารกิจที่อัปโหลดไว้ เริ่มใหม่ทั้งหมด',
    keeps: 'คำถาม สินค้า ภารกิจ และจุดล่าสมบัติยังอยู่ (ลบแยกที่แท็บของตัวเอง)',
  },
  questions: {
    button: '🗑️ ลบคำถามควิซทั้งหมด',
    what: 'ลบคำถามควิซทุกข้อ และคำตอบที่ผู้เล่นเคยส่ง',
    keeps: 'โทเคนที่ทีมเคยได้จากควิซยังอยู่ (ใช้ปุ่มรีเซ็ตผลการเล่นที่หน้าภาพรวมเพื่อล้างโทเคน)',
  },
  spots: {
    button: '🗑️ ลบจุดล่าสมบัติทั้งหมด',
    what: 'ลบจุดล่าสมบัติทุกจุด พร้อมประวัติการสแกนของทุกทีม',
    keeps: 'โทเคนที่ทีมเคยได้จากล่าสมบัติยังอยู่ (ใช้ปุ่มรีเซ็ตผลการเล่นที่หน้าภาพรวมเพื่อล้างโทเคน)',
  },
  missions: {
    button: '🗑️ ลบภารกิจถ่ายภาพทั้งหมด',
    what: 'ลบภารกิจถ่ายภาพทุกข้อ พร้อมภาพที่ทีมส่งมาและภาพตัวอย่าง',
    keeps: 'โทเคนที่ทีมเคยได้จากภารกิจยังอยู่ (ใช้ปุ่มรีเซ็ตผลการเล่นที่หน้าภาพรวมเพื่อล้างโทเคน)',
  },
};

/** Collapsed "danger zone" at the bottom of a tab: wipe a whole group of data at once (for rehearsals). Needs the confirm word. */
function BulkDelete({ target, setMsg, onDone }: { target: string; setMsg: (m: string) => void; onDone: () => void }) {
  const info = BULK_INFO[target];
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setOpen(false); setWord(''); setErr(''); }, [target]);
  if (!info) return null;
  async function run() {
    setBusy(true); setErr('');
    try {
      const r = await call<{ counts: Record<string, number> }>('bulk.delete', { target, confirm: word });
      const total = Object.values(r.counts).reduce((n, v) => n + v, 0);
      setOpen(false); setWord('');
      setMsg(`ล้างข้อมูลเรียบร้อย (${total} รายการ)`);
      onDone();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <>
      <div className="card danger-zone" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div><strong>⚠️ โซนอันตราย: ล้างข้อมูลทดสอบ</strong><div className="muted" style={{ fontSize: 14 }}>ลบทีเดียวทั้งกลุ่ม ใช้ตอนซ้อมหรือทดสอบก่อนเริ่มงานจริง · กู้คืนไม่ได้</div></div>
          <button className="btn small danger" onClick={() => { setOpen(true); setWord(''); setErr(''); }}>{info.button}</button>
        </div>
      </div>
      {open && (
        <div className="dlg-back" role="dialog" aria-label="ยืนยันการลบ" onClick={busy ? undefined : () => setOpen(false)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()}>
            <h2 style={{ marginTop: 0, color: 'var(--bad)' }}>{info.button}</h2>
            <p style={{ margin: '0 0 8px' }}>{info.what}</p>
            <p className="muted" style={{ margin: '0 0 12px' }}>{info.keeps}</p>
            <div className="error" style={{ marginBottom: 12 }}>การลบนี้ <strong>กู้คืนไม่ได้</strong> และไม่ควรทำในระหว่างงานจริง</div>
            <label className="lbl">พิมพ์คำว่า <strong>{BULK_CONFIRM}</strong> เพื่อยืนยัน</label>
            <input className="field" value={word} placeholder={BULK_CONFIRM} onChange={(e) => setWord(e.target.value)} autoFocus />
            {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn small danger" disabled={busy || word.trim() !== BULK_CONFIRM} onClick={run}>{busy ? 'กำลังลบ…' : 'ลบทั้งหมดเดี๋ยวนี้'}</button>
              <button className="btn small ghost" disabled={busy} onClick={() => setOpen(false)}>ยกเลิก</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ------------------------------------------------------------------ overview
const FLAGS: { key: 'is_open' | 'hunt_open' | 'puzzle_open' | 'market_open'; icon: string; title: string; desc: string; on: string; off: string }[] = [
  { key: 'is_open', icon: '🍜', title: 'ควิซทายอาหาร', desc: 'ผู้เล่นเริ่มและตอบคำถามได้', on: 'เปิดควิซแล้ว', off: 'ปิดควิซแล้ว' },
  { key: 'hunt_open', icon: '🧭', title: 'ล่าสมบัติ', desc: 'สแกน QR / กรอกรหัสตามจุด', on: 'เปิดล่าสมบัติแล้ว', off: 'ปิดล่าสมบัติแล้ว' },
  { key: 'puzzle_open', icon: '📸', title: 'ภารกิจทีม', desc: 'ถ่ายภาพทั้งทีม หัวหน้าทีมอัปโหลด', on: 'เปิดภารกิจทีมแล้ว', off: 'ปิดภารกิจทีมแล้ว' },
  { key: 'market_open', icon: '🛒', title: 'ตลาดสินค้า', desc: 'เปิดให้หัวหน้าทีมกดแลกจากมือถือ (ทีมงานแลกแทนได้เสมอ)', on: 'เปิดให้หัวหน้าทีมแลกของแล้ว', off: 'ปิดการแลกของโดยหัวหน้าทีมแล้ว' },
];

function Overview({ role, setMsg }: { role: Role; setMsg: (m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [goal, setGoal] = useState('');
  const [adj, setAdj] = useState<{ team_id: string } | null>(null);
  const load = useCallback(() => call('overview').then(setD).catch((e) => setMsg(e.message)), [setMsg]);
  useEffect(() => { load(); const t = setInterval(load, 15000); return () => clearInterval(t); }, [load]);
  useEffect(() => { if (d && goal === '') setGoal(String(d.settings.team_goal_pct ?? 0)); }, [d, goal]);
  if (!d) return <div className="spinner" />;
  const totalP = d.teams.reduce((s: number, t: any) => s + t.participants, 0);
  const totalC = d.teams.reduce((s: number, t: any) => s + t.completed, 0);
  const totalBal = d.teams.reduce((s: number, t: any) => s + t.balance, 0);
  const totalSpent = d.teams.reduce((s: number, t: any) => s + t.spent, 0);

  async function setFlag(f: (typeof FLAGS)[number]) {
    const next = !d.settings[f.key];
    try { await call('game.set', { [f.key]: next }); await load(); setMsg(next ? f.on : f.off); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function saveGoal() {
    try { await call('game.set', { team_goal_pct: Number(goal) }); await load(); setMsg(Number(goal) ? `ตั้งเป้าหมายทีม ${goal}% แล้ว` : 'ปิดเป้าหมายทีมแล้ว'); }
    catch (e) { setMsg((e as Error).message); }
  }
  const adjTeam = adj ? d.teams.find((t: any) => t.team_id === adj.team_id) : null;

  return (
    <>
      <div className="stats">
        <div className="stat"><b>{totalC}/{totalP}</b><span>เล่นควิซจบแล้ว</span></div>
        <div className="stat"><b>🪙 {totalBal}</b><span>โทเคนคงเหลือรวมทุกทีม</span></div>
        <div className="stat"><b>{totalSpent}</b><span>โทเคนที่ใช้ไปแล้ว</span></div>
        <div className="stat"><b>📦 {d.pendingPickup ?? 0}</b><span>ชิ้นที่รอจ่ายของ</span></div>
        <div className="stat"><b>📍 {d.checkedIn ?? 0}/{totalP}</b><span>เช็กอินวันงานแล้ว{d.settings.checkin_open ? ' · 🟢 เปิดอยู่' : ''}</span></div>
        <div className="stat" style={(d.pendingPhotos ?? 0) > 0 ? { outline: '3px solid #f0c36a' } : undefined}><b>📸 {d.pendingPhotos ?? 0}</b><span>ภาพภารกิจที่รอตรวจ</span></div>
      </div>

      <div className="switches">
        {FLAGS.map((f) => {
          const on = !!d.settings[f.key];
          return (
            <div key={f.key} className={`switch-card${on ? ' on' : ''}`}>
              <div className="s-top">
                <div className="s-ic" aria-hidden>{f.icon}</div>
                <div className="s-title">{f.title}</div>
                <span className="s-state">{on ? '🟢 เปิดอยู่' : '🔴 ปิดอยู่'}</span>
              </div>
              <div className="muted" style={{ fontSize: 14 }}>{f.desc}</div>
              {role === 'admin' && <button className={`btn small ${on ? 'danger' : ''}`} onClick={() => setFlag(f)}>{on ? 'ปิด' : 'เปิด'}</button>}
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2 style={{ margin: 0 }}>🎯 เป้าหมายร่วมของทีม: {d.settings.team_goal_pct ? `${d.settings.team_goal_pct}% ของสมาชิกต้องเล่นควิซจบ` : 'ปิดอยู่'}</h2>
        <div className="muted">เมื่อทีมถึงเป้า จะปลดล็อกสินค้าที่ติดป้าย “สินค้าพิเศษ” ในตลาด (ตั้งป้ายที่แท็บตลาด) · {d.settings.tokens_per_correct} โทเคนต่อข้อควิซที่ถูก</div>
        {role === 'admin' && (
          <div className="row" style={{ marginTop: 8 }}>
            <input className="field" style={{ width: 110 }} type="number" min={0} max={100} value={goal} onChange={(e) => setGoal(e.target.value)} />
            <span>% (0 = ปิด)</span>
            <button className="btn small" onClick={saveGoal}>บันทึก</button>
          </div>
        )}
      </div>

      <div className="grid">
        {d.teams.map((t: any) => {
          const met = t.participants && t.completed * 100 >= d.settings.team_goal_pct * t.participants;
          return (
            <div className="card team-card" key={t.team_id}>
              <h2>{t.name}</h2>
              <div className="num" style={{ fontSize: 34, fontWeight: 700 }}>🪙 {t.balance}</div>
              <span className={`leader${t.leader ? '' : ' none'}`}>{t.leader ? `⭐ หัวหน้า: ${t.leader}` : '⚠️ ยังไม่มีหัวหน้าทีม'}</span>
              <div className="muted" style={{ marginTop: 8 }}>เล่นควิซจบ {t.completed}/{t.participants} · กำลังเล่น {t.in_progress}</div>
              <div className="progress" style={{ position: 'relative' }}>
                <i style={{ width: `${t.participants ? (t.completed / t.participants) * 100 : 0}%` }} />
                {d.settings.team_goal_pct > 0 && <b title="เป้าหมาย" style={{ position: 'absolute', left: `${d.settings.team_goal_pct}%`, top: -3, height: 16, width: 3, background: 'var(--navy)' }} />}
              </div>
              {d.settings.team_goal_pct > 0 && <div className="muted">{met ? '🔓 ถึงเป้าแล้ว' : `🔒 ยังไม่ถึงเป้า ${d.settings.team_goal_pct}%`}</div>}
              <div className="muted">ใช้ไปแล้ว {t.spent}</div>
              {role === 'admin' && <button className="btn small ghost" style={{ marginTop: 8 }} onClick={() => setAdj({ team_id: t.team_id })}>± ปรับโทเคนด้วยมือ</button>}
            </div>
          );
        })}
      </div>

      {adj && adjTeam && (
        <AdjustDialog team={adjTeam} onClose={() => setAdj(null)}
          onDone={async (text) => { setAdj(null); await load(); setMsg(text); }} />
      )}
    </>
  );
}

/** Manual token adjustment: a pop-up you can't miss, with +/- buttons (phones' number pads have no minus), a preview and inline errors. */
function AdjustDialog({ team, onClose, onDone }: { team: any; onClose: () => void; onDone: (msg: string) => void | Promise<void> }) {
  const [sign, setSign] = useState<1 | -1>(1);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const keyRef = useRef(uuid()); // same key on a retry of the same request -> never applied twice
  const n = Math.floor(Number(amount) || 0);
  const delta = sign * n;
  const after = team.balance + delta;
  const problem = n <= 0 ? 'ใส่จำนวนโทเคน' : reason.trim().length < 3 ? 'ใส่เหตุผลอย่างน้อย 3 ตัวอักษร' : after < 0 ? `หักไม่ได้: ทีมมี ${team.balance} โทเคน` : '';
  async function save() {
    setBusy(true); setErr('');
    try {
      await call('adjust', { team_id: team.team_id, amount: delta, reason: reason.trim(), key: keyRef.current });
      await onDone(`ปรับโทเคนทีม ${team.name} ${delta > 0 ? '+' : ''}${delta} แล้ว (เหลือ ${after})`);
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }
  const reasons = ['ชดเชยระบบขัดข้อง', 'โบนัสกิจกรรมพิเศษ', 'แก้ไขข้อผิดพลาด', 'หักตามกติกา'];
  return (
    <div className="dlg-back" role="dialog" aria-label="ปรับโทเคน" onClick={busy ? undefined : onClose}>
      <div className="dlg" onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>± ปรับโทเคน: {team.name}</h2>
          <button className="btn small ghost" disabled={busy} onClick={onClose}>ปิด</button>
        </div>
        <div className="center" style={{ margin: '10px 0' }}>
          <div className="muted">โทเคนปัจจุบัน</div>
          <div className="num" style={{ fontSize: 36, fontWeight: 700 }}>🪙 {team.balance}</div>
        </div>
        <div className="seg">
          <button className={`plus${sign === 1 ? ' on' : ''}`} onClick={() => setSign(1)}>＋ เพิ่ม</button>
          <button className={`minus${sign === -1 ? ' on' : ''}`} onClick={() => setSign(-1)}>－ หัก</button>
        </div>
        <label className="lbl">จำนวนโทเคน</label>
        <input className="field" inputMode="numeric" pattern="[0-9]*" placeholder="เช่น 10" value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))} />
        <div className="chips">{[5, 10, 20, 50].map((v) => <button key={v} onClick={() => setAmount(String(v))}>{v}</button>)}</div>
        <label className="lbl">เหตุผล (จำเป็น · บันทึกในประวัติ)</label>
        <input className="field" placeholder="เช่น ชดเชยระบบขัดข้อง" value={reason} onChange={(e) => setReason(e.target.value)} />
        <div className="chips">{reasons.map((r) => <button key={r} onClick={() => setReason(r)}>{r}</button>)}</div>
        <div className="center" style={{ margin: '14px 0 6px', fontSize: 18 }}>
          ยอดหลังปรับ: <strong style={{ color: after < 0 ? 'var(--bad)' : 'var(--forest)' }}>{n > 0 ? after : '—'}</strong>
          {n > 0 && <span className="muted"> ({delta > 0 ? '+' : ''}{delta})</span>}
        </div>
        {(err || (problem && (amount || reason))) && <div className="error" style={{ marginBottom: 10 }}>{err || problem}</div>}
        <button className="btn" disabled={busy || !!problem} onClick={save}>{busy ? 'กำลังบันทึก…' : 'บันทึกการปรับโทเคน'}</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ event-day check-in
function Checkin({ role, setMsg }: { role: Role; setMsg: (m: string) => void }) {
  const [d, setD] = useState<any>(null);
  const [filter, setFilter] = useState<'missing' | 'in' | 'all'>('missing');
  const [q, setQ] = useState('');
  const [big, setBig] = useState(false);
  const [busy, setBusy] = useState(false);
  const isAdmin = role === 'admin';
  const load = useCallback(() => call('checkin').then(setD).catch((e) => setMsg(e.message)), [setMsg]);
  useEffect(() => { load(); const t = setInterval(load, 8000); return () => clearInterval(t); }, [load]);
  if (!d) return <div className="spinner" />;

  const people: any[] = d.people;
  const inCount = people.filter((p) => p.checked_in_at).length;
  const url = d.code ? `${window.location.origin}/?checkin=${d.code}` : '';
  const teams = Array.from(new Set(people.map((p) => p.team))).sort();
  const shown = people
    .filter((p) => (filter === 'all' ? true : filter === 'in' ? !!p.checked_in_at : !p.checked_in_at))
    .filter((p) => !q.trim() || `${p.name} ${p.nick_name} ${p.team}`.toLowerCase().includes(q.trim().toLowerCase()));

  async function set(patch: Record<string, unknown>, text: string) {
    setBusy(true);
    try { await call('checkin.set', patch); await load(); setMsg(text); }
    catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }
  async function mark(ids: string[], done: boolean) {
    try { await call('checkin.mark', { ids, done }); await load(); setMsg(done ? `เช็กอินให้ ${ids.length} คนแล้ว` : 'ยกเลิกการเช็กอินแล้ว'); }
    catch (e) { setMsg((e as Error).message); }
  }
  const time = (iso: string) => new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      {big && url && (
        <div className="dlg-back" onClick={() => setBig(false)} style={{ cursor: 'zoom-out', background: '#fff' }}>
          <div className="center">
            <div style={{ fontSize: 32, fontWeight: 700, marginBottom: 12 }}>📍 สแกน QR เพื่อเช็กอินเข้างาน</div>
            <Qr text={url} size={Math.min(560, typeof window !== 'undefined' ? window.innerWidth - 40 : 320)} />
            <div style={{ fontSize: 28, fontWeight: 700, letterSpacing: 4, marginTop: 10 }} className="codebox">{d.code}</div>
            <div className="muted">สแกนด้วยกล้องมือถือ แล้วกด “ยืนยันการเข้าร่วม” (แตะเพื่อปิด)</div>
          </div>
        </div>
      )}

      <div className="card noprint">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>📍 เช็กอินวันงาน: {d.open ? '🟢 เปิดอยู่' : '🔴 ปิดอยู่'}</h2>
            <div className="muted">เมื่อเปิด ผู้เล่นจะเห็นป๊อปอัปและแถบ “ถึงสถานที่แล้ว? เช็กอิน” ที่หน้าแรก · ผู้เล่นสแกน QR ของทีมงาน แล้วต้องกด <strong>ยืนยันการเข้าร่วม</strong> เอง</div>
          </div>
          {isAdmin && (
            <div className="row">
              <button className={`btn small ${d.open ? 'danger' : ''}`} disabled={busy} onClick={() => set({ open: !d.open }, d.open ? 'ปิดเช็กอินแล้ว' : 'เปิดเช็กอินแล้ว · ผู้เล่นจะเห็นแจ้งเตือน')}>{d.open ? 'ปิดเช็กอิน' : '▶ เปิดการลงทะเบียนวันงาน'}</button>
              {d.open && <button className="btn small ghost" disabled={busy} onClick={() => set({ announce: true }, 'แจ้งเตือนผู้ที่ยังไม่เช็กอินอีกครั้งแล้ว')}>📣 แจ้งเตือนอีกครั้ง</button>}
            </div>
          )}
        </div>
        <div style={{ marginTop: 14 }}>
          <strong>เช็กอินแล้ว {inCount}/{people.length} คน</strong>
          <div className="progress"><i style={{ width: `${people.length ? (inCount / people.length) * 100 : 0}%` }} /></div>
          <div className="row" style={{ gap: 6 }}>
            {teams.map((t) => {
              const tp = people.filter((p) => p.team === t); const ti = tp.filter((p) => p.checked_in_at).length;
              return <span key={t} className="pill" style={{ background: ti === tp.length && tp.length ? '#cfe9c9' : '#f6efdc' }}>{t} {ti}/{tp.length}</span>;
            })}
          </div>
        </div>
      </div>

      <div className="card center">
        <h2 style={{ margin: 0 }}>QR Code เช็กอิน (ให้ผู้เล่นสแกน)</h2>
        {url ? (
          <>
            <div style={{ margin: '12px 0' }}><Qr text={url} size={240} /></div>
            <div className="codebox" style={{ fontSize: 24 }}>{d.code}</div>
            {!d.open && <div className="banner" style={{ marginTop: 10 }}>เช็กอินยังปิดอยู่ · QR ใช้ไม่ได้จนกว่าจะเปิด</div>}
            <div className="row noprint" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button className="btn small" onClick={() => setBig(true)}>🖥️ แสดงเต็มจอ</button>
              <button className="btn small ghost" onClick={() => window.print()}>🖨️ พิมพ์</button>
              {isAdmin && <button className="btn small ghost" disabled={busy} onClick={() => confirm('สร้าง QR ใหม่? QR เดิมที่พิมพ์หรือแสดงไว้จะใช้ไม่ได้ทันที') && set({ regenerate: true }, 'สร้าง QR เช็กอินใหม่แล้ว (QR เดิมใช้ไม่ได้)')}>🔄 สร้าง QR ใหม่</button>}
            </div>
            <div className="muted noprint" style={{ marginTop: 8, fontSize: 14 }}>ให้ผู้เล่นสแกนที่หน้างานเท่านั้น ถ้า QR หลุดไปถึงคนที่ไม่ได้มา ให้กด “สร้าง QR ใหม่”</div>
          </>
        ) : <p className="muted" style={{ margin: '10px 0 0' }}>{isAdmin ? 'กด “เปิดการลงทะเบียนวันงาน” เพื่อสร้าง QR Code เช็กอิน' : 'ยังไม่มี QR (Admin ต้องเปิดเช็กอินก่อน)'}</p>}
      </div>

      <div className="card noprint">
        <h2>รายชื่อผู้เล่น</h2>
        <div className="row" style={{ margin: '4px 0 10px' }}>
          {([['missing', `⏳ ยังไม่มา (${people.length - inCount})`], ['in', `✅ เช็กอินแล้ว (${inCount})`], ['all', 'ทั้งหมด']] as const).map(([k, label]) => (
            <button key={k} className={`btn small ${filter === k ? '' : 'ghost'}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
          <input className="field grow" placeholder="ค้นหาชื่อ / ทีม" value={q} onChange={(e) => setQ(e.target.value)} />
          <a className="btn small ghost" style={{ textDecoration: 'none' }} href="/api/admin/export?type=checkin">⬇️ CSV</a>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>ชื่อ</th><th>ทีม</th><th>สควอด</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{shown.map((p) => (
            <tr key={p.id}>
              <td>{p.name}{p.nick_name ? <span className="muted"> ({p.nick_name})</span> : null}</td><td>{p.team}</td><td>{p.squad || '—'}</td>
              <td>{p.checked_in_at ? <>✅ {time(p.checked_in_at)} <span className="muted">· {p.checked_in_by === 'self' ? 'สแกนเอง' : 'ทีมงานเช็กอินให้'}</span></> : '⏳ ยังไม่มา'}</td>
              <td>{p.checked_in_at
                ? <button className="btn small ghost" onClick={() => confirm(`ยกเลิกเช็กอินของ ${p.name}?`) && mark([p.id], false)}>ยกเลิก</button>
                : <button className="btn small" onClick={() => mark([p.id], true)}>เช็กอินให้</button>}</td>
            </tr>))}</tbody>
        </table></div>
        {shown.length === 0 && <p className="muted center" style={{ margin: '8px 0 0' }}>{filter === 'missing' ? 'ทุกคนเช็กอินครบแล้ว 🎉' : 'ไม่พบรายชื่อ'}</p>}
      </div>
    </>
  );
}

// -------------------------------------------------------------------- market

/** Shrinks a phone/camera photo in the browser (max 1000px, JPEG) so it uploads fast and fits the 2 MB limit. */
async function compressImage(file: File, maxSide = 1000): Promise<File> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error('รองรับเฉพาะไฟล์ภาพ PNG / JPG / WebP');
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) throw new Error('เปิดไฟล์ภาพนี้ไม่ได้');
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height); // flatten transparency
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
  if (!blob) throw new Error('แปลงภาพไม่สำเร็จ');
  return new File([blob], 'photo.jpg', { type: 'image/jpeg' });
}

function Market({ role, setMsg }: { role: Role; setMsg: (m: string) => void }) {
  const [items, setItems] = useState<any[]>([]);
  const [teams, setTeams] = useState<any[]>([]);
  const [rd, setRd] = useState({ team_id: '', item_id: '', quantity: '1', key: uuid() });
  const [edit, setEdit] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, t] = await Promise.all([call('market'), call('teams')]);
      setItems(m.items); setTeams(t.teams);
    } catch (e) { setMsg((e as Error).message); }
  }, [setMsg]);
  useEffect(() => { load(); }, [load]);

  const item = items.find((i) => i.id === rd.item_id);
  const team = teams.find((t) => t.team_id === rd.team_id);
  const qty = Math.max(1, parseInt(rd.quantity) || 1);
  const cost = item ? item.price * qty : 0;

  async function redeem() {
    setBusy(true);
    try {
      // Same key is reused if the request is retried, so it can never be applied twice.
      const r = await call('redeem', { team_id: rd.team_id, item_id: rd.item_id, quantity: qty, key: rd.key });
      setMsg(r.already ? 'รายการนี้ถูกบันทึกไปแล้ว (ไม่หักซ้ำ)' : `แลกสำเร็จ หักไป ${r.total_cost} โทเคน เหลือ ${r.balance}`);
      setRd({ ...rd, item_id: '', quantity: '1', key: uuid() });
      await load();
    } catch (e) { setMsg((e as Error).message + ' (ถ้าไม่แน่ใจว่าบันทึกหรือยัง กดยืนยันซ้ำได้อย่างปลอดภัย)'); await load(); }
    finally { setBusy(false); }
  }
  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const small = await compressImage(file);
      const fd = new FormData(); fd.append('file', small);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? 'อัปโหลดไม่สำเร็จ');
      setEdit((e: any) => ({ ...e, image_url: data.url }));
      setMsg('อัปโหลดรูปแล้ว กด "บันทึก" เพื่อใช้รูปนี้');
    } catch (e) { setMsg((e as Error).message); }
    finally { setUploading(false); }
  }
  async function saveItem() {
    try { await call('item.save', edit); setEdit(null); await load(); setMsg('บันทึกสินค้าแล้ว'); }
    catch (e) { setMsg((e as Error).message); }
  }

  return (
    <>
      <div className="card">
        <h2>ยืนยันการแลกของ</h2>
        <div className="row">
          <select className="field grow" value={rd.team_id} onChange={(e) => setRd({ ...rd, team_id: e.target.value, key: uuid() })}>
            <option value="">เลือกทีม</option>
            {teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name} (🪙 {t.balance})</option>)}
          </select>
          <select className="field grow" value={rd.item_id} onChange={(e) => setRd({ ...rd, item_id: e.target.value, key: uuid() })}>
            <option value="">เลือกสินค้า</option>
            {items.filter((i) => i.active).map((i) => <option key={i.id} value={i.id}>{i.name} — {i.price} โทเคน (เหลือ {i.stock})</option>)}
          </select>
          <input className="field" style={{ width: 90 }} type="number" min={1} value={rd.quantity}
            onChange={(e) => setRd({ ...rd, quantity: e.target.value, key: uuid() })} />
        </div>
        {item && team && (
          <p className="muted">
            ราคารวม <strong>{cost}</strong> โทเคน · ทีมมี {team.balance} → เหลือ {team.balance - cost}
            {team.balance < cost && <span style={{ color: 'var(--bad)' }}> (โทเคนไม่พอ)</span>}
          </p>
        )}
        <button className="btn small" disabled={busy || !rd.team_id || !rd.item_id} onClick={redeem}>
          {busy ? 'กำลังบันทึก…' : 'ยืนยันการแลก'}
        </button>
      </div>

      <Pickup setMsg={setMsg} reloadKey={items.length} />

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>รายการสินค้า</h2>
          {role === 'admin' && <button className="btn small green" onClick={() => setEdit({ name: '', category: 'ingredient', price: 10, stock: 10, active: true, requires_goal: false, image_url: '' })}>+ เพิ่มสินค้า</button>}
        </div>
        <div className="table-wrap">
          <table>
            <thead><tr><th>รูป</th><th>ชื่อ</th><th>หมวด</th><th>ราคา</th><th>คงเหลือ</th><th>ล็อกด้วยเป้าหมาย</th><th>สถานะ</th>{role === 'admin' && <th />}</tr></thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.id}>
                  <td>{i.image_url ? <img src={i.image_url} alt="" style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, display: 'block' }} /> : <span className="muted">—</span>}</td>
                  <td>{i.name}</td><td>{i.category}</td><td className="num">{i.price}</td><td className="num">{i.stock}</td>
                  <td>{i.requires_goal ? '🎯 ต้องถึงเป้า' : '—'}</td>
                  <td>{i.active ? 'เปิดขาย' : 'ปิด'}</td>
                  {role === 'admin' && <td className="row">
                    <button className="btn small ghost" onClick={() => setEdit(i)}>แก้ไข</button>
                    <button className="btn small ghost" onClick={async () => { if (confirm(`ลบ ${i.name}?`)) { await call('item.delete', { id: i.id }); load(); } }}>ลบ</button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {edit && (
        <div className="card">
          <h2>{edit.id ? 'แก้ไขสินค้า' : 'เพิ่มสินค้า'}</h2>
          <div className="row">
            <div className="grow"><label className="lbl">ชื่อ</label><input className="field" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></div>
            <div className="grow"><label className="lbl">หมวด (ingredient / sauce / topping / decoration)</label><input className="field" value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
            <div><label className="lbl">ราคา (โทเคน)</label><input className="field" style={{ width: 110 }} type="number" min={1} value={edit.price} onChange={(e) => setEdit({ ...edit, price: Number(e.target.value) })} /></div>
            <div><label className="lbl">จำนวนคงเหลือ</label><input className="field" style={{ width: 110 }} type="number" min={0} value={edit.stock} onChange={(e) => setEdit({ ...edit, stock: Number(e.target.value) })} /></div>
          </div>
          <label className="lbl">รูปสินค้า (ไฟล์ภาพ PNG / JPG / WebP · ระบบย่อรูปให้อัตโนมัติ ถ่ายจากมือถือได้เลย)</label>
          <div className="row">
            {edit.image_url
              ? <img src={edit.image_url} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--cream-deep)' }} />
              : <div style={{ width: 96, height: 96, borderRadius: 12, border: '2px dashed var(--cream-deep)', display: 'grid', placeItems: 'center', fontSize: 32 }}>🍽️</div>}
            <div>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={uploading}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadPhoto(f); e.target.value = ''; }} />
              <div className="muted">{uploading ? 'กำลังอัปโหลด…' : 'เลือกไฟล์แล้วรอจนเห็นรูปตัวอย่าง จากนั้นกด “บันทึก”'}</div>
              {edit.image_url && <button className="btn small ghost" style={{ marginTop: 6 }} onClick={() => setEdit({ ...edit, image_url: '' })}>ลบรูป</button>}
            </div>
          </div>
          <label className="lbl"><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> เปิดขาย</label>
          <label className="lbl"><input type="checkbox" checked={!!edit.requires_goal} onChange={(e) => setEdit({ ...edit, requires_goal: e.target.checked })} /> 🎯 สินค้าพิเศษ: ทีมต้องถึงเป้าหมายการเล่นควิซก่อนจึงแลกได้</label>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={saveItem}>บันทึก</button>
            <button className="btn small ghost" onClick={() => setEdit(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </>
  );
}


// ---------------------------------------------------------- player import helpers
type ImportRow = { id: string; full_name: string; nick_name: string; team: string; squad: string; leader: boolean };

/** Parses pasted Excel cells (tab separated) or a CSV file (comma separated, quotes supported). */
function parseDelimited(text: string): string[][] {
  const t = text.replace(/^﻿/, '');
  const first = t.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const delim = first.includes('\t') ? '\t' : ',';
  const rows: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cur); cur = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x.trim())) rows.push(row); row = []; }
    else cur += c;
  }
  row.push(cur); if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

/** Table -> import rows. Uses the header row (ID, Full name, Nick name, Team, Squad) if present, else that column order. */
function toImportRows(table: unknown[][]): ImportRow[] {
  const clean = table.map((r) => r.map((c) => (c === null || c === undefined ? '' : String(c).trim())));
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9ก-๙]/g, '');
  const head = (clean[0] ?? []).map(norm);
  const idx = (names: string[]) => head.findIndex((h) => names.includes(h));
  const hasHeader = idx(['id', 'รหัส']) >= 0 || idx(['team', 'ทีม']) >= 0;
  let col = { id: 0, full: 1, nick: 2, team: 3, squad: 4, leader: -1 };
  let data = clean;
  if (hasHeader) {
    col = { id: idx(['id', 'รหัส']), full: idx(['fullname', 'name', 'ชื่อ', 'ชื่อนามสกุล']), nick: idx(['nickname', 'nick', 'ชื่อเล่น']), team: idx(['team', 'ทีม']), squad: idx(['squad', 'สควอด']), leader: idx(['leader', 'teamleader', 'หัวหน้า', 'หัวหน้าทีม']) };
    data = clean.slice(1);
  }
  const at = (r: string[], i: number) => (i >= 0 ? r[i] ?? '' : '');
  return data.filter((r) => r.some(Boolean)).map((r) => ({
    id: at(r, col.id), full_name: at(r, col.full), nick_name: at(r, col.nick), team: at(r, col.team), squad: at(r, col.squad),
    leader: /^(1|y|yes|true|x|✓|✔|leader|หัวหน้า|หัวหน้าทีม|ใช่)$/i.test(at(r, col.leader).trim()),
  }));
}

/** Problems visible before sending (the server checks again). */
function importProblems(rows: ImportRow[]): string[] {
  const out: string[] = [];
  const seen = new Map<string, number>();
  rows.forEach((r, k) => {
    const key = r.id.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!key || !r.full_name || !r.team) out.push(`แถว ${k + 1}: ต้องมี ID, Full name และ Team (${r.full_name || r.id || 'ว่าง'})`);
    else if (seen.has(key)) out.push(`แถว ${k + 1}: ID “${r.id}” ซ้ำกับแถว ${seen.get(key)}`);
    else seen.set(key, k + 1);
  });
  return out;
}


// ------------------------------------------------------- pickup (prepare & hand over goods)
function Pickup({ setMsg, reloadKey }: { setMsg: (m: string) => void; reloadKey: number }) {
  const [d, setD] = useState<{ items: any[]; teams: any[] } | null>(null);
  const load = useCallback(() => call('inventory').then(setD).catch((e) => setMsg(e.message)), [setMsg]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load, reloadKey]);
  async function handOver(ids: string[], fulfilled = true) {
    try { await call('redemption.fulfill', { ids, fulfilled }); await load(); setMsg(fulfilled ? 'บันทึกว่าจ่ายของแล้ว' : 'ยกเลิกการจ่ายของแล้ว'); }
    catch (e) { setMsg((e as Error).message); }
  }
  if (!d) return null;
  const pendingTeams = d.teams.filter((t) => t.pending > 0);
  return (
    <div className="card">
      <h2>📦 เตรียมของ / เบิกของ</h2>
      <p className="muted">สรุปสิ่งที่ทีมแลกไว้แล้วและยังรอรับ เพื่อเตรียมสินค้าให้ทันเวลาเบิกจริง เมื่อจ่ายของให้ทีมแล้วกด “จ่ายแล้ว”</p>
      {d.items.length === 0 ? <p className="muted center" style={{ margin: 0 }}>ยังไม่มีการแลกสินค้า</p> : (
        <>
          <div className="table-wrap"><table>
            <thead><tr><th>สินค้า</th><th>แลกแล้วรวม</th><th>จ่ายแล้ว</th><th>รอเตรียมจ่าย</th><th>ทีมที่รอรับ</th></tr></thead>
            <tbody>{d.items.map((i) => (
              <tr key={i.item}><td>{i.item}</td><td className="num">{i.ordered}</td><td className="num">{i.handed}</td>
                <td className="num"><strong>{i.pending}</strong></td><td>{i.teamsPending.join(', ') || '—'}</td></tr>
            ))}</tbody>
          </table></div>
          <h2 style={{ fontSize: 17, marginTop: 14 }}>แยกตามทีม</h2>
          <div className="table-wrap"><table>
            <thead><tr><th>ทีม</th><th>สินค้า</th><th>แลกแล้ว</th><th>จ่ายแล้ว</th><th>รอรับ</th><th /></tr></thead>
            <tbody>{d.teams.map((t, k) => (
              <tr key={k}><td>{t.team}</td><td>{t.item}</td><td className="num">{t.ordered}</td><td className="num">{t.handed}</td>
                <td className="num">{t.pending ? <strong>{t.pending}</strong> : '—'}</td>
                <td>{t.pending > 0 && <button className="btn small" onClick={() => confirm(`จ่าย ${t.item} ×${t.pending} ให้ ${t.team} แล้วใช่ไหม?`) && handOver(t.pendingIds)}>จ่ายแล้ว ({t.pending})</button>}</td></tr>
            ))}</tbody>
          </table></div>
          {pendingTeams.length === 0 && <div className="muted" style={{ marginTop: 8 }}>✅ จ่ายของครบทุกรายการแล้ว</div>}
        </>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- people
function People({ setMsg }: { setMsg: (m: string) => void }) {
  const [teams, setTeams] = useState<any[]>([]);
  const [people, setPeople] = useState<any[]>([]);
  const [teamName, setTeamName] = useState('');
  const [editTeam, setEditTeam] = useState<any | null>(null);
  const blankForm = { id: '', login_id: '', name: '', nick_name: '', team_id: '', squad_id: '', is_leader: false };
  const [form, setForm] = useState(blankForm);
  const [squads, setSquads] = useState<any[]>([]);
  const [sizes, setSizes] = useState<Record<string, string>>({});
  const [editSquad, setEditSquad] = useState<{ id: string; name: string } | null>(null);
  const [bulk, setBulk] = useState('');
  const [imp, setImp] = useState<{ source: string; rows: ImportRow[] } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [t, p, sq] = await Promise.all([call('teams'), call('participants'), call('squads')]);
      setTeams(t.teams); setPeople(p.participants); setSquads(sq.squads);
    } catch (e) { setMsg((e as Error).message); }
  }, [setMsg]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>, ok?: string) => {
    try { const r = await fn(); await load(); if (ok) setMsg(ok); return r; } catch (e) { setMsg((e as Error).message); }
  };

  async function readFile(file: File) {
    try {
      let table: unknown[][];
      if (/\.xlsx$/i.test(file.name)) {
        const { readSheet } = await import('read-excel-file/browser');
        table = (await readSheet(file)) as unknown[][];
      } else if (/\.xls$/i.test(file.name)) {
        setMsg('ไฟล์ .xls (รุ่นเก่า) ไม่รองรับ กรุณาบันทึกเป็น .xlsx หรือ .csv ใน Excel');
        return;
      } else {
        table = parseDelimited(await file.text());
      }
      const rows = toImportRows(table);
      setImp({ source: file.name, rows });
      setMsg(rows.length ? `อ่านไฟล์ ${file.name} ได้ ${rows.length} แถว กรุณาตรวจตัวอย่างด้านล่างก่อนกดนำเข้า` : 'ไม่พบข้อมูลในไฟล์');
    } catch (e) { setMsg('อ่านไฟล์ไม่ได้: ' + (e as Error).message); }
  }
  async function doImport() {
    if (!imp) return;
    setBusy(true);
    try {
      const r = await call('participants.import', { rows: imp.rows });
      setImp(null); setBulk(''); await load();
      setMsg(`นำเข้าสำเร็จ: เพิ่มใหม่ ${r.inserted} คน · อัปเดต ${r.updated} คน` + (r.teamsCreated ? ` · สร้างทีมใหม่ ${r.teamsCreated} ทีม` : '') + (r.leadersSet ? ` · ตั้งหัวหน้าทีม ${r.leadersSet} ทีม` : '') + (r.skipped?.length ? `\n${r.skipped.join('\n')}` : ''));
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <>
      <div className="card">
        <h2>ทีม</h2>
        <ul className="list">
          {teams.map((t) => (
            <li key={t.team_id}>
              {editTeam?.id === t.team_id ? (
                <span className="row grow">
                  <input className="field grow" value={editTeam.name} onChange={(e) => setEditTeam({ ...editTeam, name: e.target.value })} />
                  <button className="btn small" onClick={() => run(async () => { await call('team.save', editTeam); setEditTeam(null); }, 'บันทึกชื่อทีมแล้ว')}>บันทึก</button>
                </span>
              ) : (
                <>
                  <span>{t.name} <span className="muted">({t.participants} คน)</span>{(() => { const l = people.find((x) => x.team_id === t.team_id && x.is_leader); return l ? <span className="pill" style={{ marginLeft: 8 }}>⭐ หัวหน้า: {l.nick_name || l.name}</span> : <span className="muted" style={{ marginLeft: 8 }}>ยังไม่มีหัวหน้าทีม</span>; })()}</span>
                  <span className="row">
                    <button className="btn small ghost" onClick={() => setEditTeam({ id: t.team_id, name: t.name })}>แก้ชื่อ</button>
                    <button className="btn small ghost" onClick={() => confirm(`ลบทีม ${t.name}?`) && run(() => call('team.delete', { id: t.team_id }), 'ลบทีมแล้ว')}>ลบ</button>
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        <div className="row" style={{ marginTop: 8 }}>
          <input className="field grow" placeholder="ชื่อทีมใหม่" value={teamName} onChange={(e) => setTeamName(e.target.value)} />
          <button className="btn small green" disabled={!teamName.trim()} onClick={() => run(async () => { await call('team.save', { name: teamName }); setTeamName(''); }, 'เพิ่มทีมแล้ว')}>+ เพิ่มทีม</button>
        </div>
      </div>

      <div className="card">
        <h2>สควอด (กลุ่มย่อยในทีม)</h2>
        <p className="muted">ทีมละ ~20 คน แนะนำแบ่งเป็นสควอดละ 4–5 คน: ล่าสมบัติจะนับ <strong>แยกตามสควอด</strong> (แต่ละสควอดเก็บแต่ละจุดได้ 1 ครั้ง) โทเคนยังเข้ากระเป๋าทีมรวม · คนที่ไม่มีสควอดจะนับเป็นกลุ่มเดียวทั้งทีม · อย่าลืมปรับโทเคนต่อจุดให้เหมาะกับจำนวนสควอด</p>
        <ul className="list">
          {teams.map((t) => {
            const mine = squads.filter((q) => q.team_id === t.team_id);
            const count = (qid: string) => people.filter((p) => p.squad_id === qid).length;
            const none = people.filter((p) => p.team_id === t.team_id && !p.squad_id).length;
            return (
              <li key={t.team_id} style={{ display: 'block' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <strong>{t.name} <span className="muted">({t.participants} คน · {mine.length} สควอด · ไม่มีสควอด {none})</span></strong>
                  <span className="row">
                    <input className="field" style={{ width: 80 }} type="number" min={2} max={30} title="ขนาดสควอด (คน)"
                      value={sizes[t.team_id] ?? '5'} onChange={(e) => setSizes({ ...sizes, [t.team_id]: e.target.value })} />
                    <button className="btn small" disabled={!t.participants}
                      onClick={() => (!mine.length || confirm(`แบ่งสควอดใหม่ให้ ${t.name}? สควอดเดิมจะถูกแทนที่`)) && run(async () => { const r = await call('squads.auto', { team_id: t.team_id, size: Number(sizes[t.team_id] ?? 5) }); setMsg(`แบ่ง ${r.people} คน เป็น ${r.squads} สควอดแล้ว`); })}>
                      สุ่มแบ่งสควอดอัตโนมัติ
                    </button>
                  </span>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  {mine.map((q) => editSquad?.id === q.id ? (
                    <span key={q.id} className="row">
                      <input className="field" value={editSquad?.name ?? ""} onChange={(e) => setEditSquad({ id: q.id, name: e.target.value })} />
                      <button className="btn small" onClick={() => run(async () => { await call('squad.save', editSquad); setEditSquad(null); }, 'บันทึกแล้ว')}>บันทึก</button>
                    </span>
                  ) : (
                    <span key={q.id} className="pill">
                      {q.name} · {count(q.id)} คน{' '}
                      <a href="#" onClick={(e) => { e.preventDefault(); setEditSquad({ id: q.id, name: q.name }); }}>แก้ชื่อ</a>{' · '}
                      <a href="#" onClick={(e) => { e.preventDefault(); confirm(`ลบ ${q.name}? สมาชิกจะกลายเป็น “ไม่มีสควอด”`) && run(() => call('squad.delete', { id: q.id }), 'ลบสควอดแล้ว'); }}>ลบ</a>
                    </span>
                  ))}
                  <button className="btn small ghost" onClick={() => { const n = prompt('ชื่อสควอดใหม่ของ ' + t.name); if (n?.trim()) run(() => call('squad.save', { team_id: t.team_id, name: n }), 'เพิ่มสควอดแล้ว'); }}>+ สควอด</button>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="card">
        <h2>นำเข้าผู้เล่นจาก Excel</h2>
        <p className="muted">
          ไฟล์ต้องมีคอลัมน์ <strong>ID, Full name, Nick name, Team</strong> (เพิ่ม <strong>Squad</strong> และ <strong>Leader</strong> = ใส่ 1/yes/หัวหน้า ให้คนที่เป็นหัวหน้าทีม ได้ ไม่บังคับ ทีมละ 1 คน) · <strong>ID</strong> คือรหัสที่ผู้เล่นใช้เข้าเกม คุณเป็นคนกำหนดเอง ·
          ทีมที่ยังไม่มีในระบบจะถูกสร้างให้ · นำเข้าซ้ำได้: ID เดิมจะอัปเดตชื่อ/ทีม ไม่สร้างซ้ำ ·
          ใน Excel ควรตั้งคอลัมน์ ID เป็นชนิด <strong>ข้อความ (Text)</strong> ไม่งั้นเลขนำหน้า 0 อาจหาย
        </p>
        <div className="row">
          <input type="file" accept=".xlsx,.csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = ''; }} />
        </div>
        <label className="lbl">หรือคัดลอกเซลล์จาก Excel (รวมแถวหัวตาราง) มาวางที่นี่</label>
        <textarea className="field" rows={4} value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={'ID\tFull name\tNick name\tTeam\nA1001\tสมชาย ใจดี\tชาย\tทีมสนเขียว'} />
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn small" disabled={!bulk.trim()} onClick={() => { const rows = toImportRows(parseDelimited(bulk)); setImp({ source: 'ข้อความที่วาง', rows }); }}>ตรวจสอบข้อมูลที่วาง</button>
          <button className="btn small ghost" onClick={() => confirm('ลบผู้เล่นทั้งหมดที่ยังไม่เริ่มเล่น (รวมข้อมูลตัวอย่าง)?') && run(async () => { const r = await call('participants.deleteUnstarted', {}); setMsg(`ลบแล้ว ${r.deleted} คน`); })}>ลบผู้เล่นที่ยังไม่เริ่มเล่นทั้งหมด (ล้างข้อมูลตัวอย่าง)</button>
        </div>

        {imp && (() => {
          const problems = importProblems(imp.rows);
          const teamsInFile = Array.from(new Set(imp.rows.map((r) => r.team).filter(Boolean)));
          return (
            <div style={{ marginTop: 14 }}>
              <h2 style={{ fontSize: 17 }}>ตัวอย่างจาก {imp.source}: {imp.rows.length} คน · {teamsInFile.length} ทีม</h2>
              {problems.length > 0 && <div className="error" style={{ marginBottom: 10 }}>{problems.slice(0, 10).join('\n')}{problems.length > 10 ? `\n… และอีก ${problems.length - 10} รายการ` : ''}</div>}
              <div className="table-wrap"><table>
                <thead><tr><th>#</th><th>ID</th><th>Full name</th><th>Nick name</th><th>Team</th><th>Squad</th><th>หัวหน้า</th></tr></thead>
                <tbody>{imp.rows.slice(0, 8).map((r, k) => <tr key={k}><td className="num">{k + 1}</td><td className="codebox">{r.id}</td><td>{r.full_name}</td><td>{r.nick_name}</td><td>{r.team}</td><td>{r.squad || '—'}</td><td>{r.leader ? '⭐' : ''}</td></tr>)}</tbody>
              </table></div>
              {imp.rows.length > 8 && <div className="muted">แสดง 8 แถวแรก จากทั้งหมด {imp.rows.length}</div>}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="btn small" disabled={busy || problems.length > 0 || imp.rows.length === 0} onClick={doImport}>{busy ? 'กำลังนำเข้า…' : `นำเข้า ${imp.rows.length} คน`}</button>
                <button className="btn small ghost" onClick={() => setImp(null)}>ยกเลิก</button>
              </div>
            </div>
          );
        })()}
      </div>

      <div className="card">
        <h2>{form.id ? 'แก้ไขผู้เล่น' : 'เพิ่มผู้เล่นทีละคน'}</h2>
        <div className="row">
          <input className="field grow" placeholder={form.id ? 'ID ใหม่ (เว้นว่าง = ใช้ ID เดิม)' : 'ID สำหรับเข้าเกม'} value={form.login_id} onChange={(e) => setForm({ ...form, login_id: e.target.value })} />
          <input className="field grow" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="field grow" placeholder="Nick name" value={form.nick_name} onChange={(e) => setForm({ ...form, nick_name: e.target.value })} />
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <select className="field grow" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value, squad_id: '' })}>
            <option value="">เลือกทีม</option>{teams.map((t) => <option key={t.team_id} value={t.team_id}>{t.name}</option>)}
          </select>
          <select className="field grow" value={form.squad_id} disabled={!form.team_id} onChange={(e) => setForm({ ...form, squad_id: e.target.value })}>
            <option value="">ไม่มีสควอด</option>{squads.filter((q) => q.team_id === form.team_id).map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
          </select>
          <button className="btn small" disabled={!form.name.trim() || !form.team_id || (!form.id && !form.login_id.trim())}
            onClick={() => run(async () => { await call('participant.save', form); setForm({ ...blankForm, team_id: form.team_id, squad_id: form.squad_id }); }, form.id ? 'บันทึกแล้ว' : 'เพิ่มผู้เล่นแล้ว')}>
            {form.id ? 'บันทึกการแก้ไข' : '+ เพิ่ม'}
          </button>
          {form.id && <button className="btn small ghost" onClick={() => setForm(blankForm)}>ยกเลิก</button>}
        </div>
        <label className="lbl"><input type="checkbox" checked={form.is_leader} onChange={(e) => setForm({ ...form, is_leader: e.target.checked })} /> ⭐ เป็นหัวหน้าทีม (มีสิทธิ์แลกสินค้าให้ทีม · ทีมละ 1 คน ถ้าติ๊กจะแทนที่หัวหน้าคนเดิม)</label>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>ผู้เล่น ({people.length})</h2>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th /><th>Full name</th><th>Nick name</th><th>ทีม</th><th>สควอด</th><th>หัวหน้า</th><th>สถานะ</th><th>คะแนน</th><th>ID</th><th /></tr></thead>
          <tbody>
            {people.map((p) => (
              <tr key={p.id}>
                <td><span className="m-av sm" aria-hidden>{p.avatar_url ? <img src={p.avatar_url} alt="" /> : (p.avatar_emoji || Array.from(p.nick_name || p.name)[0])}</span></td>
                <td>{p.name}</td><td>{p.nick_name || '—'}</td><td>{p.team_name}</td><td>{p.squad_name || '—'}</td><td>{p.is_leader ? '⭐ หัวหน้าทีม' : ''}</td>
                <td>{{ not_started: 'ยังไม่เริ่ม', in_progress: 'กำลังเล่น', completed: 'จบแล้ว' }[p.status as 'completed']}</td>
                <td className="num">{p.status === 'completed' ? `${p.correct_count} (${p.tokens_earned})` : ''}</td>
                <td>{p.has_code ? '✔ มี ID' : '— ไม่มี ID'}</td>
                <td className="row">
                  <button className="btn small ghost" onClick={() => setForm({ id: p.id, login_id: '', name: p.name, nick_name: p.nick_name ?? '', team_id: p.team_id, squad_id: p.squad_id ?? '', is_leader: !!p.is_leader })}>แก้ไข</button>
                  {p.is_leader
                    ? <button className="btn small ghost" onClick={() => run(() => call('leader.clear', { id: p.id }), 'ยกเลิกหัวหน้าทีมแล้ว')}>ยกเลิกหัวหน้า</button>
                    : <button className="btn small ghost" onClick={() => confirm(`ตั้ง ${p.name} เป็นหัวหน้าทีม ${p.team_name}? (หัวหน้าคนเดิมจะถูกแทนที่)`) && run(() => call('leader.set', { id: p.id }), 'ตั้งหัวหน้าทีมแล้ว')}>ตั้งเป็นหัวหน้า</button>}
                  <button className="btn small ghost" onClick={() => { const v = prompt(`ID ใหม่ของ ${p.name} (ID เดิมจะใช้ไม่ได้ทันที)`); if (v?.trim()) run(() => call('participant.save', { id: p.id, login_id: v, name: p.name, nick_name: p.nick_name ?? '', team_id: p.team_id, squad_id: p.squad_id ?? '' }), 'เปลี่ยน ID แล้ว'); }}>เปลี่ยน ID</button>
                  {p.has_avatar && <button className="btn small ghost" onClick={() => confirm(`ลบรูปโปรไฟล์ของ ${p.name}?`) && run(() => call('avatar.clear', { id: p.id }), 'ลบรูปโปรไฟล์แล้ว')}>ลบรูปโปรไฟล์</button>}
                  {p.has_code && <button className="btn small ghost" onClick={() => confirm(`ยกเลิก ID ของ ${p.name}? จะเข้าเกมไม่ได้จนกว่าจะตั้ง ID ใหม่`) && run(() => call('code.revoke', { id: p.id }), 'ยกเลิก ID แล้ว')}>ยกเลิก ID</button>}
                  {p.status === 'not_started' && <button className="btn small ghost" onClick={() => confirm(`ลบ ${p.name}?`) && run(() => call('participant.delete', { id: p.id }), 'ลบแล้ว')}>ลบ</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>
    </>
  );
}

// ----------------------------------------------------------------- questions
function Questions({ setMsg }: { setMsg: (m: string) => void }) {
  const [qs, setQs] = useState<any[]>([]);
  const [edit, setEdit] = useState<any | null>(null);
  const [up, setUp] = useState(false);
  const load = useCallback(() => call('questions').then((r) => setQs(r.questions)).catch((e) => setMsg(e.message)), [setMsg]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    try { await call('question.save', edit); setEdit(null); await load(); setMsg('บันทึกคำถามแล้ว'); }
    catch (e) { setMsg((e as Error).message); }
  }
  async function upload(file: File) {
    setUp(true);
    try {
      const fd = new FormData(); fd.append('file', file);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message);
      setEdit((e: any) => ({ ...e, image_url: data.url }));
    } catch (e) { setMsg((e as Error).message); } finally { setUp(false); }
  }

  return (
    <>
      <div className="banner">⚠️ แก้ไขคำถามให้เสร็จก่อนเปิดเกม หลังมีคนเริ่มตอบแล้วไม่ควรเปลี่ยนคำตอบที่ถูกหรือลำดับ</div>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>คำถาม ({qs.filter((q) => q.active).length} ข้อที่ใช้งาน)</h2>
          <button className="btn small green" onClick={() => setEdit({ position: qs.length + 1, prompt: '', image_url: '', options: ['', '', '', ''], correct_index: 0, active: true })}>+ เพิ่มคำถาม</button>
        </div>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>รูป</th><th>คำถาม</th><th>ตัวเลือก (✔ = ถูก)</th><th>ใช้งาน</th><th /></tr></thead>
          <tbody>
            {qs.map((q) => (
              <tr key={q.id}>
                <td className="num">{q.position}</td>
                <td>{q.image_url && <img src={q.image_url} alt="" style={{ width: 64, height: 48, objectFit: 'cover', borderRadius: 8 }} />}</td>
                <td>{q.prompt}</td>
                <td>{q.options.map((o: string, i: number) => <div key={i}>{i === q.correct_index ? '✔ ' : '• '}{o}</div>)}</td>
                <td>{q.active ? 'ใช่' : 'ไม่'}</td>
                <td className="row">
                  <button className="btn small ghost" onClick={() => setEdit({ ...q, image_url: q.image_url ?? '' })}>แก้ไข</button>
                  <button className="btn small ghost" onClick={async () => { if (confirm('ลบคำถามนี้?')) { try { const r = await call('question.delete', { id: q.id }); setMsg(r.deactivated ? 'มีคนตอบแล้ว จึงปิดการใช้งานแทนการลบ' : 'ลบแล้ว'); load(); } catch (e) { setMsg((e as Error).message); } } }}>ลบ</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </div>

      {edit && (
        <div className="card">
          <h2>{edit.id ? 'แก้ไขคำถาม' : 'เพิ่มคำถาม'}</h2>
          <label className="lbl">คำถาม</label>
          <input className="field" value={edit.prompt} onChange={(e) => setEdit({ ...edit, prompt: e.target.value })} />
          <label className="lbl">รูปภาพ — วางลิงก์ https://… หรืออัปโหลด (PNG/JPG/WebP ≤ 2MB) ใช้เฉพาะรูปที่คุณมีสิทธิ์ใช้งาน</label>
          <div className="row">
            <input className="field grow" value={edit.image_url} onChange={(e) => setEdit({ ...edit, image_url: e.target.value })} placeholder="https://… หรือ /placeholders/q1.svg" />
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {up && <span className="muted">กำลังอัปโหลด…</span>}
          </div>
          {edit.image_url && <img src={edit.image_url} alt="" style={{ width: 160, marginTop: 8, borderRadius: 10 }} />}
          <label className="lbl">ตัวเลือก 4 ข้อ (เลือกวงกลมที่เป็นคำตอบที่ถูก)</label>
          {edit.options.map((o: string, i: number) => (
            <div className="row" key={i} style={{ marginBottom: 6 }}>
              <input type="radio" name="correct" checked={edit.correct_index === i} onChange={() => setEdit({ ...edit, correct_index: i })} />
              <input className="field grow" value={o} onChange={(e) => { const opts = [...edit.options]; opts[i] = e.target.value; setEdit({ ...edit, options: opts }); }} />
            </div>
          ))}
          <div className="row">
            <div><label className="lbl">ลำดับ</label><input className="field" style={{ width: 90 }} type="number" value={edit.position} onChange={(e) => setEdit({ ...edit, position: Number(e.target.value) })} /></div>
            <label className="lbl" style={{ marginTop: 28 }}><input type="checkbox" checked={edit.active} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /> ใช้งาน</label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn small" onClick={save}>บันทึก</button>
            <button className="btn small ghost" onClick={() => setEdit(null)}>ยกเลิก</button>
          </div>
        </div>
      )}
    </>
  );
}


// ---------------------------------------------------------------------- hunt
const SECRET_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const randomSecret = () => {
  const a = new Uint32Array(8); crypto.getRandomValues(a);
  return Array.from(a, (n) => SECRET_CHARS[n % SECRET_CHARS.length]).join('');
};

function Qr({ text, size = 160 }: { text: string; size?: number }) {
  const [src, setSrc] = useState('');
  useEffect(() => { QRCode.toDataURL(text, { margin: 1, width: size * 2 }).then(setSrc).catch(() => setSrc('')); }, [text, size]);
  return src ? <img src={src} alt="QR" width={size} height={size} /> : <div style={{ width: size, height: size }} />;
}

function Hunt({ setMsg }: { setMsg: (m: string) => void }) {
  const blank = { id: '', position: '1', title: '', hint: '', secret: '', tokens: '10', active: true, min_players: '1', window_sec: '180' };
  const [d, setD] = useState<{ spots: any[]; claims: any[] }>({ spots: [], claims: [] });
  const [f, setF] = useState<typeof blank | null>(null);
  const [cards, setCards] = useState(false);
  const load = useCallback(() => call('hunt').then(setD).catch((e) => setMsg(e.message)), [setMsg]);
  useEffect(() => { load(); }, [load]);
  const link = (secret: string) => `${window.location.origin}/?spot=${secret}`;
  const count = (id: string) => d.claims.filter((c) => c.spot_id === id).length;

  async function save() {
    if (!f) return;
    try {
      await call('spot.save', { ...f, id: f.id || undefined, position: Number(f.position), tokens: Number(f.tokens), min_players: Number(f.min_players), window_sec: Number(f.window_sec) });
      setF(null); await load(); setMsg('บันทึกจุดแล้ว');
    } catch (e) { setMsg((e as Error).message); }
  }

  if (cards) {
    const act = d.spots.filter((s) => s.active);
    return (
      <>
        <div className="row noprint" style={{ marginBottom: 12 }}>
          <button className="btn small" onClick={() => window.print()}>พิมพ์</button>
          <button className="btn small ghost" onClick={() => setCards(false)}>กลับ</button>
          <span className="muted">พิมพ์แล้ววางที่จุดจริง อย่าโพสต์ในกลุ่มแชท (ใครสแกนก็ได้โทเคน)</span>
        </div>
        <div className="grid">
          {act.map((s) => (
            <div className="card center" key={s.id} style={{ breakInside: 'avoid' }}>
              <h2>{s.title}</h2>
              <Qr text={link(s.secret)} size={180} />
              <div className="codebox" style={{ fontSize: 22 }}>{s.secret}</div>
              <div className="muted">สแกน หรือกรอกรหัสในเกม · {s.tokens} โทเคน</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>จุดล่าสมบัติ ({d.spots.length})</h2>
          <span className="row">
            <button className="btn small" onClick={() => setF({ ...blank, position: String(d.spots.length + 1), secret: randomSecret() })}>เพิ่มจุด</button>
            <button className="btn small ghost" disabled={!d.spots.length} onClick={() => setCards(true)}>พิมพ์ QR ทุกจุด</button>
          </span>
        </div>
        <p className="muted">แต่ละ <strong>สควอด</strong> (ถ้าไม่มีสควอด = ทั้งทีม) ได้โทเคนจากแต่ละจุด <strong>ครั้งเดียว</strong> (คนแรกในกลุ่มที่เจอ) โทเคนเข้ากระเป๋าทีม · แก้ไขรหัสจุดหลังเริ่มเกมแล้ว QR ที่พิมพ์ไว้จะใช้ไม่ได้</p>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>ชื่อจุด</th><th>รหัส</th><th>โทเคน</th><th>สควอด/ทีมที่เจอ</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>{d.spots.map((s) => (
            <tr key={s.id}>
              <td className="num">{s.position}</td><td>{s.title}{s.min_players > 1 && <span className="pill" style={{ marginLeft: 6 }}>👥 ต้อง {s.min_players} คน/{Math.round(s.window_sec / 60 * 10) / 10} นาที</span>}<div className="muted">{s.hint}</div></td>
              <td className="codebox">{s.secret}</td><td className="num">{s.tokens}</td><td className="num">{count(s.id)}</td>
              <td>{s.active ? 'ใช้งาน' : 'ปิด'}</td>
              <td className="row">
                <button className="btn small ghost" onClick={() => setF({ id: s.id, position: String(s.position), title: s.title, hint: s.hint, secret: s.secret, tokens: String(s.tokens), active: s.active, min_players: String(s.min_players ?? 1), window_sec: String(s.window_sec ?? 180) })}>แก้ไข</button>
                <button className="btn small ghost" onClick={() => confirm(`ลบจุด ${s.title}?`) && call('spot.delete', { id: s.id }).then((r) => { load(); setMsg(r.deactivated ? 'มีทีมเจอแล้ว จึงปิดจุดแทนการลบ' : 'ลบแล้ว'); }).catch((e) => setMsg(e.message))}>ลบ</button>
              </td>
            </tr>))}</tbody>
        </table></div>
      </div>

      {f && (
        <div className="card">
          <h2>{f.id ? 'แก้ไขจุด' : 'เพิ่มจุด'}</h2>
          <label className="lbl">ชื่อจุด (ผู้เล่นเห็น)</label>
          <input className="field" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <label className="lbl">คำใบ้ (ผู้เล่นเห็นจนกว่าทีมจะเจอ)</label>
          <input className="field" value={f.hint} onChange={(e) => setF({ ...f, hint: e.target.value })} />
          <label className="lbl">รหัสจุด (4–40 ตัว A-Z 0-9 · ซ่อนจากผู้เล่น)</label>
          <div className="row">
            <input className="field grow codebox" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />
            <button className="btn small ghost" onClick={() => setF({ ...f, secret: randomSecret() })}>สุ่มใหม่</button>
          </div>
          {f.secret.length >= 4 && <div style={{ margin: '10px 0' }}><Qr text={link(f.secret)} size={120} /></div>}
          <div className="row">
            <div><label className="lbl">โทเคน</label><input className="field" type="number" min={0} value={f.tokens} onChange={(e) => setF({ ...f, tokens: e.target.value })} /></div>
            <div><label className="lbl">ลำดับ</label><input className="field" type="number" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></div>
            <div><label className="lbl">จุดร่วมมือ: ต้องสแกนกี่คน (1 = ปกติ)</label><input className="field" style={{ width: 130 }} type="number" min={1} max={10} value={f.min_players} onChange={(e) => setF({ ...f, min_players: e.target.value })} /></div>
            <div><label className="lbl">ภายในกี่วินาที</label><input className="field" style={{ width: 110 }} type="number" min={30} max={1800} step={30} value={f.window_sec} onChange={(e) => setF({ ...f, window_sec: e.target.value })} /></div>
            <label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ใช้งาน</label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn small" disabled={!f.title.trim() || f.secret.length < 4} onClick={save}>บันทึก</button>
            <button className="btn small ghost" onClick={() => setF(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>ความคืบหน้าล่าสุด</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>ทีม</th><th>สควอด</th><th>จุด</th><th>ผู้พบ</th></tr></thead>
          <tbody>{d.claims.map((c, i) => <tr key={i}><td>{fmt(c.at)}</td><td>{c.team}</td><td>{c.squad || '—'}</td><td>{d.spots.find((s) => s.id === c.spot_id)?.title}</td><td>{c.by}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  );
}


// ------------------------------------------------------------------- team photo missions
const CATS: [string, string][] = [['person', '👤 ภาพบุคคล'], ['object', '📦 ภาพสิ่งของ'], ['food', '🍜 ภาพอาหาร'], ['place', '📍 ภาพสถานที่'], ['other', '🎯 โจทย์พิเศษ']];

function Missions({ role, setMsg }: { role: Role; setMsg: (m: string) => void }) {
  const blank = { id: '', position: '1', title: '', description: '', category: 'person', ref_image_url: '', tokens: '20', active: true };
  const [d, setD] = useState<{ missions: any[]; submissions: any[] }>({ missions: [], submissions: [] });
  const [f, setF] = useState<typeof blank | null>(null);
  const [up, setUp] = useState(false);
  const [zoom, setZoom] = useState('');
  const [filter, setFilter] = useState<'pending' | 'approved' | 'rejected' | 'all'>('pending');
  const [busyId, setBusyId] = useState('');
  const isAdmin = role === 'admin';
  const load = useCallback(() => call('missions').then(setD).catch((e) => setMsg(e.message)), [setMsg]);
  useEffect(() => { load(); const t = setInterval(load, 20000); return () => clearInterval(t); }, [load]);

  async function save() {
    if (!f) return;
    try {
      await call('mission.save', { ...f, id: f.id || undefined, position: Number(f.position), tokens: Number(f.tokens) });
      setF(null); await load(); setMsg('บันทึกภารกิจแล้ว');
    } catch (e) { setMsg((e as Error).message); }
  }
  async function uploadRef(file: File) {
    setUp(true);
    try {
      const small = await compressImage(file, 1400);
      const fd = new FormData(); fd.append('file', small);
      const res = await fetch('/api/admin/upload', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? 'อัปโหลดไม่สำเร็จ');
      setF((x) => (x ? { ...x, ref_image_url: data.url } : x));
    } catch (e) { setMsg((e as Error).message); } finally { setUp(false); }
  }
  async function review(sub: any, approve: boolean) {
    let reason = '';
    if (!approve) {
      const r = prompt(sub.status === 'approved'
        ? `ยกเลิกการยืนยันภาพของทีม ${sub.team}?\nโทเคน ${sub.tokens} จะถูกหักคืนจากทีม\n\nเหตุผล:`
        : `ปฏิเสธภาพของทีม ${sub.team}?\n(ไม่ได้โทเคน และหัวหน้าทีมส่งภาพใหม่ได้)\n\nเหตุผลที่ผู้เล่นจะเห็น (เช่น ภาพไม่ชัด / ไม่ตรงโจทย์ / ไม่ครบทีม):`, 'ไม่ตรงโจทย์');
      if (r === null) return;
      reason = r;
    }
    setBusyId(sub.id);
    try {
      await call('photo.review', { id: sub.id, approve, reason });
      await load();
      window.dispatchEvent(new Event('fc-photos-changed'));
      setMsg(approve ? `ยืนยันภาพของทีม ${sub.team} แล้ว · ทีมได้ +${sub.tokens} โทเคน` : `ปฏิเสธภาพของทีม ${sub.team} แล้ว`);
    } catch (e) { setMsg((e as Error).message); }
    finally { setBusyId(''); }
  }
  const approved = d.submissions.filter((x) => x.status === 'approved');
  const pendingList = d.submissions.filter((x) => x.status === 'pending');
  const shown = filter === 'all' ? d.submissions : d.submissions.filter((x) => x.status === filter);
  const title = (id: string) => d.missions.find((m) => m.id === id)?.title ?? '';

  return (
    <>
      {zoom && <div className="dlg-back" onClick={() => setZoom('')} style={{ cursor: 'zoom-out' }}><img src={zoom} alt="" style={{ maxWidth: '100%', maxHeight: '90dvh', borderRadius: 16 }} /></div>}
      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <h2 style={{ margin: 0 }}>📸 ภารกิจทีม: ถ่ายภาพทั้งทีม ({d.missions.length})</h2>
          {isAdmin && <button className="btn small" onClick={() => setF({ ...blank, position: String(d.missions.length + 1) })}>+ เพิ่มภารกิจ</button>}
        </div>
        <p className="muted">
          ตั้งโจทย์ถ่ายภาพ (บุคคล สิ่งของ อาหาร สถานที่ หรือโจทย์พิเศษ) ใส่ภาพตัวอย่างได้ · <strong>ทั้งทีมต้องอยู่ในภาพ</strong> และ <strong>เฉพาะหัวหน้าทีมเท่านั้นที่อัปโหลดได้</strong> ·
          ภาพที่ส่งจะ <strong>รอทีมงานตรวจ</strong>: กด <strong>✅ ยืนยัน</strong> ทีมจึงได้โทเคน หรือ <strong>❌ ปฏิเสธ</strong> (ไม่ตรงโจทย์) ทีมจะไม่ได้โทเคนและหัวหน้าส่งใหม่ได้ ·
          เปิด-ปิดที่สวิตช์ “ภารกิจทีม” ในหน้าภาพรวม · ทีมที่ยังไม่มีหัวหน้าจะส่งภาพไม่ได้
        </p>
        <div className="table-wrap"><table>
          <thead><tr><th>#</th><th>ภาพตัวอย่าง</th><th>ภารกิจ</th><th>ประเภท</th><th>โทเคน</th><th>ผ่านแล้ว</th><th>รอตรวจ</th><th>สถานะ</th><th /></tr></thead>
          <tbody>{d.missions.map((m) => (
            <tr key={m.id}>
              <td className="num">{m.position}</td>
              <td>{m.ref_image_url ? <img src={m.ref_image_url} alt="" onClick={() => setZoom(m.ref_image_url)} style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10, cursor: 'zoom-in', display: 'block' }} /> : <span className="muted">—</span>}</td>
              <td><strong>{m.title}</strong><div className="muted" style={{ maxWidth: 360 }}>{m.description}</div></td>
              <td>{CATS.find((c) => c[0] === m.category)?.[1]}</td><td className="num">{m.tokens}</td><td className="num">{m.done} ทีม</td><td className="num">{m.pending ? <strong style={{ color: '#a35a00' }}>{m.pending}</strong> : '—'}</td>
              <td>{m.active ? 'ใช้งาน' : 'ปิด'}</td>
              <td className="row">{isAdmin && <>
                <button className="btn small ghost" onClick={() => setF({ id: m.id, position: String(m.position), title: m.title, description: m.description, category: m.category, ref_image_url: m.ref_image_url ?? '', tokens: String(m.tokens), active: m.active })}>แก้ไข</button>
                <button className="btn small ghost" onClick={() => confirm(`ลบภารกิจ “${m.title}”?`) && call('mission.delete', { id: m.id }).then((r) => { load(); setMsg(r.deactivated ? 'มีทีมส่งภาพแล้ว จึงปิดภารกิจแทนการลบ' : 'ลบแล้ว'); }).catch((e) => setMsg(e.message))}>ลบ</button>
              </>}</td>
            </tr>))}</tbody>
        </table></div>
      </div>

      {f && (
        <div className="card">
          <h2>{f.id ? 'แก้ไขภารกิจ' : 'เพิ่มภารกิจ'}</h2>
          <label className="lbl">ชื่อภารกิจ (ผู้เล่นเห็น)</label>
          <input className="field" placeholder="เช่น ถ่ายภาพกับเชฟประจำค่าย" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
          <label className="lbl">โจทย์ / วิธีถ่าย</label>
          <textarea className="field" rows={3} placeholder="เช่น ทั้งทีมยืนถ่ายภาพคู่กับเชฟ ทุกคนต้องอยู่ในภาพ" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <div className="row">
            <div><label className="lbl">ประเภทภาพ</label>
              <select className="field" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select></div>
            <div><label className="lbl">โทเคนเมื่อสำเร็จ</label><input className="field" style={{ width: 120 }} type="number" min={0} value={f.tokens} onChange={(e) => setF({ ...f, tokens: e.target.value })} /></div>
            <div><label className="lbl">ลำดับ</label><input className="field" style={{ width: 90 }} type="number" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /></div>
            <label className="row" style={{ marginTop: 24 }}><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> ใช้งาน</label>
          </div>
          <label className="lbl">ภาพตัวอย่าง (ไม่บังคับ · ไฟล์ภาพ PNG / JPG / WebP ระบบย่อให้อัตโนมัติ)</label>
          <div className="row">
            {f.ref_image_url
              ? <img src={f.ref_image_url} alt="" style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 12, border: '2px solid var(--cream-deep)' }} />
              : <div style={{ width: 120, height: 90, borderRadius: 12, border: '2px dashed var(--cream-deep)', display: 'grid', placeItems: 'center', fontSize: 30 }}>📷</div>}
            <div>
              <input type="file" accept="image/png,image/jpeg,image/webp" disabled={up} onChange={(e) => { const x = e.target.files?.[0]; if (x) uploadRef(x); e.target.value = ''; }} />
              <div className="muted">{up ? 'กำลังอัปโหลด…' : 'เลือกไฟล์แล้วรอจนเห็นภาพ จากนั้นกด “บันทึก”'}</div>
              {f.ref_image_url && <button className="btn small ghost" style={{ marginTop: 6 }} onClick={() => setF({ ...f, ref_image_url: '' })}>ลบภาพตัวอย่าง</button>}
            </div>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn small" disabled={!f.title.trim() || up} onClick={save}>บันทึก</button>
            <button className="btn small ghost" onClick={() => setF(null)}>ยกเลิก</button>
          </div>
        </div>
      )}

      <div className="card">
        <h2>🖼️ ตรวจภาพที่ทีมส่งมา {pendingList.length > 0 && <span className="pill" style={{ background: '#fbe7b8', marginLeft: 6 }}>⏳ รอตรวจ {pendingList.length}</span>}</h2>
        <div className="row" style={{ margin: '6px 0 10px' }}>
          {([['pending', `⏳ รอตรวจ (${pendingList.length})`], ['approved', `✅ ผ่านแล้ว (${approved.length})`], ['rejected', `❌ ไม่ผ่าน (${d.submissions.length - approved.length - pendingList.length})`], ['all', 'ทั้งหมด']] as const).map(([k, label]) => (
            <button key={k} className={`btn small ${filter === k ? '' : 'ghost'}`} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
        {shown.length === 0 ? <p className="muted center" style={{ margin: 0 }}>{filter === 'pending' ? 'ไม่มีภาพที่รอตรวจ 🎉' : 'ไม่มีภาพในหมวดนี้'}</p> : (
          <div className="gallery">
            {shown.map((x) => (
              <figure key={x.id} className={`g-item ${x.status}`}>
                <img src={x.image_url} alt={title(x.mission_id)} loading="lazy" onClick={() => setZoom(x.image_url)} />
                <figcaption>
                  <strong>{x.team}</strong>
                  <div>{title(x.mission_id)}</div>
                  <div className="muted" style={{ fontSize: 13 }}>⭐ {x.by} · {fmt(x.at)}</div>
                  {x.status === 'pending' && (
                    <div className="row" style={{ marginTop: 8 }}>
                      <button className="btn small" disabled={busyId === x.id} onClick={() => review(x, true)}>✅ ยืนยัน (+{x.tokens})</button>
                      <button className="btn small danger" disabled={busyId === x.id} onClick={() => review(x, false)}>❌ ปฏิเสธ</button>
                    </div>
                  )}
                  {x.status === 'approved' && (
                    <>
                      <div style={{ color: 'var(--ok)', fontSize: 14, fontWeight: 600 }}>✅ ยืนยันแล้ว +{x.tokens}{x.reviewedBy ? ` · โดย ${x.reviewedBy}` : ''}</div>
                      {isAdmin && <button className="btn small ghost" style={{ marginTop: 6 }} disabled={busyId === x.id} onClick={() => review(x, false)}>ยกเลิกการยืนยัน (หักโทเคนคืน)</button>}
                    </>
                  )}
                  {x.status === 'rejected' && <div style={{ color: 'var(--bad)', fontSize: 14 }}>❌ ไม่ผ่าน{x.reason ? `: ${x.reason}` : ''}</div>}
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ------------------------------------------------------------------- history
function History() {
  const [r, setR] = useState<any[]>([]);
  const [l, setL] = useState<any>({ ledger: [], audit: [] });
  useEffect(() => { call('redemptions').then((d) => setR(d.redemptions)); call('ledger').then(setL); }, []);
  return (
    <>
      <div className="card">
        <h2>ประวัติการแลกของ</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>ทีม</th><th>สินค้า</th><th>จำนวน</th><th>โทเคน</th><th>แลกโดย</th><th>การจ่ายของ</th></tr></thead>
          <tbody>{r.map((x) => <tr key={x.id}><td>{fmt(x.created_at)}</td><td>{x.team_name}</td><td>{x.item_name}</td><td className="num">{x.quantity}</td><td className="num">{x.total_cost}</td><td>{x.confirmed_by}</td><td>{x.fulfilled_at ? `✅ จ่ายแล้ว ${fmt(x.fulfilled_at)}` : '⏳ รอจ่าย'}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>การปรับโทเคนด้วยมือ</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>ทีม</th><th>จำนวน</th><th>เหตุผล</th><th>โดย</th></tr></thead>
          <tbody>{l.ledger.filter((x: any) => x.kind === 'adjustment').map((x: any) => <tr key={x.id}><td>{fmt(x.created_at)}</td><td>{x.team_name}</td><td className="num">{x.amount > 0 ? '+' : ''}{x.amount}</td><td>{x.reason}</td><td>{x.created_by}</td></tr>)}</tbody>
        </table></div>
      </div>
      <div className="card">
        <h2>Audit log (ล่าสุด)</h2>
        <div className="table-wrap"><table>
          <thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead>
          <tbody>{l.audit.map((x: any) => <tr key={x.id}><td>{fmt(x.created_at)}</td><td>{x.actor}</td><td>{x.action}</td><td style={{ fontSize: 13 }}>{JSON.stringify(x.details)}</td></tr>)}</tbody>
        </table></div>
      </div>
    </>
  );
}

function Export() {
  const items: [string, string][] = [
    ['summary', 'สรุปทีม: การเข้าร่วม ยอดโทเคนคงเหลือ'],
    ['participants', 'ผลของผู้เล่นแต่ละคน (ไม่มีรหัสเข้าเกม)'],
    ['redemptions', 'ประวัติการแลกของ'],
    ['adjustments', 'ประวัติการปรับโทเคนด้วยมือ'],
    ['hunt', 'ประวัติการล่าสมบัติ (ทีมไหนเจอจุดไหน)'],
    ['photos', 'ภาพภารกิจทีม (ทีม ภารกิจ ผู้อัปโหลด ลิงก์ภาพ)'],
    ['checkin', 'เช็กอินวันงาน (ใครมาถึงแล้ว เวลา วิธีเช็กอิน)'],
  ];
  return (
    <div className="card stack">
      <h2>ส่งออก CSV</h2>
      <p className="muted">ไฟล์มีข้อมูลส่วนบุคคล (ชื่อผู้เล่น) โปรดเก็บและแชร์เท่าที่จำเป็น</p>
      {items.map(([k, label]) => <a key={k} className="btn small ghost" style={{ textDecoration: 'none', textAlign: 'center' }} href={`/api/admin/export?type=${k}`}>{label}</a>)}
    </div>
  );
}
