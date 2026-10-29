import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { gameServer, until } from './helpers/server.js';
import { FIELD } from '../public/field.js';

test('private rooms: own/stale/full codes, cancellation and simultaneous joins', async t => {
  const s = await gameServer(t);
  const clients = await Promise.all(['Host', 'Guest', 'Third'].map(async name => s.connect(await s.login(name))));
  const [a, b, c] = clients;
  a.send({ type: 'createRoom' }); const first = await a.next('waiting', m => m.active);
  a.send({ type: 'joinRoom', code: first.code }); await a.next('error');
  a.send({ type: 'createRoom' }); const second = await a.next('waiting', m => m.active);
  assert.notEqual(first.code, second.code);
  b.send({ type: 'joinRoom', code: first.code }); await b.next('error');
  a.send({ type: 'leave' }); await a.next('waiting', m => !m.active);
  b.send({ type: 'joinRoom', code: second.code }); await b.next('error');
  a.send({ type: 'createRoom' }); const room = await a.next('waiting', m => m.active);
  b.send({ type: 'joinRoom', code: room.code }); c.send({ type: 'joinRoom', code: room.code });
  const started = await a.next('match');
  await until(() => b.messages.some(m => m.type === 'match' || m.type === 'error') && c.messages.some(m => m.type === 'match' || m.type === 'error'));
  assert.equal([b, c].filter(x => x.messages.some(m => m.type === 'match' && m.id === started.id)).length, 1);
  assert.equal([b, c].filter(x => x.messages.some(m => m.type === 'error')).length, 1);
  a.send({ type: 'leave' }); await a.next('result');
});

test('queue: duplicate requests, disconnected waiters and queue-to-room transitions leave no ghosts', async t => {
  const s = await gameServer(t);
  const a = await s.connect(await s.login('QueueA')), b = await s.connect(await s.login('QueueB'));
  a.send({ type: 'queue' }); a.send({ type: 'queue' });
  await a.next('waiting', m => m.active);
  await until(async () => (await s.request('/api/status')).data.waiting === 1);
  a.ws.terminate(); await until(() => a.closeInfo);
  await until(async () => (await s.request('/api/status')).data.waiting === 0);
  b.send({ type: 'queue' }); await b.next('waiting', m => m.active);
  b.send({ type: 'createRoom' }); const room = await b.next('waiting', m => m.kind === 'room');
  assert.equal((await s.request('/api/status')).data.waiting, 0);
  const c = await s.connect(await s.login('QueueC'));
  c.send({ type: 'joinRoom', code: room.code }); await Promise.all([b.next('match'), c.next('match')]);
  const status = (await s.request('/api/status')).data;
  assert.equal(status.matches, 1); assert.equal(status.playing, 2); assert.equal(status.waiting, 0);
});

test('disconnect/reconnect and simultaneous surrender record exactly one mirrored result', async t => {
  const s = await gameServer(t);
  const ca = await s.login('ReconnectA'), cb = await s.login('ReconnectB');
  const a = await s.connect(ca), b = await s.connect(cb);
  assert.equal(await s.rejectSocket(ca), 409);
  const firstId = await s.pair(a, b);
  a.ws.terminate(); const win = await b.next('result');
  assert.equal(win.id, firstId); assert.equal(win.outcome, 'win'); assert.equal(win.reason, 'disconnect');
  await until(() => a.closeInfo);
  const again = await s.connect(ca);
  assert.equal((await s.request('/api/stats', ca)).data.games, 1);
  const secondId = await s.pair(again, b); assert.notEqual(secondId, firstId);
  again.send({ type: 'leave' }); b.send({ type: 'leave' });
  const [ra, rb] = await Promise.all([again.next('result'), b.next('result')]);
  assert.notEqual(ra.outcome, rb.outcome); assert.equal(ra.id, rb.id);
  await delay(80);
  for (const [cookie, client] of [[ca, again], [cb, b]]) {
    const stats = (await s.request('/api/stats', cookie)).data;
    assert.equal(stats.games, 2); assert.equal(stats.recent.length, 2);
    assert.equal(client.messages.filter(m => m.type === 'result').length, 0);
  }
});

test('stale keyboard input stops after the timeout; both sides clamp pointer input safely', async t => {
  const s = await gameServer(t);
  const a = await s.connect(await s.login('InputA')), b = await s.connect(await s.login('InputB'));
  await s.pair(a, b);
  for (const c of [a, b]) c.send({ type: 'input', x: -99999, y: 99999 });
  for (const c of [a, b]) await c.state(v => v.paddles[0].x === FIELD.paddleInset && v.paddles[0].y === FIELD.height - FIELD.paddleInset);
  for (const c of [a, b]) c.send({ type: 'input', x: 99999, y: -99999 });
  for (const c of [a, b]) await c.state(v => v.paddles[0].x === FIELD.width / 2 - FIELD.centerInset && v.paddles[0].y === FIELD.paddleInset);
  a.send({ type: 'input', x: 200, y: 320 }); await a.state(v => v.paddles[0].x === 200);
  a.send({ type: 'input', dx: .1, dy: 0 });
  await a.state(v => v.paddles[0].x > 205);
  await delay(700); const stopped = a.last.paddles[0].x;
  await delay(150); assert.equal(a.last.paddles[0].x, stopped);
  assert.ok(stopped > 220 && stopped < 240);
});

test('three simultaneous matches survive normal 60 Hz input, latency and paused reads without cross-talk', { timeout: 15000 }, async t => {
  const s = await gameServer(t), clients = [];
  for (let i = 0; i < 6; i++) clients.push(await s.connect(await s.login('Concurrent' + i)));
  const ids = [];
  for (let i = 0; i < 6; i += 2) ids.push(await s.pair(clients[i], clients[i + 1]));
  assert.equal(new Set(ids).size, 3);
  let tick = 0;
  const input = setInterval(() => {
    tick++;
    clients.forEach((c, i) => c.send({ type: 'input', x: 120 + i * 45, y: 320 + Math.sin(tick / 15 + i) * 180 }));
  }, 1000 / 60);
  t.after(() => clearInterval(input));
  clients[5].ws.pause(); await delay(250); clients[5].ws.resume();
  await delay(2700); clearInterval(input);
  assert.equal((await s.request('/api/status')).data.matches, 3);
  for (let i = 0; i < clients.length; i++) {
    const c = clients[i]; assert.equal(c.closeInfo, null); assert.ok(c.states.length > 80);
    for (const { state } of c.states) {
      for (const obj of [...state.paddles, state.ball]) assert.ok([obj.x, obj.y, obj.vx, obj.vy].every(Number.isFinite));
      assert.ok(state.paddles[0].x >= FIELD.paddleInset && state.paddles[0].x <= 600 - FIELD.centerInset);
    }
  }
  // Inputs arriving late still land at the right position for each participant.
  await delay(150);
  for (let i = 0; i < clients.length; i++) clients[i].send({ type: 'input', x: 140 + i * 40, y: 240 });
  for (let i = 0; i < clients.length; i++) await clients[i].state(v => v.paddles[0].x === 140 + i * 40 && v.paddles[0].y === 240);
  for (let i = 0; i < clients.length; i += 2) {
    const left = clients[i].last, right = clients[i + 1].last;
    assert.equal(left.paddles[1].x, 1200 - right.paddles[0].x);
    assert.deepEqual(left.score, [...right.score].reverse());
  }
  clients[0].send({ type: 'leave' }); await clients[0].next('result'); await clients[1].next('result');
  assert.equal((await s.request('/api/status')).data.matches, 2);
});

test('malformed, oversized and flooded WebSockets cannot crash or disturb healthy clients', async t => {
  const s = await gameServer(t);
  assert.equal(await s.rejectSocket(), 401);
  const healthy = await s.connect(await s.login('Healthy'));
  assert.equal(await s.rejectSocket(await s.login('WrongOrigin'), { Origin: 'https://other.invalid' }), 403);
  for (const [name, payload, code] of [
    ['BadJSON', '{', 1008], ['BadShape', 'null', 1008], ['Oversize', 'x'.repeat(3000), 1009],
  ]) {
    const c = await s.connect(await s.login(name)); c.ws.send(payload);
    await until(() => c.closeInfo); assert.equal(c.closeInfo.code, code);
  }
  const flood = await s.connect(await s.login('Flood'));
  for (let i = 0; i < 110; i++) flood.send({ type: 'input', dx: 0, dy: 0 });
  await until(() => flood.closeInfo); assert.equal(flood.closeInfo.code, 1008);
  healthy.send({ type: 'cpu', level: 2 }); await healthy.next('match');
  assert.equal((await s.request('/health')).status, 200); assert.equal(healthy.closeInfo, null);
});

test('logout mid-match revokes the session and awards one disconnect result', async t => {
  const s = await gameServer(t), ca = await s.login('LogoutA'), cb = await s.login('LogoutB');
  const a = await s.connect(ca), b = await s.connect(cb); await s.pair(a, b);
  const logout = await s.request('/api/logout', ca, {}); assert.equal(logout.status, 200);
  const win = await b.next('result'); assert.equal(win.outcome, 'win'); assert.equal(win.reason, 'disconnect');
  assert.equal((await s.request('/api/stats', ca)).status, 401);
  assert.equal(await s.rejectSocket(ca), 401);
  const newCookie = await s.login('LogoutA'); assert.equal((await s.request('/api/stats', newCookie)).data.losses, 1);
});

test('graceful restart saves an interrupted online match and preserves sessions and stats', async t => {
  const s = await gameServer(t), ca = await s.login('RestartA'), cb = await s.login('RestartB');
  const a = await s.connect(ca), b = await s.connect(cb); const id = await s.pair(a, b);
  await s.stop(true);
  const [ra, rb] = await Promise.all([a.next('result'), b.next('result')]);
  assert.equal(ra.id, id); assert.equal(ra.outcome, 'cancelled'); assert.equal(rb.reason, 'restart');
  await s.boot();
  for (const cookie of [ca, cb]) {
    assert.ok((await s.request('/api/me', cookie)).data.player);
    const stats = (await s.request('/api/stats', cookie)).data;
    assert.equal(stats.games, 0); assert.equal(stats.cancelled, 1); assert.equal(stats.recent.length, 1);
  }
  await s.pair(await s.connect(ca), await s.connect(cb));
});

test('AWS-origin header, secure cookies and static assets enforce the deployment boundary', async t => {
  const s = await gameServer(t, { originKey: 'test-origin-secret', secureCookie: true });
  assert.equal((await fetch(s.base + '/')).status, 403);
  assert.equal((await fetch(s.base + '/health')).status, 200);
  assert.equal(await s.rejectSocket('', { 'X-Pong-Origin': 'wrong' }), 403);
  const login = await s.request('/api/login', null, { name: 'OriginA' });
  assert.match(login.headers.get('set-cookie'), /HttpOnly; SameSite=Strict;.*Secure/);
  assert.ok(login.headers.get('strict-transport-security'));
  const c = await s.connect(login.cookie); assert.equal(c.closeInfo, null);
  for (const path of ['/app.js', '/movement.js', '/field.js']) {
    const response = await fetch(s.base + path, { headers: { 'X-Pong-Origin': 'test-origin-secret' } });
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type'), /javascript/);
  }
});

test('unexpected HTTP bodies and static property names return client errors', async t => {
  const s = await gameServer(t);
  for (const body of [null, [], 'name', 123]) assert.equal((await s.request('/api/login', null, body)).status, 400);
  assert.equal((await s.request('/api/login', null, { name: 'x'.repeat(17000) })).status, 413);
  const malformed = await fetch(s.base + '/api/login', { method: 'POST', headers: { Origin: s.base }, body: '{' });
  assert.equal(malformed.status, 400);
  for (const path of ['/__proto__', '/constructor', '/toString', '/missing']) assert.equal((await fetch(s.base + path)).status, 404);
  assert.equal((await s.request('/health')).status, 200);
});

test('maintenance cancels simultaneous matches and clears queue and room waiters before reopening', async t => {
  const s = await gameServer(t), admin = await s.login('chun'), clients = [];
  for (let i = 0; i < 6; i++) clients.push(await s.connect(await s.login('Maintenance' + i)));
  await s.pair(clients[0], clients[1]); await s.pair(clients[2], clients[3]);
  clients[4].send({ type: 'queue' }); await clients[4].next('waiting', m => m.active);
  clients[5].send({ type: 'createRoom' }); const room = await clients[5].next('waiting', m => m.active);
  const settings = { paused: true, message: 'Maintenance', windows: [], daily: { enabled: false, start: '23:00', end: '07:00' } };
  assert.equal((await s.request('/api/admin/settings', admin, settings)).status, 200);
  for (const c of clients.slice(0, 4)) assert.equal((await c.next('result')).outcome, 'cancelled');
  assert.equal((await s.request('/api/status')).data.matches, 0);
  assert.equal((await s.request('/api/status')).data.waiting, 0);
  clients[4].send({ type: 'cpu', level: 1 }); await clients[4].next('error');
  settings.paused = false; await s.request('/api/admin/settings', admin, settings);
  clients[4].send({ type: 'joinRoom', code: room.code }); await clients[4].next('error');
  await s.pair(clients[4], clients[5]);
  assert.equal((await s.request('/api/status')).data.matches, 1);
});

test('Japanese names survive a multibyte UTF-8 character split across HTTP chunks', async t => {
  const s = await gameServer(t), bytes = Buffer.from(JSON.stringify({ name: '日本語プレイヤー' }));
  const status = await new Promise((resolve, reject) => {
    const req = http.request(s.base + '/api/login', { method: 'POST', headers: { Origin: s.base, 'Content-Type': 'application/json', 'Content-Length': bytes.length } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.write(bytes.subarray(0, 10)); setTimeout(() => req.end(bytes.subarray(10)), 30);
  });
  assert.equal(status, 200);
});
