import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { FIELD } from '../public/field.js';

test('UI can register, choose all CPU levels, show result/stats and access name-only admin', async t => {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: 'http://localhost:3000', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document, commands = [], requests = [];
  t.after(() => w.close());
  let socket, savedSettings;
  w.structuredClone = structuredClone;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : () => {} });
  w.requestAnimationFrame = () => 1;
  class Socket extends w.EventTarget {
    static OPEN = 1; static CONNECTING = 0;
    constructor() { super(); socket = this; this.readyState = 0; queueMicrotask(() => { this.readyState = 1; this.dispatchEvent(new w.Event('open')); this.receive({ type: 'hello', online: 1, blocked: false }); }); }
    send(raw) { commands.push(JSON.parse(raw)); }
    close() { this.readyState = 3; this.dispatchEvent(new w.Event('close')); }
    receive(value) { this.dispatchEvent(new w.MessageEvent('message', { data: JSON.stringify(value) })); }
  }
  w.WebSocket = Socket;
  const stats = { player: { id: 'chun-id', name: 'chun' }, games: 2, wins: 1, losses: 1, winRate: 0.5, score: 7, conceded: 8, playSeconds: 241, cancelled: 0, opponents: [{ name: 'Bob', games: 2, wins: 1, losses: 1, winRate: 0.5, score: 7, playSeconds: 241 }], recent: [{ outcome: 'win', opponent_name: 'Bob', score: 5, against: 3, mode: 'online', duration: 120, reason: 'score', ended_at: new Date().toISOString() }] };
  w.fetch = async (path, options) => {
    requests.push({ path, options }); let data;
    if (path === '/api/me') data = { player: null, online: 0, blocked: false };
    else if (path === '/api/login') data = { player: stats.player };
    else if (path.startsWith('/api/stats') || path.startsWith('/api/admin/stats')) data = stats;
    else if (path === '/api/admin/settings') { savedSettings = JSON.parse(options.body); data = { ok: true }; }
    else if (path === '/api/admin') data = { settings: savedSettings || { paused: false, message: 'メンテナンス', windows: [], daily: { enabled: false, start: '23:00', end: '07:00' } }, status: { blocked: false }, players: [{ ...stats.player, games: 2, wins: 1, score: 7, playSeconds: 241 }], connected: [{ id: 'chun-id', name: 'chun', status: 'lobby' }] };
    else data = { ok: true };
    return { ok: true, json: async () => data };
  };
  w.FIELD = FIELD;
  w.eval(readFileSync('public/app.js', 'utf8').replace("import { FIELD } from './field.js';", ''));
  await delay(10);
  assert.equal(doc.getElementById('adminNav').hidden, true); assert.equal(doc.getElementById('queueButton').disabled, true);
  doc.getElementById('nameInput').value = 'chun'; doc.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await delay(10);
  assert.equal(doc.getElementById('adminNav').hidden, false); assert.equal(doc.getElementById('playerName').textContent, 'chun'); assert.equal(doc.getElementById('queueButton').disabled, false);
  assert.ok(doc.getElementById('summaryStats').textContent.includes('50.0')); assert.ok(doc.getElementById('summaryStats').textContent.includes('5.0割'));
  doc.getElementById('cpuTab').click(); assert.equal(doc.getElementById('cpuSetup').hidden, false);
  for (const level of [1, 2, 3]) { doc.querySelector(`[data-level="${level}"]`).click(); doc.getElementById('cpuButton').click(); assert.equal(commands.at(-1).level, level); }
  const state = { paddles: [{ x: 90, y: 320 }, { x: 1110, y: 320 }], ball: { x: 600, y: 320, vx: 0, vy: 0 }, score: [0, 0], countdown: 2.5, rally: 0 };
  socket.receive({ type: 'match', id: 'm1', mode: 'cpu', level: 3, you: 'chun', opponent: 'CPU Lv.3', state });
  assert.equal(doc.getElementById('courtOverlay').hidden, true); assert.equal(doc.getElementById('queueButton').disabled, true);
  socket.receive({ type: 'state', state: { ...state, countdown: 0, score: [4, 2] } }); assert.equal(doc.getElementById('selfScore').textContent, '4');
  socket.receive({ type: 'result', outcome: 'win', reason: 'score', score: [5, 2] }); await delay(10);
  assert.equal(doc.getElementById('courtOverlay').hidden, false); assert.equal(doc.getElementById('selfScore').textContent, '5'); assert.equal(doc.getElementById('queueButton').disabled, false);
  doc.getElementById('adminNav').click(); await delay(10);
  assert.equal(doc.getElementById('viewAdmin').hidden, false); assert.ok(doc.getElementById('connectedPlayers').textContent.includes('chun'));
  doc.getElementById('pausedInput').checked = true; doc.getElementById('settingsForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await delay(10);
  assert.equal(savedSettings.paused, true); assert.equal(requests.some(r => r.path.includes('/auth')), false);
  doc.querySelector('[data-player-id]').click(); await delay(10); assert.equal(doc.getElementById('adminPlayerDetail').hidden, false);
  socket.receive({ type: 'presence', online: 1, blocked: true, message: '全体停止' });
  assert.equal(doc.getElementById('maintenance').hidden, false); assert.equal(doc.getElementById('maintenanceMessage').textContent, '全体停止');
});
