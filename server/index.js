import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { WebSocketServer, WebSocket } from 'ws';
import { Store } from './store.js';
import { FIELD, makeState, movePaddle, stepBall, cpuInput, viewState, clamp } from './physics.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = new Store(process.env.DATA_DIR || resolve(root, 'data'));
const clients = new Map(), matches = new Map(), rooms = new Map(), queue = [];
const rates = new Map();
let settings = store.settings(), lastBlocked = false, shuttingDown = false;
const originKey = process.env.ORIGIN_KEY || '';
const cookieSecure = process.env.SECURE_COOKIE === 'true';
// CloudWatch can discover these JSON fields. Never log names, sessions or IPs.
const log = (event, fields = {}) => console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...fields }));
const send = (client, message) => { if (client?.ws.readyState === WebSocket.OPEN && client.ws.bufferedAmount < 128 * 1024) client.ws.send(JSON.stringify(message)); };
const errorMessage = (client, message) => send(client, { type: 'error', message });
const tokenOf = req => (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith('pong_session='))?.slice(13) || '';
const safeEqual = (a, b) => timingSafeEqual(createHash('sha256').update(String(a)).digest(), createHash('sha256').update(String(b)).digest());
function rate(key, limit, period = 60000) {
  const now = Date.now();
  let item = rates.get(key);
  if (!item || item.until <= now) { item = { count: 0, until: now + period }; rates.set(key, item); }
  return ++item.count <= limit;
}
function ipOf(req) {
  if (process.env.TRUST_PROXY !== 'true') return req.socket.remoteAddress;
  const parts = String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean);
  return parts.at(-2) || parts.at(-1) || req.socket.remoteAddress;
}
function validOrigin(req) {
  try { return new URL(req.headers.origin).host === req.headers.host; } catch { return false; }
}
export function blockedAt(value, now = Date.now()) {
  if (value.paused) return value.message;
  if (value.windows.some(w => now >= Date.parse(w.start) && now < Date.parse(w.end))) return value.message;
  if (value.daily?.enabled) {
    const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tokyo', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
    const { start, end } = value.daily;
    if (start < end ? time >= start && time < end : time >= start || time < end) return value.message;
  }
  return null;
}
function publicStatus() {
  return { blocked: Boolean(blockedAt(settings)), message: blockedAt(settings) || '', online: clients.size, playing: [...clients.values()].filter(c => c.match).length, matches: matches.size, waiting: queue.length };
}
function broadcastPresence() {
  const status = publicStatus();
  for (const client of clients.values()) send(client, { type: 'presence', ...status });
}
function clearWaiting(client) {
  let i; while ((i = queue.indexOf(client.id)) !== -1) queue.splice(i, 1);
  if (client.room) { rooms.delete(client.room); client.room = null; }
  client.waiting = false;
}
function startMatch(first, second, mode, level) {
  clearWaiting(first); if (!second.cpu) clearWaiting(second);
  const match = { id: randomUUID(), mode, level, players: [first, second], state: makeState(), started: Date.now(), lastSnapshot: 0 };
  matches.set(match.id, match);
  match.players.forEach((p, side) => {
    if (p.cpu) return;
    p.match = match.id; p.side = side; p.input = {}; p.dashSequence = 0; p.pendingDash = null;
    send(p, { type: 'match', id: match.id, mode, level, you: p.name, opponent: match.players[1 - side].name, field: FIELD, state: viewState(match.state, side), started: match.started });
  });
  broadcastPresence();
  log('match_started', { matchId: match.id, mode, level: level || null });
}
function endMatch(match, winner, reason) {
  if (!matches.has(match.id)) return;
  // Commit both players' results in one transaction before announcing the result.
  store.record(match, winner, reason);
  matches.delete(match.id);
  log('match_finished', { matchId: match.id, mode: match.mode, reason, outcome: winner === 'cancelled' ? 'cancelled' : 'completed', durationSeconds: Math.floor((Date.now() - match.started) / 1000), score: match.state.score });
  match.players.forEach((p, side) => {
    if (p.cpu) return;
    p.match = null; p.input = {};
    send(p, { type: 'result', id: match.id, outcome: winner === 'cancelled' ? 'cancelled' : winner === side ? 'win' : 'loss', reason, score: side ? [...match.state.score].reverse() : [...match.state.score], duration: Math.floor((Date.now() - match.started) / 1000) });
  });
  broadcastPresence();
}
function applyRestrictions() {
  const blocked = Boolean(blockedAt(settings));
  if (blocked && !lastBlocked) {
    for (const match of [...matches.values()]) endMatch(match, 'cancelled', 'maintenance');
    for (const c of clients.values()) { clearWaiting(c); send(c, { type: 'waiting', active: false }); }
  }
  lastBlocked = blocked;
  broadcastPresence();
}
function cleanSettings(input) {
  if (typeof input.paused !== 'boolean' || !Array.isArray(input.windows) || input.windows.length > 20) throw new Error('停止設定の形式が正しくありません。');
  const message = String(input.message || 'メンテナンス中です。しばらくお待ちください。').trim().slice(0, 200);
  const windows = input.windows.map(w => {
    const start = Date.parse(w.start), end = Date.parse(w.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error('停止日時は開始より終了を後にしてください。');
    return { id: String(w.id || randomUUID()).slice(0, 50), start: new Date(start).toISOString(), end: new Date(end).toISOString() };
  });
  const daily = { enabled: Boolean(input.daily?.enabled), start: String(input.daily?.start || '23:00'), end: String(input.daily?.end || '07:00') };
  if (![daily.start, daily.end].every(t => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)) || daily.start === daily.end) throw new Error('毎日の制限時間を正しく指定してください。開始と終了は別の時刻にしてください。');
  return { paused: input.paused, message, windows, daily };
}
async function readJSON(req) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > 16384) { const e = new Error('送信データが大きすぎます。'); e.status = 413; throw e; }
  }
  try { return JSON.parse(body || '{}'); } catch { const e = new Error('JSON形式が正しくありません。'); e.status = 400; throw e; }
}
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
const server = http.createServer(async (req, res) => {
  const json = (status, value) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); };
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (cookieSecure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health' && req.method === 'GET') return json(200, { ok: !shuttingDown });
    if (originKey && !safeEqual(req.headers['x-pong-origin'] || '', originKey)) return json(403, { error: 'CloudFrontのURLからアクセスしてください。' });
    if (!rate(`http:${ipOf(req)}`, 400)) return json(429, { error: 'アクセスが多すぎます。1分ほどお待ちください。' });
    if (!['GET', 'HEAD'].includes(req.method) && !validOrigin(req)) return json(403, { error: '同じサイトから操作してください。' });
    const token = tokenOf(req), player = store.session(token);
    if (url.pathname === '/api/status' && req.method === 'GET') return json(200, publicStatus());
    if (url.pathname === '/api/me' && req.method === 'GET') return json(200, { player: player || null, adminAvailable: player?.name === 'chun', ...publicStatus() });
    if (url.pathname === '/api/login' && req.method === 'POST') {
      if (!rate(`login:${ipOf(req)}`, 20)) return json(429, { error: '名前登録の操作が多すぎます。1分ほどお待ちください。' });
      const input = await readJSON(req);
      const name = String(input.name || '').normalize('NFC').trim();
      if (!/^[\p{L}\p{N}_\- ]{1,16}$/u.test(name) || /^cpu/i.test(name)) return json(400, { error: '名前は1〜16文字の文字・数字・空白・_・-で入力してください。CPUで始まる名前は使用できません。' });
      const existing = store.findPlayer(name);
      if (existing && clients.has(existing.id) && existing.id !== player?.id) return json(409, { error: 'その名前は現在接続中です。別の名前を使ってください。' });
      if (player && clients.has(player.id)) return json(409, { error: '名前変更の前にログアウトしてください。' });
      const result = store.register(name);
      res.setHeader('Set-Cookie', `pong_session=${result.token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${cookieSecure ? '; Secure' : ''}`);
      return json(200, { player: result.player, adminAvailable: result.player.name === 'chun' });
    }
    if (url.pathname === '/api/logout' && req.method === 'POST') {
      if (player) clients.get(player.id)?.ws.close(1000, 'logout');
      store.logout(token);
      res.setHeader('Set-Cookie', `pong_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${cookieSecure ? '; Secure' : ''}`);
      return json(200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      if (!player) return json(401, { error: '名前を登録してから操作してください。' });
      if (url.pathname === '/api/stats' && req.method === 'GET') return json(200, store.stats(player.id, url.searchParams.get('mode')));
      if (url.pathname.startsWith('/api/admin')) {
        if (player.name !== 'chun') return json(403, { error: '管理者名はchunのみです。' });
        if (url.pathname === '/api/admin' && req.method === 'GET') return json(200, {
          settings, status: publicStatus(), players: store.players(),
          connected: [...clients.values()].map(c => ({ id: c.id, name: c.name, status: c.match ? 'playing' : c.waiting ? 'waiting' : 'lobby', mode: matches.get(c.match)?.mode || null, opponent: matches.get(c.match)?.players.find(p => p.id !== c.id)?.name || null, connectedAt: c.connectedAt })),
        });
        if (url.pathname === '/api/admin/settings' && req.method === 'POST') {
          let value; try { value = cleanSettings(await readJSON(req)); } catch (error) { return json(400, { error: error.message }); }
          settings = store.settings(value); applyRestrictions();
          return json(200, { ok: true, settings });
        }
        if (url.pathname === '/api/admin/stats' && req.method === 'GET') {
          const id = url.searchParams.get('id');
          if (!store.player(id)) return json(404, { error: 'プレイヤーが見つかりません。' });
          return json(200, store.stats(id, url.searchParams.get('mode')));
        }
      }
      return json(404, { error: 'このAPIは存在しません。' });
    }
    if (!['GET', 'HEAD'].includes(req.method)) return json(405, { error: 'この操作には対応していません。' });
    const files = { '/': 'index.html', '/index.html': 'index.html', '/style.css': 'style.css', '/app.js': 'app.js', '/field.js': 'field.js', '/favicon.svg': 'favicon.svg', '/HTdR38qbIAA86Ob.webp': 'HTdR38qbIAA86Ob.webp' };
    const file = files[url.pathname];
    if (!file) return json(404, { error: 'ページが見つかりません。' });
    const data = await readFile(resolve(root, 'public', file));
    res.writeHead(200, { 'Content-Type': mime[extname(file)] }); res.end(req.method === 'HEAD' ? undefined : data);
  } catch (error) {
    log('request_error', { status: error.status || 500, errorType: error.name });
    if (!res.headersSent) json(error.status || 500, { error: error.status ? error.message : 'サーバーでエラーが発生しました。' });
    else res.end();
  }
});
const wss = new WebSocketServer({ noServer: true, maxPayload: 2048, perMessageDeflate: false });
server.on('upgrade', (req, socket, head) => {
  const reject = code => { socket.write(`HTTP/1.1 ${code}\r\nConnection: close\r\n\r\n`); socket.destroy(); };
  if (req.url !== '/ws' || !validOrigin(req) || (originKey && !safeEqual(req.headers['x-pong-origin'] || '', originKey))) return reject('403 Forbidden');
  if (!rate(`ws:${ipOf(req)}`, 30)) return reject('429 Too Many Requests');
  const player = store.session(tokenOf(req));
  if (!player) return reject('401 Unauthorized');
  if (clients.has(player.id)) return reject('409 Conflict');
  if (clients.size >= 200) return reject('503 Service Unavailable');
  wss.handleUpgrade(req, socket, head, ws => {
    const client = { ...player, ws, token: tokenOf(req), input: {}, match: null, waiting: false, room: null, alive: true, connectedAt: Date.now(), messages: 0, messageWindow: Date.now() };
    clients.set(player.id, client);
    log('player_connected', { online: clients.size });
    ws.on('pong', () => { client.alive = true; });
    ws.on('error', () => {});
    send(client, { type: 'hello', player, ...publicStatus() }); broadcastPresence();
    ws.on('message', raw => {
      if (Date.now() - client.messageWindow > 1000) { client.messageWindow = Date.now(); client.messages = 0; }
      if (++client.messages > 100) return ws.close(1008, 'rate limit');
      let msg; try { msg = JSON.parse(raw); } catch { return ws.close(1008, 'invalid JSON'); }
      if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') return ws.close(1008, 'invalid message');
      if (msg.type === 'input') {
        if (!client.match) return;
        const dash = msg.dash;
        if (Number.isSafeInteger(dash?.id) && dash.id > client.dashSequence && [dash.dx, dash.dy].every(n => Number.isInteger(n) && Math.abs(n) <= 1) && (dash.dx || dash.dy)) {
          client.dashSequence = dash.id;
          client.pendingDash = { dx: dash.dx * (client.side ? -1 : 1), dy: dash.dy };
        }
        if (Number.isFinite(msg.x) && Number.isFinite(msg.y)) client.input = { x: client.side ? FIELD.width - clamp(msg.x, 35, 545) : clamp(msg.x, 35, 545), y: clamp(msg.y, 64, 576) };
        else client.input = { dx: clamp(Number(msg.dx) || 0, -1, 1) * (client.side ? -1 : 1), dy: clamp(Number(msg.dy) || 0, -1, 1) };
        client.inputAt = Date.now(); return;
      }
      if (!rate(`action:${client.id}`, 30, 10000)) return errorMessage(client, '操作が多すぎます。少しお待ちください。');
      if (msg.type === 'leave') {
        const match = matches.get(client.match);
        if (match) endMatch(match, 1 - client.side, 'forfeit');
        clearWaiting(client); send(client, { type: 'waiting', active: false }); broadcastPresence(); return;
      }
      if (blockedAt(settings)) return errorMessage(client, blockedAt(settings));
      if (client.match) return errorMessage(client, '対戦中は新しい対戦を開始できません。');
      if (msg.type === 'cpu') {
        const level = Number(msg.level);
        if (![1, 2, 3].includes(level)) return errorMessage(client, '難易度を選択してください。');
        startMatch(client, { id: `cpu:${level}`, name: `CPU Lv.${level}`, cpu: true }, 'cpu', level);
      } else if (msg.type === 'queue') {
        clearWaiting(client);
        let opponent;
        while (queue.length && !opponent) { const candidate = clients.get(queue.shift()); if (candidate && !candidate.match && candidate.id !== client.id) opponent = candidate; }
        if (opponent) startMatch(opponent, client, 'online');
        else { queue.push(client.id); client.waiting = true; send(client, { type: 'waiting', active: true, kind: 'queue' }); broadcastPresence(); }
      } else if (msg.type === 'createRoom') {
        clearWaiting(client);
        let code; do { code = randomBytes(4).toString('hex').slice(0, 6).toUpperCase(); } while (rooms.has(code));
        rooms.set(code, client.id); client.room = code; client.waiting = true;
        send(client, { type: 'waiting', active: true, kind: 'room', code }); broadcastPresence();
      } else if (msg.type === 'joinRoom') {
        const code = String(msg.code || '').toUpperCase();
        const other = clients.get(rooms.get(code));
        if (!other || other.id === client.id || other.match) return errorMessage(client, 'ルームが見つかりません。相手の6文字のコードを確認してください。');
        startMatch(other, client, 'online');
      } else errorMessage(client, '対応していない操作です。');
    });
    ws.on('close', () => {
      if (clients.get(client.id) !== client) return;
      const match = matches.get(client.match);
      if (match) endMatch(match, 1 - client.side, 'disconnect');
      clearWaiting(client); clients.delete(client.id); broadcastPresence();
      log('player_disconnected', { online: clients.size });
    });
  });
});

let previous = performance.now(), accumulator = 0;
const timer = setInterval(() => {
  const now = performance.now(); accumulator += Math.min((now - previous) / 1000, 0.1); previous = now;
  while (accumulator >= 1 / 60) {
    for (const match of [...matches.values()]) {
      match.players.forEach((p, side) => {
        if (p.cpu) { const cpu = cpuInput(match, now / 1000); movePaddle(match.state.paddles[side], cpu.input, side, 1 / 60, cpu.speed); }
        else {
          const input = Date.now() - (p.inputAt || 0) < 600 ? { ...p.input, dash: p.pendingDash } : {};
          movePaddle(match.state.paddles[side], input, side, 1 / 60);
          p.pendingDash = null;
        }
      });
      const scorer = stepBall(match.state, 1 / 60);
      if (scorer !== null && match.state.score[scorer] >= FIELD.target) endMatch(match, scorer, 'score');
      else if (Date.now() - match.started > 15 * 60000) endMatch(match, 'cancelled', 'timeout');
    }
    accumulator -= 1 / 60;
  }
  for (const match of matches.values()) {
    if (now - match.lastSnapshot < 1000 / 30) continue;
    match.lastSnapshot = now;
    match.players.forEach((p, side) => { if (!p.cpu) send(p, { type: 'state', state: viewState(match.state, side), at: Date.now() }); });
  }
}, 1000 / 120);
const restrictions = setInterval(applyRestrictions, 1000);
const usage = setInterval(() => log('usage', { ...publicStatus(), message: undefined, memoryMb: Math.round(process.memoryUsage().rss / 1024 / 1024) }), 60000);
const heartbeat = setInterval(() => {
  for (const c of clients.values()) {
    if (!c.alive || !store.session(c.token)) { c.ws.terminate(); continue; }
    c.alive = false; c.ws.ping();
  }
  for (const [key, value] of rates) if (value.until < Date.now()) rates.delete(key);
}, 15000);
lastBlocked = Boolean(blockedAt(settings));
server.listen(Number(process.env.PORT || 3000), process.env.HOST || '127.0.0.1', () => { console.log(`DICT_PONG ready: http://${process.env.HOST || '127.0.0.1'}:${server.address().port}`); log('server_started'); });
function shutdown() {
  if (shuttingDown) return; shuttingDown = true;
  clearInterval(timer); clearInterval(restrictions); clearInterval(heartbeat); clearInterval(usage);
  log('server_stopping');
  for (const match of [...matches.values()]) endMatch(match, 'cancelled', 'restart');
  for (const c of clients.values()) c.ws.close(1001, 'server restart');
  wss.close(); server.close(() => { store.close(); process.exit(0); });
  setTimeout(() => process.exit(0), 4000).unref();
}
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
