'use client';

import { useEffect, useRef } from 'react';

/** Refresh read data without remounting forms or interrupting an active game. */
export function useVisibleRefresh(refresh: () => Promise<unknown>, enabled = true) {
  const callback = useRef(refresh);
  callback.current = refresh;

  useEffect(() => {
    if (!enabled) return;
    let busy = false;
    const tick = () => {
      if (document.visibilityState !== 'visible' || busy) return;
      busy = true;
      // Callers report their own errors and retain the last successful data.
      Promise.resolve().then(() => callback.current()).catch(() => {}).finally(() => { busy = false; });
    };
    const timer = window.setInterval(tick, 15000);
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled]);
}
