import 'server-only';
import { db } from '../supabase';
import { HttpError } from '../http';
import {
  MG_GAMES, MG_MAX_ATTEMPTS, MG_MAX_TOKENS, MEMORY, MYSTERY, SPOT, applyPercent, memoryTokens, mysteryTokens, spotTokens, type MgGame,
} from './config';
import { INGREDIENTS, MEMORY_CARDS, shuffle } from './pools';
import { SCENES, nearestDiff } from './spot-scenes';

type Row = { id: string; participant_id: string; game: MgGame; n: number; state: any; started_at: string; finished_at: string | null; tokens: number | null; result: any };
const FLAG: Record<MgGame, string> = { spot: 'mg_spot_open', memory: 'mg_memory_open', mystery: 'mg_mystery_open' };

export const isGame = (g: string): g is MgGame => (MG_GAMES as string[]).includes(g);
const dataUrl = (svg: string) => 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
const secs = (iso: string) => (Date.now() - new Date(iso).getTime()) / 1000;

async function settings() {
  const { data, error } = await db().from('game_settings').select('mg_spot_open, mg_memory_open, mg_mystery_open, mg_percent').eq('id', 1).single();
  if (error) throw error;
  return data as any;
}
async function requireOpen(game: MgGame) {
  const s = await settings();
  if (!s[FLAG[game]]) throw new HttpError(403, 'MG_CLOSED');
  return (s.mg_percent ?? 100) as number;
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
async function finish(row: Row, rawTokens: number, detail: Record<string, unknown>, pct: number) {
  const tokens = applyPercent(rawTokens, pct);
  const { data, error } = await db().rpc('mg_finish', { p_attempt: row.id, p_tokens: tokens, p_result: { ...detail, raw: rawTokens, percent: pct } });
  if (error) throw error;
  return { done: true as const, tokens: data.tokens as number, awarded: data.awarded as number, best: (data.best ?? data.tokens) as number, detail: data.result };
}

/** The player's open attempt for a game, or a new one (max 3 per game). */
async function startOrResume(pid: string, game: MgGame, init: () => unknown): Promise<{ row: Row; resumed: boolean }> {
  const sb = db();
  const { data: rows, error } = await sb.from('minigame_attempts').select('*').eq('participant_id', pid).eq('game', game).order('n');
  if (error) throw error;
  const list = (rows ?? []) as Row[];
  const open = list.find((r) => !r.finished_at);
  if (open) return { row: open, resumed: true };
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
export async function status(pid: string) {
  const sb = db();
  const [s, { data: mine }, { data: all }] = await Promise.all([
    settings(),
    sb.from('minigame_attempts').select('game, n, tokens, finished_at').eq('participant_id', pid).order('n'),
    sb.from('minigame_attempts').select('game, tokens, participant_id, participants(name, nick_name, teams(name))').not('finished_at', 'is', null),
  ]);
  const games = Object.fromEntries(MG_GAMES.map((g) => {
    const m = ((mine ?? []) as any[]).filter((r) => r.game === g);
    const fin = m.filter((r) => r.finished_at);
    const best = new Map<string, any>();
    for (const r of ((all ?? []) as any[]).filter((r) => r.game === g)) {
      const cur = best.get(r.participant_id);
      if (!cur || (r.tokens ?? 0) > cur.tokens) best.set(r.participant_id, { tokens: r.tokens ?? 0, name: r.participants?.nick_name || r.participants?.name || '', team: r.participants?.teams?.name ?? '', me: r.participant_id === pid });
    }
    const top = [...best.values()].sort((a, b) => b.tokens - a.tokens).slice(0, 5);
    return [g, {
      open: !!s[FLAG[g]], used: m.length, max: MG_MAX_ATTEMPTS, inProgress: m.some((r) => !r.finished_at),
      best: Math.max(0, ...fin.map((r) => r.tokens ?? 0)), scores: fin.map((r) => r.tokens ?? 0),
      maxTokens: applyPercent(MG_MAX_TOKENS[g], s.mg_percent ?? 100), top,
    }];
  }));
  return { games, percent: s.mg_percent ?? 100 };
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
async function spotFinish(row: Row, pct: number) {
  const st = row.state;
  const t = Math.min(SPOT.seconds, secs(row.started_at) + st.misses * SPOT.missPenaltySec);
  const found = (st.found as number[]).length;
  return finish(row, spotTokens(found, t), { found, seconds: Math.round(t), misses: st.misses }, pct);
}
export async function spot(pid: string, body: any) {
  const pct = await requireOpen('spot');
  switch (body.action) {
    case 'start': {
      // The three tries use the three different pictures; the picture follows the attempt number.
      const { row } = await startOrResume(pid, 'spot', () => ({ scene: 0, found: [], misses: 0 }));
      if (row.state.scene !== (row.n - 1) % SCENES.length) { row.state.scene = (row.n - 1) % SCENES.length; await save(row.id, row.state); }
      if (secs(row.started_at) > SPOT.seconds + SPOT.grace) {            // an old, abandoned attempt: close it and start the next one
        await spotFinish(row, pct);
        return spot(pid, { action: 'start' });
      }
      return spotView(row);
    }
    case 'click': {
      const row = await load(pid, 'spot', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      if (secs(row.started_at) > SPOT.seconds + SPOT.grace) return { ...(await spotFinish(row, pct)), over: true };
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
      await save(row.id, row.state);
      const mark = { x: hit.x / 400, y: hit.y / 300 };
      if (row.state.found.length >= SPOT.diffs) return { hit: true, mark, count: SPOT.diffs, ...(await spotFinish(row, pct)) };
      return { hit: true, mark, count: row.state.found.length };
    }
    case 'finish': {                                                       // time is up on the phone, or the player gives up
      const row = await load(pid, 'spot', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      return spotFinish(row, pct);
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
  const pct = await requireOpen('memory');
  switch (body.action) {
    case 'start': {
      const { row } = await startOrResume(pid, 'memory', () => {
        const ids = shuffle(MEMORY_CARDS).slice(0, MEMORY.pairs).map((c) => c.id);
        return { layout: shuffle([...ids, ...ids]), matched: [], open: null, moves: 0 };
      });
      return memoryView(row);
    }
    case 'flip': {
      const row = await load(pid, 'memory', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      const st = row.state;
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
      if (match && st.matched.length === st.layout.length) Object.assign(out, await finish(row, memoryTokens(st.moves), { moves: st.moves }, pct));
      return out;
    }
  }
  throw new HttpError(400, 'BAD_INPUT');
}

// ------------------------------------------------------------------ 3) mystery ingredient
const ing = (id: string) => { const c = INGREDIENTS.find((x) => x.id === id)!; return { id: c.id, emoji: c.emoji, name: c.name }; };
export async function mystery(pid: string, body: any) {
  const pct = await requireOpen('mystery');
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
      return { attemptId: row.id, n: row.n, total: MYSTERY.rounds, seconds: MYSTERY.secondsPerRound, round: row.state.idx + 1 };
    }
    case 'round': {
      const row = await load(pid, 'mystery', body.attemptId);
      if (row.finished_at) throw new HttpError(409, 'ALREADY_COMPLETED');
      const st = row.state;
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
      if (!st.shownAt) throw new HttpError(409, 'OUT_OF_ORDER');
      const r = st.rounds[st.idx];
      const t = secs(st.shownAt);
      const pick = typeof body.pick === 'string' ? body.pick : '';
      const correct = pick === r.a;
      const raw = mysteryTokens(correct, t);
      st.got.push(raw);
      if (correct) st.right += 1;
      st.idx += 1; st.shownAt = null;
      await save(row.id, st);
      const base = { correct, answer: ing(r.a), roundTokens: applyPercent(raw, pct), seconds: Math.round(t * 10) / 10, timedOut: t > MYSTERY.secondsPerRound + MYSTERY.grace };
      if (st.idx >= MYSTERY.rounds) {
        const total = (st.got as number[]).reduce((a, b) => a + b, 0);
        return { ...base, ...(await finish(row, total, { correct: st.right, rounds: st.got }, pct)) };
      }
      return { ...base, done: false };
    }
  }
  throw new HttpError(400, 'BAD_INPUT');
}
