'use client';

import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import LineLogo from '@/components/LineLogo';
import { api } from '@/lib/client-api';
import { isLineGroupUrl, type LineStatus } from '@/lib/line-types';

type Props = {
  status: LineStatus;
  onRefresh: () => Promise<unknown>;
  onAuthLost: (error: unknown) => void;
};
type Invitation = {
  busy: boolean;
  error: string;
  promptOpen: boolean;
  isObserver: boolean;
  open: () => void;
};
const LineInvitationContext = createContext<Invitation | null>(null);
export const useLineInvitation = () => useContext(LineInvitationContext);

/** Keep the invitation above every player screen, without replacing an active game. */
export function LineInvitationProvider({ status, onRefresh, onAuthLost, children }: Omit<Props, 'status'> & {
  status: LineStatus | null;
  children: React.ReactNode;
}) {
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const joining = useRef(false);
  const revision = status?.revision ?? 1;
  const identity = status?.group ? `${status.group}:${revision}` : null;
  const available = !!status?.open && !!status.configured && !!status.group;
  const promptOpen = available && !status?.joined && dismissed !== identity;
  const groupName = status?.groupName || status?.group || '';

  useEffect(() => {
    if (!status) setDismissed(null);
  }, [status]);
  useEffect(() => { setError(''); }, [identity]);

  async function join() {
    if (!available || joining.current) return;
    joining.current = true;
    setBusy(true); setError('');
    try {
      const result = await api<{ url: string }>('/api/line/join', {});
      if (!isLineGroupUrl(result.url)) throw new Error('ลิงก์กลุ่ม LINE ไม่ถูกต้อง กรุณาติดต่อทีมงาน');
      await onRefresh().catch(() => {});
      window.location.assign(result.url);
    } catch (err) {
      onAuthLost(err);
      setError(err instanceof Error ? err.message : 'เปิดกลุ่ม LINE ไม่สำเร็จ กรุณาลองใหม่');
      void onRefresh().catch(() => {});
    } finally { joining.current = false; setBusy(false); }
  }
  const open = () => {
    if (!available || busy) return;
    if (status?.joined) void join();
    else { setError(''); setDismissed(null); }
  };
  return (
    <LineInvitationContext.Provider value={{ busy, error, promptOpen, isObserver: !!status?.isObserver, open }}>
      {children}
      {promptOpen && status && <JoinPrompt key={identity} group={groupName} status={status} busy={busy} error={error}
        onJoin={join} onClose={() => setDismissed(identity)} />}
    </LineInvitationContext.Provider>
  );
}

/** The recorded check-in is the invitation click; LINE opens after the server saves it. */
export default function LineCheckin(props: Props) {
  const invitation = useLineInvitation();
  if (!invitation) return <LineInvitationProvider {...props}><LineShortcut status={props.status} /></LineInvitationProvider>;
  return <LineShortcut status={props.status} />;
}

function LineShortcut({ status }: { status: LineStatus }) {
  const invitation = useLineInvitation()!;
  const available = status.open && status.configured && !!status.group;
  const groupName = status.groupName || status.group;
  const buttonTitle = groupName ? `กลุ่ม LINE · ${groupName}` : 'กลุ่ม LINE';
  const buttonStatus = invitation.busy ? 'กำลังเชื่อมต่อ…' : !status.open ? 'ยังไม่เปิดใช้งาน'
    : !status.configured ? 'รอทีมงานกำหนดกลุ่ม' : status.joined ? '✓ เข้า LINE แล้ว'
      : status.rejoinRequired ? 'มีลิงก์ใหม่ · กรุณาเข้ากลุ่มอีกครั้ง' : 'แตะเพื่อเข้าร่วมกลุ่ม';
  return (
    <section className="line-entry" aria-label="กลุ่ม LINE ของคุณ">
      {!invitation.promptOpen && invitation.error && <div className="error" role="alert" style={{ marginBottom: 10 }}>{invitation.error}</div>}
      <button className="btn line-entry-button" disabled={!available || invitation.busy}
        aria-label={`${status.joined ? 'เปิด' : 'เข้าร่วม'}กลุ่ม LINE${groupName ? ` ${groupName}` : ''}`} onClick={invitation.open}>
        <span className="line-entry-icon" aria-hidden><LineLogo /></span>
        <span className="line-entry-text"><span className="line-entry-title">{buttonTitle}</span><span className="line-entry-status">{buttonStatus}</span></span>
        <span className="line-entry-arrow" aria-hidden>›</span>
      </button>
    </section>
  );
}

function JoinPrompt({ group, status, busy, error, onJoin, onClose }: {
  group: string;
  status: LineStatus;
  busy: boolean;
  error: string;
  onJoin: () => Promise<void>;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    firstButton.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div className="player-dialog-overlay line-invitation-overlay" style={{ position: 'fixed', inset: 0, background: 'rgba(75,51,27,.65)', display: 'grid', placeItems: 'center', zIndex: 120 }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        tabIndex={-1} className="card center stack player-dialog-panel line-invitation-dialog"
        style={{ width: '100%', maxWidth: 420, margin: 0, border: '3px solid #b9b77a', overflowWrap: 'anywhere' }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.preventDefault(); onClose(); }
          if (event.key !== 'Tab') return;
          const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
          const first = buttons[0], last = buttons[buttons.length - 1];
          if (!first) { event.preventDefault(); dialog.current?.focus(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
            event.preventDefault(); first.focus();
          }
        }}>
        <div style={{ display: 'flex', justifyContent: 'center' }}><LineLogo size={64} /></div>
        <h2 id={titleId} style={{ margin: 0 }}>{status.rejoinRequired ? 'ทีมงานอัปเดตลิงก์ LINE' : 'เข้ากลุ่ม LINE ของทีม'}</h2>
        <strong className="line-group-heading">{group}</strong>
        <p id={descriptionId} className="muted" style={{ margin: 0 }}>
          {status.rejoinRequired ? 'กรุณากดเปิดลิงก์ใหม่และเข้าร่วมกลุ่มอีกครั้ง เพื่อรับข่าวสารล่าสุดของทีม' : 'กดปุ่มด้านล่าง แล้วกดเข้าร่วมในแอป LINE จากนั้นกลับมาใช้งาน Food Camp ได้เลย'}
        </p>
        {status.isObserver ? <div className="observer-note">คุณเป็นคณะทำงาน สามารถเข้ากลุ่มเพื่อติดตามทีมได้ การเข้าของคุณไม่รวมในจำนวนสมาชิกหรือคะแนนทีม</div> : (status.complete || status.rewardPreviouslyEarned) ? (
          <div className="line-reward-note">ทีมได้รับรางวัล {status.tokens} Tokens แล้ว การเปิดลิงก์ใหม่นี้จะไม่ให้คะแนนซ้ำ</div>
        ) : <div className="line-reward-note">
          <strong>ทีมได้รับ Tokens เมื่อสมาชิกเข้าครบทุกคน</strong>
          <div className="line-reward-ranks" aria-label="รางวัลตามลำดับทีมที่เข้าครบ">
            {[20, 15, 10, 5].map((tokens, index) => <div key={tokens}><span>อันดับ {index + 1}</span><strong>{tokens}</strong><small>Tokens / ทีม</small></div>)}
          </div>
          {typeof status.nextRewardTokens === 'number' && status.nextRewardTokens > 0 && <p style={{ margin: '8px 0 0' }}>หากทีมเข้าครบเป็นทีมถัดไป จะได้รับ <strong>{status.nextRewardTokens} Tokens</strong></p>}
          <p style={{ margin: '8px 0 0', fontSize: 13 }}>ให้คะแนนเข้ากระเป๋าทีมครั้งเดียว ไม่ใช่คะแนนรายคน · ไม่รวมคณะทำงานในการนับจำนวน</p>
        </div>}
        {error && <div className="error" role="alert">{error}</div>}
        <button ref={firstButton} className="btn line-invitation-action" disabled={busy} onClick={() => void onJoin()}>
          {busy ? 'กำลังเชื่อมต่อ…' : `เชื่อมต่อ LINE กลุ่ม ${group}`}
        </button>
        <button className="btn ghost" onClick={onClose}>ไว้ทีหลัง</button>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>
          ระบบจะบันทึกการกด แล้วเปิด LINE ให้คุณกดเข้าร่วมกลุ่ม
        </p>
      </div>
    </div>
  );
}
