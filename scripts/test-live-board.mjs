import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { isLiveTeam, liveRank, liveTeams } from '../lib/live-board.ts';

const require = createRequire(import.meta.url);
function load(path, mocks) {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id] ?? require(id), module, module.exports);
  return module.exports;
}

test('Live competition membership uses assigned D/C/A/O codes, never names', () => {
  for (const code of ['D', 'C', 'A', 'O']) assert.equal(isLiveTeam(code), true);
  for (const value of ['DCAO1', 'DCAO4', 'committee', 'กรรมการ', '', null, undefined]) assert.equal(isLiveTeam(value), false);
});

test('renamed zero-score teams keep group order without assigned places', () => {
  const input = [
    { name: 'ทีมครัว O', lineGroupCode: 'O', balance: 0 },
    { name: 'DCAO1', lineGroupCode: null, balance: 9999 },
    { name: 'New Camp C', lineGroupCode: 'C', balance: 0 },
    { name: 'ทีมสีเขียว', lineGroupCode: 'D', balance: 0 },
    { name: 'ทีม A เปลี่ยนชื่อ', lineGroupCode: 'A', balance: 0 },
  ];
  const shown = liveTeams(input);
  assert.deepEqual(shown.map((team) => team.lineGroupCode), ['D', 'C', 'A', 'O']);
  assert.deepEqual(shown.map((team) => liveRank(team.balance, shown)), [null, null, null, null]);
  assert.equal(input[0].name, 'ทีมครัว O', 'rendering must not reorder the source payload');
});

test('positive scores have current places 1–4 and ties share a place', () => {
  const teams = liveTeams([30, 10, 40, 20].map((balance, i) => ({ name: `Renamed ${i}`, lineGroupCode: 'DCAO'[i], balance })));
  assert.deepEqual(teams.map((team) => liveRank(team.balance, teams)), [1, 2, 3, 4]);
  const ties = [20, 20, 10, 0].map((balance) => ({ balance }));
  assert.deepEqual(ties.map((team) => liveRank(team.balance, ties)), [1, 1, 3, null]);
});

class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
const teamRows = () => [
  ...[26, 26, 26, 27].map((participants, i) => ({ team_id: `team-${i + 1}`, name: `DCAO${i + 1}`, participants, completed: 0, balance: 0, spent: 0, in_progress: 0 })),
  { team_id: 'staff', name: 'committee', participants: 19, completed: 19, balance: 9999, spent: 0, in_progress: 0 },
  { team_id: 'judges', name: 'กรรมการ', participants: 0, completed: 0, balance: 9999, spent: 0, in_progress: 0 },
];

/** Exercise the real GET route with scoped, ordered and limited in-memory query results. */
function liveRoute({ role = 'staff', teams = teamRows(), identities = teamRows().map((t, i) => ({ id: t.team_id, name: t.name, line_group_code: 'DCAO'[i] ?? null })), identityError = null } = {}) {
  const queries = [];
  const tables = {
    game_settings: [{ id: 1, is_open: false, hunt_open: false, puzzle_open: false, team_goal_pct: 80 }],
    teams: identities, team_summary: teams, hunt_spots: [{ id: 'spot', active: true }],
    hunt_claims: [
      { team_id: 'staff', claimed_at: '2026-11-10T12:00:00Z', teams: { name: 'committee' }, hunt_spots: { title: 'Staff' } },
      { team_id: 'team-1', claimed_at: '2026-11-10T11:00:00Z', teams: { name: 'DCAO1' }, hunt_spots: { title: 'Camp' } },
    ],
    token_ledger: [{ team_id: 'staff', kind: 'quiz', amount: 999 }, { team_id: 'team-1', kind: 'quiz', amount: 20 }],
    redemptions: [
      ...Array.from({ length: 12 }, (_, i) => ({ team_id: 'staff', item_name: 'Staff', quantity: 1, created_at: `2026-11-10T12:${String(i).padStart(2, '0')}:00Z`, teams: { name: 'committee' } })),
      { team_id: 'team-1', item_name: 'Camp', quantity: 1, created_at: '2026-11-10T10:00:00Z', teams: { name: 'DCAO1' } },
    ],
    participants: [
      { team_id: 'staff', status: 'completed', is_observer: false, completed_at: '2026-11-10T12:00:00Z', teams: { name: 'committee' } },
      { team_id: 'team-2', status: 'completed', is_observer: false, completed_at: '2026-11-10T11:00:00Z', teams: { name: 'DCAO2' } },
      { team_id: 'team-2', status: 'completed', is_observer: true, completed_at: '2026-11-10T12:00:00Z', teams: { name: 'DCAO2' } },
    ],
    photo_submissions: [{ team_id: 'team-3', status: 'approved', reviewed_at: '2026-11-10T11:00:00Z', teams: { name: 'DCAO3' }, photo_missions: { title: 'Camp' } }],
  };
  const sb = { from(table) {
    const record = { table, operations: [] }; queries.push(record);
    let single = false;
    const query = {
      select() { return query; },
      eq(...args) { record.operations.push(['eq', ...args]); return query; },
      in(...args) { record.operations.push(['in', ...args]); return query; },
      order(...args) { record.operations.push(['order', ...args]); return query; },
      limit(n) { record.operations.push(['limit', n]); return query; },
      single() { single = true; return query; },
      then(resolve, reject) {
        let data = [...tables[table]];
        for (const [op, key, value] of record.operations) {
          if (op === 'eq') data = data.filter((row) => row[key] === value);
          if (op === 'in') data = data.filter((row) => value.includes(row[key]));
          if (op === 'order') data.sort((a, b) => String(a[key]).localeCompare(String(b[key])) * (value?.ascending === false ? -1 : 1));
          if (op === 'limit') data = data.slice(0, key);
        }
        return Promise.resolve({ data: single ? data[0] : data, error: table === 'teams' ? identityError : null }).then(resolve, reject);
      },
    };
    return query;
  } };
  const { GET } = load('../app/api/admin/[action]/route.ts', {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/http': { HttpError, handler: (fn) => fn, ok: (value) => value },
    '@/lib/auth': { getAdminRole: async () => role },
    '@/lib/supabase': { db: () => sb }, '@/lib/live-board': { isLiveTeam },
    '@/lib/goal': { goalStatus: () => ({ need: 0, met: false }) },
    '@/lib/codes': {}, '@/lib/avatars': {}, '@/lib/bulk': {}, '@/lib/bulk-reset': {}, '@/lib/line-types': {},
  });
  return { queries, get: () => GET(new Request('https://camp.example/api/admin/live'), { params: Promise.resolve({ action: 'live' }) }) };
}

for (const role of ['staff', 'admin']) test(`Live ${role} response excludes staff teams and scopes events before limits`, async () => {
  const route = liveRoute({ role }); const result = await route.get();
  assert.deepEqual(result.teams.map((team) => team.name), ['DCAO1', 'DCAO2', 'DCAO3', 'DCAO4']);
  assert.equal(result.teams.reduce((n, team) => n + team.participants, 0), 105);
  assert.equal(result.teams.reduce((n, team) => n + team.balance, 0), 0);
  assert.equal(result.teams[0].quizTokens, 20);
  assert.ok(result.feed.length > 0 && result.feed.every((event) => ['team-1', 'team-2', 'team-3', 'team-4'].includes(event.teamId)));
  assert.ok(result.feed.some((event) => event.kind === 'redeem'), 'staff events must not consume the recent redemption limit');
  assert.equal(result.feed.filter((event) => event.kind === 'quiz').length, 1, 'observer completions must remain excluded');
  for (const query of route.queries.filter((q) => ['hunt_claims', 'token_ledger', 'redemptions', 'participants', 'photo_submissions'].includes(q.table))) {
    assert.deepEqual(query.operations.find((op) => op[0] === 'in' && op[1] === 'team_id')?.[2], ['team-1', 'team-2', 'team-3', 'team-4']);
  }
});

test('Live requires an authenticated organiser before querying team data', async () => {
  const route = liveRoute({ role: null });
  await assert.rejects(route.get(), { status: 401 });
  assert.deepEqual(route.queries, []);
});

test('Live with no competing teams does not read unscoped activity history', async () => {
  const route = liveRoute({ identities: teamRows().map(t => ({id: t.team_id, name: t.name, line_group_code: null})) });
  const result = await route.get();
  assert.deepEqual(result.teams, []); assert.deepEqual(result.feed, []);
  assert.deepEqual(route.queries.map((q) => q.table).sort(), ['game_settings', 'hunt_spots', 'team_summary', 'teams']);
});

test('Live preserves four team identities and current event names after every team is renamed', async () => {
  const names = ['ทีมครัวสีเขียว', 'Camp Together', 'ทีมสร้างสรรค์', 'เพื่อนร่วมแคมป์'];
  const identities = teamRows().map((t, i) => ({ id: t.team_id, name: names[i] ?? 'DCAO1', line_group_code: 'DCAO'[i] ?? null }));
  // The summary and event join fixtures deliberately still carry old labels.
  const result = await liveRoute({ identities }).get();
  assert.deepEqual(result.teams.map(t => t.name), names);
  assert.deepEqual(result.teams.map(t => t.id), ['team-1', 'team-2', 'team-3', 'team-4']);
  assert.equal(result.teams.reduce((n, t) => n + t.participants, 0), 105);
  assert.ok(result.feed.every(event => event.team === identities.find(t => t.id === event.teamId).name));
});

test('Live reports a failed identity lookup instead of silently returning an empty board', async () => {
  await assert.rejects(liveRoute({ identityError: new Error('identity lookup failed') }).get(), /identity lookup failed/);
});
