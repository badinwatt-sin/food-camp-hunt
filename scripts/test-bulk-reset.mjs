import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const compiled = ts.transpileModule(readFileSync(new URL('../lib/bulk-reset.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const module = { exports: {} };
new Function('require', 'module', 'exports', compiled)(() => ({}), module, module.exports);
const { resetLineForBulk } = module.exports;

function fixture(rpcError, failTable) {
  const calls = [];
  const sb = {
    async rpc(name) { calls.push({ rpc: name }); return { error: rpcError }; },
    from(table) {
      const write = { table, filters: [] };
      const q = {
        update(patch) { write.operation = 'update'; write.patch = patch; return q; },
        delete() { write.operation = 'delete'; return q; },
        eq(...args) { write.filters.push(['eq', ...args]); return q; },
        not(...args) { write.filters.push(['not', ...args]); return q; },
        like(...args) { write.filters.push(['like', ...args]); return q; },
        then(resolve, reject) {
          calls.push(write);
          const error = !write.filters.length ? { message: 'UPDATE requires a WHERE clause' }
            : table === failTable ? { message: 'fallback denied' } : null;
          return Promise.resolve({ error }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  return { sb, calls };
}

test('working stored reset stays atomic and does not use the compatibility writes', async () => {
  const f = fixture(null);
  await resetLineForBulk(f.sb);
  assert.deepEqual(f.calls, [{ rpc: 'reset_line_checkin' }]);
});

test('hosted safe-update rejection falls back to qualified writes after closing LINE', async () => {
  const f = fixture({ message: 'UPDATE requires a WHERE clause' });
  await resetLineForBulk(f.sb);
  assert.deepEqual(f.calls.map((call) => call.table ?? call.rpc), ['reset_line_checkin', 'game_settings', 'teams', 'participants', 'token_ledger']);
  assert.equal(f.calls[1].patch.line_open, false);
  assert.deepEqual(f.calls[1].filters, [['eq', 'id', 1]]);
  assert.ok(f.calls.slice(1).every((call) => call.filters.length > 0), 'all mutations must carry a WHERE filter');
  assert.deepEqual(f.calls[2].patch, { line_completed_at: null, line_finish_rank: null, line_reward_tokens: 0 });
  assert.deepEqual(f.calls[4].filters, [['like', 'idempotency_key', 'line:%'], ['eq', 'created_by', 'system']]);
});

test('permission and unrelated RPC errors cannot silently trigger destructive fallback', async () => {
  const error = { message: 'permission denied for table teams' };
  const f = fixture(error);
  await assert.rejects(resetLineForBulk(f.sb), (caught) => caught === error);
  assert.equal(f.calls.length, 1);
});

test('a failed compatibility step stops before clearing participants or rewards', async () => {
  const f = fixture({ message: 'UPDATE requires a WHERE clause' }, 'teams');
  await assert.rejects(resetLineForBulk(f.sb), (error) => error.message === 'fallback denied');
  assert.deepEqual(f.calls.map((call) => call.table ?? call.rpc), ['reset_line_checkin', 'game_settings', 'teams']);
});
