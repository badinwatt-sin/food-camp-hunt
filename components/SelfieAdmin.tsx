'use client';
import { useCallback, useEffect, useState } from 'react';
import { colorName } from '@/lib/selfie/color';
import FitLine from '@/components/FitLine';

type Member = { id: string; name: string; fullName: string; isObserver: boolean; photoId: string | null; photoUrl: string | null; pct: number | null; at: string | null; checks: any; similarTo?: string[]; faceLike?: { name: string; dist: number }[] };
type Team = { id: string; name: string; color: string | null; active: boolean; startedAt: string | null; members: Member[]; count: number; total: number; complete: boolean; rank: number | null; tokens: number; completedAt: string | null };
type Data = { settings: { open: boolean; live: boolean; before: boolean; after: boolean; start: string | null; end: string | null; color: string; percent: number; tolerance: number; rewards: number[]; announcedAt: string | null; audience: 'all' | 'teams' | 'judges'; faceMode: 'off' | 'flag' | 'block'; faceDistance: number }; aiEnabled: boolean; allTeams: { id: string; name: string; excluded: boolean; members: number }[]; palette: string[]; judges: { members: Member[]; count: number; total: number }; teams: Team[] };
type Props = { role: 'admin' | 'staff'; setMsg: (m: string) => void; call: <T = any>(action: string, body?: unknown) => Promise<T> };

const PRESETS = [['#2f8f5b', 'เขียวป่า'], ['#1f3557', 'น้ำเงินเข้ม'], ['#e0573b', 'แดงอิฐ'], ['#f6d365', 'เหลือง'], ['#ffffff', 'ขาว'], ['#111111', 'ดำ'], ['#c96d2f', 'ส้มดิน'], ['#7c4dff', 'ม่วง']];
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; };
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

/** Admin → 🤳 Selfie Wall: window, colour, threshold, rewards, and every team's wall with moderation. */
export default function SelfieAdmin({ role, setMsg, call }: Props) {
  const [d, setD] = useState<Data | null>(null);
  const [f, setF] = useState<{ start: string; end: string; color: string; percent: string; tolerance: string; rewards: string[]; faceMode: string; faceDistance: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [zoom, setZoom] = useState<Member | null>(null);
  const [reason, setReason] = useState('');   // reject reason (hooks stay above the early return)
  const isAdmin = role === 'admin';
  const load = useCallback(() => call<Data>('selfie').then((r) => {
    setD(r);
    setF((cur) => cur ?? { start: toLocal(r.settings.start), end: toLocal(r.settings.end), color: r.settings.color, percent: String(r.settings.percent), tolerance: String(r.settings.tolerance), rewards: [0, 1, 2, 3].map((i) => String(r.settings.rewards[i] ?? 0)), faceMode: r.settings.faceMode, faceDistance: String(r.settings.faceDistance) });
  }).catch((e) => setMsg(e.message)), [call, setMsg]);
  useEffect(() => { load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, [load]);
  if (!d || !f) return <div className="spinner" />;
  const s = d.settings;

  async function set(patch: Record<string, unknown>, text: string) {
    setBusy(true);
    try { await call('selfie.set', patch); await load(); setMsg(text); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  const save = () => set({
    start: f!.start ? new Date(f!.start).toISOString() : '', end: f!.end ? new Date(f!.end).toISOString() : '',
    color: f!.color, percent: Number(f!.percent), tolerance: Number(f!.tolerance), rewards: f!.rewards.map(Number), face_mode: f!.faceMode, face_distance: Number(f!.faceDistance),
  }, 'บันทึกการตั้งค่า Selfie Wall แล้ว');
  async function reject(m: Member) {
    const why = reason.trim();
    if (!m.photoId || !why) { setMsg('กรุณาเลือกหรือพิมพ์เหตุผลก่อนปฏิเสธภาพ'); return; }
    try { await call('selfie.reject', { id: m.photoId, reason: why }); setZoom(null); setReason(''); await load(); setMsg(`ปฏิเสธภาพของ ${m.name} แล้ว ระบบแจ้งให้ถ่ายใหม่`); } catch (e) { setMsg((e as Error).message); }
  }
  async function exclude(t: { id: string; name: string; excluded: boolean }, excluded: boolean) {
    const q = excluded
      ? `ตั้งทีม "${t.name}" เป็นทีมกรรมการ/ทดสอบ?\n• ไม่นับคะแนน ไม่มีอันดับ ไม่ได้ Token ไม่อยู่ในยอดรวม\n• ไม่ได้รับ Pop-up ในช่วงจริง และเล่นได้เฉพาะโหมด "ทดสอบกรรมการ"\n• ภาพที่ทีมนี้ถ่ายไว้บน Team Wall จริงจะถูกนำออก`
      : `เปลี่ยนทีม "${t.name}" กลับเป็นทีมผู้เล่นปกติ? (จะนับคะแนนและอันดับตามปกติ)`;
    if (!confirm(q)) return;
    try { const r = await call<{ removed: number }>('selfie.team.exclude', { team_id: t.id, excluded }); await load(); setMsg(excluded ? `ตั้งทีม ${t.name} เป็นทีมกรรมการ/ทดสอบแล้ว${r.removed ? ` (นำภาพออก ${r.removed} ภาพ)` : ''}` : `ทีม ${t.name} กลับเป็นทีมปกติแล้ว`); } catch (e) { setMsg((e as Error).message); }
  }
  async function startTeam(t: Team, active: boolean) {
    if (active && !s.open && !confirm('ภารกิจยังปิดอยู่ ทีมจะยังไม่เห็นอะไรจนกว่าจะกด "เปิดภารกิจ" เริ่มทีมนี้ไว้ก่อนไหม?')) return;
    try { await call('selfie.team.start', { team_id: t.id, active }); await load(); setMsg(active ? `เริ่มภารกิจให้ทีม ${t.name} แล้ว (แจ้งเตือนเฉพาะทีมนี้)` : `หยุดภารกิจของทีม ${t.name} แล้ว`); } catch (e) { setMsg((e as Error).message); }
  }
  async function remove(m: Member) {
    if (!m.photoId || !confirm(`ลบภาพของ ${m.name} ออกจาก Team Wall?`)) return;
    try { await call('selfie.remove', { id: m.photoId }); await load(); setMsg(`ลบภาพของ ${m.name} แล้ว`); } catch (e) { setMsg((e as Error).message); }
  }
  const test = s.audience === 'judges';
  async function setAudience(a: 'all' | 'teams' | 'judges') {
    if (a === s.audience) return;
    if (a === 'all' && s.open && !confirm('เริ่มให้ทุกทีมเลยไหม? สมาชิกทุกทีมจะได้รับ Pop-up ทันที (ไม่รวมกรรมการ/Committee)')) return;
    await set({ audience: a }, a === 'all' ? (s.open ? 'เริ่มภารกิจให้ทุกทีมแล้ว สมาชิกจะได้รับ Pop-up' : 'ตั้งเป็นทุกทีมแล้ว (กดเปิดภารกิจเพื่อประกาศ)')
      : a === 'teams' ? 'ตั้งเป็นเลือกทีมแล้ว กด "เริ่มทีมนี้" ที่ทีมที่ต้องการ'
      : 'ตั้งเป็นโหมดทดสอบกรรมการแล้ว ผู้เล่นอื่นจะไม่เห็นและไม่ได้รับแจ้งเตือน');
  }
  async function teamColor(id: string, color: string | null) {
    try { await call('selfie.team.color', { team_id: id, color }); await load(); } catch (e) { setMsg((e as Error).message); }
  }
  async function randomColors() {
    if (!confirm('สุ่มสีให้ทุกทีมใหม่ (แต่ละทีมได้สีไม่ซ้ำกัน)? สีเดิมของทุกทีมจะถูกแทนที่')) return;
    setBusy(true);
    try { await call('selfie.team.color', { assign: 'random' }); await load(); setMsg('สุ่มสีให้ทุกทีมแล้ว (ไม่ซ้ำกัน)'); } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  }
  async function clearTest() {
    if (!confirm('ลบภาพทดสอบของกรรมการทั้งหมด? (ภาพและคะแนนของทีมจริงไม่ถูกแตะ)')) return;
    try { const r = await call<{ cleared: number }>('selfie.clearTest', {}); await load(); setMsg(`ลบภาพทดสอบแล้ว ${r.cleared} ภาพ`); } catch (e) { setMsg((e as Error).message); }
  }
  const stateText = !s.open ? '⚪ ปิดอยู่' : s.before ? `⏰ รอเริ่ม ${fmt(s.start)}` : s.after ? `⌛ หมดเวลาแล้ว (${fmt(s.end)})` : '🟢 เปิดรับภาพอยู่';
  const done = d.teams.filter((t) => t.complete).sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9));

  return (
    <>
      {zoom && (
        <div className="dlg-back" role="dialog" aria-label="ตรวจภาพ Selfie" onClick={() => setZoom(null)}>
          <div className="dlg" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 520, maxHeight: '92vh', overflowY: 'auto' }}>
            <img src={zoom.photoUrl!} alt={zoom.name} style={{ width: '100%', borderRadius: 14, maxHeight: '36vh', objectFit: 'contain', background: '#111' }} />
            <div style={{ marginTop: 8 }}><strong>{zoom.name}</strong>{zoom.fullName && zoom.fullName !== zoom.name && <div className="muted">{zoom.fullName}</div>}<div className="muted" style={{ fontSize: 13 }}>{fmt(zoom.at)} · พื้นหลังตรงสี {zoom.pct ?? '—'}%</div><div className="muted" style={{ fontSize: 13 }}>ที่มาของภาพ: {zoom.checks?.source === 'gallery' ? '🖼️ เลือกจากรูปในเครื่อง (ไม่ใช่ถ่ายสด)' : zoom.checks?.source === 'camera-app' ? '📱 ถ่ายด้วยแอปกล้องของมือถือ' : '📷 ถ่ายสดในแอป'}</div></div>
            {zoom.faceLike && zoom.faceLike.length > 0 && <div className="error" style={{ marginTop: 8 }}>🧑‍🤝‍🧑 ใบหน้าคล้ายกับ: {zoom.faceLike.map((x) => `${x.name} (ห่าง ${x.dist})`).join(', ')} — {zoom.faceLike[0].dist <= s.faceDistance ? 'น่าจะเป็นคนเดียวกัน' : 'ใกล้เคียง ควรตรวจ'}</div>}
            {zoom.checks?.faceMissing && <div className="muted" style={{ marginTop: 6, fontSize: 13 }}>⚠️ ตรวจใบหน้าไม่ได้ (ไม่พบใบหน้าหรือโหลดโมเดลไม่สำเร็จ) ควรดูภาพด้วยตา</div>}
            {zoom.similarTo && zoom.similarTo.length > 0 && <div className="error" style={{ marginTop: 8 }}>⚠️ ภาพนี้คล้ายกับภาพของ: {zoom.similarTo.join(', ')} (ตรวจว่าเป็นภาพซ้ำหรือไม่)</div>}
            <div className="muted" style={{ fontSize: 13, marginTop: 6 }}>{zoom.checks?.ai ? `AI: ${zoom.checks.ai.person ? 'เห็นคน' : 'ไม่เห็นคน'} ${zoom.checks.ai.people ?? ''} คน · ${zoom.checks.ai.bg ?? ''}` : zoom.checks?.aiEnabled === false ? 'ตรวจด้วยพิกเซลอย่างเดียว (ยังไม่ตั้งค่า AI)' : ''}</div>
            <label className="lbl">ปฏิเสธภาพนี้ (ผู้ถ่ายจะได้รับ Pop-up พร้อมเหตุผล และถ่ายใหม่)</label>
            <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {['ไม่ใช่ใบหน้าของคุณเอง', 'ใบหน้าซ้ำกับสมาชิกคนอื่น', 'ภาพซ้ำกับของคนอื่น', 'ไม่เห็นหน้าชัดเจน', 'พื้นหลังไม่ใช่สีที่กำหนด'].map((r) => <button key={r} type="button" className={`btn small ghost${reason === r ? ' on' : ''}`} style={reason === r ? { borderColor: 'var(--forest)', background: '#e2f3dc' } : undefined} onClick={() => setReason(r)}>{r}</button>)}
            </div>
            <input className="field" placeholder="หรือพิมพ์เหตุผลเอง" value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
            <div className="row" style={{ marginTop: 12 }}>
              <button className="btn small danger" disabled={!reason.trim()} onClick={() => reject(zoom)}>❌ ปฏิเสธภาพนี้</button>
              {isAdmin && <button className="btn small ghost" onClick={() => { remove(zoom); setZoom(null); }}>ลบเฉยๆ (ไม่แจ้ง)</button>}
              <button className="btn small ghost" onClick={() => { setZoom(null); setReason(''); }}>ปิด</button>
            </div>
          </div>
        </div>
      )}

      <div className={`switch-card${s.live ? ' on' : ''}`} style={{ marginBottom: 14 }}>
        <div className="s-top"><div className="s-ic" style={{ background: s.color, color: '#fff' }}>🤳</div>
          <div><div className="s-title">Selfie Wall Mission · Agency in the Wonder Woods</div><div className="muted" style={{ fontSize: 14 }}>ภารกิจแรกหลังรวมทีม: ผู้เล่นทุกคนถ่าย Selfie กับฉากหลัง<strong>สีประจำทีม</strong> ≥ {s.percent}% ทีมที่ครบก่อนได้ {s.rewards.join(' › ')} Tokens</div></div>
          <span className="s-state">{stateText}</span></div>
        {isAdmin && (
          <div style={{ marginTop: 10 }}>
            <div className="lbl" style={{ margin: '0 0 6px' }}>เริ่มให้ใคร</div>
            <div className="tabs" role="radiogroup" aria-label="กลุ่มที่เริ่มเล่น" style={{ marginBottom: 8 }}>
              <button role="radio" aria-checked={test} className={test ? 'on' : ''} disabled={busy} onClick={() => setAudience('judges')}>👁 ทดสอบกรรมการ</button>
              <button role="radio" aria-checked={s.audience === 'teams'} className={s.audience === 'teams' ? 'on' : ''} disabled={busy} onClick={() => setAudience('teams')}>🎯 เลือกทีม</button>
              <button role="radio" aria-checked={s.audience === 'all'} className={s.audience === 'all' ? 'on' : ''} disabled={busy} onClick={() => setAudience('all')}>👥 ทุกทีม</button>
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 8 }}>{test
              ? 'ทดสอบ: เฉพาะกรรมการ/Committee (คณะทำงาน) เห็นและเล่นได้ ไม่มีคะแนน/Token ผู้เล่นทุกทีมไม่เห็นเมนูและไม่ได้รับแจ้งเตือน'
              : s.audience === 'teams'
                ? 'เลือกทีม: แจ้งเตือนและเปิดเมนูเฉพาะทีมที่กด "เริ่มทีมนี้" ด้านล่าง ทีมอื่นไม่เห็นอะไรเลย'
                : 'ทุกทีม: สมาชิกทุกทีมเห็นภารกิจและได้รับ Pop-up (ไม่รวมกรรมการ/Committee ซึ่งเป็นผู้สังเกตการณ์ ไม่นับคะแนน ไม่ขึ้น Team Wall และไม่ขึ้น Live)'}</div>
            {s.audience === 'teams' && (
              <div style={{ display: 'grid', gap: 6, marginBottom: 8 }}>
                {d.teams.map((t) => (
                  <div key={t.id} className="row" style={{ alignItems: 'center', gap: 8, background: t.active ? '#eef8ea' : '#f6f3ea', borderRadius: 12, padding: '6px 10px' }}>
                    <span style={{ width: 18, height: 18, borderRadius: '50%', background: t.color ?? s.color, border: '2px solid #fff', boxShadow: '0 0 0 2px #cfd6cf', flex: 'none' }} aria-hidden />
                    <strong style={{ flex: 1, minWidth: 80 }}>{t.name}</strong>
                    <span className="muted" style={{ fontSize: 13 }}>{t.active ? `🟢 เริ่มแล้ว${t.startedAt ? ' ' + fmt(t.startedAt) : ''}` : '⚪ ยังไม่เริ่ม'}</span>
                    <button className={`btn small ${t.active ? 'ghost' : 'green'}`} onClick={() => startTeam(t, !t.active)}>{t.active ? '⏹ หยุด' : '▶ เริ่มทีมนี้'}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
        {isAdmin && (
          <div className="row" style={{ marginTop: 2 }}>
            <button className={`btn small ${s.open ? 'danger' : 'green'}`} disabled={busy} onClick={() => set({ open: !s.open }, s.open ? 'ปิด Selfie Wall แล้ว' : test ? 'เปิดให้กรรมการทดสอบแล้ว (ไม่แจ้งเตือนผู้เล่นอื่น)' : s.audience === 'teams' ? 'เปิดภารกิจแล้ว (เฉพาะทีมที่เริ่มไว้จะเห็น Pop-up)' : 'เปิด Selfie Wall แล้ว ทุกทีมจะเห็น Pop-up')}>{s.open ? '⏹ ปิดภารกิจ' : test ? '▶ เปิดให้กรรมการทดสอบ' : s.audience === 'teams' ? '▶ เปิดภารกิจ (เฉพาะทีมที่เริ่ม)' : '▶ เปิดภารกิจ (ประกาศทุกทีม)'}</button>
            <button className="btn small ghost" disabled={busy || !s.open} onClick={() => set({ announce: true }, 'แจ้งเตือนผู้เล่นอีกครั้งแล้ว')}>📣 {test ? 'แจ้งกรรมการอีกครั้ง' : s.audience === 'teams' ? 'แจ้งทีมที่เริ่มอีกครั้ง' : 'แจ้งทุกทีมอีกครั้ง'}</button>
            <span className="muted" style={{ fontSize: 13 }}>{d.aiEnabled ? '🤖 AI ตรวจภาพ: เปิดใช้งาน' : '⚠️ ยังไม่ตั้งค่า ANTHROPIC_API_KEY ใน Vercel → ระบบจะตรวจเฉพาะสัดส่วนสีพื้นหลัง (ไม่ตรวจว่ามีหน้าคน)'}</span>
          </div>
        )}
      </div>

      {isAdmin && (
        <div className="card">
          <h2 style={{ marginTop: 0 }}>⚙️ ตั้งค่าภารกิจ</h2>
          <div className="row">
            <div><label className="lbl">เริ่ม (ว่าง = ทันทีที่เปิด)</label><input className="field" type="datetime-local" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
            <div><label className="lbl">สิ้นสุด (ว่าง = จนกว่าจะปิด)</label><input className="field" type="datetime-local" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
          </div>
          <label className="lbl">สีเริ่มต้น (ใช้กับกรรมการในโหมดทดสอบ และทีมที่ยังไม่ได้ตั้งสี)</label>
          <div className="row" style={{ alignItems: 'center' }}>
            <input type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ width: 56, height: 44, border: 0, background: 'none' }} aria-label="เลือกสี" />
            <input className="field" style={{ width: 120 }} value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
            <strong>{colorName(f.color.length === 7 ? f.color : '#000000')}</strong>
            <div className="row" style={{ gap: 6 }}>{PRESETS.map(([c, n]) => <button key={c} type="button" title={n} onClick={() => setF({ ...f, color: c })} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: f.color === c ? '3px solid #1f3557' : '2px solid #ddd', cursor: 'pointer' }} aria-label={n} />)}</div>
          </div>
          <div className="row">
            <div><label className="lbl">พื้นหลังต้องเป็นสีนี้อย่างน้อย (%)</label><input className="field" style={{ width: 120 }} type="number" min={1} max={100} value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} /></div>
            <div><label className="lbl">ความยืดหยุ่นของสี (ΔE 5–100 · แนะนำ 25–40)</label><input className="field" style={{ width: 120 }} type="number" min={5} max={100} value={f.tolerance} onChange={(e) => setF({ ...f, tolerance: e.target.value })} /></div>
          </div>
          <label className="lbl">ตรวจใบหน้าซ้ำ (กันการส่งภาพแทนกัน)</label>
          <div className="tabs" role="radiogroup" aria-label="โหมดตรวจใบหน้าซ้ำ" style={{ marginBottom: 6 }}>
            {([['block', '⛔ บล็อกอัตโนมัติ'], ['flag', '⚠️ ให้ Admin ตรวจ'], ['off', '⚪ ปิด']] as const).map(([k, l]) => (
              <button key={k} role="radio" aria-checked={f.faceMode === k} className={f.faceMode === k ? 'on' : ''} onClick={() => setF({ ...f, faceMode: k })}>{l}</button>
            ))}
          </div>
          <div className="row">
            <div><label className="lbl">เกณฑ์ความเหมือนของใบหน้า (0.25–0.65 · ยิ่งน้อยยิ่งเข้ม · แนะนำ 0.45)</label><input className="field" style={{ width: 120 }} type="number" step="0.01" min={0.25} max={0.65} value={f.faceDistance} onChange={(e) => setF({ ...f, faceDistance: e.target.value })} /></div>
            <div className="muted" style={{ fontSize: 13, flex: 1, minWidth: 220 }}>คนเดียวกันมักห่างกัน 0.2–0.4 คนละคนมัก 0.6 ขึ้นไป · <strong>บล็อก</strong> = ส่งไม่ได้ถ้าใบหน้าซ้ำกับคนอื่น · <strong>ให้ Admin ตรวจ</strong> = ส่งได้แต่ติดป้ายเตือนให้คุณกดปฏิเสธเอง · ข้อมูลใบหน้าเป็นเพียงตัวเลข คำนวณบนมือถือผู้เล่น และถูกลบพร้อมภาพ</div>
          </div>
          <label className="lbl">รางวัลตามลำดับทีมที่ครบ (Tokens)</label>
          <div className="row">{f.rewards.map((v, i) => <div key={i}><div className="muted" style={{ fontSize: 12 }}>อันดับ {i + 1}</div><input className="field" style={{ width: 90 }} type="number" min={0} value={v} onChange={(e) => setF({ ...f, rewards: f.rewards.map((x, k) => (k === i ? e.target.value : x)) })} /></div>)}</div>
          <div className="row" style={{ marginTop: 12 }}><button className="btn small" disabled={busy} onClick={save}>บันทึกการตั้งค่า</button>
            <span className="muted" style={{ fontSize: 13 }}>ผู้เล่นเห็น Pop-up ตอนเปิดภารกิจ และทุกครั้งที่ทีมคืบหน้า · คณะทำงาน (observer) ติดภาพได้แต่ไม่นับคะแนน</span></div>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>🎨 สีประจำทีม</h2>
          {isAdmin && <button className="btn small" disabled={busy} onClick={randomColors}>🎲 สุ่มสีให้ทุกทีม (ไม่ซ้ำกัน)</button>}
        </div>
        <p className="muted" style={{ margin: '6px 0 10px', fontSize: 14 }}>แต่ละทีมได้ฉากหลังคนละสี ไม่ซ้ำกัน และต้องต่างกันชัดเจน (ภาพเดียวจะไม่ผ่านสองทีม) หลีกเลี่ยงสีใกล้สีผิว เพราะใบหน้าจะนับเป็นพื้นหลัง</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {d.teams.map((t) => (
            <div key={t.id} className="row" style={{ alignItems: 'center', gap: 10 }}>
              <span style={{ width: 28, height: 28, borderRadius: '50%', background: t.color ?? s.color, border: '3px solid #fff', boxShadow: '0 0 0 2px #cfd6cf', flex: 'none', opacity: t.color ? 1 : .45 }} aria-hidden />
              <strong style={{ minWidth: 110 }}>{t.name}</strong>
              <span className="muted" style={{ minWidth: 90 }}>{t.color ? colorName(t.color) : `ใช้สีเริ่มต้น`}</span>
              {isAdmin && (
                <div className="row" style={{ gap: 6, flexWrap: 'wrap' }}>
                  {d.palette.map((c) => {
                    const used = d.teams.find((x) => x.id !== t.id && x.color === c);
                    return <button key={c} type="button" disabled={!!used} title={used ? `${used.name} ใช้อยู่` : colorName(c)} aria-label={`${colorName(c)}${used ? ` (${used.name} ใช้อยู่)` : ''}`}
                      onClick={() => teamColor(t.id, c)} style={{ width: 30, height: 30, borderRadius: '50%', background: c, border: t.color === c ? '3px solid #1f3557' : '2px solid #ddd', cursor: used ? 'not-allowed' : 'pointer', opacity: used ? .25 : 1 }} />;
                  })}
                  <input type="color" value={t.color ?? s.color} aria-label={`เลือกสีเองให้ทีม ${t.name}`} onChange={(e) => teamColor(t.id, e.target.value)} style={{ width: 34, height: 34, border: 0, background: 'none', padding: 0 }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {isAdmin && (
        <div className="card">
          <h2 style={{ margin: 0 }}>🧪 ทีมกรรมการ / ทีมทดสอบ <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>(ไม่นับคะแนน)</span></h2>
          <p className="muted" style={{ margin: '6px 0 10px', fontSize: 14 }}>ทีมที่ติ๊กไว้ เช่น กลุ่ม Committee ที่มีหลายคน จะ <strong>ไม่มีอันดับ ไม่ได้ Token ไม่อยู่ในยอดรวม ไม่ได้รับ Pop-up ในช่วงจริง และไม่ขึ้น Team Wall</strong> สมาชิกทุกคนทดสอบบน Team Wall ของกรรมการแทน (เหมือนคณะทำงาน)</p>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
            {d.allTeams.map((t) => (
              <button key={t.id} type="button" role="switch" aria-checked={t.excluded} onClick={() => exclude(t, !t.excluded)}
                style={{ border: t.excluded ? '2px solid #7c4dff' : '2px solid #dcd6c6', background: t.excluded ? '#efe9ff' : '#fff', borderRadius: 12, padding: '8px 12px', cursor: 'pointer', textAlign: 'left', minHeight: 44 }}>
                <strong>{t.excluded ? '🧪 ' : ''}{t.name}</strong>
                <div className="muted" style={{ fontSize: 12 }}>{t.members} คน · {t.excluded ? 'ทีมกรรมการ/ทดสอบ (ไม่นับคะแนน)' : 'ทีมผู้เล่นปกติ'}</div>
              </button>
            ))}
          </div>
        </div>
      )}

      {d.judges.total > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}>🧪 Team Wall ทดสอบ (กรรมการ/Committee/ทีมทดสอบ) <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>{d.judges.count}/{d.judges.total} คน · ไม่มีคะแนน</span></h2>
            {isAdmin && d.judges.count > 0 && <button className="btn small ghost" onClick={clearTest}>ล้างภาพทดสอบ</button>}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8, marginTop: 10 }}>
            {d.judges.members.map((m) => <MemberTile key={m.id} m={m} color={s.color} onZoom={setZoom} />)}
          </div>
        </div>
      )}

      <div className="stats">
        <div className="stat"><b>{d.teams.reduce((n, t) => n + t.count, 0)}/{d.teams.reduce((n, t) => n + t.total, 0)}</b><span>ผู้เล่นที่ถ่ายแล้ว (ไม่นับกรรมการ/Committee)</span></div>
        <div className="stat"><b>{done.length}/{d.teams.length}</b><span>ทีมที่ครบแล้ว</span></div>
        <div className="stat"><b>🪙 {done.reduce((n, t) => n + t.tokens, 0)}</b><span>Tokens ที่แจกไปแล้ว</span></div>
      </div>
      {done.length > 0 && <div className="card"><h2 style={{ marginTop: 0 }}>🏁 ลำดับทีมที่ครบ</h2><ol style={{ margin: 0, paddingLeft: 22 }}>{done.map((t) => <li key={t.id}><strong>{t.name}</strong> · +{t.tokens} Tokens · {fmt(t.completedAt)}</li>)}</ol></div>}

      {d.teams.map((t) => (
        <div className="card" key={t.id}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ margin: 0 }}><span style={{ display: 'inline-block', width: 16, height: 16, borderRadius: '50%', background: t.color ?? s.color, border: '2px solid #fff', boxShadow: '0 0 0 2px #cfd6cf', marginRight: 8, verticalAlign: 'middle' }} aria-hidden />{t.name} <span className="muted" style={{ fontWeight: 400, fontSize: 15 }}>{t.count}/{t.total} คน</span></h2>
            {t.complete ? <span className="pill" style={{ background: '#cfe9c9' }}>✅ อันดับ {t.rank} · +{t.tokens}</span> : s.audience === 'teams' && !t.active ? <span className="pill" style={{ background: '#eee' }}>ยังไม่เริ่ม</span> : <span className="pill" style={{ background: '#f4ead0' }}>{t.total ? Math.round((t.count / t.total) * 100) : 0}%</span>}
          </div>
          <div className="progress" style={{ margin: '8px 0 10px' }}><i style={{ width: `${t.total ? (t.count / t.total) * 100 : 0}%` }} /></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
            {t.members.map((m) => <MemberTile key={m.id} m={m} color={t.color ?? s.color} onZoom={setZoom} />)}
          </div>
        </div>
      ))}
    </>
  );
}

/** One member on an admin Team Wall: photo, nickname and real name (one line each, shrunk to fit) and a flag when the picture resembles someone else's. */
function MemberTile({ m, color, onZoom }: { m: Member; color: string; onZoom: (m: Member) => void }) {
  const real = m.fullName && m.fullName.trim() !== m.name.trim() ? m.fullName : '\u00a0';
  const flag = (m.similarTo?.length ?? 0) > 0 || (m.faceLike?.length ?? 0) > 0;
  return (
    <div style={{ textAlign: 'center', minWidth: 0 }}>
      <button type="button" onClick={() => m.photoUrl && onZoom(m)} disabled={!m.photoUrl} aria-label={m.name}
        style={{ position: 'relative', width: '100%', aspectRatio: '3 / 4', borderRadius: 10, border: flag ? '3px solid #e0573b' : m.photoUrl ? `3px solid ${color}` : '2px dashed #ccc', background: m.photoUrl ? `url(${m.photoUrl}) center/cover` : '#eee', cursor: m.photoUrl ? 'zoom-in' : 'default', padding: 0 }}>
        {!m.photoUrl && <span className="muted" style={{ fontSize: 22 }}>👤</span>}
        {m.checks?.source === 'gallery' && <span title="เลือกจากรูปในเครื่อง" style={{ position: 'absolute', bottom: 4, left: 4, background: 'rgba(31,53,87,.85)', color: '#fff', borderRadius: 8, fontSize: 11, padding: '1px 5px' }}>🖼️</span>}
        {flag && <span title={`คล้ายกับ ${[...(m.similarTo ?? []), ...(m.faceLike ?? []).map((x) => x.name)].join(', ')}`} style={{ position: 'absolute', top: 4, right: 4, background: '#e0573b', color: '#fff', borderRadius: 8, fontSize: 11, padding: '1px 5px' }}>{(m.faceLike?.length ?? 0) > 0 ? '👥 หน้าซ้ำ?' : '⚠️ คล้าย'}</span>}
      </button>
      <FitLine text={m.name} base={12.5} min={8} style={{ fontWeight: 700, marginTop: 3 }} />
      <FitLine text={real} base={11} min={7} className="muted" />
      {m.photoUrl && <div className="muted" style={{ fontSize: 10.5 }}>{m.pct}%</div>}
    </div>
  );
}
