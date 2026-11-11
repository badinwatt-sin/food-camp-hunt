import 'server-only';
import { db } from './supabase';

export type NotifyKind = 'info' | 'announce' | 'photo' | 'selfie' | 'hunt' | 'shop' | 'checkin';
type Note = {
  audience: 'all' | 'team' | 'user' | 'admin';
  teamId?: string | null; participantId?: string | null;
  kind?: NotifyKind; title: string; body?: string; link?: string;
};

/**
 * Writes one message into the bell. Best effort: a bell problem (or a database that has not been upgraded yet)
 * must never make the real action fail, so errors are swallowed.
 */
export async function notify(n: Note): Promise<void> {
  try {
    await db().from('notifications').insert({
      audience: n.audience, team_id: n.teamId ?? null, participant_id: n.participantId ?? null,
      kind: n.kind ?? 'info', title: n.title.slice(0, 160), body: (n.body ?? '').slice(0, 400), link: n.link ?? null,
    });
  } catch { /* ignore */ }
}

/** Several at once (e.g. the same news for the team and for the organisers). */
export const notifyAll = (list: Note[]) => Promise.all(list.map(notify)).then(() => undefined);
