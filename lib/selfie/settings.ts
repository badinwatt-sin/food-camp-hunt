/** Selfie-wall settings as stored in game_settings, and the helpers both the API and the admin share. */
export type SelfieSettingsRow = {
  selfie_open?: boolean | null; selfie_start?: string | null; selfie_end?: string | null; selfie_color?: string | null;
  selfie_percent?: number | null; selfie_tolerance?: number | null; selfie_rewards?: string | null; selfie_announced_at?: string | null;
};
export const SELFIE_SETTINGS_SELECT = 'selfie_open, selfie_start, selfie_end, selfie_color, selfie_percent, selfie_tolerance, selfie_rewards, selfie_announced_at';

export const parseRewards = (s: string | null | undefined): number[] =>
  (s ?? '20,15,10,5').split(',').map((x) => Math.max(0, parseInt(x.trim(), 10) || 0)).slice(0, 8);

export function selfieWindow(s: SelfieSettingsRow | null | undefined, now = Date.now()) {
  const start = s?.selfie_start ? new Date(s.selfie_start).getTime() : null;
  const end = s?.selfie_end ? new Date(s.selfie_end).getTime() : null;
  const on = s?.selfie_open === true;
  const before = start !== null && now < start;
  const after = end !== null && now > end;
  return { on, before, after, live: on && !before && !after, start: s?.selfie_start ?? null, end: s?.selfie_end ?? null };
}

export function publicSettings(s: SelfieSettingsRow | null | undefined) {
  const w = selfieWindow(s);
  return {
    open: w.on, live: w.live, before: w.before, after: w.after, start: w.start, end: w.end,
    color: (s?.selfie_color ?? '#2f8f5b').toLowerCase(), percent: s?.selfie_percent ?? 60, tolerance: s?.selfie_tolerance ?? 32,
    rewards: parseRewards(s?.selfie_rewards), announcedAt: s?.selfie_announced_at ?? null,
  };
}
