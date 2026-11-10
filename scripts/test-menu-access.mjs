import assert from 'node:assert/strict';
import test from 'node:test';
import { menuAccess } from '../lib/menu-access.ts';

test('missing or closed settings disable every activity and menu', () => {
  for (const settings of [undefined, null, {}, { is_open: false, hunt_open: false, puzzle_open: false, market_open: false, checkin_open: false, mg_spot_open: false, mg_memory_open: false, mg_mystery_open: false }]) {
    assert.equal(Object.values(menuAccess(settings)).every((open) => open === false), true);
  }
});

test('each mission opens independently and enables the missions menu', () => {
  for (const [flag, menu] of [['is_open', 'quiz'], ['hunt_open', 'hunt'], ['puzzle_open', 'photos']]) {
    const access = menuAccess({ [flag]: true });
    assert.equal(access[menu], true);
    assert.equal(access.missions, true);
    assert.equal(access.market, false);
    assert.equal(access.checkin, false);
    assert.equal(Object.values(access).filter(Boolean).length, 2);
  }
});

test('any single open minigame enables games without enabling closed activities', () => {
  for (const flag of ['mg_spot_open', 'mg_memory_open', 'mg_mystery_open']) {
    assert.deepEqual(menuAccess({ [flag]: true }), { quiz: false, hunt: false, photos: false, games: true, market: false, missions: true, checkin: false });
  }
});

test('market and venue check-in do not open the missions menu', () => {
  assert.deepEqual(menuAccess({ market_open: true, checkin_open: true }), { quiz: false, hunt: false, photos: false, games: false, market: true, missions: false, checkin: true });
});

test('closing the last mission disables the missions menu', () => {
  const settings = { is_open: true, hunt_open: true };
  assert.equal(menuAccess(settings).missions, true);
  settings.is_open = false;
  assert.equal(menuAccess(settings).missions, true);
  settings.hunt_open = false;
  assert.equal(menuAccess(settings).missions, false);
});

test('only explicit boolean true opens an activity', () => {
  assert.equal(menuAccess({ is_open: 'false', hunt_open: 1, mg_memory_open: null }).missions, false);
});
