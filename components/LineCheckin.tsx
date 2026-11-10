'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { api } from '@/lib/client-api';
import { isLineGroupUrl, type LineStatus } from '@/lib/line-types';

type Props = {
  status: LineStatus;
  onRefresh: () => Promise<unknown>;
  onAuthLost: (error: unknown) => void;
  onPromptChange?: (open: boolean) => void;
};

/** The recorded check-in is the invitation click; LINE opens after the server saves it. */
export default function LineCheckin({ status, onRefresh, onAuthLost, onPromptChange }: Props) {
  const [dismissedGroup, setDismissedGroup] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const joining = useRef(false);
  const available = status.open && status.configured && !!status.group;
  const showPrompt = available && !status.joined && dismissedGroup !== status.group;
  const closePrompt = useCallback(() => setDismissedGroup(status.group), [status.group]);
  const groupName = status.groupName || status.group;
  const buttonTitle = groupName ? `กลุ่ม LINE · ${groupName}` : 'กลุ่ม LINE';

  useEffect(() => {
    onPromptChange?.(showPrompt);
    return () => onPromptChange?.(false);
  }, [showPrompt, onPromptChange]);

  async function join() {
    if (!available || joining.current) return;
    joining.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await api<{ url: string }>('/api/line/join', {});
      if (!isLineGroupUrl(result.url)) throw new Error('ลิงก์กลุ่ม LINE ไม่ถูกต้อง กรุณาติดต่อทีมงาน');
      await onRefresh().catch(() => {});
      window.location.assign(result.url);
    } catch (err) {
      onAuthLost(err);
      setError(err instanceof Error ? err.message : 'เปิดกลุ่ม LINE ไม่สำเร็จ กรุณาลองใหม่');
      void onRefresh().catch(() => {});
    } finally {
      joining.current = false;
      setBusy(false);
    }
  }

  const buttonStatus = busy ? 'กำลังเชื่อมต่อ…' : !status.open ? 'ยังไม่เปิดใช้งาน'
    : !status.configured ? 'รอทีมงานกำหนดกลุ่ม' : status.joined ? '✓ เข้า LINE แล้ว' : 'แตะเพื่อเข้าร่วมกลุ่ม';

  return (
    <section className="line-entry" aria-label="กลุ่ม LINE ของคุณ">
      {!showPrompt && error && <div className="error" role="alert" style={{ marginBottom: 10 }}>{error}</div>}
      <button className="btn line-entry-button" disabled={!available || busy}
        aria-label={`${status.joined ? 'เปิด' : 'เข้าร่วม'}กลุ่ม LINE${groupName ? ` ${groupName}` : ''}`}
        onClick={() => { if (status.joined) void join(); else { setError(''); setDismissedGroup(null); } }}>
        <span className="line-entry-icon" aria-hidden>💬</span>
        <span className="line-entry-text">
          <span className="line-entry-title">{buttonTitle}</span>
          <span className="line-entry-status">{buttonStatus}</span>
        </span>
        <span className="line-entry-arrow" aria-hidden>›</span>
      </button>
      {showPrompt && <JoinPrompt group={groupName!} busy={busy} error={error} onJoin={join} onClose={closePrompt} />}
    </section>
  );
}

function JoinPrompt({ group, busy, error, onJoin, onClose }: {
  group: string;
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
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(31,47,77,.65)', display: 'grid', placeItems: 'center', padding: 18, zIndex: 120 }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}
        tabIndex={-1} className="card center stack"
        style={{ width: '100%', maxWidth: 420, margin: 0, border: '3px solid #8ac49c', maxHeight: 'calc(100dvh - 36px)', overflowY: 'auto', overflowWrap: 'anywhere' }}
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
        <div aria-hidden style={{ fontSize: 56, lineHeight: 1 }}>💬</div>
        <h2 id={titleId} style={{ margin: 0 }}>เช็กอินเข้ากลุ่ม LINE {group}</h2>
        <p id={descriptionId} className="muted" style={{ margin: 0 }}>
          ยินดีต้อนรับสู่ Food Camp! กดเชื่อมต่อกลุ่ม LINE ที่ทีมงานจัดไว้ให้ เพื่อรับข่าวสารและทำภารกิจร่วมกับทีม
        </p>
        <div style={{ background: '#edf6ed', padding: 12, borderRadius: 12, fontSize: 15 }}>
          ทีมที่สมาชิกกดเข้าครบก่อน รับ 20 Tokens<br />อันดับถัดไปได้รับ 15 · 10 · 5 Tokens
        </div>
        {error && <div className="error" role="alert">{error}</div>}
        <button ref={firstButton} className="btn" disabled={busy} onClick={() => void onJoin()}>
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
