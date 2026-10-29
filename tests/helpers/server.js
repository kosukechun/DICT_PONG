import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

export async function until(check, message = 'condition', timeout = 4000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await check()) return; await delay(15); }
  assert.fail(`Timed out: ${message}`);
}

export async function gameServer(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'pong-online-'));
  const connections = new Set();
  let child, base, output = '';
  const api = {
    get base() { return base; }, get logs() { return output; },
    async boot() {
      let bootOutput = '';
      // The IPC shutdown hook exists only in this test process, never in the app.
      const hook = 'data:text/javascript,' + encodeURIComponent("Math.random = () => 0.5; process.on('message', value => { if (value === 'test:shutdown') process.emit('SIGTERM'); });");
      child = spawn(process.execPath, ['--import', hook, 'server/index.js'], {
        cwd: options.root || process.cwd(),
        env: { ...process.env, HOST: '127.0.0.1', PORT: '0', DATA_DIR: directory, ORIGIN_KEY: options.originKey || '', SECURE_COOKIE: String(Boolean(options.secureCookie)), TRUST_PROXY: 'false' },
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      });
      for (const pipe of [child.stdout, child.stderr]) pipe.on('data', data => { output += data; bootOutput += data; });
      child.on('error', error => { bootOutput += String(error); });
      await until(() => {
        const found = bootOutput.match(/ready: (http:\/\/127\.0\.0\.1:\d+)/);
        if (found) { base = found[1]; return true; }
        assert.equal(child.exitCode, null, bootOutput);
      }, 'server startup', 6000);
    },
    async stop(graceful = false) {
      if (!child || child.exitCode !== null || child.signalCode) return;
      if (graceful) child.send('test:shutdown'); else child.kill();
      await until(() => child.exitCode !== null || child.signalCode, 'server exit', 6000);
    },
    async request(path, cookie, body, extra = {}) {
      const response = await fetch(base + path, {
        method: body !== undefined ? 'POST' : 'GET',
        ...extra,
        headers: { ...(options.originKey ? { 'X-Pong-Origin': options.originKey } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body !== undefined ? { Origin: base, 'Content-Type': 'application/json' } : {}), ...extra.headers },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, data: await response.json(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
    },
    async login(name) {
      const result = await api.request('/api/login', null, { name });
      assert.equal(result.status, 200, JSON.stringify(result.data));
      return result.cookie;
    },
    async connect(cookie) {
      const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Cookie: cookie, Origin: base, ...(options.originKey ? { 'X-Pong-Origin': options.originKey } : {}) } });
      const messages = [], states = [];
      const client = {
        ws, messages, states, last: null, closeInfo: null,
        send(value) { ws.send(JSON.stringify(value)); },
        async next(type, predicate = () => true, timeout = 4000) {
          let index;
          await until(() => { index = messages.findIndex(m => m.type === type && predicate(m)); return index >= 0; }, `message ${type}`, timeout);
          return messages.splice(index, 1)[0];
        },
        async state(predicate) { await until(() => client.last && predicate(client.last), 'matching game state'); return client.last; },
      };
      connections.add(client);
      ws.on('message', raw => {
        const value = JSON.parse(raw);
        if (value.type === 'state') { client.last = value.state; states.push(value); if (states.length > 600) states.shift(); }
        else if (value.type !== 'presence') messages.push(value);
      });
      ws.on('close', (code, reason) => { client.closeInfo = { code, reason: String(reason) }; });
      ws.on('error', () => {});
      await client.next('hello');
      return client;
    },
    async rejectSocket(cookie = '', headers = {}) {
      return await new Promise((resolveStatus, reject) => {
        const ws = new WebSocket(base.replace('http', 'ws') + '/ws', { headers: { Origin: base, Cookie: cookie, ...headers } });
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('Expected a rejected WebSocket handshake')); }, 4000);
        ws.on('unexpected-response', (_, res) => { clearTimeout(timer); res.resume(); ws.terminate(); resolveStatus(res.statusCode); });
        ws.on('open', () => { clearTimeout(timer); ws.terminate(); reject(new Error('Unexpectedly accepted a WebSocket')); });
        ws.on('error', () => {});
      });
    },
    async pair(a, b) {
      a.send({ type: 'createRoom' });
      const room = await a.next('waiting', m => m.active);
      b.send({ type: 'joinRoom', code: room.code });
      const [left, right] = await Promise.all([a.next('match'), b.next('match')]);
      assert.equal(left.id, right.id);
      return left.id;
    },
  };
  t.after(async () => {
    for (const client of connections) client.ws.terminate();
    await api.stop();
    if (dirname(resolve(directory)) !== resolve(tmpdir())) throw new Error('Unexpected test data directory');
    rmSync(directory, { recursive: true, force: true });
  });
  await api.boot();
  return api;
}
