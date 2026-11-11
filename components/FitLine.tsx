'use client';
import { useLayoutEffect, useRef, useState } from 'react';

/**
 * One line of text that never wraps and never runs out of its box.
 * It starts at `base` px; only when the text is too wide does it shrink (down to `min`), so every name
 * that fits is shown at exactly the same size and only the long ones get smaller. "…" is the last resort.
 */
export default function FitLine({ text, base, min = 8, className, style }: { text: string; base: number; min?: number; className?: string; style?: React.CSSProperties }) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(base);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let lastW = -1;
    const fit = () => {
      if (el.clientWidth === lastW && size !== base) return;
      lastW = el.clientWidth;
      let s = base;
      el.style.fontSize = `${s}px`;
      while (el.scrollWidth > el.clientWidth + 0.5 && s > min) { s -= 0.5; el.style.fontSize = `${s}px`; }
      setSize(s);
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    document.fonts?.ready.then(fit).catch(() => {});
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, base, min]);
  return <div ref={ref} className={className} title={text} style={{ ...style, fontSize: size, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', lineHeight: 1.3 }}>{text}</div>;
}
