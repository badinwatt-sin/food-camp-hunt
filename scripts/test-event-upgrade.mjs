// Real, isolated PostgreSQL verification for the event UX/roles/rewards upgrade.
// Requires Docker. Never reads SUPABASE_URL or any production credentials.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const container = `food-camp-event-test-${process.pid}`;
const lit = (value) => value == null ? 'null' : `'${String(value).replaceAll("'", "''")}'`;
const dockerEnv = { ...process.env };
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete dockerEnv[key];
const dockerArgs = (args) => ['--host=unix:///var/run/docker.sock', ...args];
let passed = 0, started = false;
function check(label, actual, expected = true) {
  assert.deepEqual(actual, expected, label); passed++; console.log(`PASS ${label}`);
}
function command(args, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', dockerArgs(args), { env: dockerEnv, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', error = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { error += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim()) : reject(new Error(error || output || `docker exit ${code}`)));
    child.stdin.end(input);
  });
}
const sql = (query, database = 'event_upgrade') => command(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], query);
const json = async (query, database) => JSON.parse(await sql(query, database));
const rpc = (name, args = []) => json(`select public.${name}(${args.map(lit).join(',')});`);
async function denied(label, query, code) {
  await assert.rejects(sql(query), new RegExp(code), label); passed++; console.log(`PASS ${label}`);
}
const join = (id) => rpc('join_line_group', [id]);
const configure = (team, code, url) => rpc('configure_line_group', [team, code, url]);
const bal = async (id) => Number(await sql(`select team_balance(${lit(id)});`));
const bootstrap = 'create schema storage; create table storage.buckets(id text primary key,name text,public boolean);';
const memoryState = { layout: ['a','a','b','b','c','c','d','d','e','e','f','f'], matched: Array.from({ length: 12 }, (_, i) => i), moves: 6, open: null };
const spotState = { scene: 0, found: [0,1,2,3,4], misses: 0 };
const mysteryState = { idx: 5, right: 5, shownAt: null, got: [10,10,10,10,10], rounds: Array.from({ length: 5 }, (_, i) => ({ a: String(i), opts: [String(i)] })) };
async function person(team, name, extra = '') {
  const id = randomUUID();
  await sql(`insert into participants(id,team_id,name${extra ? ', ' + extra.split(':')[0] : ''}) values(${lit(id)},${lit(team)},${lit(name)}${extra ? ', ' + extra.split(':').slice(1).join(':') : ''});`);
  return id;
}
async function attempt(pid, game, n, state, extra = '') {
  const id = randomUUID();
  await sql(`insert into minigame_attempts(id,participant_id,game,n,state${extra ? ',started_at' : ''}) values(${lit(id)},${lit(pid)},${lit(game)},${n},${lit(JSON.stringify(state))}::jsonb${extra ? ',' + extra : ''});`);
  return id;
}
const finish = (id, tokens = 999999) => json(`select mg_finish(${lit(id)},${tokens},'{"success":true,"tokens":999999}'::jsonb);`);
try {
  const migration = await readFile(new URL('supabase/event-upgrade.sql', root), 'utf8');
  const schema = await readFile(new URL('supabase/schema.sql', root), 'utf8');
  const at = schema.lastIndexOf(migration.trim());
  assert.ok(at >= 0, 'fresh schema embeds the event migration verbatim');
  const baseline = schema.slice(0, at);
  await command(['run','--detach','--rm','--name',container,'-e','POSTGRES_PASSWORD=local-event-tests-only','-e','POSTGRES_DB=event_upgrade','postgres:16']); started = true;
  for (let n = 0; ; n++) {
    try { await command(['exec',container,'pg_isready','-h','127.0.0.1','-U','postgres','-d','event_upgrade']); break; }
    catch (e) { if (n >= 100) throw e; await new Promise((resolve) => setTimeout(resolve, 300)); }
  }
  await sql(`create role anon; create role authenticated; create role service_role bypassrls; ${bootstrap}`);
  await sql(baseline);
  const teamD = randomUUID(), teamC = randomUUID(), squadTeam = randomUUID(), foreignTeam = randomUUID();
  await sql(`insert into teams(id,name) values(${lit(teamD)},'Existing D'),(${lit(teamC)},'Eligible C'),(${lit(squadTeam)},'Squad team'),(${lit(foreignTeam)},'Foreign team');`);
  const oldLeader = await person(teamD, 'Existing leader', 'is_leader:true');
  const oldMember = await person(teamD, 'Existing member');
  await configure(teamD, 'D', 'https://line.me/ti/g/event-D-original');
  await sql('update game_settings set line_open=true,mg_memory_open=true where id=1;');
  await join(oldLeader); await join(oldMember);
  const oldAttempt = await attempt(oldLeader, 'memory', 1, memoryState);
  await finish(oldAttempt, 7);
  const oldLedger = await sql(`select jsonb_agg(to_jsonb(l) order by id) from token_ledger l where team_id=${lit(teamD)};`);
  const oldJoin = await sql(`select jsonb_agg(jsonb_build_object('id',id,'at',line_joined_at) order by id) from participants where team_id=${lit(teamD)};`);
  await sql(migration); await sql(migration);
  check('migration and rerun preserve every historical token ledger entry', await sql(`select jsonb_agg(to_jsonb(l) order by id) from token_ledger l where team_id=${lit(teamD)};`), oldLedger);
  check('migration and rerun preserve existing invitation clicks', await sql(`select jsonb_agg(jsonb_build_object('id',id,'at',line_joined_at) order by id) from participants where team_id=${lit(teamD)};`), oldJoin);
  check('old members remain contributing members by default', await sql(`select bool_and(not is_observer) from participants;`), 't');
  check('LINE revision starts at one on migrated teams', await sql(`select line_revision from teams where id=${lit(teamD)};`), '1');
  await sql('create database event_fresh;'); await sql(bootstrap, 'event_fresh'); await sql(schema, 'event_fresh'); await sql(migration, 'event_fresh');
  check('fresh schema and idempotent event migration both create observer roles', await sql("select count(*) from information_schema.columns where table_schema='public' and table_name='participants' and column_name='is_observer';", 'event_fresh'), '1');

  const observer = await person(teamD, 'Activity staff', 'is_observer:true');
  check('observer can be added to an already rewarded team', await sql(`select is_observer from participants where id=${lit(observer)};`), 't');
  await sql(`update participants set team_id=${lit(teamC)} where id=${lit(observer)}; update participants set team_id=${lit(teamD)} where id=${lit(observer)};`);
  check('observer can move across teams without changing eligible rosters', await sql(`select team_id from participants where id=${lit(observer)};`), teamD);
  const oldBalance = await bal(teamD);
  await join(observer);
  check('observer opening LINE cannot change wallet or completion reward', await bal(teamD), oldBalance);
  const beforeRevision = await json(`select jsonb_build_object('rank',line_finish_rank,'tokens',line_reward_tokens,'completed',line_completed_at) from teams where id=${lit(teamD)};`);
  await configure(teamD, 'D', 'https://line.me/ti/g/event-D-updated');
  check('updating an already joined invite creates a new notification revision', await sql(`select line_revision from teams where id=${lit(teamD)};`), '2');
  check('changing LINE link clears all member and observer click status', await sql(`select count(*) from participants where team_id=${lit(teamD)} and line_joined_at is not null;`), '0');
  check('link update preserves the previously awarded rank, amount and completion time', await json(`select jsonb_build_object('rank',line_finish_rank,'tokens',line_reward_tokens,'completed',line_completed_at) from teams where id=${lit(teamD)};`), beforeRevision);
  check('link update preserves the wallet ledger', await bal(teamD), oldBalance);
  await configure(teamD, 'D', 'https://line.me/ti/g/event-D-updated');
  check('saving an unchanged link does not trigger another notification', await sql(`select line_revision from teams where id=${lit(teamD)};`), '2');
  await Promise.all([join(oldLeader),join(oldMember),join(observer),join(oldLeader)]);
  check('rejoining a revised invitation never awards the LINE reward again', await bal(teamD), oldBalance);
  const clicksAfter = await sql(`select jsonb_agg(jsonb_build_object('id',id,'at',line_joined_at) order by id) from participants where team_id=${lit(teamD)};`);
  await sql(`update teams set line_group_name='เปลี่ยนชื่อเท่านั้น' where id=${lit(teamD)};`);
  check('renaming does not change LINE revision', await sql(`select line_revision from teams where id=${lit(teamD)};`), '2');
  check('renaming does not clear anyone’s invitation click', await sql(`select jsonb_agg(jsonb_build_object('id',id,'at',line_joined_at) order by id) from participants where team_id=${lit(teamD)};`), clicksAfter);

  const memberC = await person(teamC, 'Only contributing member');
  const observerC = await person(teamC, 'Observer not joining', 'is_observer:true');
  await configure(teamC, 'C', 'https://line.me/ti/g/event-C');
  const joinedC = await join(memberC);
  check('a full eligible team can finish without any observer joining LINE', joinedC.complete, true);
  check('LINE completion denominator excludes observers', [joinedC.total,joinedC.joinedCount], [1,1]);
  check('team summary counts only participating members', await sql(`select participants from team_summary where team_id=${lit(teamC)};`), '1');
  await sql(`update game_settings set team_goal_pct=100,is_open=true,hunt_open=true,puzzle_open=true,mg_spot_open=true,mg_memory_open=true,mg_mystery_open=true,mg_spot_tokens=17,mg_memory_tokens=23,mg_mystery_tokens=31 where id=1;
    update participants set status='completed' where id=${lit(memberC)};`);
  check('quiz team goal excludes observers from its percentage denominator', await sql(`select team_goal_met(${lit(teamC)});`), 't');
  check('team summary completed count is only eligible members', await sql(`select completed from team_summary where team_id=${lit(teamC)};`), '1');
  await denied('observer cannot be promoted to leader', `update participants set is_leader=true where id=${lit(observerC)};`, 'OBSERVER|ROLE_CHANGE|observer');
  await denied('scored participant cannot change into an observer to alter ratios', `update participants set is_observer=true where id=${lit(oldMember)};`, 'ROLE_CHANGE_LOCKED|LINE_GROUP_COMPLETED');

  const question = randomUUID(), spot = randomUUID(), puzzle = randomUUID(), photo = randomUUID();
  await sql(`insert into questions(id,prompt,options,correct_index) values(${lit(question)},'Test quiz',array['A','B','C','D'],0);
    insert into hunt_spots(id,title,hint,secret,tokens,min_players) values(${lit(spot)},'Coop','test','EVENTCOOP',9,3);
    insert into team_puzzles(id,prompt,clues,options,correct_index) values(${lit(puzzle)},'Puzzle',array['A','B'],array['A','B','C','D'],0);
    insert into photo_missions(id,title,description,tokens) values(${lit(photo)},'Photo','test',5);`);
  const observerCalls = [
    ['start quiz', `select start_participant(${lit(observerC)});`],
    ['submit answer', `select submit_answer(${lit(observerC)},${lit(question)},0);`],
    ['complete quiz', `select complete_quiz(${lit(observerC)});`],
    ['claim hunt', `select claim_spot(${lit(observerC)},'EVENTCOOP');`],
    ['submit puzzle', `select submit_puzzle(${lit(observerC)},${lit(puzzle)},0);`],
    ['submit photo', `select submit_photo(${lit(observerC)},${lit(photo)},'https://example.test/image.jpg');`],
  ];
  for (const [label, query] of observerCalls) await denied(`database refuses observer gameplay: ${label}`, query, 'OBSERVER_READ_ONLY');
  const observerWrites = [
    ['answers', `insert into answers(participant_id,question_id,selected_index,is_correct) values(${lit(observerC)},${lit(question)},0,true);`],
    ['minigame attempts', `insert into minigame_attempts(participant_id,game,n,state) values(${lit(observerC)},'spot',1,'{}');`],
    ['hunt scans', `insert into hunt_scans(spot_id,team_id,participant_id) values(${lit(spot)},${lit(teamC)},${lit(observerC)});`],
    ['hunt claims', `insert into hunt_claims(spot_id,team_id,participant_id,tokens) values(${lit(spot)},${lit(teamC)},${lit(observerC)},9);`],
    ['puzzle attempts', `insert into puzzle_attempts(puzzle_id,team_id,participant_id,selected_index,is_correct) values(${lit(puzzle)},${lit(teamC)},${lit(observerC)},0,true);`],
    ['puzzle solves', `insert into puzzle_solves(puzzle_id,team_id,participant_id,tokens) values(${lit(puzzle)},${lit(teamC)},${lit(observerC)},9);`],
    ['photo submissions', `insert into photo_submissions(mission_id,team_id,participant_id,image_url,tokens) values(${lit(photo)},${lit(teamC)},${lit(observerC)},'https://example.test/observer.jpg',9);`],
    ['token ledger', `insert into token_ledger(team_id,participant_id,kind,amount,idempotency_key) values(${lit(teamC)},${lit(observerC)},'quiz',99,'observer-forgery');`],
  ];
  for (const [label, query] of observerWrites) await denied(`direct table guards reject observer ${label}`, query, 'OBSERVER_READ_ONLY');
  check('observer has no contribution token ledger', await sql(`select count(*) from token_ledger where participant_id=${lit(observerC)};`), '0');
  const claimC = await rpc('claim_spot',[memberC,'EVENTCOOP']);
  check('co-op hunt scales required players to eligible members without observers', [claimC.pending,claimC.tokens], [false,9]);

  const leader = await person(squadTeam,'Leader','is_leader:true');
  const teammate = await person(squadTeam,'Teammate');
  const ordinary = await person(squadTeam,'Ordinary member');
  const observerSquad = await person(squadTeam,'Squad staff','is_observer:true');
  const foreign = await person(foreignTeam,'Other team member');
  await rpc('leader_manage_squad',[leader,'create','  Cooking A  ',null,null]);
  const squad = await sql(`select id from squads where team_id=${lit(squadTeam)} and name='Cooking A';`);
  check('team leader can create a trimmed squad inside their team', !!squad);
  await rpc('leader_manage_squad',[leader,'assign',null,teammate,squad]);
  check('team leader can assign a teammate to their own squad', await sql(`select squad_id from participants where id=${lit(teammate)};`), squad);
  await denied('ordinary member cannot create or manage squads', `select leader_manage_squad(${lit(ordinary)},'create','Forbidden',null,null);`, 'NOT_LEADER');
  await denied('observer cannot manage squads', `select leader_manage_squad(${lit(observerSquad)},'create','Forbidden',null,null);`, 'OBSERVER_READ_ONLY|NOT_LEADER');
  await denied('leader cannot assign a member from another team', `select leader_manage_squad(${lit(leader)},'assign',null,${lit(foreign)},${lit(squad)});`, 'BAD_INPUT|NOT_FOUND|SQUAD_NOT_FOUND|FORBIDDEN');
  await denied('leader cannot assign observer staff to contribution squads', `select leader_manage_squad(${lit(leader)},'assign',null,${lit(observerSquad)},${lit(squad)});`, 'OBSERVER_READ_ONLY|BAD_INPUT');
  await sql(`insert into squads(team_id,name) values(${lit(foreignTeam)},'Foreign squad');`);
  const foreignSquad = await sql(`select id from squads where team_id=${lit(foreignTeam)};`);
  await denied('leader cannot use a squad owned by another team', `select leader_manage_squad(${lit(leader)},'assign',null,${lit(teammate)},${lit(foreignSquad)});`, 'SQUAD_NOT_FOUND|BAD_INPUT|FORBIDDEN');
  await rpc('leader_manage_squad',[leader,'assign',null,teammate,null]);
  check('leader can remove an unstarted teammate from a squad', await sql(`select squad_id is null from participants where id=${lit(teammate)};`), 't');
  await rpc('leader_manage_squad',[leader,'assign',null,teammate,squad]);
  await rpc('claim_spot',[teammate,'EVENTCOOP']);
  await denied('squad membership is locked after hunt progress to prevent duplicate rewards', `select leader_manage_squad(${lit(leader)},'assign',null,${lit(teammate)},null);`, 'SQUAD_LOCKED');

  // Fixed rewards are determined from persisted completion state, not the caller's tokens or success flag.
  const gamer = await person(foreignTeam,'Fixed-reward player');
  const partialSpot = await attempt(gamer,'spot',1,{...spotState,found:[0,1]});
  const partialResult = await finish(partialSpot);
  check('partial spot progress gets no Tokens despite forged success/tokens input', [partialResult.tokens,partialResult.awarded], [0,0]);
  const completeSpot = await attempt(gamer,'spot',2,spotState);
  const spotResults = await Promise.all(Array.from({length:8},()=>finish(completeSpot)));
  check('concurrent success awards only the Admin configured spot amount', spotResults.reduce((sum,r)=>sum+r.awarded,0),17);
  check('spot reward is independent of client-supplied amount', await bal(foreignTeam),17);
  await sql('update game_settings set mg_spot_tokens=90 where id=1;');
  const spotAgain = await attempt(gamer,'spot',3,spotState);
  const secondSpot = await finish(spotAgain);
  check('later success and changed reward configuration cannot credit the same player/game again', secondSpot.awarded,0);
  check('raising reward does not top up a previously rewarded weekly game', await bal(foreignTeam),17);
  const partialMemory = await attempt(gamer,'memory',1,{...memoryState,matched:[0,1]});
  check('partial memory game earns no fixed reward', (await finish(partialMemory)).awarded,0);
  const completeMemory = await attempt(gamer,'memory',2,memoryState);
  check('matching every pair earns the exact Admin memory reward', (await finish(completeMemory)).awarded,23);
  const wrongMystery = await attempt(gamer,'mystery',1,{...mysteryState,right:4,got:[10,10,10,10,0]});
  check('mystery requires all five correct answers', (await finish(wrongMystery)).awarded,0);
  const completeMystery = await attempt(gamer,'mystery',2,mysteryState);
  check('five correct mystery answers earn the Admin fixed reward', (await finish(completeMystery)).awarded,31);
  check('all completed weekly rewards sum to the three configured values once', await bal(foreignTeam),71);
  const historicalReplay = await attempt(oldLeader,'memory',2,memoryState);
  check('historical best-of-three credit is preserved without a second new reward', (await finish(historicalReplay)).awarded,0);
  check('legacy wallet stays intact after the scoring-model upgrade', await bal(teamD),oldBalance);
  const zeroPlayer = await person(foreignTeam,'Zero configured reward');
  await sql('update game_settings set mg_memory_tokens=0 where id=1;');
  const zeroAttempt = await attempt(zeroPlayer,'memory',1,memoryState);
  check('Admin may configure a zero-token completion reward', (await finish(zeroAttempt)).awarded,0);
  await sql('update game_settings set mg_memory_tokens=100 where id=1;');
  const zeroAgain = await attempt(zeroPlayer,'memory',2,memoryState);
  check('a zero-token successful claim still counts as already claimed', (await finish(zeroAgain)).awarded,0);
  for (const role of ['anon','authenticated']) {
    await denied(`${role} cannot invoke leader squad-management RPC`, `set role ${role}; select leader_manage_squad(${lit(leader)},'create','Unauthorized',null,null);`, 'permission denied');
    await denied(`${role} cannot invoke weekly-finish RPC`, `set role ${role}; select mg_finish(${lit(completeSpot)},99999,'{}');`, 'permission denied');
  }
  check('no observer ever contributes a gameplay reward', await sql('select count(*) from token_ledger l join participants p on p.id=l.participant_id where p.is_observer;'),'0');
  console.log(`\n${passed} event-upgrade PostgreSQL checks passed.`);
} finally {
  if (started) execFileSync('docker',dockerArgs(['rm','-f',container]),{env:dockerEnv,stdio:'ignore'});
}
