// Isolated PostgreSQL integration tests. Never uses SUPABASE_URL or a remote database.
// Requires Docker; runs a disposable postgres:16 container and removes it at the end.
// Run: node scripts/test-line-db.mjs
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const container = `food-camp-line-test-${process.pid}`;
const root = new URL('../', import.meta.url);
const literal = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
let passed = 0;
let started = false;
function check(label, actual, expected = true) {
  assert.deepEqual(actual, expected, label);
  passed++;
  console.log(`PASS ${label}`);
}
function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout.trim()) : reject(new Error(stderr || stdout || `docker exited ${code}`)));
    child.stdin.end(input);
  });
}
const sql = (query, database = 'foodcamp') => command(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], query);
const json = async (query) => JSON.parse(await sql(query));
const rpc = (name, args = []) => json(`select public.${name}(${args.map(literal).join(',')});`);
async function expectError(label, query, code) {
  await assert.rejects(sql(query), new RegExp(code), label);
  passed++;
  console.log(`PASS ${label}`);
}
const joinSql = (id) => `select public.join_line_group(${literal(id)});`;
const join = (id) => rpc('join_line_group', [id]);
const configure = (id, code, url = `https://line.me/ti/g/test-${code}`) => rpc('configure_line_group', [id, code, url]);
const balance = async (id) => Number(await sql(`select public.team_balance(${literal(id)});`));
const roster = async (team, names) => {
  const ids = names.map(() => randomUUID());
  await sql(`insert into public.participants(id,team_id,name) values ${ids.map((id, i) => `(${literal(id)},${literal(team)},${literal(names[i])})`).join(',')};`);
  return ids;
};
const bootstrap = `create schema storage; create table storage.buckets(id text primary key, name text, public boolean);`;

try {
  const schema = await readFile(new URL('supabase/schema.sql', root), 'utf8');
  const migration = await readFile(new URL('supabase/line-groups.sql', root), 'utf8');
  // The full schema deliberately includes the same idempotent migration verbatim.
  const migrationAt = schema.lastIndexOf(migration.trim());
  assert.ok(migrationAt >= 0, 'schema.sql must include the LINE migration');
  const baseline = schema.slice(0, migrationAt);
  console.log('Starting disposable PostgreSQL 16 container…');
  await command(['run', '--detach', '--rm', '--name', container, '-e', 'POSTGRES_PASSWORD=local-tests-only', '-e', 'POSTGRES_DB=foodcamp', 'postgres:16']);
  started = true;
  for (let attempt = 0; ; attempt++) {
    // Official image starts a temporary Unix-only server while initdb runs.
    try { await command(['exec', container, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'foodcamp']); break; }
    catch (error) { if (attempt >= 100) throw error; await new Promise((resolve) => setTimeout(resolve, 300)); }
  }
  await sql(`create role anon; create role authenticated; create role service_role bypassrls; ${bootstrap}`);
  await sql(schema);
  check('fresh schema creates LINE settings', await sql('select line_open from public.game_settings where id=1;'), 'f');
  await sql(migration);
  await sql(migration);
  check('LINE migration can run repeatedly on fresh schema', true);

  await sql('create database foodcamp_upgrade;');
  await sql(bootstrap, 'foodcamp_upgrade');
  await sql(baseline, 'foodcamp_upgrade');
  await sql(migration, 'foodcamp_upgrade');
  await sql(migration, 'foodcamp_upgrade');
  check('existing pre-LINE schema upgrades and migration reruns safely', await sql('select line_open from public.game_settings where id=1;', 'foodcamp_upgrade'), 'f');

  const teams = ['D', 'C', 'A', 'O'].map(() => randomUUID());
  const reserveTeam = randomUUID();
  await sql(`insert into public.teams(id,name) values ${[...teams, reserveTeam].map((id, i) => `(${literal(id)},${literal(`LINE test ${i}`)})`).join(',')};`);
  const members = [];
  for (let i = 0; i < teams.length; i++) members.push(await roster(teams[i], [`${i} member one`, `${i} member two`]));
  const [reserveMember] = await roster(reserveTeam, ['unconfigured member']);

  await expectError('joining is disabled while LINE switch is closed', joinSql(members[0][0]), 'LINE_CLOSED');
  check('closed request leaves first-click timestamp unset', await sql(`select line_joined_at is null from participants where id=${literal(members[0][0])};`), 't');
  for (const bad of ['http://line.me/ti/g/test', 'https://example.com/line', 'https://line.me.evil.example/ti/g/test', 'https://user@line.me/ti/g/test', 'https://line.me:444/ti/g/test', 'https://line.me:443/ti/g/test', 'https://line.me/', 'https://lin.ee/?query=only']) {
    await expectError(`invite URL is validated: ${bad}`, `select configure_line_group(${literal(teams[0])},'D',${literal(bad)});`, 'BAD_LINE_URL');
  }
  for (let i = 0; i < teams.length; i++) await configure(teams[i], ['D', 'C', 'A', 'O'][i]);
  await expectError('only D/C/A/O group codes are accepted', `select configure_line_group(${literal(reserveTeam)},'X','https://line.me/ti/g/test');`, 'BAD_LINE_GROUP');
  await expectError('one LINE code cannot belong to two teams', `select configure_line_group(${literal(reserveTeam)},'D','https://line.me/ti/g/test');`, 'LINE_GROUP_TAKEN');
  await sql('update game_settings set line_open=true where id=1;');
  await expectError('team without configured LINE group cannot join', joinSql(reserveMember), 'LINE_NOT_CONFIGURED');

  const first = await join(members[0][0]);
  check('click returns exactly the configured LINE invite', first.url, 'https://line.me/ti/g/test-D');
  check('first member alone does not score', await balance(teams[0]), 0);
  check('members with no login ID are still included in completion', await sql(`select line_completed_at is null from teams where id=${literal(teams[0])};`), 't');
  const firstAt = await sql(`select line_joined_at from participants where id=${literal(members[0][0])};`);
  await Promise.all(Array.from({ length: 6 }, () => join(members[0][0])));
  check('duplicate clicks preserve the first timestamp', await sql(`select line_joined_at from participants where id=${literal(members[0][0])};`), firstAt);
  check('duplicate first-member clicks do not score early', await balance(teams[0]), 0);
  await expectError('invite cannot change after a member clicked', `select configure_line_group(${literal(teams[0])},'D','https://line.me/ti/g/new');`, 'LINE_GROUP_IN_USE');
  await configure(teams[0], 'D');
  check('saving unchanged invite remains allowed after first click', true);

  // Two independent connections race to complete the first team.
  await Promise.all(Array.from({ length: 8 }, () => join(members[0][1])));
  check('first complete group earns 20 exactly once', await balance(teams[0]), 20);
  check('concurrent duplicate last clicks insert one ledger row', await sql(`select count(*) from token_ledger where idempotency_key=${literal(`line:${teams[0]}`)};`), '1');
  check('first complete group receives rank 1', await sql(`select line_finish_rank from teams where id=${literal(teams[0])};`), '1');

  await join(members[1][0]);
  await join(members[1][1]);
  check('second group earns 15 tokens', await balance(teams[1]), 15);
  check('second complete group receives rank 2', await sql(`select line_finish_rank from teams where id=${literal(teams[1])};`), '2');
  await Promise.all([join(members[2][0]), join(members[3][0])]);
  await Promise.all([join(members[2][1]), join(members[3][1])]);
  const finalRanks = await json(`select json_agg(row_to_json(t) order by line_finish_rank) from (select line_finish_rank,line_reward_tokens from teams where line_finish_rank is not null) t;`);
  check('cross-team completion races allocate unique ranks and 20/15/10/5 rewards', finalRanks, [1, 2, 3, 4].map((rank, i) => ({ line_finish_rank: rank, line_reward_tokens: [20, 15, 10, 5][i] })));
  check('all four team wallets total 50 tokens', Number(await sql("select sum(amount) from token_ledger where idempotency_key like 'line:%';")), 50);
  await Promise.all(members.flat().map(join));
  check('replaying all members adds no additional tokens', Number(await sql("select sum(amount) from token_ledger where idempotency_key like 'line:%';")), 50);

  await expectError('cannot add a member to a scored group', `insert into participants(team_id,name) values(${literal(teams[0])},'late member');`, 'LINE_GROUP_COMPLETED');
  await expectError('cannot remove a member from a scored group', `delete from participants where id=${literal(members[0][0])};`, 'LINE_GROUP_COMPLETED');
  await expectError('cannot move a member out of a scored group', `update participants set team_id=${literal(reserveTeam)} where id=${literal(members[0][0])};`, 'LINE_GROUP_COMPLETED');
  await expectError('cannot move a member into a scored group', `update participants set team_id=${literal(teams[0])} where id=${literal(reserveMember)};`, 'LINE_GROUP_COMPLETED');

  for (const role of ['anon', 'authenticated']) {
    await expectError(`${role} cannot call join RPC`, `set role ${role}; ${joinSql(members[0][0])}`, 'permission denied');
    await expectError(`${role} cannot configure LINE groups`, `set role ${role}; select configure_line_group(${literal(teams[0])},'D','https://line.me/ti/g/test');`, 'permission denied');
    await expectError(`${role} cannot reset LINE results`, `set role ${role}; select reset_line_checkin();`, 'permission denied');
  }
  await sql('select reset_line_checkin();');
  check('reset closes LINE before clearing the race', await sql('select line_open from game_settings where id=1;'), 'f');
  check('reset removes all LINE rewards', Number(await sql("select count(*) from token_ledger where idempotency_key like 'line:%';")), 0);
  check('reset clears group ranks/completion and member check-ins', await sql('select (select count(*) from teams where line_finish_rank is not null or line_completed_at is not null)=0 and (select count(*) from participants where line_joined_at is not null)=0;'), 't');
  check('reset preserves the configured invitations', await sql('select count(*) from teams where line_group_code is not null and line_group_url is not null;'), '4');
  await sql('update game_settings set line_open=true where id=1;');
  await join(members[0][0]);
  await sql(`update participants set team_id=${literal(reserveTeam)} where id=${literal(members[0][0])};`);
  check('moving a member before completion clears their old LINE click', await sql(`select line_joined_at is null from participants where id=${literal(members[0][0])};`), 't');
  await sql(`update participants set team_id=${literal(teams[0])} where id=${literal(members[0][0])};`);
  await Promise.all(members.map((team) => join(team[0])));
  await Promise.all(members.map((team) => join(team[1])));
  const parallelRanks = await json('select json_agg(row_to_json(t) order by line_finish_rank) from (select line_finish_rank,line_reward_tokens from teams where line_finish_rank is not null) t;');
  check('all four final members racing still receive four unique ranked rewards', parallelRanks, [1, 2, 3, 4].map((rank, i) => ({ line_finish_rank: rank, line_reward_tokens: [20, 15, 10, 5][i] })));
  await sql(`set role service_role; ${joinSql(members[0][0])}`);
  check('service role can replay the join RPC', true);

  // A roster write racing the last member must either enter the roster before
  // completion or be rejected after scoring, never produce a falsely complete team.
  await sql('select reset_line_checkin(); update game_settings set line_open=true where id=1;');
  await join(members[0][0]);
  const lateId = randomUUID();
  const rosterRace = await Promise.allSettled([
    join(members[0][1]),
    sql(`insert into participants(id,team_id,name) values(${literal(lateId)},${literal(teams[0])},'racing roster member');`),
  ]);
  check('last click succeeds while racing a roster insertion', rosterRace[0].status, 'fulfilled');
  if (rosterRace[1].status === 'fulfilled') {
    check('roster inserted first leaves team incomplete with no premature reward', await balance(teams[0]), 0);
    await join(lateId);
    check('new roster member finishes group and receives its one reward', await balance(teams[0]), 20);
  } else {
    check('roster inserted after completion is rejected with the expected code', /LINE_GROUP_COMPLETED/.test(rosterRace[1].reason.message));
    check('completed roster remains at two members and one reward', await balance(teams[0]), 20);
  }
  console.log(`\n${passed} PostgreSQL integration checks passed.`);
} finally {
  if (started) execFileSync('docker', ['rm', '-f', container], { stdio: 'ignore' });
}
