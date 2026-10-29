import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

test('real HTTP / WebSocket game, five points, mirrored input, CPU, admin stops and persistence', { timeout: 60000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'pong-server-'));
  let child, base, origin, logs = '';
  const sockets = [];
  async function boot() {
    // Deterministic horizontal serves keep this protocol test repeatable with narrow goals.
    const deterministicRandom = 'data:text/javascript,' + encodeURIComponent('Math.random = () => 0.5;');
    child = spawn(process.execPath, ['--import', deterministicRandom, 'server/index.js'], { env: { ...process.env, PORT: '0', HOST: '127.0.0.1', DATA_DIR: dir, ORIGIN_KEY: '', SECURE_COOKIE: 'false', TRUST_PROXY: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', data => { logs += data; }); child.stderr.on('data', data => { logs += data; });
    for (let i = 0; i < 100; i++) { const found = logs.match(/ready: (http:\/\/127\.0\.0\.1:\d+)/); if (found) { base = origin = found[1]; return; } await delay(50); }
    throw new Error(`Server did not start: ${logs}`);
  }
  async function stop() { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
  t.after(async () => { sockets.forEach(s => s.ws.terminate()); await stop(); rmSync(dir, { recursive: true, force: true }); });
  await boot();
  async function request(path, cookie, body) {
    const response = await fetch(`${base}${path}`, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { Origin: origin, 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body) } : {}) });
    return { status: response.status, cookie: response.headers.get('set-cookie')?.split(';')[0], data: await response.json() };
  }
  async function login(name) { const response = await request('/api/login', null, { name }); assert.equal(response.status, 200); return response; }
  async function socket(cookie) {
    const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie, Origin: origin } });
    const events = [], waiting = [];
    const result = { ws, send: msg => ws.send(JSON.stringify(msg)), next: (type, timeout = 5000) => new Promise((resolve, reject) => {
      const index = events.findIndex(e => e.type === type);
      if (index >= 0) return resolve(events.splice(index, 1)[0]);
      const item = { type, resolve: msg => { clearTimeout(item.timer); resolve(msg); } };
      item.timer = setTimeout(() => { const i = waiting.indexOf(item); if (i >= 0) waiting.splice(i, 1); reject(new Error(`Timeout waiting for ${type}. ${logs}`)); }, timeout);
      waiting.push(item);
    }) };
    ws.on('message', raw => {
      const msg = JSON.parse(raw); result.last = msg.type === 'state' ? msg.state : result.last;
      const index = waiting.findIndex(w => w.type === msg.type);
      if (index >= 0) waiting.splice(index, 1)[0].resolve(msg); else if (msg.type !== 'state' && msg.type !== 'presence') events.push(msg);
    });
    ws.on('error', () => {}); sockets.push(result); await once(ws, 'open'); await result.next('hello'); return result;
  }
  assert.equal((await request('/health')).status, 200);
  assert.equal((await request('/api/stats')).status, 401);
  const unsafe = await fetch(`${base}/api/login`, { method: 'POST', headers: { Origin: 'https://other.invalid' }, body: JSON.stringify({ name: 'csrf' }) }); assert.equal(unsafe.status, 403);
  const alice = await login('Alice'), bob = await login('Bob'), chun = await login('chun'), upper = await login('Chun');
  assert.equal((await request('/api/admin', alice.cookie)).status, 403);
  assert.equal((await request('/api/admin', upper.cookie)).status, 403);
  assert.equal((await request('/api/admin', chun.cookie)).status, 200);
  assert.equal((await request('/api/login', null, { name: '<script>' })).status, 400);
  const a = await socket(alice.cookie), b = await socket(bob.cookie), admin = await socket(chun.cookie);
  assert.equal((await request('/api/login', null, { name: 'Alice' })).status, 409);
  a.send({ type: 'createRoom' }); const room = await a.next('waiting'); assert.match(room.code, /^[A-F0-9]{6}$/);
  b.send({ type: 'joinRoom', code: 'XXXXXX' }); await b.next('error');
  b.send({ type: 'joinRoom', code: room.code }); const am = await a.next('match'), bm = await b.next('match');
  assert.equal(am.opponent, 'Bob'); assert.equal(bm.opponent, 'Alice');
  assert.equal(am.state.paddles[0].x, 90); assert.equal(bm.state.paddles[0].x, 90);
  for (const client of [a, b]) client.send({ type: 'input', dx: 0, dy: 0, dash: { id: 1, dx: 1, dy: -1 }, stamina: 999 });
  await delay(150);
  for (const client of [a, b]) {
    assert.ok(client.last.paddles[0].x > 150);
    assert.equal(client.last.paddles[0].stamina, 65);
    client.send({ type: 'input', dx: 0, dy: 0, dash: { id: 1, dx: 1, dy: -1 } });
  }
  await delay(150);
  assert.equal(a.last.paddles[0].stamina, 65); assert.equal(b.last.paddles[0].stamina, 65);
  a.send({ type: 'input', dx: 1, dy: 0 }); b.send({ type: 'input', dx: 1, dy: 0 }); await delay(150);
  assert.ok(a.last.paddles[0].x > 100); assert.ok(b.last.paddles[0].x > 100);
  // Pointer positions are applied directly for both mirrored participants.
  for (const client of [a, b]) client.send({ type: 'input', x: 500, y: 120 });
  await delay(80);
  for (const client of [a, b]) {
    assert.equal(client.last.paddles[0].x, 500);
    assert.equal(client.last.paddles[0].y, 120);
  }
  const follow = setInterval(() => {
    if (a.last) a.send({ type: 'input', x: 90, y: a.last.ball.y });
    if (b.last) b.send({ type: 'input', x: 35, y: b.last.ball.y > 320 ? 64 : 576 });
  }, 40);
  let resultA, resultB;
  try { [resultA, resultB] = await Promise.all([a.next('result', 35000), b.next('result', 35000)]); } finally { clearInterval(follow); }
  assert.equal(resultA.outcome, 'win'); assert.equal(resultA.score[0], 5); assert.equal(resultB.outcome, 'loss'); assert.equal(resultB.score[1], 5);
  const events = logs.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.ok(events.some(e => e.event === 'match_finished' && e.outcome === 'completed'));
  assert.equal(events.some(e => 'name' in e || 'token' in e || 'ip' in e), false);
  const stats = (await request('/api/stats', alice.cookie)).data;
  assert.equal(stats.wins, 1); assert.equal(stats.score, 5); assert.equal(stats.opponents[0].name, 'Bob'); assert.ok(stats.playSeconds > 0);
  for (const level of [1, 2, 3]) {
    a.send({ type: 'cpu', level }); const cpu = await a.next('match'); assert.equal(cpu.level, level);
    a.send({ type: 'leave' }); const loss = await a.next('result'); assert.equal(loss.outcome, 'loss');
  }
  a.send({ type: 'queue' }); await a.next('waiting'); b.send({ type: 'queue' }); await a.next('match'); await b.next('match');
  const data = (await request('/api/admin', chun.cookie)).data;
  assert.equal(data.connected.find(p => p.name === 'Alice').status, 'playing');
  const settings = { paused: true, message: 'テスト停止', windows: [], daily: { enabled: false, start: '23:00', end: '07:00' } };
  assert.equal((await request('/api/admin/settings', alice.cookie, settings)).status, 403);
  assert.equal((await request('/api/admin/settings', chun.cookie, settings)).status, 200);
  assert.equal((await a.next('result')).outcome, 'cancelled'); assert.equal((await b.next('result')).reason, 'maintenance');
  a.send({ type: 'cpu', level: 1 }); assert.equal((await a.next('error')).message, 'テスト停止');
  assert.equal((await request('/api/status')).data.blocked, true);
  settings.paused = false; settings.windows = [{ start: new Date(Date.now() - 1000).toISOString(), end: new Date(Date.now() + 60000).toISOString() }];
  await request('/api/admin/settings', chun.cookie, settings); assert.equal((await request('/api/status')).data.blocked, true);
  settings.windows = []; settings.daily = { enabled: true, start: '00:00', end: '23:59' };
  await request('/api/admin/settings', chun.cookie, settings);
  const jst = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }).format(Date.now());
  assert.equal((await request('/api/status')).data.blocked, jst < '23:59');
  settings.daily = { enabled: true, start: '23:00', end: '07:00' }; await request('/api/admin/settings', chun.cookie, settings);
  assert.equal((await request('/api/status')).data.blocked, jst >= '23:00' || jst < '07:00');
  settings.daily.enabled = false; await request('/api/admin/settings', chun.cookie, settings);
  const invalid = { ...settings, daily: { enabled: true, start: '07:00', end: '07:00' } };
  assert.equal((await request('/api/admin/settings', chun.cookie, invalid)).status, 400);
  const finalStats = (await request('/api/admin/stats?id=' + alice.data.player.id, chun.cookie)).data;
  assert.equal(finalStats.games, 4); assert.equal(finalStats.cancelled, 1); assert.equal(finalStats.opponents.length, 4);
  assert.equal((await request('/api/stats?mode=online', alice.cookie)).data.games, 1);
  assert.equal((await request('/api/stats?mode=cpu', alice.cookie)).data.games, 3);
  sockets.forEach(s => s.ws.close()); await delay(150); await stop(); logs = ''; await boot();
  assert.equal((await request('/api/me', alice.cookie)).data.player.name, 'Alice');
  assert.equal((await request('/api/stats', alice.cookie)).data.games, 4);
  assert.equal((await request('/api/admin', chun.cookie)).data.settings.daily.enabled, false);
  await request('/api/logout', alice.cookie, {}); assert.equal((await request('/api/stats', alice.cookie)).status, 401);
});
