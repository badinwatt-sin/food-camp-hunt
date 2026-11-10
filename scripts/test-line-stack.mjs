// Full local integration: Next.js -> Supabase JS -> PostgREST -> PostgreSQL.
// Uses disposable Docker containers, an isolated app copy, and dummy credentials.
// Requires Docker, installed project node_modules, Python Playwright and Chromium.
// Run: node scripts/test-line-stack.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, mkdtemp, cp, symlink, rm } from 'node:fs/promises';
import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const suffix = `${process.pid}-${randomUUID().slice(0, 6)}`;
const network = `food-camp-stack-${suffix}`;
const postgres = `${network}-pg`;
const rest = `${network}-rest`;
const localPassword = 'food-camp-local-tests-only-password';
const jwtSecret = 'food-camp-local-tests-only-postgrest-jwt-signing-key';
const adminPassword = 'food-camp-local-tests-only-admin-password';
const codePepper = 'food-camp-local-tests-only-code-pepper';
const sessionSecret = 'food-camp-local-tests-only-session-signing-key';
const appPort = Number(process.env.FOOD_CAMP_STACK_PORT || 3001);
const base = `http://127.0.0.1:${appPort}`;
const createdContainers = [];
let appDir, dev, proxy, networkCreated = false, passed = 0, devLog = '';

function check(label, actual, expected = true) {
  assert.deepEqual(actual, expected, label);
  passed++;
  console.log(`PASS ${label}`);
}
function command(binary, args, { input = '', env = process.env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(`${binary}: ${stderr || stdout || `exit ${code}`}`)));
    child.stdin.end(input);
  });
}
const docker = (args, input = '') => command('docker', args, { input });
const sql = (query) => docker(['exec', '-i', postgres, 'psql', '-U', 'postgres', '-d', 'foodcamp', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], query);
async function ready(label, probe) {
  for (let attempt = 0; ; attempt++) {
    try { await probe(); return; }
    catch (error) {
      if (attempt >= 100) throw new Error(`${label} did not become ready: ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
}
function jwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ role: 'service_role', iss: 'supabase', iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  const body = `${header}.${payload}`;
  return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`;
}
class Client {
  cookies = new Map();
  async call(route, body) {
    const response = await fetch(base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), origin: base, cookie: [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ') },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90000),
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const equals = pair.indexOf('=');
      this.cookies.set(pair.slice(0, equals), pair.slice(equals + 1));
    }
    const data = await response.json();
    return { status: response.status, data };
  }
  async ok(route, body) {
    const result = await this.call(route, body);
    assert.equal(result.status, 200, `${route}: ${JSON.stringify(result.data)}`);
    return result.data;
  }
}

async function browser(stage) {
  const code = `
import os, json
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    browser = p.chromium.launch(executable_path='/usr/bin/chromium', headless=True, args=['--no-sandbox'])
    context = browser.new_context(viewport={'width':390,'height':844})
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(os.environ['FC_STACK_BASE'], wait_until='domcontentloaded')
    page.get_by_placeholder('ID ของคุณ').fill('STACK001')
    page.get_by_role('button',name='เข้าสู่เกม',exact=True).click()
    if os.environ['FC_STACK_STAGE']=='initial':
        popup = page.get_by_role('dialog', name='เข้ากลุ่ม LINE ของทีม')
        popup.wait_for(state='visible',timeout=60000)
        assert popup.get_by_role('button', name='เชื่อมต่อ LINE กลุ่ม เพื่อนร่วมค่าย').is_visible()
        popup.get_by_role('button', name='ไว้ทีหลัง').click()
        assert page.get_by_role('button',name='เริ่มภารกิจ').is_disabled()
        assert page.get_by_role('button',name='ตลาดของ').is_disabled()
        assert page.get_by_role('button',name='เข้าร่วมกลุ่ม LINE เพื่อนร่วมค่าย',exact=True).is_visible()
        assert page.locator('.line-entry .progress, .line-entry details').count()==0
    else:
        entry = page.get_by_role('region',name='กลุ่ม LINE ของคุณ')
        button = entry.get_by_role('button',name='เปิดกลุ่ม LINE ชาวแคมป์สายชิล',exact=True)
        button.wait_for(state='visible',timeout=60000)
        assert entry.get_by_text('✓ เข้า LINE แล้ว',exact=True).is_visible()
        assert entry.locator('.progress, details, ul, .card').count()==0
        assert page.get_by_role('dialog').count()==0
        assert entry.bounding_box()['y'] >= page.locator('.tiles').bounding_box()['y'] + page.locator('.tiles').bounding_box()['height']
    assert not errors, json.dumps(errors,ensure_ascii=False)
    browser.close()
print('Browser '+os.environ['FC_STACK_STAGE']+' flow passed with no page errors')
`;
  const output = await command('python', ['-c', code], { env: { ...process.env, FC_STACK_BASE: base, FC_STACK_STAGE: stage } });
  check(output, true);
}

try {
  console.log('Starting isolated PostgreSQL + PostgREST + Next.js stack…');
  await docker(['network', 'create', network]);
  networkCreated = true;
  await docker(['run', '--detach', '--rm', '--network', network, '--name', postgres, '-e', `POSTGRES_PASSWORD=${localPassword}`, '-e', 'POSTGRES_DB=foodcamp', 'postgres:16']);
  createdContainers.push(postgres);
  await ready('PostgreSQL', () => docker(['exec', postgres, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'foodcamp']));
  await sql('create role anon; create role authenticated; create role service_role bypassrls; create schema storage; create table storage.buckets(id text primary key,name text,public boolean);');
  await sql(await readFile(path.join(root, 'supabase/schema.sql'), 'utf8'));
  // Start on the already deployed, pre-display-name schema to verify a safe rollout.
  await sql('alter table public.teams drop column line_group_name;');
  await sql(`insert into questions(position,prompt,options,correct_index) values (1,'STACK HIDDEN QUESTION',array['A','B','C','D'],0);
    insert into market_items(name,price,stock) values('STACK HIDDEN MARKET',5,10);
    insert into hunt_spots(position,title,hint,secret,tokens) values(1,'STACK HIDDEN SPOT','test hint','STACKSPOT',5);
    insert into photo_missions(position,title,description,tokens) values(1,'STACK HIDDEN PHOTO','test photo',5);`);
  await docker(['run', '--detach', '--rm', '--network', network, '--name', rest, '-p', '127.0.0.1::3000', '-e', `PGRST_DB_URI=postgres://postgres:${localPassword}@${postgres}:5432/foodcamp`, '-e', 'PGRST_DB_SCHEMAS=public', '-e', 'PGRST_DB_ANON_ROLE=anon', '-e', `PGRST_JWT_SECRET=${jwtSecret}`, 'postgrest/postgrest:v12.2.12']);
  createdContainers.push(rest);
  const restPort = Number((await docker(['port', rest, '3000/tcp'])).split(':').at(-1));
  const serviceKey = jwt();
  await ready('PostgREST', async () => {
    const response = await fetch(`http://127.0.0.1:${restPort}/game_settings?select=id`, { headers: { Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, await response.text());
  });
  check('PostgREST authenticates the local service role against PostgreSQL', true);

  // Supabase JS uses /rest/v1; standalone PostgREST exposes its API at /.
  proxy = createServer(async (req, res) => {
    try {
      const target = `http://127.0.0.1:${restPort}${req.url.replace(/^\/rest\/v1(?=\/|$)/, '') || '/'}`;
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const headers = { ...req.headers };
      delete headers.host;
      const upstream = await fetch(target, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
      res.writeHead(upstream.status, Object.fromEntries(upstream.headers));
      res.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) { res.writeHead(502); res.end(JSON.stringify({ message: error.message })); }
  });
  await new Promise((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const proxyPort = proxy.address().port;
  appDir = await mkdtemp(path.join(tmpdir(), 'food-camp-stack-'));
  await cp(root, appDir, { recursive: true, filter: (source) => {
    const name = path.basename(source);
    return !['node_modules', '.git', '.next'].includes(name) && (!name.startsWith('.env') || name === '.env.example');
  } });
  await symlink(path.join(root, 'node_modules'), path.join(appDir, 'node_modules'), 'dir');
  dev = spawn(process.execPath, [path.join(appDir, 'node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1', '--port', String(appPort)], {
    cwd: appDir,
    detached: true,
    env: { ...process.env, SUPABASE_URL: `http://127.0.0.1:${proxyPort}`, SUPABASE_SERVICE_ROLE_KEY: serviceKey, CODE_PEPPER: codePepper, SESSION_SECRET: sessionSecret, ADMIN_PASSWORD: adminPassword, STAFF_PASSWORD: 'food-camp-local-tests-only-staff', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const log = (chunk) => { devLog = (devLog + chunk).slice(-15000); };
  dev.stdout.on('data', log); dev.stderr.on('data', log);
  await ready('Next.js', async () => {
    assert.ok(dev.exitCode == null, `Next exited ${dev.exitCode}`);
    const response = await fetch(`${base}/api/admin/session`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
  });
  check('isolated Next.js app starts with local-only environment', true);

  const guest = new Client(), admin = new Client(), player = new Client(), player2 = new Client();
  check('player API requires a real signed-in session', (await guest.call('/api/me')).status, 401);
  check('LINE admin configuration requires admin login', (await guest.call('/api/admin/line.groups')).status, 401);
  check('LINE display-name changes require admin login', (await guest.call('/api/admin/line.group.rename', { team_id: 'unknown', name: 'forbidden' })).status, 401);
  await admin.ok('/api/admin/login', { password: adminPassword });
  check('admin login creates the admin session', admin.cookies.has('fc_admin'));
  await admin.ok('/api/admin/team.save', { name: 'STACK Team D' });
  const team = (await admin.ok('/api/admin/teams')).teams.find((entry) => entry.name === 'STACK Team D');
  assert.ok(team?.team_id);
  await admin.ok('/api/admin/line.group.save', { team_id: team.team_id, group: 'D', url: 'https://line.me/ti/g/food-camp-local-test-D' });
  check('admin configures team D invite through the real RPC', true);
  await admin.ok('/api/admin/participant.save', { name: 'Stack First Member', nick_name: 'Stack One', team_id: team.team_id, login_id: 'STACK001' });
  await admin.ok('/api/admin/participant.save', { name: 'Stack Second Member', nick_name: 'Stack Two', team_id: team.team_id, login_id: 'STACK002' });
  await admin.ok('/api/admin/game.set', { line_open: true });
  await player.ok('/api/login', { id: 'STACK001' });
  await player2.ok('/api/login', { id: 'STACK002' });
  check('player login creates a signed participant session', player.cookies.has('fc_player'));
  let me = await player.ok('/api/me');
  check('home API shows assigned D group, invite, and full roster', [me.line.group, me.line.total, me.line.joinedCount, me.line.joined, me.line.url], ['D', 2, 0, false, 'https://line.me/ti/g/food-camp-local-test-D']);
  check('all default closed activity and market menus are disabled', Object.values(me.menus).every((value) => !value));
  check('pre-name database still renders player status with stable code fallback', me.line.groupName, 'D');
  const oldAdmin = (await admin.ok('/api/admin/line.groups')).teams.find((entry) => entry.id === team.team_id);
  check('pre-name database still loads admin LINE groups', oldAdmin.line_group_name, null);
  check('pre-name database still loads admin assignments', (await admin.ok('/api/admin/participants')).participants.length, 2);
  check('health distinguishes a pending optional name upgrade', (await guest.ok('/api/health')).features.lineNames.ready, false);
  const pending = await admin.call('/api/admin/line.group.rename', { team_id: team.team_id, name: 'เพื่อนร่วมค่าย' });
  check('rename before database upgrade gives clear409 without breaking login', [pending.status, pending.data.error], [409, 'LINE_NAMES_NOT_READY']);
  await sql(await readFile(path.join(root, 'supabase/line-group-names.sql'), 'utf8'));
  await sql("notify pgrst, 'reload schema';");
  await ready('PostgREST display-name schema refresh', async () => {
    const response = await fetch(`http://127.0.0.1:${restPort}/teams?select=line_group_name&limit=0`, { headers: { Authorization: `Bearer ${serviceKey}` }, signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
  });
  check('health verifies the applied display-name upgrade', (await guest.ok('/api/health')).features.lineNames.ready, true);
  const renamed = await admin.ok('/api/admin/line.group.rename', { team_id: team.team_id, name: '  เพื่อนร่วมค่าย  ' });
  check('admin saves a trimmed LINE display name through the real API', renamed.name, 'เพื่อนร่วมค่าย');
  me = await player.ok('/api/me');
  check('member receives custom display name while group identity stays D', [me.line.groupName, me.line.group], ['เพื่อนร่วมค่าย', 'D']);
  const staff = new Client();
  await staff.ok('/api/admin/login', { password: 'food-camp-local-tests-only-staff' });
  check('staff cannot rename LINE groups', (await staff.call('/api/admin/line.group.rename', { team_id: team.team_id, name: 'forbidden' })).status, 403);
  for (const invalid of ['', '   ', 'a'.repeat(61), 'two\nlines']) {
    const rejected = await admin.call('/api/admin/line.group.rename', { team_id: team.team_id, name: invalid });
    check('real rename API rejects invalid name ' + JSON.stringify(invalid), [rejected.status, rejected.data.error], [400, 'BAD_LINE_GROUP_NAME']);
  }

  await browser('initial');

  const first = await player.ok('/api/line/join', {});
  check('join API returns assigned LINE redirect URL', first.url, 'https://line.me/ti/g/food-camp-local-test-D');
  check('first click has no early group reward', [first.joinedCount, first.complete, first.balance], [1, false, 0]);
  me = await player.ok('/api/me');
  check('saved first click appears on the player homepage data', [me.line.joined, me.line.joinedCount, me.team.balance], [true, 1, 0]);
  const second = await player2.ok('/api/line/join', {});
  check('last team member completes rank 1 and wallet receives 20', [second.joinedCount, second.complete, second.rank, second.tokens, second.balance], [2, true, 1, 20, 20]);
  await Promise.all(Array.from({ length: 5 }, () => player.ok('/api/line/join', {})));
  me = await player.ok('/api/me');
  check('repeated HTTP requests do not duplicate the team reward', [me.line.rank, me.line.tokens, me.team.balance], [1, 20, 20]);
  check('completion renders every member as joined', me.line.members.every((member) => member.joined));
  const group = (await admin.ok('/api/admin/line.groups')).teams.find((entry) => entry.id === team.team_id);
  check('admin sees the same completed roster and rank', [group.joinedCount, group.line_finish_rank, group.line_reward_tokens], [2, 1, 20]);
  const completedSnapshotSql = `select jsonb_build_object('team',(select to_jsonb(t)-'line_group_name' from teams t where id='${team.team_id}'), 'members',(select jsonb_agg(to_jsonb(p) order by id) from participants p where team_id='${team.team_id}'), 'ledger',(select jsonb_agg(to_jsonb(l) order by id) from token_ledger l where team_id='${team.team_id}'));`;
  const completedSnapshot = await sql(completedSnapshotSql);
  await admin.ok('/api/admin/line.group.rename', { team_id: team.team_id, name: 'ชาวแคมป์สายชิล' });
  check('renaming a completed group preserves every scored team, roster and ledger field', await sql(completedSnapshotSql), completedSnapshot);
  me = await player.ok('/api/me');
  check('completed member gets renamed group and unchanged reward', [me.line.groupName, me.line.group, me.line.rank, me.line.tokens, me.team.balance], ['ชาวแคมป์สายชิล', 'D', 1, 20, 20]);

  await browser('complete');

  for (const [route, code] of [['/api/hunt', 'HUNT_CLOSED'], ['/api/photos', 'PUZZLE_CLOSED'], ['/api/minigames', 'MG_CLOSED']]) {
    const result = await player.call(route);
    check(`closed ${route} blocks content at the real API`, [result.status, result.data.error], [403, code]);
    check(`closed ${route} response contains no hidden mission`, JSON.stringify(result.data).includes('STACK HIDDEN'), false);
  }
  check('closed quiz omits the current question and market omits items', [me.current, me.market], [null, []]);
  await admin.ok('/api/admin/game.set', { is_open: true, market_open: true });
  await player.ok('/api/start', {});
  me = await player.ok('/api/me');
  check('opening quiz and market reveals enabled content', [me.menus.quiz, me.menus.market, me.current.prompt, me.market[0].name], [true, true, 'STACK HIDDEN QUESTION', 'STACK HIDDEN MARKET']);
  await admin.ok('/api/admin/game.set', { is_open: false, market_open: false, line_open: false });
  me = await player.ok('/api/me');
  check('closing switches hides content for an already logged-in player', [me.menus.quiz, me.menus.market, me.current, me.market, me.line.url], [false, false, null, [], null]);
  const closedJoin = await player.call('/api/line/join', {});
  check('closing LINE blocks even repeated redirect requests', [closedJoin.status, closedJoin.data.error], [403, 'LINE_CLOSED']);
  console.log(`\n${passed} full-stack checks passed against local PostgreSQL/PostgREST with real API routes and browser rendering.`);
} catch (error) {
  console.error('Local stack verification failed:', error.message);
  if (devLog) console.error('Isolated Next.js logs:\n' + devLog);
  throw error;
} finally {
  if (dev?.pid) {
    try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* already stopped */ }
    await new Promise((resolve) => { if (dev.exitCode != null) resolve(); else { dev.once('exit', resolve); setTimeout(resolve, 3000).unref(); } });
  }
  if (proxy) await new Promise((resolve) => proxy.close(resolve));
  for (const name of createdContainers.reverse()) { try { execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' }); } catch { /* already stopped */ } }
  if (networkCreated) { try { execFileSync('docker', ['network', 'rm', network], { stdio: 'ignore' }); } catch { /* already stopped */ } }
  if (appDir) await rm(appDir, { recursive: true, force: true });
}
