import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { menuAccess } from '../lib/menu-access.ts';

const require = createRequire(import.meta.url);
class HttpError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

/** Exercise the real route with only its external auth/database dependencies replaced. */
function route(path, settings, authenticated = true) {
  const tables = [];
  let statusCalled = false;
  const contentReached = new Error('content query reached');
  const sb = {
    from(table) {
      tables.push(table);
      if (table !== 'game_settings') throw contentReached;
      return { select: () => ({ eq: () => ({ single: async () => ({ data: settings, error: null }) }) }) };
    },
  };
  const mocks = {
    '@/lib/player': { requirePlayer: async () => {
      if (!authenticated) throw new HttpError(401, 'UNAUTHORIZED');
      return { id: 'player', team_id: 'team' };
    } },
    '@/lib/supabase': { db: () => sb },
    '@/lib/http': { HttpError, handler: (fn) => fn, ok: (value) => value },
    '@/lib/menu-access': { menuAccess },
    '@/lib/minigames/engine': { status: async () => { statusCalled = true; return { games: {} }; } },
    '@/lib/group': { groupMembers: async () => [] },
    '@/lib/goal': { teamGoal: async () => ({}) },
  };
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)((id) => mocks[id] ?? require(id), module, module.exports);
  return { get: module.exports.GET, tables, contentReached, statusCalled: () => statusCalled };
}

for (const [path, flag, error] of [
  ['../app/api/hunt/route.ts', 'hunt_open', 'HUNT_CLOSED'],
  ['../app/api/photos/route.ts', 'puzzle_open', 'PUZZLE_CLOSED'],
]) {
  test(`${flag}: a direct GET cannot read disabled mission content`, async () => {
    for (const settings of [null, {}, { [flag]: false }]) {
      const r = route(path, settings);
      await assert.rejects(r.get(), { status: 403, code: error });
      assert.deepEqual(r.tables, ['game_settings']);
    }
  });

  test(`${flag}: an open mission reaches its content queries`, async () => {
    const r = route(path, { [flag]: true });
    await assert.rejects(r.get(), (error) => error === r.contentReached);
    assert.equal(r.tables.length > 1, true);
  });

  test(`${flag}: authentication is required even when closed`, async () => {
    const r = route(path, { [flag]: false }, false);
    await assert.rejects(r.get(), { status: 401, code: 'UNAUTHORIZED' });
    assert.deepEqual(r.tables, []);
  });
}

test('direct minigame hub GET is denied when all games are disabled', async () => {
  const r = route('../app/api/minigames/route.ts', { mg_spot_open: false, mg_memory_open: false, mg_mystery_open: false });
  await assert.rejects(r.get(), { status: 403, code: 'MG_CLOSED' });
  assert.equal(r.statusCalled(), false);
});

test('minigame hub can list games as soon as one game is open', async () => {
  const r = route('../app/api/minigames/route.ts', { mg_memory_open: true });
  assert.deepEqual(await r.get(), { games: {} });
  assert.equal(r.statusCalled(), true);
});
