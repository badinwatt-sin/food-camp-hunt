import 'server-only';
import { db } from './supabase';

export type TeamGoal = { goalPct: number; completed: number; participants: number; met: boolean; need: number };

/** Same rule as the database function team_goal_met(): goal 0 = off (always met). */
export function goalStatus(goalPct: number, completed: number, participants: number): TeamGoal {
  const need = goalPct > 0 ? Math.max(0, Math.ceil((goalPct * participants) / 100) - completed) : 0;
  const met = goalPct === 0 || (participants > 0 && completed * 100 >= goalPct * participants);
  return { goalPct, completed, participants, met, need };
}

export async function teamGoal(teamId: string): Promise<TeamGoal> {
  const sb = db();
  const [{ data: g, error: settingsError }, { data: ps, error: peopleError }] = await Promise.all([
    sb.from('game_settings').select('team_goal_pct').eq('id', 1).single(),
    sb.from('participants').select('*').eq('team_id', teamId),
  ]);
  if (settingsError) throw settingsError;
  if (peopleError) throw peopleError;
  const list = (ps ?? []).filter((p) => !p.is_observer);
  return goalStatus(g?.team_goal_pct ?? 0, list.filter((p: any) => p.status === 'completed').length, list.length);
}
