/** LINE check-in records the player's click on the assigned invitation, not LINE membership. */
export const LINE_GROUP_CODES = ['D', 'C', 'A', 'O'] as const;
export type LineGroupCode = typeof LINE_GROUP_CODES[number];

export type LineStatus = {
  open: boolean;
  configured: boolean;
  group: LineGroupCode | null;
  /** Editable label; the stable group code still controls assignment and ranking. */
  groupName?: string | null;
  url: string | null;
  joined: boolean;
  joinedAt: string | null;
  total: number;
  joinedCount: number;
  complete: boolean;
  rank: number | null;
  tokens: number;
  members: { name: string; joined: boolean; isMe: boolean }[];
};

export function isLineGroupUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return value.length <= 2000 && /^https:\/\/(line\.me|lin\.ee)\/[^\s?#]/i.test(value)
      && u.protocol === 'https:' && (u.hostname === 'line.me' || u.hostname === 'lin.ee')
      && !u.username && !u.password && !u.port && u.pathname.length > 1 && !/\s/.test(value);
  } catch {
    return false;
  }
}
