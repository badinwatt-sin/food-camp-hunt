// Database safety tests for Food Camp. Run against a TEST Supabase project, never the live event project.
//
//   node --env-file=.env.local scripts/test-db.mjs
//
// It creates its own temporary teams/squads/participants/items/spots/puzzles, checks the rules below, then deletes them.
// Requires the full schema (schema.sql, or hunt.sql + squads.sql + coop.sql on an older database) and at least one
// ACTIVE question (the seed provides 5). The test briefly opens the quiz/hunt/puzzle switches and restores them at the end.
//
//   1 quiz  2 market  3 anon (quiz)  4 hunt  5 squads  6 co-op spots  7 team goal  8 team photo missions  10 leaders/hand-over  11 check-in  12 solo mini-games  13 selfie wall  9 anon (new features)
import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (see .env.example).'); process.exit(1); }
const sb = createClient(url, key, { auth: { persistSession: false } });

let passed = 0, failed = 0;
const check = (name, cond, extra = '') => {
  if (cond) { passed++; console.log(`  PASS  ${name}`); }
  else { failed++; console.log(`  FAIL  ${name} ${extra}`); }
};
const rpc = async (fn, args) => { const { data, error } = await sb.rpc(fn, args); return { data, error: error?.message ?? null }; };
const balance = async (team) => (await sb.rpc('team_balance', { p_team: team })).data;

const created = { team: null, team2: null, teams: [], squads: [], participants: [], items: [], spots: [], photoMissions: [] };
let before = null; // game_settings to restore
const uid = () => randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();

try {
  const { data: settings } = await sb.from('game_settings').select('*').eq('id', 1).single();
  before = settings;
  const per = settings.tokens_per_correct;
  await sb.from('game_settings').update({ is_open: true }).eq('id', 1);

  const { data: questions } = await sb.from('questions').select('id, correct_index').eq('active', true).order('position').order('id');
  if (!questions?.length) throw new Error('No active questions found. Run supabase/seed.sql first.');

  created.team = (await sb.from('teams').insert({ name: 'TEST team ' + randomUUID().slice(0, 6) }).select().single()).data.id;
  const mkPerson = async (team) => {
    const id = (await sb.from('participants').insert({ team_id: team, name: 'TEST person' }).select().single()).data.id;
    created.participants.push(id); return id;
  };

  console.log('\n1. Player flow, duplicate scoring, resume');
  const p = await mkPerson(created.team);
  check('cannot answer before starting', (await rpc('submit_answer', { p_participant: p, p_question: questions[0].id, p_selected: 0 })).error?.includes('NOT_STARTED'));
  await rpc('start_participant', { p_participant: p });
  await rpc('start_participant', { p_participant: p }); // double start is harmless
  check('cannot skip ahead', questions.length < 2 || (await rpc('submit_answer', { p_participant: p, p_question: questions[1].id, p_selected: 0 })).error?.includes('OUT_OF_ORDER'));

  // Answer every question correctly; send each answer twice in parallel (simulates double-tap / retry).
  for (const q of questions) {
    const [a, b] = await Promise.all([
      rpc('submit_answer', { p_participant: p, p_question: q.id, p_selected: q.correct_index }),
      rpc('submit_answer', { p_participant: p, p_question: q.id, p_selected: q.correct_index }),
    ]);
    check(`answer accepted once, replay returns same result (${q.id.slice(0, 4)})`, !a.error && !b.error && a.data.is_correct && b.data.is_correct);
  }
  const { count: ansCount } = await sb.from('answers').select('id', { count: 'exact', head: true }).eq('participant_id', p);
  check('exactly one stored answer per question', ansCount === questions.length, `(got ${ansCount})`);

  const results = await Promise.all(Array.from({ length: 5 }, () => rpc('complete_quiz', { p_participant: p })));
  check('5 parallel complete calls all succeed', results.every((r) => !r.error));
  const expected = questions.length * per;
  const { count: quizRows } = await sb.from('token_ledger').select('id', { count: 'exact', head: true }).eq('participant_id', p).eq('kind', 'quiz');
  check('team credited exactly once', quizRows === 1 && (await balance(created.team)) === expected, `(rows ${quizRows}, balance ${await balance(created.team)}, expected ${expected})`);
  check('late answer after completion is rejected or replayed, never re-scored',
    (await rpc('submit_answer', { p_participant: p, p_question: questions[0].id, p_selected: 0 })).data?.already === true);

  console.log('\n2. Redemption: idempotency, overspend, oversell');
  // Top the team up so tests are independent of the quiz settings.
  await rpc('adjust_tokens', { p_team: created.team, p_amount: 200 - expected, p_reason: 'test top-up', p_key: randomUUID(), p_actor: 'test' });
  const startBal = await balance(created.team);
  const item = (await sb.from('market_items').insert({ name: 'TEST item', price: 30, stock: 2 }).select().single()).data;
  created.items.push(item.id);

  const k = randomUUID();
  const r1 = await rpc('redeem_item', { p_team: created.team, p_item: item.id, p_qty: 1, p_key: k, p_actor: 'test' });
  const r2 = await rpc('redeem_item', { p_team: created.team, p_item: item.id, p_qty: 1, p_key: k, p_actor: 'test' });
  check('same key twice = one charge', !r1.error && !r2.error && r2.data.already === true && (await balance(created.team)) === startBal - 30);

  // Concurrent: stock left = 1; ten different clicks at once -> only one may win.
  const race = await Promise.all(Array.from({ length: 10 }, () =>
    rpc('redeem_item', { p_team: created.team, p_item: item.id, p_qty: 1, p_key: randomUUID(), p_actor: 'test' })));
  const wins = race.filter((r) => !r.error).length;
  const { data: after } = await sb.from('market_items').select('stock').eq('id', item.id).single();
  check('oversell prevented (stock 1, 10 concurrent requests -> 1 success)', wins === 1 && after.stock === 0, `(wins ${wins}, stock ${after.stock})`);

  // Overspend: team has startBal-60; item costs 25 each, plenty of stock; fire many at once.
  const item2 = (await sb.from('market_items').insert({ name: 'TEST item 2', price: 25, stock: 50 }).select().single()).data;
  created.items.push(item2.id);
  const bal = await balance(created.team);
  const affordable = Math.floor(bal / 25);
  const race2 = await Promise.all(Array.from({ length: affordable + 6 }, () =>
    rpc('redeem_item', { p_team: created.team, p_item: item2.id, p_qty: 1, p_key: randomUUID(), p_actor: 'test' })));
  const wins2 = race2.filter((r) => !r.error).length;
  const finalBal = await balance(created.team);
  check('overspend prevented (balance never negative)', finalBal >= 0 && wins2 === affordable, `(wins ${wins2}/${affordable}, balance ${finalBal})`);
  const { data: s2 } = await sb.from('market_items').select('stock').eq('id', item2.id).single();
  check('stock and tokens deducted together', s2.stock === 50 - wins2 && finalBal === bal - wins2 * 25);

  check('manual adjustment cannot push balance below zero',
    (await rpc('adjust_tokens', { p_team: created.team, p_amount: -(finalBal + 1), p_reason: 'test', p_key: randomUUID(), p_actor: 'test' })).error?.includes('INSUFFICIENT_TOKENS'));
  check('manual adjustment requires a reason',
    (await rpc('adjust_tokens', { p_team: created.team, p_amount: 5, p_reason: '', p_key: randomUUID(), p_actor: 'test' })).error?.includes('BAD_INPUT'));
  const { count: auditCount } = await sb.from('audit_log').select('id', { count: 'exact', head: true }).eq('actor', 'test');
  check('audit records written', (auditCount ?? 0) >= wins + wins2 + 1);

  console.log('\n3. Public (anon) access is blocked');
  const anonKey = process.env.SUPABASE_ANON_KEY;
  if (!anonKey) console.log('  SKIP  set SUPABASE_ANON_KEY to test that the public key can read/write nothing');
  else {
    const anon = createClient(url, anonKey, { auth: { persistSession: false } });
    for (const t of ['participants', 'token_ledger', 'market_items', 'questions', 'answers']) {
      const { data, error } = await anon.from(t).select('*').limit(1);
      check(`anon cannot read ${t}`, !!error || (data ?? []).length === 0);
    }
    const w = await anon.from('market_items').update({ stock: 9999 }).eq('id', item.id);
    const { data: still } = await sb.from('market_items').select('stock').eq('id', item.id).single();
    check('anon cannot change stock', !!w.error || still.stock !== 9999);
    const f = await anon.rpc('redeem_item', { p_team: created.team, p_item: item.id, p_qty: 1, p_key: randomUUID(), p_actor: 'anon' });
    check('anon cannot call redeem_item', !!f.error);
  }

  // ---------------------------------------------------------------- helpers for sections 4-9
  const mkTeam = async (label) => {
    const id = (await sb.from('teams').insert({ name: `TEST ${label} ${uid()}` }).select().single()).data.id;
    created.teams.push(id); return id;
  };
  const mkSquad = async (team, name = 'TEST squad') => {
    const id = (await sb.from('squads').insert({ team_id: team, name }).select().single()).data.id;
    created.squads.push(id); return id;
  };
  const mkMember = async (team, squad = null) => {
    const id = (await sb.from('participants').insert({ team_id: team, squad_id: squad, name: 'TEST member' }).select().single()).data.id;
    created.participants.push(id); return id;
  };
  const mkSpot = async (extra = {}) => {
    const secret = 'T' + uid() + 'Z';
    const row = { title: 'TEST spot ' + secret, secret, tokens: 10, ...extra };
    const { data, error } = await sb.from('hunt_spots').insert(row).select().single();
    if (error) throw new Error('create spot: ' + error.message);
    created.spots.push(data.id); return data;
  };
  const setSwitches = (patch) => sb.from('game_settings').update(patch).eq('id', 1);
  const claim = (person, code) => rpc('claim_spot', { p_participant: person, p_secret: code });
  const count = async (table, filter) => {
    let q = sb.from(table).select('id', { count: 'exact', head: true });
    for (const [k, v] of Object.entries(filter)) q = v === null ? q.is(k, null) : q.eq(k, v);
    return (await q).count;
  };

  console.log('\n4. Treasure hunt (no squads): once per team, closed switch, bad codes, races');
  const tH = await mkTeam('hunt'), tH2 = await mkTeam('hunt2');
  const h1 = await mkMember(tH), h2 = await mkMember(tH), g1 = await mkMember(tH2);
  const spotA = await mkSpot({ tokens: 7 });
  await setSwitches({ hunt_open: false });
  check('claim refused while hunt is closed', (await claim(h1, spotA.secret)).error?.includes('HUNT_CLOSED'));
  await setSwitches({ hunt_open: true });
  check('unknown code is refused', (await claim(h1, 'NOPE' + uid())).error?.includes('SPOT_NOT_FOUND'));
  const c1 = await claim(h1, spotA.secret.toLowerCase());
  check('first scan credits the team (code is case-insensitive)', !c1.error && c1.data.already === false && c1.data.tokens === 7 && (await balance(tH)) === 7);
  const c2 = await claim(h2, spotA.secret);
  check('teammate scanning the same spot gets nothing more', !c2.error && c2.data.already === true && (await balance(tH)) === 7);
  const c3 = await claim(g1, spotA.secret);
  check('another team can still find the same spot', !c3.error && c3.data.already === false && (await balance(tH2)) === 7);
  const spotOff = await mkSpot({ active: false });
  check('inactive spot cannot be claimed', (await claim(h1, spotOff.secret)).error?.includes('SPOT_NOT_FOUND'));
  const spotB = await mkSpot({ tokens: 9 });
  const raceH = await Promise.all([h1, h2, h1, h2, h1, h2, h1, h2].map((x) => claim(x, spotB.secret)));
  check('8 parallel scans = one credit', raceH.every((r) => !r.error) && raceH.filter((r) => r.data.already === false).length === 1
    && (await count('hunt_claims', { spot_id: spotB.id, team_id: tH })) === 1 && (await balance(tH)) === 16, `(balance ${await balance(tH)})`);
  check('hunt ledger rows are positive and unique per team+spot', (await count('token_ledger', { team_id: tH, kind: 'hunt' })) === 2);

  console.log('\n5. Squads: each squad finds each spot once, tokens go to the team wallet');
  const tQ = await mkTeam('squads');
  const sqA = await mkSquad(tQ, 'TEST A'), sqB = await mkSquad(tQ, 'TEST B');
  const qa1 = await mkMember(tQ, sqA), qa2 = await mkMember(tQ, sqA), qb1 = await mkMember(tQ, sqB), qn1 = await mkMember(tQ, null);
  const spotQ = await mkSpot({ tokens: 5 });
  check('squad A first scan credits team', (await claim(qa1, spotQ.secret)).data?.already === false && (await balance(tQ)) === 5);
  check('squad A teammate adds nothing', (await claim(qa2, spotQ.secret)).data?.already === true && (await balance(tQ)) === 5);
  check('squad B can find the same spot', (await claim(qb1, spotQ.secret)).data?.already === false && (await balance(tQ)) === 10);
  check('member without a squad counts as one extra group', (await claim(qn1, spotQ.secret)).data?.already === false && (await balance(tQ)) === 15);
  check('...and only once', (await claim(qn1, spotQ.secret)).data?.already === true && (await balance(tQ)) === 15);
  // A participant whose squad belongs to ANOTHER team must not be able to claim as that squad.
  const stray = await mkMember(tH, sqA);
  const spotS = await mkSpot({ tokens: 3 });
  await claim(stray, spotS.secret);
  const { data: strayClaim } = await sb.from('hunt_claims').select('squad_id').eq('spot_id', spotS.id).eq('participant_id', stray).single();
  check('squad from another team is ignored (treated as no squad)', strayClaim && strayClaim.squad_id === null);
  const spotQ2 = await mkSpot({ tokens: 4 });
  const raceQ = await Promise.all([qa1, qa2, qa1, qa2, qa1, qa2].map((x) => claim(x, spotQ2.secret)));
  check('parallel scans inside one squad = one credit', raceQ.filter((r) => r.data?.already === false).length === 1 && (await count('hunt_claims', { spot_id: spotQ2.id, squad_id: sqA })) === 1 && (await balance(tQ)) === 19);

  console.log('\n6. Co-op spots: N different squad members within the window');
  const tC = await mkTeam('coop');
  const sqX = await mkSquad(tC, 'TEST X'), sqY = await mkSquad(tC, 'TEST Y');
  const [c_1, c_2, c_3, c_4] = [await mkMember(tC, sqX), await mkMember(tC, sqX), await mkMember(tC, sqX), await mkMember(tC, sqX)];
  const [y_1, y_2] = [await mkMember(tC, sqY), await mkMember(tC, sqY)];
  const coop = await mkSpot({ tokens: 15, min_players: 3, window_sec: 120 });
  let r = await claim(c_1, coop.secret);
  check('1st scan is pending (1/3), no tokens', !r.error && r.data.pending === true && r.data.have === 1 && r.data.need === 3 && (await balance(tC)) === 0);
  r = await claim(c_1, coop.secret);
  check('same person scanning again does not count twice', r.data.pending === true && r.data.have === 1);
  r = await claim(c_2, coop.secret);
  check('2nd person -> 2/3', r.data.pending === true && r.data.have === 2);
  await sb.from('hunt_scans').update({ scanned_at: new Date(Date.now() - 3600e3).toISOString() }).eq('participant_id', c_1).eq('spot_id', coop.id);
  r = await claim(c_3, coop.secret);
  check('an expired scan no longer counts (window)', r.data.pending === true && r.data.have === 2);
  r = await claim(c_1, coop.secret);
  check('3 distinct people inside the window -> credited once', r.data.pending === false && r.data.already === false && r.data.tokens === 15 && (await balance(tC)) === 15);
  check('4th squad member afterwards gets nothing more', (await claim(c_4, coop.secret)).data?.already === true && (await balance(tC)) === 15);
  check('scan rows are cleaned up after the claim', (await count('hunt_scans', { spot_id: coop.id, squad_id: sqX })) === 0);
  r = await claim(y_1, coop.secret);
  check('small squad (2 people) is asked for 2, not 3', r.data.pending === true && r.data.need === 2);
  r = await claim(y_2, coop.secret);
  check('...and is credited when both scanned', r.data.pending === false && (await balance(tC)) === 30);
  const coop2 = await mkSpot({ tokens: 6, min_players: 3, window_sec: 120 });
  const raceC = await Promise.all([c_1, c_2, c_3, c_1, c_2, c_3, c_4].map((x) => claim(x, coop2.secret)));
  check('parallel co-op scans = exactly one credit', raceC.every((x) => !x.error) && (await count('hunt_claims', { spot_id: coop2.id, squad_id: sqX })) === 1 && (await balance(tC)) === 36, `(balance ${await balance(tC)})`);
  check('co-op settings are validated by the database', !!(await sb.from('hunt_spots').insert({ title: 'TEST bad', secret: 'T' + uid() + 'Q', min_players: 0 })).error);

  console.log('\n7. Team goal: locked market items');
  const tG = await mkTeam('goal');
  const gm = [await mkMember(tG), await mkMember(tG), await mkMember(tG), await mkMember(tG)];
  await rpc('adjust_tokens', { p_team: tG, p_amount: 100, p_reason: 'test top-up', p_key: randomUUID(), p_actor: 'test' });
  const locked = (await sb.from('market_items').insert({ name: 'TEST locked', price: 5, stock: 20, requires_goal: true }).select().single()).data;
  const openItem = (await sb.from('market_items').insert({ name: 'TEST open', price: 5, stock: 20 }).select().single()).data;
  created.items.push(locked.id, openItem.id);
  const buy = (item) => rpc('redeem_item', { p_team: tG, p_item: item, p_qty: 1, p_key: randomUUID(), p_actor: 'test' });
  await setSwitches({ team_goal_pct: 0 });
  check('goal off: special item sells normally', !(await buy(locked.id)).error);
  await setSwitches({ team_goal_pct: 50 });
  check('goal 50%, 0/4 done: special item refused', (await buy(locked.id)).error?.includes('GOAL_NOT_MET'));
  check('...but normal items still sell', !(await buy(openItem.id)).error);
  check('team_goal_met() is false', (await rpc('team_goal_met', { p_team: tG })).data === false);
  await sb.from('participants').update({ status: 'completed' }).eq('id', gm[0]);
  check('1/4 done (25%) still locked', (await buy(locked.id)).error?.includes('GOAL_NOT_MET'));
  await sb.from('participants').update({ status: 'completed' }).eq('id', gm[1]);
  check('2/4 done (50%) unlocks', (await rpc('team_goal_met', { p_team: tG })).data === true && !(await buy(locked.id)).error);
  const tEmpty = await mkTeam('empty');
  check('an empty team never meets a goal', (await rpc('team_goal_met', { p_team: tEmpty })).data === false);
  await setSwitches({ team_goal_pct: 0 });
  check('goal 0 = always met', (await rpc('team_goal_met', { p_team: tEmpty })).data === true);
  check('goal outside 0-100 is rejected', !!(await sb.from('game_settings').update({ team_goal_pct: 101 }).eq('id', 1)).error);

  console.log('\n8. Team photo missions: leader-only upload, ADMIN REVIEW decides the tokens');
  const tP = await mkTeam('photo');
  const ldr = await mkMember(tP), mem = await mkMember(tP);
  await sb.from('participants').update({ is_leader: true }).eq('id', ldr);
  const tP2 = await mkTeam('photo2');
  const ldr2 = await mkMember(tP2);
  await sb.from('participants').update({ is_leader: true }).eq('id', ldr2);
  const mk1 = (await sb.from('photo_missions').insert({ title: 'TEST photo ' + uid(), tokens: 20, category: 'person' }).select().single()).data;
  const mk2 = (await sb.from('photo_missions').insert({ title: 'TEST photo B ' + uid(), tokens: 30, category: 'food' }).select().single()).data;
  created.photoMissions.push(mk1.id, mk2.id);
  const sendPhoto = (who, mission = mk1.id) => rpc('submit_photo', { p_participant: who, p_mission: mission, p_url: 'https://example.invalid/test-' + uid() + '.jpg' });
  const review = (id, approve, reason = '') => rpc('review_photo', { p_submission: id, p_approve: approve, p_reason: reason, p_actor: 'test' });
  const subOf = async (team, mission, status) => (await sb.from('photo_submissions').select('id, status').eq('team_id', team).eq('mission_id', mission).eq('status', status).maybeSingle()).data;
  await setSwitches({ puzzle_open: false });
  check('photo upload closed while the "team mission" switch is off', (await sendPhoto(ldr)).error?.includes('PUZZLE_CLOSED'));
  await setSwitches({ puzzle_open: true, hunt_open: false });
  check('a non-leader cannot upload (database rule)', (await sendPhoto(mem)).error?.includes('NOT_LEADER'));
  let ph = await sendPhoto(ldr);
  check('leader upload is PENDING and gives NO tokens yet', !ph.error && ph.data.status === 'pending' && ph.data.already === false && (await balance(tP)) === 0);
  ph = await sendPhoto(ldr);
  check('the leader can swap a still-pending photo (one row only)', ph.data?.replaced === true && (await count('photo_submissions', { mission_id: mk1.id, team_id: tP })) === 1 && (await balance(tP)) === 0);
  const pend = await subOf(tP, mk1.id, 'pending');
  let rv = await review(pend.id, true);
  check('staff confirmation credits the team (+20)', !rv.error && rv.data.status === 'approved' && rv.data.tokens === 20 && (await balance(tP)) === 20);
  check('confirming again changes nothing', (await review(pend.id, true)).data?.already === true && (await balance(tP)) === 20);
  const races = await Promise.all(Array.from({ length: 6 }, () => review(pend.id, true)));
  check('parallel confirmations never double-credit', races.every((x) => !x.error) && (await balance(tP)) === 20);
  check('after confirmation the team cannot upload that mission again', (await sendPhoto(ldr)).data?.already === true && (await balance(tP)) === 20);
  check('another team has its own pending photo', (await sendPhoto(ldr2)).data?.status === 'pending' && (await balance(tP2)) === 0);
  // rejection: no tokens, leader may retry
  await sendPhoto(ldr, mk2.id);
  const pend2 = await subOf(tP, mk2.id, 'pending');
  rv = await review(pend2.id, false, 'ไม่ตรงโจทย์');
  check('rejecting a pending photo gives no tokens', !rv.error && rv.data.status === 'rejected' && (await balance(tP)) === 20);
  check('after a rejection the leader can upload again', (await sendPhoto(ldr, mk2.id)).data?.status === 'pending');
  const pend3 = await subOf(tP, mk2.id, 'pending');
  check('...and a confirmation then pays (+30)', (await review(pend3.id, true)).data?.status === 'approved' && (await balance(tP)) === 50);
  rv = await review(pend3.id, false, 'ตรวจพลาด');
  check('taking back a confirmation returns the tokens', rv.data?.status === 'rejected' && (await balance(tP)) === 20);
  const off = (await sb.from('photo_missions').insert({ title: 'TEST off ' + uid(), active: false }).select().single()).data;
  created.photoMissions.push(off.id);
  check('an inactive mission cannot be submitted', !!(await sendPhoto(ldr, off.id)).error);
  check('mission category is validated', !!(await sb.from('photo_missions').insert({ title: 'TEST bad', category: 'nope' })).error);
  await setSwitches({ puzzle_open: false });

  console.log('\n10. Team leaders and goods hand-over (database rules)');
  const tL = await mkTeam('leader');
  const l1 = await mkMember(tL), l2 = await mkMember(tL);
  check('a team can have one leader', !(await sb.from('participants').update({ is_leader: true }).eq('id', l1)).error);
  check('a second leader in the same team is refused (unique rule)', !!(await sb.from('participants').update({ is_leader: true }).eq('id', l2)).error);
  await rpc('adjust_tokens', { p_team: tL, p_amount: 50, p_reason: 'test top-up', p_key: randomUUID(), p_actor: 'test' });
  const itL = (await sb.from('market_items').insert({ name: 'TEST pickup item', price: 10, stock: 5 }).select().single()).data;
  created.items.push(itL.id);
  const rr = await rpc('redeem_item', { p_team: tL, p_item: itL.id, p_qty: 2, p_key: randomUUID(), p_actor: 'leader:TEST' });
  const { data: red } = await sb.from('redemptions').select('id, fulfilled_at, confirmed_by').eq('team_id', tL).single();
  check('leader redemption is recorded with the leader as actor, not yet handed over', !rr.error && red?.confirmed_by === 'leader:TEST' && red?.fulfilled_at === null);
  check('staff can mark goods as handed over', !(await sb.from('redemptions').update({ fulfilled_at: new Date().toISOString(), fulfilled_by: 'staff' }).eq('id', red.id)).error);
  check('market self-service switch exists and defaults to a boolean', typeof (await sb.from('game_settings').select('market_open').eq('id', 1).single()).data?.market_open === 'boolean');

  console.log('\n11. Event-day check-in (database columns and rules)');
  const tK = await mkTeam('checkin');
  const k1 = await mkMember(tK);
  const { data: ci0 } = await sb.from('game_settings').select('checkin_open, checkin_code, checkin_announced_at').eq('id', 1).single();
  check('check-in switch and code columns exist', ci0 && typeof ci0.checkin_open === 'boolean' && 'checkin_code' in ci0 && 'checkin_announced_at' in ci0);
  const t1 = new Date().toISOString();
  check('first check-in is stored', !(await sb.from('participants').update({ checked_in_at: t1, checked_in_by: 'self' }).eq('id', k1).is('checked_in_at', null)).error);
  await sb.from('participants').update({ checked_in_at: new Date(Date.now() + 60000).toISOString(), checked_in_by: 'self' }).eq('id', k1).is('checked_in_at', null);
  const { data: ci1 } = await sb.from('participants').select('checked_in_at, checked_in_by').eq('id', k1).single();
  check('a second check-in keeps the first time', new Date(ci1.checked_in_at).toISOString() === t1 && ci1.checked_in_by === 'self');

  console.log('\n12. Solo mini-games (best of 3, only the improvement is paid)');
  const tM = await mkTeam('minigames');
  const m1 = await mkMember(tM);
  const bal0 = (await sb.rpc('team_balance', { p_team: tM })).data;
  const mkAttempt = async (n) => (await sb.from('minigame_attempts').insert({ participant_id: m1, game: 'spot', n }).select('id').single()).data;
  const ma = await mkAttempt(1);
  const f1 = (await sb.rpc('mg_finish', { p_attempt: ma.id, p_tokens: 30, p_result: {} })).data;
  check('first attempt pays its tokens', f1?.awarded === 30 && f1?.tokens === 30);
  const f1b = (await sb.rpc('mg_finish', { p_attempt: ma.id, p_tokens: 30, p_result: {} })).data;
  check('finishing the same attempt twice pays nothing more', f1b?.already === true && f1b?.awarded === 0);
  const mb = await mkAttempt(2);
  check('a worse attempt pays nothing', (await sb.rpc('mg_finish', { p_attempt: mb.id, p_tokens: 20, p_result: {} })).data?.awarded === 0);
  const mc = await mkAttempt(3);
  check('a better attempt pays only the improvement', (await sb.rpc('mg_finish', { p_attempt: mc.id, p_tokens: 45, p_result: {} })).data?.awarded === 15);
  check('team wallet = best score (45)', (await sb.rpc('team_balance', { p_team: tM })).data - bal0 === 45);
  check('a 4th attempt is refused by the database', !!(await sb.from('minigame_attempts').insert({ participant_id: m1, game: 'spot', n: 4 })).error);
  check('another game has its own 3 attempts', !(await sb.from('minigame_attempts').insert({ participant_id: m1, game: 'memory', n: 1 })).error);
  const { data: mgs } = await sb.from('game_settings').select('mg_spot_open, mg_memory_open, mg_mystery_open, mg_percent').eq('id', 1).single();
  check('mini-game switches exist and are off by default / percent is 0..500', mgs && typeof mgs.mg_spot_open === 'boolean' && mgs.mg_percent >= 0);

  console.log('\n13. Selfie Wall (one photo per player, observers never count, rank rewards paid once)');
  const tS = await mkTeam('selfie');
  const sw1 = await mkMember(tS), sw2 = await mkMember(tS);
  const { data: sObs } = await sb.from('participants').insert({ team_id: tS, name: 'test selfie observer', is_observer: true }).select('id').single();
  if (sObs) created.participants.push(sObs.id);
  const { data: sBefore } = await sb.from('game_settings').select('selfie_open, selfie_start, selfie_end, selfie_rewards, selfie_audience').eq('id', 1).single();
  await sb.from('game_settings').update({ selfie_open: true, selfie_audience: 'all', selfie_start: null, selfie_end: null, selfie_rewards: '20,15,10,5' }).eq('id', 1);
  const balS0 = (await sb.rpc('team_balance', { p_team: tS })).data;
  const sr1 = (await sb.rpc('submit_selfie', { p_participant: sw1, p_url: 'https://example.invalid/s1.jpg', p_pct: 70, p_checks: {} })).data;
  check('first photo counts 1 of 2', sr1?.count === 1 && sr1?.total === 2 && sr1?.complete === false);
  check('a committee/judge (observer) cannot put a photo on a real team wall', !sObs || !!(await sb.rpc('submit_selfie', { p_participant: sObs.id, p_url: 'https://example.invalid/obs.jpg', p_pct: 70, p_checks: {} })).error);
  const sr2 = (await sb.rpc('submit_selfie', { p_participant: sw2, p_url: 'https://example.invalid/s2.jpg', p_pct: 70, p_checks: {} })).data;
  check('team completes with a rank and a reward', sr2?.complete === true && sr2?.justCompleted === true && sr2?.rank >= 1 && sr2?.tokens >= 0);
  const sPaid = sr2?.tokens ?? 0;
  const sr2b = (await sb.rpc('submit_selfie', { p_participant: sw2, p_url: 'https://example.invalid/s2b.jpg', p_pct: 80, p_checks: {} })).data;
  check('re-upload replaces the photo and pays nothing more', sr2b?.oldUrl === 'https://example.invalid/s2.jpg' && sr2b?.justCompleted === false);
  check('team wallet received exactly the reward once', (await sb.rpc('team_balance', { p_team: tS })).data - balS0 === sPaid);
  await sb.from('game_settings').update({ selfie_end: new Date(Date.now() - 60000).toISOString() }).eq('id', 1);
  check('closed window refuses photos', !!(await sb.rpc('submit_selfie', { p_participant: sw1, p_url: 'https://example.invalid/late.jpg', p_pct: 70, p_checks: {} })).error);
  await sb.from('selfie_photos').delete().eq('team_id', tS);
  await sb.from('token_ledger').delete().eq('idempotency_key', `selfie:${tS}`);
  await sb.from('teams').update({ selfie_completed_at: null, selfie_finish_rank: null, selfie_reward_tokens: 0 }).eq('id', tS);
  // ---- v2: judges-only test phase and per-team colours
  const { data: tc } = await sb.from('teams').select('selfie_color').eq('id', tS).single();
  check('team colour column exists', tc && 'selfie_color' in tc);
  await sb.from('teams').update({ selfie_color: '#2f6fd6' }).eq('id', tS);
  const { data: tOther } = await sb.from('teams').insert({ name: 'test selfie other' }).select('id').single();
  if (tOther) { created.teams.push(tOther.id); check('the same colour on a second team is refused', !!(await sb.from('teams').update({ selfie_color: '#2f6fd6' }).eq('id', tOther.id)).error); }
  await sb.from('game_settings').update({ selfie_open: true, selfie_start: null, selfie_end: null, selfie_audience: 'judges' }).eq('id', 1);
  check('real submit is blocked during the judges-only phase', !!(await sb.rpc('submit_selfie', { p_participant: sw1, p_url: 'https://example.invalid/blocked.jpg', p_pct: 70, p_checks: {} })).error);
  check('a non-judge cannot use the test wall', !!(await sb.rpc('submit_selfie_test', { p_participant: sw1, p_url: 'https://example.invalid/x.jpg', p_pct: 70, p_checks: {} })).error);
  const balT0 = (await sb.rpc('team_balance', { p_team: tS })).data;
  const tj = sObs ? (await sb.rpc('submit_selfie_test', { p_participant: sObs.id, p_url: 'https://example.invalid/judge.jpg', p_pct: 80, p_checks: {} })).data : null;
  check('a judge photo lands on the test wall and pays nothing', !sObs || (tj?.tokens === 0 && tj?.rank === null && (await sb.rpc('team_balance', { p_team: tS })).data === balT0));
  await sb.from('selfie_photos').delete().eq('is_test', true);
  // v3: 'teams' phase = only started teams may upload
  await sb.from('game_settings').update({ selfie_audience: 'teams' }).eq('id', 1);
  await sb.from('teams').update({ selfie_active: false }).eq('id', tS);
  check('a team that was not started cannot upload', !!(await sb.rpc('submit_selfie', { p_participant: sw1, p_url: 'https://example.invalid/ns.jpg', p_pct: 70, p_checks: {} })).error);
  await sb.from('teams').update({ selfie_active: true }).eq('id', tS);
  check('a started team can upload', !(await sb.rpc('submit_selfie', { p_participant: sw1, p_url: 'https://example.invalid/ok.jpg', p_pct: 70, p_checks: {} })).error);
  await sb.from('teams').update({ selfie_active: false }).eq('id', tS);
  // v4: a whole committee / test team never joins the real walls and never ranks
  await sb.from('game_settings').update({ selfie_audience: 'all' }).eq('id', 1);
  await sb.from('teams').update({ selfie_excluded: true, selfie_active: false }).eq('id', tS);
  check('a member of a committee/test team cannot upload to a real wall', !!(await sb.rpc('submit_selfie', { p_participant: sw1, p_url: 'https://example.invalid/c.jpg', p_pct: 70, p_checks: {} })).error);
  await sb.from('game_settings').update({ selfie_audience: 'judges' }).eq('id', 1);
  const balX0 = (await sb.rpc('team_balance', { p_team: tS })).data;
  const tx = (await sb.rpc('submit_selfie_test', { p_participant: sw1, p_url: 'https://example.invalid/ct.jpg', p_pct: 70, p_checks: {} })).data;
  check('...but may test on the judges wall, which pays nothing and ranks nothing', tx && tx.tokens === 0 && tx.rank === null && (await sb.rpc('team_balance', { p_team: tS })).data === balX0);
  await sb.from('selfie_photos').delete().eq('is_test', true);
  await sb.from('teams').update({ selfie_excluded: false }).eq('id', tS);
  await sb.from('game_settings').update({ selfie_audience: 'all' }).eq('id', 1);
  await sb.from('teams').update({ selfie_color: null }).eq('id', tS);
  if (sBefore) await sb.from('game_settings').update(sBefore).eq('id', 1);

  console.log('\n9. Public (anon) access to the new features is blocked');
  if (!process.env.SUPABASE_ANON_KEY) console.log('  SKIP  set SUPABASE_ANON_KEY to test that the public key reaches none of the new tables/functions');
  else {
    const anon = createClient(url, process.env.SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    for (const t of ['squads', 'hunt_spots', 'hunt_claims', 'hunt_scans', 'photo_missions', 'photo_submissions']) {
      const { data, error } = await anon.from(t).select('*').limit(1);
      check(`anon cannot read ${t}`, !!error || (data ?? []).length === 0);
    }
    const w = await anon.from('hunt_spots').update({ tokens: 9999 }).eq('id', spotA.id);
    const { data: still } = await sb.from('hunt_spots').select('tokens').eq('id', spotA.id).single();
    check('anon cannot change hunt spots', !!w.error || still.tokens !== 9999);
    check('anon cannot call claim_spot', !!(await anon.rpc('claim_spot', { p_participant: h1, p_secret: spotB.secret })).error);
    check('anon cannot call submit_photo / review_photo', !!(await anon.rpc('submit_photo', { p_participant: h1, p_mission: mk1.id, p_url: 'https://example.invalid/x.jpg' })).error && !!(await anon.rpc('review_photo', { p_submission: pend.id, p_approve: true, p_reason: '', p_actor: 'anon' })).error);
    check('anon cannot call team_goal_met', !!(await anon.rpc('team_goal_met', { p_team: tG })).error);
  }
} catch (e) {
  failed++; console.error('\nTest run crashed:', e.message);
} finally {
  // Clean up in dependency order.
  const teamIds = [created.team, created.team2, ...created.teams].filter(Boolean);
  if (teamIds.length) {
    await sb.from('photo_submissions').delete().in('team_id', teamIds);
    if (created.participants.length) await sb.from('minigame_attempts').delete().in('participant_id', created.participants);
    await sb.from('hunt_scans').delete().in('team_id', teamIds);
    await sb.from('hunt_claims').delete().in('team_id', teamIds);
    await sb.from('token_ledger').delete().in('team_id', teamIds);
    await sb.from('redemptions').delete().in('team_id', teamIds);
  }
  if (created.participants.length) await sb.from('participants').delete().in('id', created.participants);
  if (created.squads.length) await sb.from('squads').delete().in('id', created.squads);
  if (created.spots.length) await sb.from('hunt_spots').delete().in('id', created.spots);
  if (created.photoMissions.length) await sb.from('photo_missions').delete().in('id', created.photoMissions);
  if (created.items.length) await sb.from('market_items').delete().in('id', created.items);
  if (teamIds.length) await sb.from('teams').delete().in('id', teamIds);
  await sb.from('audit_log').delete().eq('actor', 'test');
  // Put every switch back exactly as it was.
  if (before) {
    await sb.from('game_settings').update({
      is_open: before.is_open, hunt_open: before.hunt_open, puzzle_open: before.puzzle_open, team_goal_pct: before.team_goal_pct, market_open: before.market_open, checkin_open: before.checkin_open, checkin_code: before.checkin_code, checkin_announced_at: before.checkin_announced_at,
    }).eq('id', 1);
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}
