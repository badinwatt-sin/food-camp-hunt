'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import { backgroundMatch, colorName, hexToRgb } from '@/lib/selfie/color';

type Member = { id: string; name: string; fullName: string; isMe: boolean; isObserver: boolean; photoUrl: string | null; at: string | null };
type Status = {
  settings: { open: boolean; live: boolean; before: boolean; after: boolean; start: string | null; end: string | null; color: string; percent: number; tolerance: number; rewards: number[]; announcedAt: string | null };
  team: { name: string; members: Member[]; count: number; total: number; pct: number; complete: boolean; rank: number | null; tokens: number; completedAt: string | null };
  me: { isObserver: boolean; photoUrl: string | null };
  nextReward: number; nextRank: number | null;
  standings: { team: string; rank: number; tokens: number; at: string }[];
};
type Verdict = { accepted: boolean; reason?: string; pct: number; need: number; justCompleted?: boolean; rank?: number | null; tokens?: number; status?: Status };
type Props = { onBalance: () => void; onAuthLost: (e: unknown) => void };

const THEME_TITLE = 'Agency in the Wonder Woods';
const THEME_FOOT = 'Agency Outing & Team Building 2026';
const fmtDT = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const medal = (r: number | null | undefined) => (r === 1 ? '🥇' : r === 2 ? '🥈' : r === 3 ? '🥉' : r ? `#${r}` : '');

/** The whole mission screen: brief → wall → camera → verdict → celebration → final framed picture. */
export default function SelfieWall({ onBalance, onAuthLost }: Props) {
  const [st, setSt] = useState<Status | null>(null);
  const [err, setErr] = useState('');
  const [shoot, setShoot] = useState(false);
  const [party, setParty] = useState<{ tokens: number; rank: number | null } | null>(null);
  const [showFrame, setShowFrame] = useState(false);
  const load = useCallback(async () => {
    try { setSt(await api<Status>('/api/selfie')); setErr(''); } catch (e) { onAuthLost(e); setErr((e as Error).message); }
  }, [onAuthLost]);
  useEffect(() => { load(); const t = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 10000); return () => clearInterval(t); }, [load]);

  if (!st) return <div className="card center">{err ? <div className="error">{err}</div> : <div className="spinner" />}</div>;
  const s = st.settings, team = st.team, name = colorName(s.color);
  const onVerdict = (v: Verdict) => {
    if (v.status) setSt(v.status);
    if (v.accepted) { setShoot(false); onBalance(); }
    if (v.accepted && v.justCompleted) setParty({ tokens: v.tokens ?? 0, rank: v.rank ?? null });
  };

  return (
    <div className="sw" style={{ ['--sw-color' as string]: s.color }}>
      {party && <Celebration tokens={party.tokens} rank={party.rank} team={team.name} onDone={() => { setParty(null); setShowFrame(true); }} />}
      {showFrame && <FinalFrame st={st} onClose={() => setShowFrame(false)} />}
      {shoot && <Camera settings={s} onClose={() => setShoot(false)} onVerdict={onVerdict} onAuthLost={onAuthLost} />}

      {/* ---- hero / brief */}
      <div className="card sw-hero">
        <div className="sw-leaves" aria-hidden>{['🍃', '🌿', '🍂', '🍃', '🌱', '🍂'].map((l, i) => <span key={i} style={{ left: `${8 + i * 16}%`, animationDelay: `${i * 0.9}s` }}>{l}</span>)}</div>
        <div className="sw-kicker">ภารกิจแรกของทีม · {THEME_TITLE}</div>
        <h2 className="sw-title">🤳 Selfie Wall</h2>
        <p className="sw-brief">ทุกคนในทีมถ่าย <strong>Selfie</strong> กับฉากหลัง <span className="sw-chip"><i style={{ background: s.color }} />{name}</span> ให้พื้นหลังเป็นสีนี้อย่างน้อย <strong>{s.percent}%</strong> ระบบ AI จะตรวจภาพให้ทันที</p>
        <div className="sw-meta">
          {s.live ? <Countdown end={s.end} /> : s.before ? <span className="sw-pill">⏰ เริ่ม {fmtDT(s.start)}</span> : s.after ? <span className="sw-pill off">⌛ หมดเวลาแล้ว {fmtDT(s.end)}</span> : <span className="sw-pill off">ยังไม่เปิด</span>}
          {s.end && s.live && <span className="sw-pill">ถึง {fmtDT(s.end)}</span>}
        </div>
      </div>

      {/* ---- progress + rewards */}
      <div className="card sw-progress">
        <div className="sw-ring" style={{ ['--p' as string]: team.pct }} role="img" aria-label={`ทีมทำสำเร็จแล้ว ${team.pct}%`}>
          <div><b>{team.pct}%</b><span>{team.count}/{team.total} คน</span></div>
        </div>
        <div className="sw-progress-text">
          <h3>ทีม {team.name}</h3>
          {team.complete ? (
            <div className="sw-done">{medal(team.rank)} ทีมคุณทำครบเป็นอันดับ {team.rank} · ได้ <strong>{team.tokens}</strong> Tokens</div>
          ) : (
            <div className="muted">เหลืออีก {team.total - team.count} คน · ถ้าครบตอนนี้ทีมจะได้ <strong className="sw-gold">{st.nextReward} Tokens</strong> (อันดับ {st.nextRank})</div>
          )}
          <div className="sw-ranks" aria-label="รางวัลตามลำดับทีมที่ครบ">
            {s.rewards.map((t, i) => {
              const taken = st.standings.find((x) => x.rank === i + 1);
              return <div key={i} className={taken ? 'taken' : st.nextRank === i + 1 ? 'next' : ''}><span>{medal(i + 1)}</span><strong>{t}</strong><small>{taken ? taken.team : 'Tokens'}</small></div>;
            })}
          </div>
        </div>
      </div>

      {/* ---- the wall */}
      <div className="card sw-wall-card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h3 style={{ margin: 0 }}>🖼️ กำแพงภาพของทีม</h3>
          {team.complete && <button className="btn small" onClick={() => setShowFrame(true)}>🎞️ ดูภาพรวมทีม</button>}
        </div>
        <div className="sw-wall">
          {team.members.map((m, i) => <Frame key={m.id} m={m} index={i} onShoot={m.isMe && s.live ? () => setShoot(true) : undefined} />)}
        </div>
        {!st.me.photoUrl && s.live && (
          <button className="btn sw-cta" onClick={() => setShoot(true)}>📷 ถ่าย Selfie ของฉัน</button>
        )}
        {st.me.photoUrl && s.live && !team.complete && <button className="btn ghost" onClick={() => setShoot(true)}>ถ่ายใหม่</button>}
        {st.me.isObserver && <div className="observer-note" style={{ marginTop: 10 }}>👁 คณะทำงานร่วมติดภาพได้ แต่ไม่นับเป็นคะแนนของทีม</div>}
        {err && <div className="error" style={{ marginTop: 10 }}>{err}</div>}
      </div>

      {st.standings.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 8px' }}>🏁 ทีมที่ทำครบแล้ว</h3>
          <ol className="sw-standings">{st.standings.map((x) => <li key={x.rank}><span>{medal(x.rank)} {x.team}</span><strong>+{x.tokens}</strong><small>{fmtDT(x.at)}</small></li>)}</ol>
        </div>
      )}
    </div>
  );
}

function Countdown({ end }: { end: string | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!end) return <span className="sw-pill live">🟢 เปิดอยู่</span>;
  const left = Math.max(0, new Date(end).getTime() - now);
  const d = Math.floor(left / 86400000), h = Math.floor((left % 86400000) / 3600000), m = Math.floor((left % 3600000) / 60000), sec = Math.floor((left % 60000) / 1000);
  return <span className="sw-pill live">⏳ เหลือ {d > 0 ? `${d} วัน ` : ''}{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(sec).padStart(2, '0')}</span>;
}

/** One slot on the wall: grey placeholder with the name until a photo arrives, then it flips in. */
function Frame({ m, index, onShoot }: { m: Member; index: number; onShoot?: () => void }) {
  return (
    <div className={`sw-frame${m.photoUrl ? ' has' : ''}${m.isMe ? ' me' : ''}${m.isObserver ? ' obs' : ''}`} style={{ animationDelay: `${index * 60}ms` }}>
      <div className="sw-frame-inner">
        {m.photoUrl ? <img src={m.photoUrl} alt={m.name} loading="lazy" /> : (
          <div className="sw-frame-empty" onClick={onShoot} role={onShoot ? 'button' : undefined}>
            <span className="sw-frame-ghost" aria-hidden>👤</span>
            <span>{onShoot ? '📷 แตะเพื่อถ่าย' : 'รอถ่าย…'}</span>
          </div>
        )}
      </div>
      <div className="sw-frame-name">{m.isObserver ? '👁 ' : ''}{m.name}{m.isMe ? ' (ฉัน)' : ''}</div>
    </div>
  );
}

// ------------------------------------------------------------------ camera + live colour check
function Camera({ settings: s, onClose, onVerdict, onAuthLost }: { settings: Status['settings']; onClose: () => void; onVerdict: (v: Verdict) => void; onAuthLost: (e: unknown) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<'live' | 'preview' | 'sending' | 'rejected'>('live');
  const [camErr, setCamErr] = useState('');
  const [livePct, setLivePct] = useState<number | null>(null);
  const [shot, setShot] = useState<{ blob: Blob; url: string; pct: number } | null>(null);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const target = useMemo(() => hexToRgb(s.color), [s.color]);
  const name = colorName(s.color);
  const fileInput = useRef<HTMLInputElement>(null);

  // live camera (front) + a colour meter every ~400 ms so people can move before they shoot
  useEffect(() => {
    if (mode !== 'live') return;
    let stream: MediaStream | null = null, stop = false, raf = 0, last = 0;
    const c = document.createElement('canvas');
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamErr('nocam'); return; }
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1080 } }, audio: false }); }
      catch { setCamErr('denied'); return; }
      if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!; v.srcObject = stream; await v.play().catch(() => {});
      const tick = (now: number) => {
        if (stop) return; raf = requestAnimationFrame(tick);
        if (now - last < 400 || !v.videoWidth) return; last = now;
        const w = 96, h = Math.round((v.videoHeight / v.videoWidth) * 96);
        c.width = w; c.height = h;
        const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(v, 0, 0, w, h);
        setLivePct(Math.round(backgroundMatch(ctx.getImageData(0, 0, w, h).data, w, h, target, s.tolerance).backgroundPct));
      };
      raf = requestAnimationFrame(tick);
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, [mode, target, s.tolerance]);

  async function toJpeg(src: HTMLVideoElement | HTMLImageElement, mirror: boolean) {
    const sw = src instanceof HTMLVideoElement ? src.videoWidth : src.naturalWidth, sh = src instanceof HTMLVideoElement ? src.videoHeight : src.naturalHeight;
    const scale = Math.min(1, 1080 / Math.max(sw, sh));
    const c = canvas.current!; c.width = Math.round(sw * scale); c.height = Math.round(sh * scale);
    const ctx = c.getContext('2d')!;
    if (mirror) { ctx.translate(c.width, 0); ctx.scale(-1, 1); }
    ctx.drawImage(src, 0, 0, c.width, c.height);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const small = document.createElement('canvas'); small.width = 96; small.height = Math.round((c.height / c.width) * 96);
    const sc = small.getContext('2d', { willReadFrequently: true })!; sc.drawImage(c, 0, 0, small.width, small.height);
    const pct = Math.round(backgroundMatch(sc.getImageData(0, 0, small.width, small.height).data, small.width, small.height, target, s.tolerance).backgroundPct);
    const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.86));
    if (!blob) throw new Error('สร้างภาพไม่สำเร็จ');
    return { blob, url: URL.createObjectURL(blob), pct };
  }
  async function snap() {
    try { setShot(await toJpeg(video.current!, true)); setMode('preview'); } catch (e) { setCamErr((e as Error).message); }
  }
  async function fromFile(f: File) {
    const img = new Image(); img.src = URL.createObjectURL(f);
    await new Promise((r, j) => { img.onload = r; img.onerror = j; });
    setShot(await toJpeg(img, false)); setMode('preview');
  }
  async function send() {
    if (!shot) return;
    setMode('sending');
    try {
      const fd = new FormData(); fd.append('file', shot.blob, 'selfie.jpg');
      const res = await fetch('/api/selfie', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.message ?? 'ส่งภาพไม่สำเร็จ');
      const v = data as Verdict;
      setVerdict(v);
      if (v.accepted) onVerdict(v); else setMode('rejected');
    } catch (e) { onAuthLost(e); setVerdict({ accepted: false, reason: (e as Error).message, pct: 0, need: s.percent }); setMode('rejected'); }
  }
  const good = (livePct ?? 0) >= s.percent;

  return (
    <div className="sw-cam" role="dialog" aria-modal="true" aria-label="ถ่าย Selfie">
      <canvas ref={canvas} style={{ display: 'none' }} />
      <input ref={fileInput} type="file" accept="image/*" capture="user" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) fromFile(f); e.target.value = ''; }} />
      <div className="sw-cam-top">
        <button className="sw-x" onClick={onClose} aria-label="ปิด">✕</button>
        <div className="sw-cam-target"><i style={{ background: s.color }} /> ฉากหลัง{name} ≥ {s.percent}%</div>
      </div>

      {mode === 'live' && (
        <>
          <div className="sw-cam-view">
            {camErr ? (
              <div className="sw-cam-err">
                <div style={{ fontSize: 44 }}>📷</div>
                <p>{camErr === 'denied' ? 'เปิดกล้องไม่ได้ กรุณาอนุญาตการใช้กล้อง หรือใช้แอปกล้องของมือถือแทน' : 'เบราว์เซอร์นี้เปิดกล้องในแอปไม่ได้ ใช้แอปกล้องของมือถือแทนได้เลย'}</p>
                <button className="btn" onClick={() => fileInput.current?.click()}>📷 ถ่ายด้วยแอปกล้อง</button>
              </div>
            ) : <video ref={video} playsInline muted autoPlay />}
            <div className="sw-cam-guide" aria-hidden><div className="sw-cam-face" /></div>
          </div>
          <div className="sw-cam-bar">
            <div className={`sw-meter${good ? ' ok' : ''}`}><i style={{ width: `${Math.min(100, livePct ?? 0)}%` }} /><span>{livePct === null ? 'กำลังวัดสี…' : `${name} ${livePct}% ${good ? '✅ พร้อมถ่าย' : `· ต้องถึง ${s.percent}%`}`}</span></div>
            <div className="sw-cam-actions">
              <button className="btn ghost small" onClick={() => fileInput.current?.click()}>🖼️ เลือกรูป</button>
              <button className="sw-shutter" onClick={snap} disabled={!!camErr} aria-label="ถ่ายภาพ"><i /></button>
              <span style={{ width: 92 }} />
            </div>
            <div className="sw-cam-tip">ให้หน้าอยู่กลางวงรี และให้ฉากหลัง{name}อยู่รอบตัวมากที่สุด</div>
          </div>
        </>
      )}

      {(mode === 'preview' || mode === 'sending' || mode === 'rejected') && shot && (
        <>
          <div className="sw-cam-view"><img src={shot.url} alt="ภาพที่ถ่าย" />
            {mode === 'sending' && <div className="sw-scan"><div className="sw-scan-line" /><div className="sw-scan-text">🤖 AI กำลังตรวจภาพ…</div></div>}
          </div>
          <div className="sw-cam-bar">
            {mode === 'rejected' && verdict ? (
              <div className="sw-reject">
                <strong>❌ ยังไม่ผ่าน</strong>
                <div>{verdict.reason}</div>
                {verdict.pct > 0 && <div className="muted" style={{ fontSize: 13 }}>วัดได้ {verdict.pct}% · ต้องถึง {verdict.need}%</div>}
              </div>
            ) : (
              <div className={`sw-meter${shot.pct >= s.percent ? ' ok' : ''}`}><i style={{ width: `${Math.min(100, shot.pct)}%` }} /><span>ประเมินเบื้องต้น {name} ≈ {shot.pct}%</span></div>
            )}
            <div className="sw-cam-actions">
              <button className="btn ghost small" disabled={mode === 'sending'} onClick={() => { setShot(null); setVerdict(null); setMode('live'); }}>↺ ถ่ายใหม่</button>
              {mode !== 'rejected' && <button className="btn sw-send" disabled={mode === 'sending'} onClick={send}>{mode === 'sending' ? 'กำลังตรวจ…' : '✅ ส่งภาพนี้'}</button>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ celebration (team just completed)
function Celebration({ tokens, rank, team, onDone }: { tokens: number; rank: number | null; team: string; onDone: () => void }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const start = performance.now(), dur = 1400;
    let raf = 0;
    const tick = (t: number) => { const k = Math.min(1, (t - start) / dur); setN(Math.round(tokens * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick);
    try { navigator.vibrate?.([80, 60, 120]); } catch { /* ignore */ }
    return () => cancelAnimationFrame(raf);
  }, [tokens]);
  const bits = useMemo(() => Array.from({ length: 60 }, (_, i) => ({ l: Math.random() * 100, d: Math.random() * 1.2, r: Math.random() * 360, c: ['#f6d365', '#e0573b', '#2f8f5b', '#3f7fb5', '#fff', '#c96d2f'][i % 6], s: 6 + Math.random() * 8 })), []);
  return (
    <div className="sw-party" role="alertdialog" aria-label="ทีมทำภารกิจสำเร็จ">
      <div className="sw-confetti" aria-hidden>{bits.map((b, i) => <i key={i} style={{ left: `${b.l}%`, animationDelay: `${b.d}s`, background: b.c, width: b.s, height: b.s * 0.6, transform: `rotate(${b.r}deg)` }} />)}</div>
      <div className="sw-party-card">
        <div className="sw-coin3d" aria-hidden><div className="face front">🪙</div><div className="face back">🪙</div></div>
        <div className="sw-party-kicker">ทีม {team} ครบทุกคนแล้ว!</div>
        <div className="sw-party-rank">{medal(rank)} อันดับ {rank}</div>
        <div className="sw-party-tokens">+{n}</div>
        <div className="sw-party-sub">Tokens เข้ากระเป๋าทีม</div>
        <button className="btn sw-cta" onClick={onDone}>🎞️ ดูภาพรวมทีม</button>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ the framed team picture (save / share)
function FinalFrame({ st, onClose }: { st: Status; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let dead = false;
    renderFrame(st).then(({ blob, url }) => { if (dead) return; setBlob(blob); setUrl(url); }).catch((e) => setErr((e as Error).message));
    return () => { dead = true; };
  }, [st]);
  async function share() {
    if (!blob) return;
    const file = new File([blob], `${st.team.name}-wonder-woods.jpg`, { type: 'image/jpeg' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [file] })) { try { await nav.share({ files: [file], title: THEME_TITLE, text: `ทีม ${st.team.name} · ${THEME_FOOT}` }); return; } catch { /* cancelled */ } }
    download();
  }
  function download() {
    if (!url) return;
    const a = document.createElement('a'); a.href = url; a.download = `${st.team.name}-wonder-woods.jpg`; a.click();
  }
  return (
    <div className="sw-final" role="dialog" aria-modal="true" aria-label="ภาพรวมทีม">
      <div className="sw-final-top"><button className="sw-x" onClick={onClose} aria-label="ปิด">✕</button><strong>ภาพรวมทีม {st.team.name}</strong></div>
      <div className="sw-final-body">
        {err && <div className="error">{err}</div>}
        {url ? <img src={url} alt={`ภาพรวมทีม ${st.team.name}`} className="sw-final-img" /> : <div className="spinner" />}
        {!st.team.complete && <div className="banner" style={{ margin: '10px 0 0' }}>ยังไม่ครบทุกคน ช่องที่ว่างจะเติมเมื่อเพื่อนถ่ายเสร็จ</div>}
      </div>
      <div className="sw-final-actions">
        <button className="btn" disabled={!blob} onClick={share}>📤 แชร์ / โพสต์ Facebook</button>
        <button className="btn ghost" disabled={!url} onClick={download}>💾 บันทึกภาพ</button>
        <div className="muted" style={{ fontSize: 12, textAlign: 'center' }}>กด “แชร์” แล้วเลือก Facebook หรือบันทึกภาพไว้โพสต์เอง</div>
      </div>
    </div>
  );
}

const loadImg = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = () => rej(new Error('โหลดรูปไม่สำเร็จ')); i.src = src; });
const rr = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); };

/** Draws the collage: logo header, a grid of portrait photos with names, team name, footer line. 1080 px wide JPEG. */
async function renderFrame(st: Status) {
  const members = st.team.members.filter((m) => !m.isObserver).concat(st.team.members.filter((m) => m.isObserver && m.photoUrl));
  const n = Math.max(1, members.length);
  const cols = n <= 2 ? 2 : n <= 6 ? 3 : n <= 12 ? 4 : 5;
  const rows = Math.ceil(n / cols);
  const W = 1080, pad = 44, gap = 16, cellW = Math.floor((W - pad * 2 - gap * (cols - 1)) / cols), cellH = Math.round(cellW * 4 / 3), nameH = 40;
  const headH = 400, footH = 150;
  const H = headH + rows * (cellH + nameH + gap) + footH;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const ctx = c.getContext('2d')!;
  // backdrop: warm cream with a soft forest gradient and leaf sprinkles
  const g = ctx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, '#fff8ea'); g.addColorStop(1, '#e7f0e3');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#4c6b3c'; ctx.lineWidth = 10; rr(ctx, 18, 18, W - 36, H - 36, 36); ctx.stroke();
  ctx.strokeStyle = '#c96d2f'; ctx.lineWidth = 3; rr(ctx, 34, 34, W - 68, H - 68, 28); ctx.stroke();
  // logo
  try { const logo = await loadImg('/kv-logo.png'); const lw = 460, lh = lw * logo.height / logo.width; ctx.drawImage(logo, (W - lw) / 2, 52, lw, lh); }
  catch { ctx.fillStyle = '#4c6b3c'; ctx.font = 'bold 44px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(THEME_TITLE, W / 2, 140); }
  ctx.textAlign = 'center'; ctx.fillStyle = '#b4532a'; ctx.font = 'bold 46px "Noto Sans Thai", "Sarabun", sans-serif';
  ctx.fillText(`ทีม ${st.team.name}`, W / 2, headH - 36);
  // photos
  for (let i = 0; i < members.length; i++) {
    const m = members[i], col = i % cols, row = Math.floor(i / cols);
    const x = pad + col * (cellW + gap) + (row === rows - 1 ? Math.floor(((cols - Math.min(cols, n - row * cols)) * (cellW + gap)) / 2) : 0);
    const y = headH + row * (cellH + nameH + gap);
    ctx.save(); rr(ctx, x, y, cellW, cellH, 18); ctx.fillStyle = '#d9d9d2'; ctx.fill(); ctx.clip();
    if (m.photoUrl) {
      try { const img = await loadImg(m.photoUrl); const s = Math.max(cellW / img.width, cellH / img.height); ctx.drawImage(img, x + (cellW - img.width * s) / 2, y + (cellH - img.height * s) / 2, img.width * s, img.height * s); }
      catch { /* keep the grey box */ }
    } else { ctx.fillStyle = '#9aa39c'; ctx.font = `${Math.round(cellW * 0.5)}px sans-serif`; ctx.fillText('👤', x + cellW / 2, y + cellH * 0.62); }
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 6; rr(ctx, x, y, cellW, cellH, 18); ctx.stroke();
    ctx.fillStyle = '#1f3557'; ctx.font = `600 ${cellW > 240 ? 24 : 20}px "Noto Sans Thai", "Sarabun", sans-serif`;
    ctx.fillText(`${m.isObserver ? '👁 ' : ''}${m.name}`.slice(0, 22), x + cellW / 2, y + cellH + 28, cellW);
  }
  // footer
  ctx.fillStyle = '#4c6b3c'; ctx.font = 'bold 34px "Noto Sans Thai", "Sarabun", sans-serif';
  ctx.fillText(THEME_FOOT, W / 2, H - 70);
  ctx.fillStyle = '#7a8a74'; ctx.font = '22px sans-serif';
  ctx.fillText(st.team.complete ? `${medal(st.team.rank)} อันดับ ${st.team.rank} · +${st.team.tokens} Tokens` : 'Food Camp Hunt', W / 2, H - 36);
  const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
  if (!blob) throw new Error('สร้างภาพไม่สำเร็จ');
  return { blob, url: URL.createObjectURL(blob) };
}
