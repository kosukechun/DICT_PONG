import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { JSDOM } from 'jsdom';
import { FIELD } from '../public/field.js';
import { movePaddle } from '../public/movement.js';

test('home opens the match on start, renders visible goals and supports dash, surrender, stats and admin', async t => {
  const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: 'http://localhost:3000', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window, doc = w.document, commands = [], requests = [];
  t.after(() => w.close());
  let socket, savedSettings;
  w.structuredClone = structuredClone;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  const paint = []; let frame, drawingRequests = 0;
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: (_, key) => key.startsWith('create') ? () => ({ addColorStop() {} }) : (...args) => { if (['fillText', 'fillRect', 'roundRect', 'arc'].includes(key)) paint.push({ operation: key, args }); } });
  w.requestAnimationFrame = callback => { frame = callback; return ++drawingRequests; };
  w.cancelAnimationFrame = () => { frame = null; };
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
  w.movePaddle = movePaddle;
  w.eval(readFileSync('public/app.js', 'utf8').replace(/^import .*;$/gm, ''));
  await delay(10);
  assert.equal(doc.getElementById('adminNav').hidden, true); assert.equal(doc.getElementById('queueButton').disabled, true);
  assert.equal(doc.body.dataset.view, 'home'); assert.equal(doc.getElementById('viewPlay').hidden, true);
  assert.equal(doc.getElementById('viewHome').querySelector('canvas'), null);
  assert.equal(doc.getElementById('setupCard').closest('section').id, 'viewHome');
  assert.equal(drawingRequests, 0);
  const mouseControl = doc.querySelector('[name="controlMode"][value="mouse"]');
  const keyboardControl = doc.querySelector('[name="controlMode"][value="keyboard"]');
  assert.equal(mouseControl.checked, true);
  keyboardControl.click();
  assert.equal(w.localStorage.getItem('pong-control-mode'), 'keyboard');
  doc.getElementById('nameInput').value = 'chun'; doc.getElementById('loginForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await delay(10);
  assert.equal(doc.getElementById('adminNav').hidden, false); assert.equal(doc.getElementById('playerName').textContent, 'chun'); assert.equal(doc.getElementById('queueButton').disabled, false);
  assert.ok(doc.getElementById('detailStats').textContent.includes('50.0')); assert.ok(doc.getElementById('detailStats').textContent.includes('5.0割'));
  assert.equal(doc.getElementById('viewPlay').querySelector('.stat-grid'), null);
  doc.getElementById('friendsTab').click();
  assert.equal(doc.getElementById('friendsSetup').hidden, false); assert.equal(doc.getElementById('onlineSetup').hidden, true);
  doc.getElementById('createRoomButton').click(); assert.equal(commands.at(-1).type, 'createRoom');
  socket.receive({ type: 'waiting', active: true, kind: 'room', code: 'ABC123' });
  assert.equal(doc.getElementById('matchOptions').hidden, true); assert.equal(doc.getElementById('waitingBox').hidden, false);
  assert.equal(doc.body.dataset.view, 'home'); assert.equal(drawingRequests, 0);
  doc.getElementById('cancelWaitingButton').click(); assert.equal(commands.at(-1).type, 'leave');
  socket.receive({ type: 'waiting', active: false });
  doc.getElementById('cpuTab').click(); assert.equal(doc.getElementById('cpuSetup').hidden, false);
  for (const level of [1, 2, 3]) { doc.querySelector(`[data-level="${level}"]`).click(); doc.getElementById('cpuButton').click(); assert.equal(commands.at(-1).level, level); }
  const state = { paddles: [{ x: 90, y: 320 }, { x: 1110, y: 320 }], ball: { x: 600, y: 320, vx: 0, vy: 0 }, score: [0, 0], countdown: 2.5, rally: 0 };
  socket.receive({ type: 'match', id: 'm1', mode: 'cpu', level: 3, you: 'chun', opponent: 'CPU Lv.3', state });
  assert.equal(doc.getElementById('courtOverlay').hidden, true); assert.equal(doc.getElementById('queueButton').disabled, true);
  assert.equal(doc.body.dataset.view, 'play'); assert.equal(doc.getElementById('viewHome').hidden, true);
  assert.equal(doc.getElementById('viewPlay').hidden, false); assert.equal(doc.getElementById('returnHomeButton').hidden, true);
  assert.equal(keyboardControl.disabled, true);
  frame(w.performance.now());
  assert.equal(paint.filter(p => p.operation === 'fillText' && p.args[0] === 'GOAL').length, 2);
  for (const side of [0, 1]) assert.ok(paint.some(p => p.operation === 'fillRect' && p.args[1] === FIELD.goalTop && p.args[2] >= 10 && p.args[2] <= 16 && p.args[3] === FIELD.goalBottom - FIELD.goalTop && (side ? p.args[0] >= FIELD.width - 16 : p.args[0] === 0)));
  doc.querySelector('button[data-view="home"]').click(); assert.equal(doc.body.dataset.view, 'play');
  assert.equal(doc.getElementById('leaveButton').hidden, false); assert.ok(doc.getElementById('leaveButton').textContent.includes('降参'));
  const beforeCancel = commands.filter(c => c.type === 'leave').length;
  doc.getElementById('leaveButton').click(); assert.equal(doc.getElementById('confirmDialog').open, true);
  doc.getElementById('cancelLeaveButton').click(); assert.equal(doc.getElementById('confirmDialog').open, false);
  assert.equal(commands.filter(c => c.type === 'leave').length, beforeCancel);
  let keyTime = 1000; w.performance.now = () => keyTime;
  const key = (type, value, repeat = false, target = w) => target.dispatchEvent(new w.KeyboardEvent(type, { key: value, repeat, bubbles: true, cancelable: true }));
  key('keydown', 'w'); key('keydown', 'd'); key('keydown', 'd', true);
  assert.equal(commands.filter(c => c.dash).length, 0);
  key('keyup', 'd'); keyTime += 120; key('keydown', 'd');
  assert.deepEqual(commands.at(-1).dash, { id: 1, dx: 1, dy: -1 });
  key('keydown', 'd', true); assert.equal(commands.filter(c => c.dash).length, 1);
  key('keyup', 'd'); keyTime += 300; key('keydown', 'd');
  assert.equal(commands.filter(c => c.dash).length, 1);
  w.dispatchEvent(new w.Event('blur')); keyTime += 20; key('keydown', 'd');
  assert.equal(commands.filter(c => c.dash).length, 1);
  const count = commands.length; key('keydown', 'a', false, doc.getElementById('nameInput'));
  assert.equal(commands.length, count);
  w.dispatchEvent(new w.Event('blur'));
  key('keydown', 'ArrowLeft'); key('keyup', 'ArrowLeft'); keyTime += 100; key('keydown', 'ArrowLeft');
  assert.equal(commands.at(-1).dash.dx, -1);
  socket.receive({ type: 'state', state: { ...state, paddles: [{ ...state.paddles[0], stamina: 30 }, state.paddles[1]] } });
  assert.equal(doc.getElementById('staminaMeter').value, 30);
  assert.equal(doc.getElementById('staminaPanel').classList.contains('low'), true);
  socket.receive({ type: 'state', state: { ...state, countdown: 0, score: [4, 2] } }); assert.equal(doc.getElementById('selfScore').textContent, '4');
  socket.receive({ type: 'result', outcome: 'win', reason: 'score', score: [5, 2] }); await delay(10);
  assert.equal(doc.getElementById('courtOverlay').hidden, false); assert.equal(doc.getElementById('selfScore').textContent, '5'); assert.equal(doc.getElementById('queueButton').disabled, false);
  assert.equal(doc.getElementById('leaveButton').hidden, true);
  assert.equal(doc.getElementById('returnHomeButton').hidden, false); assert.equal(doc.body.dataset.view, 'play');
  doc.getElementById('returnHomeButton').click();
  assert.equal(doc.body.dataset.view, 'home'); assert.equal(doc.getElementById('viewPlay').hidden, true);
  assert.equal(doc.getElementById('gameNav').hidden, true); assert.equal(frame, null);
  doc.querySelector('[data-view="stats"]').click(); assert.equal(doc.body.dataset.view, 'stats');
  doc.getElementById('homeLink').click(); assert.equal(doc.body.dataset.view, 'home');
  doc.getElementById('gameNav').click(); assert.equal(doc.body.dataset.view, 'home');
  socket.receive({ type: 'waiting', active: true, kind: 'queue' }); assert.equal(doc.body.dataset.view, 'home');
  assert.equal(mouseControl.disabled, true);
  socket.receive({ type: 'waiting', active: false });
  mouseControl.click();
  assert.equal(mouseControl.checked, true); assert.equal(w.localStorage.getItem('pong-control-mode'), 'mouse');
  socket.receive({ type: 'match', id: 'm2', mode: 'cpu', level: 2, you: 'chun', opponent: 'CPU Lv.2', state });
  assert.equal(doc.body.dataset.view, 'play'); assert.equal(doc.getElementById('waitingBox').hidden, true);
  const court = doc.getElementById('court');
  court.setPointerCapture = () => {};
  court.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 640 });
  const point = (type, x, y, pointerType = 'mouse') => {
    const event = new w.MouseEvent(type, { clientX: x, clientY: y, bubbles: true });
    Object.defineProperty(event, 'pointerType', { value: pointerType }); court.dispatchEvent(event);
  };
  keyTime = 2000; frame(keyTime);
  const beforeMouse = commands.length;
  key('keydown', 'w'); assert.equal(commands.length, beforeMouse);
  point('pointermove', 500, 320);
  assert.equal(commands.at(-1).x, 500); // Sent immediately, without a 30 Hz timer.
  keyTime += 16; paint.length = 0; frame(keyTime);
  const mallets = () => paint.filter(p => p.operation === 'arc' && p.args[2] === FIELD.paddleRadius);
  assert.equal(mallets().length, 2);
  assert.deepEqual(mallets()[0].args.slice(0, 3), [500, 320, FIELD.paddleRadius]); // Exact cursor position before any server response.
  assert.equal(paint.some(p => p.operation === 'roundRect'), false);
  // A delayed server snapshot must not pull an actively predicted paddle backward.
  socket.receive({ type: 'state', state });
  keyTime += 16; paint.length = 0; frame(keyTime);
  assert.equal(mallets()[0].args[0], 500);
  point('pointermove', 9000, -100);
  keyTime += 20; frame(keyTime);
  assert.equal(commands.at(-1).x, 600 - FIELD.centerInset); assert.equal(commands.at(-1).y, FIELD.paddleInset);
  w.dispatchEvent(new w.Event('blur'));
  assert.equal(commands.at(-1).dx, 0); assert.equal(commands.at(-1).dy, 0);
  keyTime += 16; paint.length = 0; frame(keyTime);
  assert.equal(mallets()[0].args[0], 90);
  // A letterboxed fullscreen canvas must map the visible court, not its margins.
  court.getBoundingClientRect = () => ({ left: 20, top: 10, width: 1200, height: 1000 });
  keyTime += 100;
  point('pointerdown', 220, 390, 'touch');
  keyTime += 16; paint.length = 0; frame(keyTime);
  assert.deepEqual(mallets()[0].args.slice(0, 2), [200, 200]);
  point('pointermove', 320, 490, 'touch');
  keyTime += 20; paint.length = 0; frame(keyTime);
  assert.deepEqual(mallets()[0].args.slice(0, 2), [300, 300]);
  point('pointercancel', 320, 490, 'touch');
  assert.equal(commands.at(-1).dx, 0); assert.equal(commands.at(-1).dy, 0);
  court.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1200, height: 640 });
  // High-rate mouse devices are coalesced below the server's 100 msg/s limit.
  const beforeBurst = commands.length;
  for (let i = 0; i < 1000; i++) { keyTime += .5; point('pointermove', 100 + i / 4, 240); if (i % 32 === 0) frame(keyTime); }
  keyTime += 20; frame(keyTime);
  assert.ok(commands.length - beforeBurst <= 33);
  assert.equal(commands.at(-1).x, 349.75);
  doc.getElementById('leaveButton').click(); doc.getElementById('confirmLeaveButton').click();
  const afterSurrender = commands.filter(c => c.type === 'leave').length;
  doc.getElementById('confirmLeaveButton').click(); assert.equal(commands.filter(c => c.type === 'leave').length, afterSurrender);
  assert.equal(commands.at(-1).type, 'leave');
  socket.receive({ type: 'result', outcome: 'loss', reason: 'forfeit', score: [1, 2] }); await delay(10);
  assert.equal(doc.getElementById('leaveButton').hidden, true); assert.equal(doc.getElementById('selfScore').textContent, '1');
  assert.ok(doc.getElementById('overlayDescription').textContent.includes('降参'));
  const resultTitle = doc.getElementById('overlayTitle').textContent;
  socket.receive({ type: 'hello', online: 1, blocked: false });
  assert.equal(doc.body.dataset.view, 'play'); assert.equal(doc.getElementById('overlayTitle').textContent, resultTitle);
  doc.getElementById('returnHomeButton').click(); assert.equal(doc.body.dataset.view, 'home');
  doc.getElementById('adminNav').click(); await delay(10);
  assert.equal(doc.getElementById('viewAdmin').hidden, false); assert.ok(doc.getElementById('connectedPlayers').textContent.includes('chun'));
  doc.getElementById('pausedInput').checked = true; doc.getElementById('settingsForm').dispatchEvent(new w.Event('submit', { cancelable: true })); await delay(10);
  assert.equal(savedSettings.paused, true); assert.equal(requests.some(r => r.path.includes('/auth')), false);
  doc.getElementById('adminConnectionsTab').click(); assert.equal(doc.getElementById('adminConnectionsPanel').hidden, false);
  assert.equal(doc.getElementById('adminSettingsPanel').hidden, true);
  doc.getElementById('adminRecordsTab').click();
  doc.querySelector('[data-player-id]').click(); await delay(10); assert.equal(doc.getElementById('adminPlayerDetail').hidden, false);
  socket.receive({ type: 'presence', online: 1, blocked: true, message: '全体停止' });
  assert.equal(doc.getElementById('maintenance').hidden, false); assert.equal(doc.getElementById('maintenanceMessage').textContent, '全体停止');
});

test('home restores valid control preferences and falls back to mouse for absent or invalid values', async () => {
  for (const stored of [null, 'keyboard', 'invalid']) {
    const dom = new JSDOM(readFileSync('public/index.html', 'utf8'), { url: 'http://localhost:3000', runScripts: 'outside-only' });
    const w = dom.window;
    try {
      w.HTMLCanvasElement.prototype.getContext = () => ({});
      w.fetch = async () => ({ ok: true, json: async () => ({ player: null, online: 0, blocked: false }) });
      w.FIELD = FIELD; w.movePaddle = movePaddle;
      if (stored !== null) w.localStorage.setItem('pong-control-mode', stored);
      w.eval(readFileSync('public/app.js', 'utf8').replace(/^import .*;$/gm, ''));
      await delay(1);
      assert.equal(w.document.querySelector('[name="controlMode"]:checked').value, stored === 'keyboard' ? 'keyboard' : 'mouse');
    } finally { w.close(); }
  }
});
