// Rehearsal load test: N virtual players log in at (almost) the same moment, then keep using the app like real phones do
// (home, team page, notices poll, hunt, photo missions). READ-ONLY apart from creating login sessions.
//
//   node scripts/loadtest.mjs --url https://your-app.vercel.app --ids ids.txt --users 100 --seconds 60 --ramp 5
//
// ids.txt = one player ID per line (use TEST players in a TEST project; do not load-test the live event database
// right before the event). It prints requests/s, errors by status and latency percentiles.
import { readFileSync } from 'node:fs';

const arg = (name, def) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : def; };
const base = (arg('url', '') || '').replace(/\/$/, '');
const idsFile = arg('ids', '');
const users = Number(arg('users', 100));
const seconds = Number(arg('seconds', 60));
const ramp = Number(arg('ramp', 5));
if (!base || !idsFile) { console.error('Usage: node scripts/loadtest.mjs --url <site> --ids <file> [--users 100] [--seconds 60] [--ramp 5]'); process.exit(1); }
const ids = readFileSync(idsFile, 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
if (ids.length === 0) { console.error('ids file is empty'); process.exit(1); }

const lat = [];                 // ms for every request
const codes = new Map();        // status -> count
const note = (status, ms) => { lat.push(ms); codes.set(status, (codes.get(status) ?? 0) + 1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

async function timed(path, init) {
  const t0 = performance.now();
  try {
    const res = await fetch(base + path, init);
    await res.arrayBuffer();
    note(res.status, performance.now() - t0);
    return res;
  } catch {
    note('network-error', performance.now() - t0);
    return null;
  }
}

async function player(n, stopAt) {
  await sleep(rnd(0, ramp * 1000));                       // everybody arrives within the ramp window
  const id = ids[n % ids.length];
  const res = await timed('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: JSON.stringify({ id }) });
  const cookie = res ? (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ') : '';
  if (!res || res.status !== 200 || !cookie) return;      // could not log in: counted above
  const h = { Cookie: cookie };
  await timed('/api/me', { headers: h });                 // first screen after login
  while (performance.now() < stopAt) {
    await sleep(rnd(3000, 9000));                         // a person taps something every few seconds
    const pick = Math.random();
    const path = pick < 0.45 ? '/api/notices' : pick < 0.6 ? '/api/me' : pick < 0.75 ? '/api/team' : pick < 0.9 ? '/api/photos' : '/api/hunt';
    await timed(path, { headers: h });
  }
}

console.log(`Load test: ${users} players -> ${base} for ${seconds}s (login burst over ${ramp}s)`);
const started = performance.now();
const stopAt = started + seconds * 1000;
await Promise.all(Array.from({ length: users }, (_, n) => player(n, stopAt)));
const secs = (performance.now() - started) / 1000;

lat.sort((a, b) => a - b);
const pct = (p) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((p / 100) * lat.length))] : 0);
const total = lat.length;
const bad = [...codes.entries()].filter(([c]) => c !== 200).reduce((n, [, v]) => n + v, 0);
console.log(`\nrequests: ${total} in ${secs.toFixed(0)}s (${(total / secs).toFixed(1)}/s)`);
console.log('status  :', [...codes.entries()].map(([c, v]) => `${c}×${v}`).join('  '));
console.log(`latency : p50 ${pct(50).toFixed(0)} ms · p95 ${pct(95).toFixed(0)} ms · p99 ${pct(99).toFixed(0)} ms · max ${(lat[lat.length - 1] ?? 0).toFixed(0)} ms`);
const verdict = bad === 0 && pct(95) < 2000 ? 'GOOD: no errors and p95 under 2 s' : bad === 0 ? 'OK but slow: no errors, p95 over 2 s' : `PROBLEM: ${bad} failed requests (${((bad / total) * 100).toFixed(1)}%)`;
console.log(verdict);
process.exit(bad === 0 ? 0 : 1);
