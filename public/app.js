import { FIELD } from './field.js';

const $ = id => document.getElementById(id);
const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let player = null, ws = null, view = 'play', mode = 'online', level = 2, match = null, state = null, displayState = null;
let waiting = false, blocked = false, reconnectTimer, reconnectAttempts = 0, loggingOut = false;
let statsFilter = 'all', latestStats = null, toastTimer, soundEnabled = false, audio;
let adminTimer, adminLoaded = false, settingsDirty = false;
const keys = new Set();
let pointer = null, dragging = false, lastScore = '0,0', lastRally = 0;
const canvas = $('court'), ctx = canvas.getContext('2d');
const emptyState = () => ({ paddles: [{ x: 90, y: 320 }, { x: 1110, y: 320 }], ball: { x: 600, y: 320 }, score: [0, 0], countdown: 0, rally: 0 });
displayState = emptyState();

function toast(message, error = false) {
  clearTimeout(toastTimer); $('toast').textContent = message; $('toast').classList.toggle('error', error); $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, error ? 6500 : 3500);
}
async function api(path, body) {
  const response = await fetch(path, { credentials: 'same-origin', ...(body !== undefined ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  let result; try { result = await response.json(); } catch { throw new Error('サーバーに接続できません。しばらくしてから再度お試しください。'); }
  if (!response.ok) throw new Error(result.error || '通信エラーが発生しました。');
  return result;
}
function command(value) {
  if (ws?.readyState !== WebSocket.OPEN) { toast('サーバーに接続してから操作してください。', true); return false; }
  ws.send(JSON.stringify(value)); return true;
}
function updateControls() {
  const connected = ws?.readyState === WebSocket.OPEN;
  for (const button of document.querySelectorAll('.play-action')) button.disabled = !player || !connected || Boolean(match) || waiting || blocked;
  $('onlineTab').disabled = Boolean(match) || waiting;
  $('cpuTab').disabled = Boolean(match) || waiting;
  $('leaveButton').hidden = !match;
  $('waitingBox').hidden = !waiting;
  $('logoutButton').disabled = loggingOut;
  $('queueButton').textContent = match ? '対戦中です' : blocked ? 'ただいまプレイ休止中' : !player ? '名前を登録して対戦する' : '対戦相手を探す →';
  $('cpuButton').textContent = match ? '対戦中です' : blocked ? 'ただいまプレイ休止中' : !player ? '名前を登録して対戦する' : 'CPUと対戦する →';
}
function setPlayer(value) {
  player = value;
  $('loginForm').hidden = Boolean(player); $('playerProfile').hidden = !player;
  $('topName').textContent = player?.name || 'ゲスト';
  $('topAvatar').textContent = Array.from(player?.name || 'G')[0].toUpperCase();
  if (player) {
    $('playerName').textContent = player.name; $('playerAvatar').textContent = Array.from(player.name)[0].toUpperCase();
    $('selfName').textContent = player.name;
  }
  $('adminNav').hidden = player?.name !== 'chun';
  if (player?.name !== 'chun' && view === 'admin') switchView('play');
  updateControls();
}
function presence(value) {
  blocked = Boolean(value.blocked);
  $('onlineCount').textContent = value.online ?? 0;
  $('maintenance').hidden = !blocked; $('maintenanceMessage').textContent = value.message || '';
  updateControls();
}
function overlay(kicker, title, description) {
  $('courtOverlay').hidden = false; $('overlayKicker').textContent = kicker; $('overlayTitle').textContent = title; $('overlayDescription').textContent = description;
}
function connectedUI(online) {
  $('connectionDot').classList.toggle('live', online);
  $('connectionLabel').textContent = online ? 'サーバー接続中' : player ? '再接続を待っています' : '名前を登録して参加';
  updateControls();
}
function connect() {
  clearTimeout(reconnectTimer);
  if (!player || loggingOut || ws?.readyState === WebSocket.OPEN || ws?.readyState === WebSocket.CONNECTING) return;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); ws = socket;
  socket.addEventListener('open', () => { if (ws !== socket) return; reconnectAttempts = 0; connectedUI(true); });
  socket.addEventListener('message', event => {
    let msg; try { msg = JSON.parse(event.data); } catch { return; }
    if (msg.type === 'hello') { presence(msg); if (!match) overlay('YOUR COURT IS READY', 'さあ、対戦を選ぼう。', 'オンラインの相手と、またはCPUと。次のラリーをはじめよう。'); }
    if (msg.type === 'presence') presence(msg);
    if (msg.type === 'error') toast(msg.message, true);
    if (msg.type === 'waiting') {
      waiting = msg.active;
      if (waiting) {
        $('waitingTitle').textContent = msg.kind === 'room' ? '友だちの参加を待っています' : '対戦相手を探しています';
        $('waitingText').textContent = msg.kind === 'room' ? 'このコードを友だちに伝えてください。' : '相手が見つかると自動でスタートします。';
        $('roomCodeButton').hidden = !msg.code; $('roomCodeButton').textContent = msg.code || '';
        overlay(msg.kind === 'room' ? 'PRIVATE COURT' : 'LOOKING FOR A PLAYER', '次のラリーを、待とう。', msg.code ? `ルームコード：${msg.code}` : 'オンラインの対戦相手を探しています。');
      } else if (!match) overlay('YOUR COURT IS READY', 'さあ、対戦を選ぼう。', '対戦モードを選ぶと、ここにコートが開きます。');
      updateControls();
    }
    if (msg.type === 'match') {
      match = msg; waiting = false; state = msg.state; displayState = structuredClone(state); pointer = null; keys.clear(); lastScore = '0,0'; lastRally = 0;
      switchView('play'); $('selfName').textContent = msg.you; $('opponentName').textContent = msg.opponent;
      $('arenaMode').textContent = msg.mode === 'cpu' ? `CPU MATCH / LEVEL ${msg.level}` : 'ONLINE MATCH / 1 VS 1';
      $('courtOverlay').hidden = true; updateScore(); updateControls(); canvas.focus({ preventScroll: true });
      $('arenaCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
    if (msg.type === 'state' && match) {
      state = msg.state;
      if (String(state.score) !== lastScore) { beep(600, 0.15); lastScore = String(state.score); displayState = structuredClone(state); }
      else if (state.rally > lastRally) beep(280 + Math.min(state.rally, 10) * 20, 0.035);
      lastRally = state.rally; updateScore();
    }
    if (msg.type === 'result') {
      match = null; waiting = false; keys.clear(); pointer = null; state = null; $('countdown').hidden = true;
      $('selfScore').textContent = msg.score[0]; $('opponentScore').textContent = msg.score[1];
      const reasons = { score: '次のラリーも、楽しもう。', forfeit: '途中終了により勝敗が記録されました。', disconnect: '接続の切断により勝敗が記録されました。', maintenance: '管理者の停止設定により中断しました。勝敗には含まれません。', restart: 'サーバーの終了により中断しました。勝敗には含まれません。', timeout: '15分を経過したため中断しました。勝敗には含まれません。' };
      overlay(msg.outcome === 'win' ? 'YOU WIN — NICE RALLY!' : msg.outcome === 'loss' ? 'GOOD GAME — NEXT RALLY?' : 'MATCH INTERRUPTED', msg.outcome === 'win' ? 'この一勝を、次へ。' : msg.outcome === 'loss' ? 'もう一度、挑んでみよう。' : '対戦を中断しました。', reasons[msg.reason] || '対戦が終了しました。');
      $('arenaMode').textContent = 'MATCH COMPLETE'; updateControls(); loadStats().catch(e => toast(e.message, true));
      if ($('confirmDialog').open) $('confirmDialog').close();
    }
  });
  socket.addEventListener('close', () => {
    if (ws !== socket) return;
    ws = null; connectedUI(false); waiting = false;
    if (match) { match = null; state = null; keys.clear(); pointer = null; $('countdown').hidden = true; overlay('CONNECTION LOST', '接続が切れました。', '切断は負けとして記録されます。接続後に戦績を確認できます。'); }
    updateControls();
    if (!loggingOut && player && reconnectAttempts < 5) {
      reconnectAttempts++; reconnectTimer = setTimeout(connect, Math.min(1000 * reconnectAttempts, 5000));
    } else if (!loggingOut && player) {
      $('connectionLabel').textContent = '再接続する ↻';
      toast('接続できませんでした。同じ名前で開いている別画面を閉じて、上部の再接続ボタンを押してください。', true);
    }
  });
  socket.addEventListener('error', () => {});
}

$('loginForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = $('loginForm').querySelector('button'); button.disabled = true;
  try { const result = await api('/api/login', { name: $('nameInput').value }); setPlayer(result.player); loggingOut = false; connect(); await loadStats(); toast(`${result.player.name}さん、コートへようこそ。`); }
  catch (error) { toast(error.message, true); } finally { button.disabled = false; }
});
async function logout() {
  if (match) { $('confirmDialog').showModal(); return; }
  loggingOut = true; updateControls(); clearTimeout(reconnectTimer);
  try {
    await api('/api/logout', {}); ws?.close(1000); ws = null; setPlayer(null); waiting = false; latestStats = null; adminLoaded = false;
    connectedUI(false); switchView('play'); renderStats(null); overlay('YOUR COURT IS READY', 'はじめよう、ラリー。', 'プレイヤー名を登録して、対戦モードを選ぼう。');
    $('selfName').textContent = 'あなた'; $('opponentName').textContent = '対戦相手'; $('selfScore').textContent = '0'; $('opponentScore').textContent = '0'; displayState = emptyState();
  } catch (error) { toast(error.message, true); } finally { loggingOut = false; updateControls(); }
}
$('logoutButton').addEventListener('click', logout);
$('profileButton').addEventListener('click', () => { switchView('play'); (player ? $('playerProfile') : $('nameInput')).scrollIntoView({ behavior: 'smooth', block: 'center' }); if (!player) $('nameInput').focus(); });
$('reconnectButton').addEventListener('click', () => { if (player && !ws) { reconnectAttempts = 0; connect(); } });
function selectMode(value) {
  mode = value; const online = value === 'online';
  $('onlineTab').classList.toggle('selected', online); $('onlineTab').setAttribute('aria-selected', online);
  $('cpuTab').classList.toggle('selected', !online); $('cpuTab').setAttribute('aria-selected', !online);
  $('onlineSetup').hidden = !online; $('cpuSetup').hidden = online;
}
$('onlineTab').addEventListener('click', () => selectMode('online')); $('cpuTab').addEventListener('click', () => selectMode('cpu'));
for (const button of document.querySelectorAll('[data-level]')) {
  button.addEventListener('click', () => {
    level = Number(button.dataset.level);
    document.querySelectorAll('[data-level]').forEach(b => { b.classList.toggle('selected', b === button); b.setAttribute('aria-pressed', b === button); });
    $('difficultyNote').textContent = ['まずはゆっくり。基本の動きをつかもう。', '程よい手応え。ラリーを楽しもう。', '速い反応と鋭い返球。本気の腕試し。'][level - 1];
  });
}
$('queueButton').addEventListener('click', () => command({ type: 'queue' }));
$('createRoomButton').addEventListener('click', () => command({ type: 'createRoom' }));
$('joinRoomForm').addEventListener('submit', event => { event.preventDefault(); const code = $('roomCodeInput').value.trim().toUpperCase(); if (!/^[A-F0-9]{6}$/.test(code)) return toast('ルームコードは6文字の英数字です。', true); command({ type: 'joinRoom', code }); });
$('cpuButton').addEventListener('click', () => command({ type: 'cpu', level }));
$('cancelWaitingButton').addEventListener('click', () => command({ type: 'leave' }));
$('roomCodeButton').addEventListener('click', async () => { try { await navigator.clipboard.writeText($('roomCodeButton').textContent); toast('ルームコードをコピーしました。'); } catch { toast('表示されたルームコードを相手に伝えてください。'); } });
$('leaveButton').addEventListener('click', () => $('confirmDialog').showModal());
$('confirmLeaveButton').addEventListener('click', () => { command({ type: 'leave' }); $('confirmDialog').close(); });
for (const id of ['cancelLeaveButton', 'cancelLeaveIcon']) $(id).addEventListener('click', () => $('confirmDialog').close());
$('helpButton').addEventListener('click', () => $('helpDialog').showModal());
document.querySelectorAll('.close-dialog').forEach(button => button.addEventListener('click', () => $('helpDialog').close()));
$('soundButton').addEventListener('click', () => {
  soundEnabled = !soundEnabled; $('soundSlash').hidden = soundEnabled;
  $('soundButton').setAttribute('aria-label', soundEnabled ? 'サウンドをオフにする' : 'サウンドをオンにする'); $('soundButton').setAttribute('aria-pressed', soundEnabled);
  if (soundEnabled) { audio ||= new (window.AudioContext || window.webkitAudioContext)(); audio.resume().catch(() => {}); beep(440, 0.08); }
});
function beep(frequency, length) {
  if (!soundEnabled || !audio) return;
  const oscillator = audio.createOscillator(), gain = audio.createGain(); oscillator.type = 'sine'; oscillator.frequency.value = frequency;
  gain.gain.setValueAtTime(0.04, audio.currentTime); gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + length);
  oscillator.connect(gain); gain.connect(audio.destination); oscillator.start(); oscillator.stop(audio.currentTime + length);
}
$('fullscreenButton').addEventListener('click', async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else if ($('arenaCard').requestFullscreen) await $('arenaCard').requestFullscreen(); else toast('この端末では全画面表示を利用できません。横向きでプレイしてください。'); } catch { toast('全画面表示を開始できませんでした。', true); } });

function switchView(value) {
  if (match && value !== 'play') { toast('対戦が終わってから確認できます。'); return; }
  if (value === 'admin' && player?.name !== 'chun') return;
  view = value; for (const key of ['play', 'stats', 'admin']) $(`view${key[0].toUpperCase() + key.slice(1)}`).hidden = value !== key;
  document.querySelectorAll('.nav-item[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === value));
  $('pageLabel').textContent = { play: 'PLAY ARENA', stats: 'MY STATS', admin: 'CONTROL ROOM' }[value];
  clearInterval(adminTimer);
  if (value === 'stats') loadStats().catch(e => toast(e.message, true));
  if (value === 'admin') {
    loadAdmin(!adminLoaded).catch(e => toast(e.message, true));
    adminTimer = setInterval(() => loadAdmin(false).catch(() => {}), 5000);
  }
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
$('homeLink').addEventListener('click', event => { event.preventDefault(); switchView('play'); window.scrollTo({ top: 0, behavior: 'smooth' }); });
function formatTime(seconds) {
  if (seconds < 60) return { value: seconds, unit: '秒' };
  if (seconds < 3600) return { value: Math.floor(seconds / 60), unit: '分' };
  return { value: (seconds / 3600).toFixed(1), unit: '時間' };
}
function statCards(data) {
  const time = formatTime(data?.playSeconds || 0);
  const cards = [
    { label: '勝率', symbol: '↗', value: data ? (data.winRate * 100).toFixed(1) : '—', unit: '%', caption: data ? `${(data.winRate * 10).toFixed(1)}割 / ${data.wins}勝 ${data.losses}敗` : '最初の一勝を目指そう' },
    { label: '対戦数', symbol: '▣', value: data ? data.games : '—', unit: '試合', caption: data ? `中断 ${data.cancelled}試合（勝敗対象外）` : 'まだ対戦記録はありません' },
    { label: 'プレイ時間', symbol: '◷', value: data ? time.value : '—', unit: time.unit, caption: 'コートで過ごした時間' },
    { label: '総得点', symbol: '◎', value: data ? data.score : '—', unit: '点', caption: data ? `総失点 ${data.conceded}点` : '積み重ねた一打の記録' },
  ];
  return cards.map(c => `<div class="stat-card"><div class="stat-card-top"><span>${c.label}</span><span class="stat-symbol">${c.symbol}</span></div><div class="stat-value">${c.value}<small>${c.unit}</small></div><div class="stat-caption">${c.caption}</div></div>`).join('');
}
const empty = (title, description) => `<div class="empty-state"><div class="empty-mark">◌</div><strong>${escapeHTML(title)}</strong>${escapeHTML(description)}</div>`;
function dateLabel(value) { return new Intl.DateTimeFormat('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)); }
function historyTable(rows) {
  if (!rows?.length) return empty('まだ、ラリーの足あとはありません。', player ? '対戦すると、ここに記録が増えていきます。' : '名前を登録して、最初の試合をはじめよう。');
  const reasons = { score: '5点先取', forfeit: '途中終了', disconnect: '切断', maintenance: '管理者停止', restart: 'サーバー終了', timeout: '時間切れ' };
  return `<div class="table-scroll"><table><thead><tr><th>結果</th><th>対戦相手</th><th>スコア</th><th class="hide-mobile">モード / 時間</th><th>日時</th></tr></thead><tbody>${rows.map(r => `<tr><td><span class="badge ${r.outcome}">${{ win: 'WIN', loss: 'LOSE', cancelled: '中断' }[r.outcome]}</span></td><td class="name-cell">${escapeHTML(r.opponent_name)}<div class="mode-label">${reasons[r.reason] || ''}</div></td><td class="score-cell nowrap">${r.score} : ${r.against}</td><td class="hide-mobile"><span class="mode-label">${r.mode === 'cpu' ? `CPU LV.${r.level}` : 'ONLINE'}</span><div>${Math.floor(r.duration / 60)}分${r.duration % 60}秒</div></td><td class="nowrap"><span class="mode-label">${dateLabel(r.ended_at)}</span></td></tr>`).join('')}</tbody></table></div>`;
}
function opponentTable(rows) {
  if (!rows?.length) return empty('対戦相手ごとの記録', '対戦すると、相手別の勝率や得点を確認できます。');
  return `<div class="table-scroll"><table><thead><tr><th>対戦相手</th><th>勝敗</th><th>勝率</th><th>総得点</th><th class="hide-mobile">プレイ時間</th></tr></thead><tbody>${rows.map(r => `<tr><td class="name-cell">${escapeHTML(r.name)}</td><td class="nowrap">${r.wins}勝 ${r.losses}敗</td><td class="bar-cell"><div class="win-bar"><meter min="0" max="100" value="${(r.winRate * 100).toFixed(1)}" aria-label="勝率"></meter><small>${(r.winRate * 100).toFixed(1)}% / ${(r.winRate * 10).toFixed(1)}割</small></div></td><td>${r.score}点</td><td class="hide-mobile">${formatTime(r.playSeconds).value}${formatTime(r.playSeconds).unit}</td></tr>`).join('')}</tbody></table></div>`;
}
function renderStats(data) {
  $('summaryStats').innerHTML = statCards(data); $('recentMatches').innerHTML = historyTable(data?.recent?.slice(0, 4));
  $('detailStats').innerHTML = statCards(data); $('detailMatches').innerHTML = historyTable(data?.recent); $('opponentStats').innerHTML = opponentTable(data?.opponents);
}
async function loadStats() {
  if (!player) { renderStats(null); return; }
  const all = await api('/api/stats'); latestStats = all;
  $('summaryStats').innerHTML = statCards(all); $('recentMatches').innerHTML = historyTable(all.recent.slice(0, 4));
  const data = statsFilter === 'all' ? all : await api(`/api/stats?mode=${statsFilter}`);
  $('detailStats').innerHTML = statCards(data); $('detailMatches').innerHTML = historyTable(data.recent); $('opponentStats').innerHTML = opponentTable(data.opponents);
}
$('refreshStatsButton').addEventListener('click', () => loadStats().then(() => toast('戦績を更新しました。')).catch(e => toast(e.message, true)));
document.querySelectorAll('[data-filter]').forEach(button => button.addEventListener('click', () => {
  statsFilter = button.dataset.filter; document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b === button));
  loadStats().catch(e => toast(e.message, true));
}));

function localDateTime(value) {
  const d = new Date(value), pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function scheduleRow(w) {
  const row = document.createElement('div'); row.className = 'schedule-row'; row.dataset.id = w.id;
  row.innerHTML = `<label>開始（端末の現地時間）<input type="datetime-local" class="schedule-start" value="${localDateTime(w.start)}" required></label><label>終了（端末の現地時間）<input type="datetime-local" class="schedule-end" value="${localDateTime(w.end)}" required></label><button type="button" class="text-button">この予定を削除 ×</button>`;
  row.querySelector('button').addEventListener('click', () => { row.remove(); settingsDirty = true; }); $('scheduleList').append(row);
}
async function loadAdmin(includeSettings) {
  if (player?.name !== 'chun') return;
  const data = await api('/api/admin'); adminLoaded = true;
  $('adminRunningState').textContent = data.status.blocked ? '停止中' : '稼働中'; $('adminRunningState').classList.toggle('stopped', data.status.blocked);
  $('connectedCount').textContent = `${data.connected.length} 人`;
  $('connectedPlayers').innerHTML = data.connected.length ? data.connected.map(p => `<div class="presence-player"><span class="avatar">${escapeHTML(Array.from(p.name)[0].toUpperCase())}</span><div><strong>${escapeHTML(p.name)}</strong><small>${p.opponent ? `vs ${escapeHTML(p.opponent)} / ${p.mode === 'cpu' ? 'CPU' : 'オンライン'}` : '次の対戦を待っています'}</small></div><span class="tag">${{ playing: '対戦中', waiting: '相手待ち', lobby: 'ロビー' }[p.status]}</span></div>`).join('') : empty('接続中のプレイヤーはいません', '接続するとここに表示されます。');
  $('adminPlayers').innerHTML = data.players.length ? `<div class="table-scroll"><table><thead><tr><th>プレイヤー名</th><th>対戦数</th><th>勝率</th><th>総得点</th><th>プレイ時間</th><th>詳細</th></tr></thead><tbody>${data.players.map(p => `<tr><td class="name-cell">${escapeHTML(p.name)}</td><td>${p.games}試合</td><td>${p.games ? (p.wins / p.games * 100).toFixed(1) : '0.0'}%</td><td>${p.score}点</td><td>${formatTime(p.playSeconds).value}${formatTime(p.playSeconds).unit}</td><td><button class="player-link" data-player-id="${escapeHTML(p.id)}">戦績を見る ↗</button></td></tr>`).join('')}</tbody></table></div>` : empty('まだ登録がありません', '名前を登録したプレイヤーが表示されます。');
  if (includeSettings && !settingsDirty) {
    const s = data.settings; $('pausedInput').checked = s.paused; $('messageInput').value = s.message;
    $('dailyEnabledInput').checked = Boolean(s.daily?.enabled); $('dailyStartInput').value = s.daily?.start || '23:00'; $('dailyEndInput').value = s.daily?.end || '07:00';
    $('scheduleList').replaceChildren(); s.windows.forEach(scheduleRow);
  }
}
$('settingsForm').addEventListener('input', () => { settingsDirty = true; });
$('addScheduleButton').addEventListener('click', () => {
  if ($('scheduleList').children.length >= 20) return toast('停止予定は20件まで登録できます。', true);
  const start = Date.now() + 3600000; scheduleRow({ id: crypto.randomUUID(), start, end: start + 3600000 }); settingsDirty = true;
});
$('settingsForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('settingsForm').querySelector('[type="submit"]'); button.disabled = true;
  try {
    const windows = [...$('scheduleList').children].map(row => ({ id: row.dataset.id, start: new Date(row.querySelector('.schedule-start').value).toISOString(), end: new Date(row.querySelector('.schedule-end').value).toISOString() }));
    await api('/api/admin/settings', { paused: $('pausedInput').checked, message: $('messageInput').value, windows, daily: { enabled: $('dailyEnabledInput').checked, start: $('dailyStartInput').value, end: $('dailyEndInput').value } });
    settingsDirty = false; await loadAdmin(true); toast('稼働設定を保存しました。');
  } catch (error) { toast(error.message, true); } finally { button.disabled = false; }
});
$('refreshAdminButton').addEventListener('click', () => loadAdmin(!settingsDirty).then(() => toast(settingsDirty ? '接続状況を更新しました。編集中の設定は保持しています。' : '管理画面を更新しました。')).catch(e => toast(e.message, true)));
$('adminPlayers').addEventListener('click', async event => {
  const button = event.target.closest('[data-player-id]'); if (!button) return;
  try {
    const data = await api(`/api/admin/stats?id=${encodeURIComponent(button.dataset.playerId)}`);
    $('adminDetailTitle').textContent = `${data.player.name} の戦績`;
    $('adminDetailStats').innerHTML = statCards(data); $('adminDetailOpponents').innerHTML = opponentTable(data.opponents); $('adminDetailMatches').innerHTML = historyTable(data.recent);
    $('adminPlayerDetail').hidden = false; $('adminPlayerDetail').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) { toast(error.message, true); }
});
$('closeAdminDetail').addEventListener('click', () => { $('adminPlayerDetail').hidden = true; });

function updateScore() {
  if (!state) return;
  $('selfScore').textContent = state.score[0]; $('opponentScore').textContent = state.score[1];
  $('countdown').hidden = state.countdown <= 0 || !match;
  $('countdown').textContent = Math.ceil(state.countdown);
}
function inputVector() {
  const dx = Number(keys.has('arrowright') || keys.has('d')) - Number(keys.has('arrowleft') || keys.has('a'));
  const dy = Number(keys.has('arrowdown') || keys.has('s')) - Number(keys.has('arrowup') || keys.has('w'));
  return { dx, dy };
}
const controlKeys = ['arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'w', 'a', 's', 'd'];
window.addEventListener('keydown', event => {
  if (!match || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target.tagName) || document.querySelector('dialog[open]')) return;
  const key = event.key.toLowerCase(); if (!controlKeys.includes(key)) return;
  event.preventDefault(); pointer = null; keys.add(key);
});
window.addEventListener('keyup', event => { keys.delete(event.key.toLowerCase()); });
function resetInput() { keys.clear(); pointer = null; dragging = false; if (match) command({ type: 'input', dx: 0, dy: 0 }); }
window.addEventListener('blur', resetInput); document.addEventListener('visibilitychange', () => { if (document.hidden) resetInput(); });
function pointerPosition(event) {
  const rect = canvas.getBoundingClientRect();
  // Canvas object-fit preserves 1200:640 even in fullscreen.
  const scale = Math.min(rect.width / 1200, rect.height / 640), width = 1200 * scale, height = 640 * scale;
  return { x: Math.max(35, Math.min(545, (event.clientX - rect.left - (rect.width - width) / 2) / scale)), y: Math.max(64, Math.min(576, (event.clientY - rect.top - (rect.height - height) / 2) / scale)) };
}
canvas.addEventListener('pointerdown', event => { if (!match) return; event.preventDefault(); dragging = true; keys.clear(); pointer = pointerPosition(event); canvas.setPointerCapture(event.pointerId); canvas.focus({ preventScroll: true }); });
canvas.addEventListener('pointermove', event => { if (match && dragging) pointer = pointerPosition(event); });
canvas.addEventListener('pointerup', () => { dragging = false; pointer = null; }); canvas.addEventListener('pointercancel', resetInput);
setInterval(() => { if (match && ws?.readyState === WebSocket.OPEN) command({ type: 'input', ...(pointer || inputVector()) }); }, 1000 / 30);

let lastFrame = performance.now();
function draw(now) {
  const dt = Math.min((now - lastFrame) / 1000, 0.05); lastFrame = now;
  if (state) {
    const blend = 1 - Math.exp(-32 * dt);
    displayState.paddles.forEach((p, i) => { p.x += (state.paddles[i].x - p.x) * blend; p.y += (state.paddles[i].y - p.y) * blend; });
    displayState.ball.x += (state.ball.x - displayState.ball.x) * blend; displayState.ball.y += (state.ball.y - displayState.ball.y) * blend;
  }
  const { paddles, ball } = displayState;
  ctx.clearRect(0, 0, 1200, 640);
  ctx.fillStyle = '#142d34'; ctx.fillRect(0, 0, 1200, 640);
  const gradient = ctx.createRadialGradient(600, 320, 20, 600, 320, 650); gradient.addColorStop(0, '#1b3941'); gradient.addColorStop(1, '#11272e'); ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1200, 640);
  ctx.strokeStyle = '#7193940a'; ctx.lineWidth = 1;
  for (let x = 24; x < 1200; x += 36) for (let y = 24; y < 640; y += 36) { ctx.beginPath(); ctx.moveTo(x - 2, y); ctx.lineTo(x + 2, y); ctx.moveTo(x, y - 2); ctx.lineTo(x, y + 2); ctx.stroke(); }
  ctx.strokeStyle = '#668d8a50'; ctx.lineWidth = 2; ctx.setLineDash([9, 12]); ctx.beginPath(); ctx.moveTo(600, 0); ctx.lineTo(600, 640); ctx.stroke(); ctx.setLineDash([]);
  ctx.beginPath(); ctx.arc(600, 320, 92, 0, Math.PI * 2); ctx.strokeStyle = '#64858145'; ctx.stroke();
  ctx.beginPath(); ctx.arc(600, 320, 5, 0, Math.PI * 2); ctx.fillStyle = '#71948a70'; ctx.fill();
  ctx.strokeStyle = '#6d9c9b40'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(24, FIELD.goalTop); ctx.lineTo(24, 24); ctx.lineTo(1176, 24); ctx.lineTo(1176, FIELD.goalTop);
  ctx.moveTo(24, FIELD.goalBottom); ctx.lineTo(24, 616); ctx.lineTo(1176, 616); ctx.lineTo(1176, FIELD.goalBottom); ctx.stroke();
  ctx.beginPath(); ctx.arc(24, 320, 145, -Math.PI / 2, Math.PI / 2); ctx.stroke(); ctx.beginPath(); ctx.arc(1176, 320, 145, Math.PI / 2, Math.PI * 1.5); ctx.stroke();
  const goalHeight = FIELD.goalBottom - FIELD.goalTop;
  ctx.fillStyle = '#668b8e';
  for (const x of [0, FIELD.width - 4]) {
    ctx.fillRect(x, 0, 4, FIELD.goalTop);
    ctx.fillRect(x, FIELD.goalBottom, 4, FIELD.height - FIELD.goalBottom);
  }
  ctx.fillStyle = '#cadb9d'; ctx.fillRect(0, FIELD.goalTop, 4, goalHeight);
  ctx.fillStyle = '#ff8055'; ctx.fillRect(FIELD.width - 4, FIELD.goalTop, 4, goalHeight);
  ctx.fillStyle = '#f1f1de';
  for (const x of [0, FIELD.width]) for (const y of [FIELD.goalTop, FIELD.goalBottom]) {
    ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fill();
  }
  paddles.forEach((p, i) => {
    const color = i ? '#ff8055' : '#cadb9d'; ctx.shadowColor = color; ctx.shadowBlur = match ? 23 : 12; ctx.fillStyle = color;
    ctx.beginPath(); ctx.roundRect(p.x - 9, p.y - 54, 18, 108, 7); ctx.fill(); ctx.shadowBlur = 0;
    ctx.fillStyle = i ? '#ffb28f' : '#f1f4c9'; ctx.fillRect(p.x - 3, p.y - 33, 2, 66);
  });
  if (match && state?.countdown <= 0) {
    const vx = state.ball.vx || 0, vy = state.ball.vy || 0;
    const trail = ctx.createLinearGradient(ball.x - vx * 0.06, ball.y - vy * 0.06, ball.x, ball.y); trail.addColorStop(0, '#f1eee200'); trail.addColorStop(1, '#f1eee27a');
    ctx.strokeStyle = trail; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(ball.x - vx * 0.06, ball.y - vy * 0.06); ctx.lineTo(ball.x, ball.y); ctx.stroke();
  }
  ctx.shadowColor = '#f0f5d2'; ctx.shadowBlur = 22; ctx.fillStyle = '#f1f1de'; ctx.beginPath(); ctx.arc(ball.x, ball.y, 12, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = '9px Segoe UI, sans-serif'; ctx.letterSpacing = '3px'; ctx.fillStyle = '#8aa29a55'; ctx.textAlign = 'center'; ctx.fillText('D I C T _ P O N G   /   A I R   H O C K E Y', 600, 608);
  requestAnimationFrame(draw);
}
renderStats(null); updateControls(); requestAnimationFrame(draw);
async function initialize() {
  try { const me = await api('/api/me'); presence(me); setPlayer(me.player); if (player) { connect(); await loadStats(); } else connectedUI(false); }
  catch (error) { $('connectionLabel').textContent = 'サーバー未接続'; toast(error.message, true); }
}
initialize();
