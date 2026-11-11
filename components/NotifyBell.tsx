'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

type Item = { id: number; kind: string; title: string; body: string; at: string; link?: string | null; to?: string };
type Feed = { enabled: boolean; items: Item[]; teams?: { id: string; name: string }[] };
type Props = {
  mode: 'player' | 'admin';
  /** admin: the same fetch helper the dashboard uses (GET when no body, POST with a body) */
  call?: <T = any>(action: string, body?: unknown) => Promise<T>;
  /** player: open the screen a message points to */
  onGo?: (link: string) => void;
};

const safe = {
  get(k: string) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k: string, v: string) { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};
const ICON: Record<string, string> = { announce: '📣', photo: '📸', selfie: '🤳', hunt: '🧭', shop: '🛒', checkin: '📍', info: '🔔' };

function ago(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'เมื่อสักครู่';
  if (s < 3600) return `${Math.floor(s / 60)} นาทีที่แล้ว`;
  if (s < 86400) return `${Math.floor(s / 3600)} ชม.ที่แล้ว`;
  return `${Math.floor(s / 86400)} วันที่แล้ว`;
}

/**
 * Notification bell for players and organisers: unread badge, a list, "mark all read", and an on/off switch.
 * "Off" is remembered on this device only; the admin can also switch the bell off for every player (master switch).
 */
export default function NotifyBell({ mode, call, onGo }: Props) {
  const seenKey = `fch.bell.seen.${mode}`;
  const offKey = `fch.bell.off.${mode}`;
  const [feed, setFeed] = useState<Feed | null>(null);
  const [open, setOpen] = useState(false);
  const [off, setOff] = useState(false);
  const [seen, setSeen] = useState(0);
  const [toast, setToast] = useState<Item | null>(null);
  const [manage, setManage] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [team, setTeam] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const lastMax = useRef<number | null>(null);
  const dead = useRef(false);
  const offRef = useRef(false);
  offRef.current = off;

  useEffect(() => { setOff(safe.get(offKey) === '1'); setSeen(Number(safe.get(seenKey)) || 0); }, [offKey, seenKey]);

  const load = useCallback(async () => {
    if (dead.current || document.visibilityState === 'hidden') return;
    try {
      let f: Feed;
      if (mode === 'admin') f = await call!<Feed>('notify');
      else {
        const res = await fetch('/api/notify', { cache: 'no-store', signal: AbortSignal.timeout(15000) });
        if (res.status === 401) { dead.current = true; setFeed(null); return; }   // not logged in: no bell
        if (!res.ok) return;
        f = await res.json();
      }
      setFeed(f);
      const max = f.items.reduce((m, x) => Math.max(m, x.id), 0);
      // a message that arrived while the app is open: a small banner for a few seconds (unless muted)
      if (lastMax.current !== null && max > lastMax.current && !offRef.current) {
        const fresh = f.items.find((x) => x.id === max);
        if (fresh) { setToast(fresh); setTimeout(() => setToast((t) => (t?.id === fresh.id ? null : t)), 6000); }
      }
      lastMax.current = max;
    } catch { /* offline: try again later */ }
  }, [mode, call]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    const vis = () => { if (document.visibilityState === 'visible') load(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [load]);

  if (!feed || (mode === 'player' && !feed.enabled)) return null;
  const items = feed.items;
  const max = items.reduce((m, x) => Math.max(m, x.id), 0);
  const unread = off ? 0 : items.filter((x) => x.id > seen).length;
  const markAll = () => { setSeen(max); safe.set(seenKey, String(max)); };
  const toggle = () => { const v = !off; setOff(v); safe.set(offKey, v ? '1' : '0'); if (!v) markAll(); };
  const openPanel = () => { setOpen((o) => !o); setToast(null); if (!open) void load(); };

  async function send() {
    if (!call || !title.trim()) return;
    setBusy(true); setMsg('');
    try { await call('notify.send', { title, body: text, team_id: team }); setTitle(''); setText(''); setMsg('ส่งแล้ว ✅'); await load(); }
    catch (e: any) { setMsg(e.message ?? 'ส่งไม่สำเร็จ'); } finally { setBusy(false); }
  }
  async function master(v: boolean) {
    if (!call) return;
    try { await call('notify.set', { enabled: v }); setFeed((f) => (f ? { ...f, enabled: v } : f)); } catch (e: any) { setMsg(e.message ?? 'บันทึกไม่สำเร็จ'); }
  }
  async function clearAll() {
    if (!call || !window.confirm('ล้างรายการแจ้งเตือนทั้งหมด (ผู้เล่นและผู้จัด)?')) return;
    try { await call('notify.clear', {}); await load(); } catch (e: any) { setMsg(e.message ?? 'ล้างไม่สำเร็จ'); }
  }

  return (
    <div className={`bell-wrap ${mode}`}>
      <button className={`bell-btn${off ? ' muted' : ''}`} onClick={openPanel} aria-label={off ? 'การแจ้งเตือน (ปิดอยู่)' : `การแจ้งเตือน${unread ? ` ${unread} รายการใหม่` : ''}`} aria-expanded={open}>
        <span aria-hidden>{off ? '🔕' : '🔔'}</span>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {toast && !open && (
        <button className="bell-toast" onClick={openPanel} role="status">
          <b>{toast.title}</b>{toast.body && <span>{toast.body}</span>}
        </button>
      )}
      {open && (
        <>
          <div className="bell-scrim" onClick={() => setOpen(false)} />
          <div className="bell-panel" role="dialog" aria-label="การแจ้งเตือน">
            <div className="bell-head">
              <b>🔔 การแจ้งเตือน</b>
              <button className="bell-x" onClick={() => setOpen(false)} aria-label="ปิด">✕</button>
            </div>
            <label className="bell-switch">
              <span>รับการแจ้งเตือนบนเครื่องนี้</span>
              <input type="checkbox" checked={!off} onChange={toggle} />
              <i aria-hidden />
            </label>
            {off && <div className="bell-note">ปิดอยู่ — จะไม่มีตัวเลขและแบนเนอร์เด้ง (ยังเปิดดูรายการได้)</div>}
            <div className="bell-list">
              {items.length === 0 && <div className="bell-empty">ยังไม่มีการแจ้งเตือน</div>}
              {items.map((x) => (
                <button key={x.id} className={`bell-item${!off && x.id > seen ? ' new' : ''}`}
                  onClick={() => { if (mode === 'player' && x.link && onGo) { setOpen(false); onGo(x.link); } }}>
                  {!/^\p{Extended_Pictographic}/u.test(x.title) && <span className="bi-ic" aria-hidden>{ICON[x.kind] ?? '🔔'}</span>}
                  <span className="bi-tx"><b>{x.title}</b>{x.body && <em>{x.body}</em>}<small>{ago(x.at)}{x.to ? ` · ถึง ${x.to}` : ''}</small></span>
                </button>
              ))}
            </div>
            <div className="bell-foot">
              <button className="btn small ghost" onClick={markAll} disabled={unread === 0}>อ่านทั้งหมด</button>
              {mode === 'admin' && <button className="btn small ghost" onClick={() => setManage((m) => !m)}>{manage ? 'ซ่อนการจัดการ' : '⚙️ ส่งประกาศ / ตั้งค่า'}</button>}
            </div>
            {mode === 'admin' && manage && (
              <div className="bell-manage">
                <b>📣 ส่งประกาศ</b>
                <input value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder="หัวข้อ เช่น พักเที่ยง 12:00 รวมที่เต็นท์" />
                <input value={text} maxLength={300} onChange={(e) => setText(e.target.value)} placeholder="รายละเอียด (ไม่บังคับ)" />
                <select value={team} onChange={(e) => setTeam(e.target.value)}>
                  <option value="">ส่งถึง: ผู้เล่นทุกคน</option>
                  {(feed.teams ?? []).map((t) => <option key={t.id} value={t.id}>ส่งถึงทีม: {t.name}</option>)}
                </select>
                <button className="btn small" disabled={busy || !title.trim()} onClick={send}>{busy ? 'กำลังส่ง…' : 'ส่งประกาศ'}</button>
                <label className="bell-switch">
                  <span>เปิดกระดิ่งให้ผู้เล่นทุกคน</span>
                  <input type="checkbox" checked={feed.enabled} onChange={(e) => master(e.target.checked)} />
                  <i aria-hidden />
                </label>
                <button className="btn small ghost" onClick={clearAll}>🗑 ล้างรายการทั้งหมด</button>
                {msg && <div className="bell-note">{msg}</div>}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
