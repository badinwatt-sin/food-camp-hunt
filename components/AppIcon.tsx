import type { ReactNode } from 'react';

const paths: Record<string, ReactNode> = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  home: <><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z" /></>,
  missions: <><path d="M5 21V4m0 0c5-5 9 5 15 0v10c-6 5-10-5-15 0" /></>,
  team: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-3-5" /></>,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-2a6 6 0 0 1 12 0v2m1-16a3 3 0 0 1 0 6m3 10v-2a6 6 0 0 0-3-5" /></>,
  shop: <><path d="M4 7h16l1 14H3L4 7Z" /><path d="M8 8V6a4 4 0 0 1 8 0v2" /></>,
  quiz: <><rect x="4" y="3" width="16" height="18" rx="3" /><path d="M9 8a3 3 0 0 1 6 0c0 2-3 2-3 4m0 4h.01" /></>,
  weekly: <><rect x="3" y="5" width="18" height="16" rx="3" /><path d="M7 3v4m10-4v4M3 10h18m-13 5 3 3 5-5" /></>,
  hunt: <><circle cx="12" cy="12" r="9" /><path d="m16 8-3 5-5 3 3-5 5-3Z" /></>,
  camera: <><path d="M8 5 6 8H3v12h18V8h-3l-2-3H8Z" /><circle cx="12" cy="13" r="3" /></>,
  checkin: <><path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z" /><path d="m9 10 2 2 4-4" /></>,
  history: <><path d="M3 11a9 9 0 1 1 3 8M3 4v7h7m2-5v6l4 2" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
  logout: <><path d="M9 3H4v18h5m6-15 6 6-6 6m-6-6h12" /></>,
  back: <><path d="m10 5-7 7 7 7M3 12h18" /></>,
  shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" /><path d="m8 12 3 3 5-6" /></>,
  settings: <><circle cx="12" cy="12" r="4" /><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M5 19l2-2M17 7l2-2" /></>,
  check: <><path d="m4 12 5 5L20 6" /></>,
  chevron: <><path d="m9 5 7 7-7 7" /></>,
  close: <><path d="m5 5 14 14M5 19 19 5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6v6l4 2" /></>,
  trophy: <><path d="M7 3h10v6a5 5 0 0 1-10 0V3ZM7 5H3v3a4 4 0 0 0 4 4m10-7h4v3a4 4 0 0 1-4 4m-5 2v7m-4 0h8" /></>,
  plus: <><path d="M12 4v16M4 12h16" /></>,
  scan: <><path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M3 12h18" /></>,
  refresh: <><path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10h.01" /></>,
  warning: <><path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01" /></>,
  edit: <><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z" /></>,
  token: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="5" /></>,
};

/** Decorative interface icon; accessible names stay on the surrounding control. */
export default function AppIcon({ name, size = 20, className = '' }: { name: string; size?: number; className?: string }) {
  if (name === 'line') return <img src="/line-logo.svg" width={size} height={size} className={`app-icon ${className}`} alt="" aria-hidden="true" />;
  return <svg className={`app-icon ${className}`} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{paths[name] ?? paths.info}</svg>;
}
