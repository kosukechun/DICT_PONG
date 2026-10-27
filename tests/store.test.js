import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../server/store.js';

test('names, password-free sessions, results, filters and opponent aggregates survive restart', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pong-store-')); let store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = store.register('chun'), b = store.register('Chun');
  assert.notEqual(a.player.id, b.player.id); assert.equal(store.session(a.token).name, 'chun');
  assert.equal(store.register('chun').player.id, a.player.id);
  const base = { started: Date.now() - 123000, players: [a.player, b.player], state: { score: [5, 3] }, mode: 'online' };
  store.record({ ...base, id: 'match-1' }, 0, 'score');
  store.record({ ...base, id: 'match-2', state: { score: [1, 5] } }, 1, 'score');
  store.record({ ...base, id: 'match-3', state: { score: [3, 2] } }, 'cancelled', 'maintenance');
  store.record({ ...base, id: 'match-4', mode: 'cpu', level: 2, players: [a.player, { cpu: true, name: 'CPU Lv.2' }] }, 0, 'score');
  const online = store.stats(a.player.id, 'online');
  assert.equal(online.games, 2); assert.equal(online.wins, 1); assert.equal(online.winRate, 0.5);
  assert.equal(online.score, 6); assert.equal(online.conceded, 8); assert.equal(online.cancelled, 1);
  assert.ok(online.playSeconds >= 369); assert.equal(online.opponents.length, 1); assert.equal(online.opponents[0].name, 'Chun');
  assert.equal(store.stats(a.player.id, 'cpu').games, 1); assert.equal(store.stats(a.player.id).games, 3);
  assert.equal(store.stats(b.player.id).wins, 1);
  store.settings({ paused: true, message: 'テスト', windows: [] });
  store.close(); store = new Store(dir);
  assert.equal(store.session(a.token).id, a.player.id); assert.equal(store.stats(a.player.id).games, 3); assert.equal(store.settings().paused, true);
  store.logout(a.token); assert.equal(store.session(a.token), undefined);
});

test('a failed result insert rolls back both match and player results', t => {
  const dir = mkdtempSync(join(tmpdir(), 'pong-transaction-')), store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  const a = store.register('Alice').player;
  assert.throws(() => store.record({ id: 'invalid', started: Date.now(), mode: 'online', players: [a, { id: 'missing', name: 'Missing' }], state: { score: [5, 0] } }, 0, 'score'));
  assert.equal(store.stats(a.id).games, 0);
  assert.equal(store.db.prepare('SELECT COUNT(*) AS n FROM matches').get().n, 0);
});
