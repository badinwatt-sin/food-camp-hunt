import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import { isLineGroupUrl } from '../lib/line-types.ts';
import { menuAccess, MENU_SETTINGS_SELECT } from '../lib/menu-access.ts';

const require = createRequire(import.meta.url);

/** Run actual route code and HTTP guards, replacing only external services. No network calls. */
function loadModule(path, mocks) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled)(
    (id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id), module, module.exports,
  );
  return module.exports;
}

function httpModule() {
  return loadModule('../lib/http.ts', {
    'server-only': {},
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
  });
}

function joinRoute({ authenticated = true, result = { data: { url: 'https://line.me/R/ti/g/example' }, error: null } } = {}) {
  const http = httpModule();
  const calls = [];
  const rpcs = [];
  const { POST } = loadModule('../app/api/line/join/route.ts', {
    '@/lib/http': {
      ...http,
      checkOrigin(req) { calls.push('origin'); http.checkOrigin(req); },
      rateLimit(...args) { calls.push('limit'); http.rateLimit(...args); },
    },
    '@/lib/player': { requirePlayer: async () => {
      calls.push('auth');
      if (!authenticated) throw new http.HttpError(401, 'UNAUTHORIZED');
      return { id: 'authenticated-player', team_id: 'assigned-team' };
    } },
    '@/lib/supabase': { db: () => {
      calls.push('db');
      return { rpc: async (name, args) => { rpcs.push({ name, args }); return result; } };
    } },
  });
  return { post: POST, calls, rpcs };
}

function request({ origin = 'https://camp.test', body = {} } = {}) {
  const headers = { host: 'camp.test', 'Content-Type': 'application/json' };
  if (origin !== null) headers.origin = origin;
  return new Request('https://camp.test/api/line/join', { method: 'POST', headers, body: JSON.stringify(body) });
}

test('LINE join authenticates and uses only the server session participant ID', async () => {
  const r = joinRoute();
  const res = await r.post(request({ body: { p_participant: 'other-player', participant_id: 'other-player', url: 'https://attacker.test' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { url: 'https://line.me/R/ti/g/example' });
  assert.deepEqual(r.calls, ['origin', 'auth', 'limit', 'db']);
  assert.deepEqual(r.rpcs, [{ name: 'join_line_group', args: { p_participant: 'authenticated-player' } }]);
});

test('LINE join rejects cross-origin requests before auth or database access', async () => {
  const r = joinRoute();
  const res = await r.post(request({ origin: 'https://attacker.test' }));
  assert.equal(res.status, 403);
  assert.equal((await res.json()).error, 'FORBIDDEN');
  assert.deepEqual(r.calls, ['origin']);
  assert.deepEqual(r.rpcs, []);
});

test('LINE join rejects unauthenticated requests without touching the database', async () => {
  const r = joinRoute({ authenticated: false });
  const res = await r.post(request());
  assert.equal(res.status, 401);
  assert.equal((await res.json()).error, 'UNAUTHORIZED');
  assert.deepEqual(r.calls, ['origin', 'auth']);
  assert.deepEqual(r.rpcs, []);
});

test('LINE join accepts same-origin browsers that omit the Origin header', async () => {
  const r = joinRoute();
  assert.equal((await r.post(request({ origin: null }))).status, 200);
  assert.equal(r.rpcs.length, 1);
});

for (const [code, status] of [['LINE_CLOSED', 403], ['LINE_NOT_CONFIGURED', 409], ['LINE_GROUP_COMPLETED', 409]]) {
  test(`LINE database rejection ${code} is returned without a redirect URL`, async () => {
    const r = joinRoute({ result: { data: null, error: { message: code } } });
    const res = await r.post(request());
    const body = await res.json();
    assert.equal(res.status, status);
    assert.equal(body.error, code);
    assert.equal('url' in body, false);
    assert.equal(r.rpcs.length, 1);
  });
}

test('LINE join rate limits repeat requests per authenticated player before RPC', async () => {
  const r = joinRoute();
  for (let i = 0; i < 30; i++) assert.equal((await r.post(request())).status, 200);
  const res = await r.post(request());
  assert.equal(res.status, 429);
  assert.equal((await res.json()).error, 'RATE_LIMITED');
  assert.equal(r.rpcs.length, 30);
});

test('LINE invitation validation allows HTTPS invitations on supported LINE domains', () => {
  for (const value of [
    'https://line.me/R/ti/g/example',
    'https://line.me/ti/g/EXAMPLE?utm_source=camp#join',
    'https://lin.ee/aB123',
    'HTTPS://LINE.ME/R/ti/g/example',
  ]) assert.equal(isLineGroupUrl(value), true, value);
});

test('LINE invitation validation rejects foreign hosts, credentials, ports, unsafe protocols and empty paths', () => {
  for (const value of [
    '', 'line.me/R/ti/g/example', 'http://line.me/R/ti/g/example', 'javascript:alert(1)',
    '//line.me/R/ti/g/example', 'https://attacker.test/invite', 'https://line.me.attacker.test/invite',
    'https://attacker.test/line.me/invite', 'https://sub.line.me/invite',
    'https://user:password@line.me/invite', 'https://line.me@attacker.test/invite',
    'https://line.me:443/invite', 'https://line.me:444/invite',
    'https://line.me', 'https://line.me/', 'https://line.me/?invite=abc', 'https://line.me/#invite',
    ' https://line.me/invite', 'https://line.me/invite ', 'https://line.me/in vite',
    'https://line.me./invite', `https://line.me/${'a'.repeat(2000)}`,
  ]) assert.equal(isLineGroupUrl(value), false, value);
});

function meRoute(settings, { authenticated = true, settingsError = null } = {}) {
  const queries = [];
  const http = httpModule();
  const player = { id: 'me', team_id: 'team', name: 'Participant', status: 'in_progress', teams: { name: 'D' } };
  const question = { id: 'q1', position: 1, prompt: 'Hidden question', image_url: null, options: ['A', 'B', 'C', 'D'] };
  const line = { open: false, configured: false, group: null, url: null, joined: false, joinedAt: null,
    total: 1, joinedCount: 0, complete: false, rank: null, tokens: 0, members: [] };
  const sb = {
    from(table) {
      const recorded = { table, columns: null };
      queries.push(recorded);
      const result = () => {
        if (table === 'game_settings') return { data: settings, error: settingsError };
        if (table === 'questions') {
          const columns = recorded.columns.split(',').map((column) => column.trim());
          return { data: [Object.fromEntries(columns.map((column) => [column, question[column]]))], error: null };
        }
        if (table === 'participants') return { data: null, error: null };
        return { data: [], error: null };
      };
      const query = {
        select(columns) { recorded.columns = columns; return query; },
        eq() { return query; }, order() { return query; }, limit() { return query; },
        async single() { return result(); }, async maybeSingle() { return result(); },
        then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
      };
      return query;
    },
    rpc: async () => ({ data: 0, error: null }),
  };
  const { GET } = loadModule('../app/api/me/route.ts', {
    '@/lib/http': http,
    '@/lib/player': { requirePlayer: async () => {
      if (!authenticated) throw new http.HttpError(401, 'UNAUTHORIZED');
      return player;
    } },
    '@/lib/supabase': { db: () => sb },
    '@/lib/menu-access': { menuAccess, MENU_SETTINGS_SELECT },
    '@/lib/goal': { teamGoal: async () => ({ goalPct: 0, completed: 0, participants: 1, met: true, need: 0 }) },
    '@/lib/line-groups': { getLineStatus: async () => line },
  });
  return { get: GET, queries };
}

test('/api/me closed switches keep question content and market stock out of the response and query', async () => {
  const r = meRoute({ is_open: false, market_open: false });
  const res = await r.get();
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.current, null);
  assert.equal(body.total, 1);
  assert.deepEqual(body.market, []);
  assert.equal(body.menus.quiz, false);
  assert.equal(body.menus.market, false);
  assert.equal(body.menus.missions, false);
  assert.equal(r.queries.find((query) => query.table === 'questions').columns, 'id, position');
  assert.equal(r.queries.some((query) => query.table === 'market_items'), false);
  assert.equal(JSON.stringify(body).includes('Hidden question'), false);
});

test('/api/me open switches expose the next question and query market content', async () => {
  const r = meRoute({ is_open: true, market_open: true });
  const body = await (await r.get()).json();
  assert.equal(body.current.prompt, 'Hidden question');
  assert.equal(body.menus.quiz, true);
  assert.equal(body.menus.market, true);
  assert.equal(body.menus.missions, true);
  assert.equal(r.queries.some((query) => query.table === 'market_items'), true);
});

test('/api/me requires authentication before reading settings or content', async () => {
  const r = meRoute({}, { authenticated: false });
  const res = await r.get();
  assert.equal(res.status, 401);
  assert.deepEqual(r.queries, []);
});

test('/api/me settings failure cannot fall through to fetching activity content', async () => {
  const r = meRoute(null, { settingsError: { message: 'FORBIDDEN' } });
  const res = await r.get();
  assert.equal(res.status, 403);
  assert.deepEqual(r.queries.map((query) => query.table), ['game_settings']);
});

function renameRoute({ role = 'admin', dbError = null, found = true } = {}) {
  const http = httpModule();
  const writes = [], audits = [];
  const { POST } = loadModule('../app/api/admin/[action]/route.ts', {
    'next/server': { NextResponse: { json: (body, init) => Response.json(body, init) } },
    '@/lib/http': http,
    '@/lib/auth': { getAdminRole: async () => role },
    '@/lib/goal': {}, '@/lib/codes': {}, '@/lib/avatars': {}, '@/lib/bulk': {}, '@/lib/bulk-reset': {},
    '@/lib/line-types': { isLineGroupUrl, LINE_GROUP_CODES: ['D', 'C', 'A', 'O'] },
    '@/lib/supabase': {
      audit: async (...args) => audits.push(args),
      db: () => ({ from(table) {
        const write = { table, patch: null, filter: null };
        const query = {
          update(patch) { write.patch = patch; writes.push(write); return query; },
          eq(key, value) { write.filter = [key, value]; return query; },
          select() { return query; },
          async maybeSingle() { return { data: found ? { id: write.filter[1], line_group_name: write.patch.line_group_name } : null, error: dbError }; },
        };
        return query;
      } }),
    },
  });
  return { post: (body) => POST(request({ body }), { params: Promise.resolve({ action: 'line.group.rename' }) }), writes, audits };
}

test('admin can rename a scored group while only its display name is updated', async () => {
  const r = renameRoute();
  const res = await r.post({ team_id: 'completed-team', name: '  ทีมหมูกระทะ 🍲  ', group: 'X', url: 'https://evil.test' });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, name: 'ทีมหมูกระทะ 🍲' });
  assert.deepEqual(r.writes, [{ table: 'teams', patch: { line_group_name: 'ทีมหมูกระทะ 🍲' }, filter: ['id', 'completed-team'] }]);
  assert.deepEqual(r.audits, [['admin', 'line.group.rename', { team_id: 'completed-team', name: 'ทีมหมูกระทะ 🍲' }]]);
});

for (const role of [null, 'staff']) {
  test(`LINE display-name rename rejects role ${role} before database writes`, async () => {
    const r = renameRoute({ role });
    const res = await r.post({ team_id: 'team', name: 'ชื่อใหม่' });
    assert.equal(res.status, role === null ? 401 : 403);
    assert.deepEqual(r.writes, []);
    assert.deepEqual(r.audits, []);
  });
}

test('LINE rename rejects missing, blank, non-string, multi-line and oversized names before saving', async () => {
  for (const name of [undefined, null, 123, {}, '', '   ', 'a'.repeat(61), 'two\nlines', 'bad\tname', 'bad\0name']) {
    const r = renameRoute();
    const res = await r.post({ team_id: 'team', name });
    assert.equal(res.status, 400, JSON.stringify(name));
    assert.equal((await res.json()).error, 'BAD_LINE_GROUP_NAME');
    assert.deepEqual(r.writes, []);
  }
});

test('LINE rename accepts a 60-character Unicode display name', async () => {
  const r = renameRoute();
  const res = await r.post({ team_id: 'team', name: '🍲'.repeat(60) });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).name, '🍲'.repeat(60));
});

test('LINE rename reports a pending database upgrade without claiming success or logging an edit', async () => {
  for (const dbError of [{ code: '42703', message: 'column line_group_name does not exist' }, { code: 'PGRST204', message: 'schema cache missing line_group_name' }]) {
    const r = renameRoute({ dbError });
    const res = await r.post({ team_id: 'team', name: 'ชื่อใหม่' });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).error, 'LINE_NAMES_NOT_READY');
    assert.deepEqual(r.audits, []);
  }
});

test('LINE rename reports an unknown team and does not claim a saved edit', async () => {
  const r = renameRoute({ found: false });
  const res = await r.post({ team_id: 'missing', name: 'ชื่อใหม่' });
  assert.equal(res.status, 404);
  assert.deepEqual(r.audits, []);
});

function lineStatusModule(team) {
  const selections = [];
  const sb = { from(table) {
    const result = () => ({ data: table === 'game_settings' ? { line_open: true } : table === 'teams' ? team : [{ id: 'me', name: 'Player', line_joined_at: '2026-11-10T09:00:00Z' }], error: null });
    const query = {
      select(columns) { selections.push({ table, columns }); return query; },
      eq() { return query; }, order() { return query; },
      async single() { return result(); },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject); },
    };
    return query;
  } };
  const module = loadModule('../lib/line-groups.ts', {
    'server-only': {}, './supabase': { db: () => sb }, './line-types': { isLineGroupUrl },
  });
  return { get: () => module.getLineStatus({ id: 'me', team_id: 'team' }), selections };
}

test('pre-name-migration LINE reads still work and fall back to the D/C/A/O label', async () => {
  const r = lineStatusModule({ line_group_code: 'D', line_group_url: 'https://line.me/ti/g/test', line_completed_at: null });
  const result = await r.get();
  assert.equal(result.group, 'D');
  assert.equal(result.groupName, 'D');
  assert.equal(result.configured, true);
  assert.equal(result.joined, true);
});

test('custom LINE display name is projected safely without leaking private team columns', async () => {
  const r = lineStatusModule({ line_group_code: 'D', line_group_name: 'เพื่อนร่วมค่าย', line_group_url: 'https://line.me/ti/g/test', private_team_setting: 'not-for-clients' });
  const result = await r.get();
  assert.equal(result.groupName, 'เพื่อนร่วมค่าย');
  assert.equal(result.group, 'D');
  assert.equal(JSON.stringify(result).includes('not-for-clients'), false);
});
