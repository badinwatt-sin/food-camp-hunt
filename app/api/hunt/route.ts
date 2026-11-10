import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { teamGoal } from '@/lib/goal';
import { handler, HttpError, ok } from '@/lib/http';
import { groupMembers } from '@/lib/group';

export const dynamic = 'force-dynamic';

/**
 * Hunt progress. A spot counts as "found" per SQUAD (people without a squad: per team).
 * Secrets are never sent to the phone.
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const { data: settings, error: settingsError } = await sb.from('game_settings').select('hunt_open').eq('id', 1).single();
  if (settingsError) throw settingsError;
  if (!settings?.hunt_open) throw new HttpError(403, 'HUNT_CLOSED');
  const squadId: string | null = p.squad_id ?? null;
  const [{ data: spots }, { data: claims }, { data: squads }, balance, goal, members, { data: scans }] = await Promise.all([
    sb.from('hunt_spots').select('id, position, title, hint, tokens, min_players, window_sec').eq('active', true).order('position').order('id'),
    sb.from('hunt_claims').select('spot_id, squad_id, participants(name, nick_name)').eq('team_id', p.team_id),
    sb.from('squads').select('id, name').eq('team_id', p.team_id).order('name'),
    sb.rpc('team_balance', { p_team: p.team_id }),
    teamGoal(p.team_id),
    groupMembers(p),
    sb.from('hunt_scans').select('spot_id, participant_id, scanned_at, squad_id').eq('team_id', p.team_id),
  ]);
  const activeIds = new Set((spots ?? []).map((s: any) => s.id));
  const mine = new Map((claims ?? []).filter((c: any) => (c.squad_id ?? null) === squadId).map((c: any) => [c.spot_id, c]));
  const list = (spots ?? []).map((s: any) => {
    const c: any = mine.get(s.id);
    // Co-op spot: several group members must scan within the time window.
    const need = Math.min(s.min_players, members.length);
    const live = (scans ?? []).filter((x: any) => x.spot_id === s.id && (x.squad_id ?? null) === squadId
      && Date.now() - new Date(x.scanned_at).getTime() < s.window_sec * 1000);
    const coop = s.min_players > 1 && need > 1;
    return {
      id: s.id, title: s.title, tokens: s.tokens, hint: c ? '' : s.hint, found: !!c, foundBy: c?.participants?.nick_name || c?.participants?.name || null,
      coop: coop ? { need, windowSec: s.window_sec, have: c ? 0 : live.length, iScanned: live.some((x: any) => x.participant_id === p.id) } : null,
    };
  });
  // Friendly in-team scoreboard: how many spots each squad has found.
  const board = (squads ?? []).map((s: any) => ({
    id: s.id, name: s.name, mine: s.id === squadId,
    found: (claims ?? []).filter((c: any) => c.squad_id === s.id && activeIds.has(c.spot_id)).length,
  })).sort((a: any, b: any) => b.found - a.found || a.name.localeCompare(b.name));
  return ok({
    open: !!settings?.hunt_open,
    team: { name: p.teams?.name ?? '', balance: balance.data ?? 0 },
    squad: p.squads?.name ?? null,
    groupSize: members.length,
    squads: board,
    goal,
    spots: list,
    found: list.filter((s) => s.found).length,
    earned: list.filter((s) => s.found).reduce((n, s) => n + s.tokens, 0),
  });
});
