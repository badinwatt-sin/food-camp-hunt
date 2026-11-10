import 'server-only';
import { db } from '../supabase';
import { HttpError } from '../http';
import {
  MG_GAMES, MG_MAX_ATTEMPTS, MG_SUCCESS_RULES, MEMORY, MYSTERY, SPOT, weeklyReward, type MgGame,
} from './config';
import { INGREDIENTS, MEMORY_CARDS, shuffle } from './pools';
import { SCENES, nearestDiff } from './spot-scenes';

type Row = { id: string; participant_id: string; game: MgGame; n: number; state: any; started_at: string; finished_at: string | null; tokens: number | null; result: any };
const FLAG: Record<MgGame, string> = { spot: 'mg_spot_open', memory: 'mg_memory_open', mystery: 'mg_mystery_open' };

export const isGame = (g: string): g is MgGame => (MG_GAMES as string[]).includes(g);
const dataUrl = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
const secs = (iso: string) => (Date.now() - new Date(iso).getTime()) / 1000;

async function settings() {
  const { data, error } = await db().from('game_settings').select('*').eq('id', 1).single();
  if (error) throw error;
  return data as any;
}
async function requireOpen(game: MgGame) {
  const s = await settings();
  if (!s[FLAG[game]]) throw new HttpError(403, 'MG_CLOSED');
  return weeklyReward(s, game);
}

async function load(pid: string, game: MgGame, id: unknown): Promise<Row> {
  if (typeof id !== 'string' || id.length > 60) throw new HttpError(404, 'NOT_FOUND');
  const { data, error } = await db().from('minigame_attempts').select('*').eq('id', id).eq('participant_id', pid).eq('game', game).maybeSingle();
  if (error) throw error;
  if (!data) throw new HttpError(404, 'NOT_FOUND');
  return data as Row;
}
const save = async (id: string, state: unknown) => {
  const { error } = await db().from('minigame_attempts').update({ state }).eq('id', id);
  if (error) throw error;
};
async function finish(row: Row, success: boolean, detail: Record<string, unknown>, rewardTokens: number) {
  // The database derives success from the saved attempt and reads the current Admin reward itself.
  const { data, error } = await db().rpc('mg_finish', { p_attempt: row.id, p_tokens: success ? rewardTokens : 0, p_result: { ...detail, success } });
  if (error) throw error;
  return { done: true as const, success: data.result?.success ?? success, claimed: data.claimed ?? (data.result?.success ?? success),
    tokens: data.tokens as number, awarded: data.awarded as number, best: (data.best ?? data.tokens) as number,
    rewardTokens: data.result?.rewardTokens ?? rewardTokens, detail: data.result };
}

/** The player's open attempt for a game, or a new one (max 3 per game). */
async function startOrResume(pid: string, game: MgGame, init: () => unknown): Promise<{ row: Row; resumed: boolean }> {
  const sb = db();
  const { data: rows, error } = await sb.from('minigame_attempts').select('*').eq('participant_id', pid).eq('game', game).order('n');
  if (error) throw error;
  const list = (rows ?? []) as Row[];
  const open = list.find((r) => !r.finished_at);
  if (open) return { row: open, resumed: true };
  const priorSuccess = list.some((r) => r.finished_at && r.result?.fixedReward === true && r.result?.success === true);
  const { data: credits, error: creditError } = await sb.from('token_ledger').select('amount, idempotency_key')
    .eq('participant_id', pid).eq('kind', 'minigame').eq('reason', game);
  if (creditError) throw creditError;
  const alreadyClaimed = priorSuccess || (credits ?? []).some((entry: any) => entry.amount > 0 || String(entry.idempotency_key).startsWith('weekly:'));
  if (alreadyClaimed) throw new HttpError(409, 'ALREADY_COMPLETED');
  const n = (list.length ? Math.max(...list.map((r) => r.n)) : 0) + 1;
  if (n > MG_MAX_ATTEMPTS) throw new HttpError(409, 'MG_NO_ATTEMPTS');
  const { data, error: e2 } = await sb.from('minigame_attempts').insert({ participant_id: pid, game, n, state: init() }).select('*').single();
  if (e2) {
    // two taps at once: the other request created it first
    const { data: again } = await sb.from('minigame_attempts').select('*').eq('participant_id', pid).eq('game', game).is('finished_at', null).maybeSingle();
    if (again) return { row: again as Row, resumed: true };
    throw e2;
  }
  return { row: data as Row, resumed: false };
}

// ------------------------------------------------------------------ status (hub screen)
export async function status(pid: string, isObserver = false) {
  const sb = db();
  const [s, mineResult, allResult, ledgerResult] = await Promise.all([
    settings(),
    sb.from('minigame_attempts').select('game, n, tokens, finished_at, result').eq('participant_id', pid).order('n'),
    sb.from('minigame_attempts').select('game, tokens, participant_id, result, participants(*, teams(name))').not('finished_at', 'is', null),
    sb.from('token_ledger').select('reason, amount, idempotency_key').eq('participant_id', pid).eq('kind', 'minigame'),
  ]);
  if (mineResult.error) throw mineResult.error;
  if (allResult.error) throw allResult.error;
  if (ledgerResult.error) throw ledgerResult.error;
  const mine = (mineResult.data ?? []) as any[];
  const all = (allResult.data ?? []) as any[];
  const ledger = (ledgerResult.data ?? []) as any[];
  const games = Object.fromEntries(MG_GAMES.map((g) => {
    const m = mine.filter((r) => r.game === g);
    const fin = m.filter((r) => r.finished_at);
    const claimed = fin.some((r) => r.result?.fixedReward === true && r.result?.success === true)
      || ledger.some((entry) => entry.reason === g && (entry.amount > 0 || String(entry.idempotency_key).startsWith('weekly:')));
    const best = new Map<string, any>();
    for (const r of all.filter((r) => r.game === g && !r.participants?.is_observer)) {
      const cur = best.get(r.participant_id);
      if (!cur || (r.tokens ?? 0) > cur.tokens) best.set(r.participant_id, { tokens: r.tokens ?? 0, name: r.participants?.nick_name || r.participants?.name || '', team: r.participants?.teams?.name ?? '', me: r.participant_id === pid });
    }
    const top = [...best.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
    const rewardTokens = weeklyReward(s, g);
    return [g, {
      open: !!s[FLAG[g]], used: m.length, max: MG_MAX_ATTEMPTS, inProgress: m.some((r) => !r.finished_at), claimed: !isObserver && claimed,
      best: Math.max(0, ...fin.map((r) => r.tokens ?? 0)), scores: fin.map((r) => r.tokens ?? 0),
      maxTokens: rewardTokens, rewardTokens, successRule: MG_SUCCESS_RULES[g], top,
    }];
  }));
  return { games, isObserver };
}

// ------------------------------------------------------------------ 1) spot the difference
function spotView(row: Row) {
  const scene = SCENES[row.state.scene];
  return {
    attemptId: row.id, n: row.n, scene: scene.name, a: dataUrl(scene.render(false)), b: dataUrl(scene.render(true)),
    total: SPOT.diffs, seconds: SPOT.seconds, elapsed: Math.min(SPOT.seconds, Math.floor(secs(row.started_at))),
    penalty: row.state.misses * SPOT.missPenaltySec,
    found: (row.state.found as number[]).map((id) => ({ x: scene.diffs[id].x / 400, y: scene.diffs[id].y / 300 })),
  };
}
async function spotFinish(row: Row, rewardTokens: number) {
  const st = row.state;
  const completed = typeof st.completedAt === 'string' ? new Date(st.completedAt).getTime() : NaN;
  const elapsed = Number.isFinite(completed) ? (completed - new Date(row.started_at).getTime()) / 1000 : secs(row.started_at);
  const t = elapsed + st.misses * SPOT.missPenaltySec;
  const found = (st.found as number[]).length;
  return finish(row, found === SPOT.diffs && t <= SPOT.seconds + SPOT.grace, { found, seconds: Math.round(t), misses: st.misses }, rewardTokens);
}
export async function spot(pid: string, body: any) {
  const rewardTokens = await requireOpen('spot');
  switch (body.action) {
    case 'start': {
      // The three tries use the three different pictures; the picture follows the attempt number.
      const { row } = await startOrResume(pid, 'spot', () => ({ scene: 0, found: [], misses: 0 }));
      if (row.state.found.length >= SPOT.diffs) return spotFinish(row, rewardTokens);
      if (row.state.scene !== (row.n - 1) % SCENES.length) { row.state.scene = (row.n - 1) % SCENES.length; await save(row.id, row.state); }
      if (secs(row.started_at) + row.state.misses * SPOT.missPenaltySec > SPOT.seconds + SPOT.grace) {            // an old, abandoned attempt: close it and start the next one
        await spotFinish(row, rewardTokens);
        return spot(pid, { action: 'start' });
      }
      return spotView(row);
    }
    case 'click': {
      const row = await load(pid, 'spot', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      if (secs(row.started_at) + row.state.misses * SPOT.missPenaltySec > SPOT.seconds + SPOT.grace) return { ...(await spotFinish(row, rewardTokens)), over: true };
      const x = Number(body.x), y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) throw new HttpError(400, 'BAD_INPUT');
      const scene = SCENES[row.state.scene];
      const hit = nearestDiff(scene, x * 400, y * 300, row.state.found);
      if (!hit) {
        row.state.misses += 1;
        await save(row.id, row.state);
        return { hit: false, penalty: row.state.misses * SPOT.missPenaltySec };
      }
      row.state.found.push(hit.id);
      if (row.state.found.length >= SPOT.diffs) row.state.completedAt = new Date().toISOString();
      await save(row.id, row.state);
      const mark = { x: hit.x / 400, y: hit.y / 300 };
      if (row.state.found.length >= SPOT.diffs) return { hit: true, mark, count: SPOT.diffs, ...(await spotFinish(row, rewardTokens)) };
      return { hit: true, mark, count: row.state.found.length };
    }
    case 'finish': {                                                       // time is up on the phone, or the player gives up
      const row = await load(pid, 'spot', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      return spotFinish(row, rewardTokens);
    }
  }
  throw new HttpError(400, 'BAD_INPUT');
}

// ------------------------------------------------------------------ 2) memory flip
const card = (id: string) => { const c = MEMORY_CARDS.find((x) => x.id === id)!; return { id: c.id, emoji: c.emoji, name: c.name }; };
function memoryView(row: Row) {
  const st = row.state;
  return {
    attemptId: row.id, n: row.n, pairs: MEMORY.pairs, moves: st.moves,
    matched: (st.matched as number[]).map((i) => ({ i, ...card(st.layout[i]) })),
    open: st.open === null ? null : { i: st.open, ...card(st.layout[st.open]) },
  };
}
export async function memory(pid: string, body: any) {
  const rewardTokens = await requireOpen('memory');
  switch (body.action) {
    case 'start': {
      const { row } = await startOrResume(pid, 'memory', () => {
        const ids = shuffle(MEMORY_CARDS).slice(0, MEMORY.pairs).map((c) => c.id);
        return { layout: shuffle([...ids, ...ids]), matched: [], open: null, moves: 0 };
      });
      if (row.state.matched.length === row.state.layout.length) return finish(row, true, { moves: row.state.moves }, rewardTokens);
      return memoryView(row);
    }
    case 'flip': {
      const row = await load(pid, 'memory', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      const st = row.state;
      if (st.matched.length === st.layout.length) return finish(row, true, { moves: st.moves }, rewardTokens);
      const i = Number(body.index);
      if (!Number.isInteger(i) || i < 0 || i >= st.layout.length || st.matched.includes(i) || st.open === i) throw new HttpError(400, 'BAD_INPUT');
      if (st.open === null) {                                              // first card of a move
        st.open = i;
        await save(row.id, st);
        return { phase: 'first', card: card(st.layout[i]) };
      }
      const first = st.open as number;                                     // second card: the move is counted
      st.moves += 1;
      st.open = null;
      const match = st.layout[first] === st.layout[i];
      if (match) st.matched.push(first, i);
      await save(row.id, st);
      const out: any = { phase: 'second', card: card(st.layout[i]), first, match, moves: st.moves };
      if (match && st.matched.length === st.layout.length) Object.assign(out, await finish(row, true, { moves: st.moves }, rewardTokens));
      return out;
    }
  }
  throw new HttpError(400, 'BAD_INPUT');
}

// ------------------------------------------------------------------ 3) mystery ingredient
const ing = (id: string) => { const c = INGREDIENTS.find((x) => x.id === id)!; return { id: c.id, emoji: c.emoji, name: c.name }; };
const mysteryFinish = (row: Row, rewardTokens: number) => {
  const st = row.state;
  return finish(row, st.right === MYSTERY.rounds && st.got.length === MYSTERY.rounds && st.got.every((value: number) => value > 0),
    { correct: st.right, rounds: st.got }, rewardTokens);
};
export async function mystery(pid: string, body: any) {
  const rewardTokens = await requireOpen('mystery');
  const build = () => {
    const answers = shuffle(INGREDIENTS).slice(0, MYSTERY.rounds);
    return {
      idx: 0, shownAt: null, got: [] as number[], right: 0,
      rounds: answers.map((a) => ({
        a: a.id, opts: shuffle([a.id, ...shuffle(INGREDIENTS.filter((x) => x.id !== a.id)).slice(0, 3).map((x) => x.id)]),
        ox: 15 + Math.floor(Math.random() * 70), oy: 15 + Math.floor(Math.random() * 70),   // which part of the picture is shown zoomed in
      })),
    };
  };
  switch (body.action) {
    case 'start': {
      const { row } = await startOrResume(pid, 'mystery', build);
      if (row.state.idx >= MYSTERY.rounds) return mysteryFinish(row, rewardTokens);
      return { attemptId: row.id, n: row.n, total: MYSTERY.rounds, seconds: MYSTERY.secondsPerRound, round: row.state.idx + 1 };
    }
    case 'round': {
      const row = await load(pid, 'mystery', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      const st = row.state;
      if (st.idx >= MYSTERY.rounds) return mysteryFinish(row, rewardTokens);
      const r = st.rounds[st.idx];
      if (!st.shownAt) { st.shownAt = new Date().toISOString(); await save(row.id, st); }
      return {
        round: st.idx + 1, total: MYSTERY.rounds, seconds: MYSTERY.secondsPerRound, elapsed: Math.round(secs(st.shownAt) * 10) / 10,
        emoji: ing(r.a).emoji, ox: r.ox, oy: r.oy, options: r.opts.map(ing).map((o: any) => ({ id: o.id, emoji: o.emoji, name: o.name })),
      };
    }
    case 'answer': {
      const row = await load(pid, 'mystery', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      const st = row.state;
      if (st.idx >= MYSTERY.rounds) return { ...(await mysteryFinish(row, rewardTokens)), correct: st.got[MYSTERY.rounds - 1] > 0, correctCount: st.right, answer: ing(st.rounds[MYSTERY.rounds - 1].a) };
      if (!st.shownAt) throw new HttpError(409, 'OUT_OF_ORDER');
      const r = st.rounds[st.idx];
      const t = secs(st.shownAt);
      const pick = typeof body.pick === 'string' ? body.pick : '';
      const timedOut = t > MYSTERY.secondsPerRound + MYSTERY.grace;
      const correct = pick === r.a && !timedOut;
      const raw = correct ? 1 : 0;
      st.got.push(raw);
      if (correct) st.right += 1;
      st.idx += 1; st.shownAt = null;
      await save(row.id, st);
      const base = { correct, answer: ing(r.a), correctCount: st.right, seconds: Math.round(t * 10) / 10, timedOut };
      if (st.idx >= MYSTERY.rounds) {
        return { ...base, ...(await mysteryFinish(row, rewardTokens)) };
      }
      return { ...base, done: false };
    }
  }
  throw new HttpError(400, 'BAD_INPUT');
}
