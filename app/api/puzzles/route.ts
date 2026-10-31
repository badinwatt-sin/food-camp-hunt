import { db } from '@/lib/supabase';
import { requirePlayer } from '@/lib/player';
import { cluesFor, groupMembers } from '@/lib/group';
import { handler, ok } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Team puzzles. The player only receives THEIR share of the clues (the group must talk to combine them)
 * and never the correct answer.
 */
export const GET = handler(async () => {
  const p = await requirePlayer();
  const sb = db();
  const squadId: string | null = p.squad_id ?? null;
  const [{ data: settings }, { data: puzzles }, { data: attempts }, { data: solves }, members] = await Promise.all([
    sb.from('game_settings').select('puzzle_open').eq('id', 1).single(),
    sb.from('team_puzzles').select('id, position, prompt, clues, options, tokens, max_attempts').eq('active', true).order('position').order('id'),
    sb.from('puzzle_attempts').select('puzzle_id, squad_id').eq('team_id', p.team_id),
    sb.from('puzzle_solves').select('puzzle_id, squad_id, tokens, participants(name, nick_name)').eq('team_id', p.team_id),
    groupMembers(p),
  ]);
  const idx = Math.max(0, members.findIndex((m) => m.id === p.id));
  const mine = (x: any) => (x.squad_id ?? null) === squadId;
  const list = (puzzles ?? []).map((z: any) => {
    const solved: any = (solves ?? []).find((x: any) => x.puzzle_id === z.id && mine(x));
    const used = (attempts ?? []).filter((a: any) => a.puzzle_id === z.id && mine(a)).length;
    return {
      id: z.id, prompt: z.prompt, options: z.options, tokens: z.tokens,
      clueTotal: z.clues.length,
      myClues: cluesFor(idx, members.length, z.clues.length).map((j) => ({ no: j + 1, text: z.clues[j] })),
      maxAttempts: z.max_attempts, used, left: Math.max(0, z.max_attempts - used),
      solved: !!solved, solvedBy: solved?.participants?.nick_name || solved?.participants?.name || null,
    };
  });
  return ok({ open: !!settings?.puzzle_open, squad: p.squads?.name ?? null, groupSize: members.length, puzzles: list });
});
