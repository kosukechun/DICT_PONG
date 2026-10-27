import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'pong.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, player_id TEXT NOT NULL REFERENCES players(id), expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS matches(id TEXT PRIMARY KEY, mode TEXT NOT NULL, level INTEGER, started_at TEXT NOT NULL, ended_at TEXT NOT NULL, duration INTEGER NOT NULL, status TEXT NOT NULL, reason TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS results(match_id TEXT NOT NULL REFERENCES matches(id), player_id TEXT NOT NULL REFERENCES players(id), opponent_id TEXT, opponent_name TEXT NOT NULL, score INTEGER NOT NULL, against INTEGER NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY(match_id,player_id));
      CREATE INDEX IF NOT EXISTS results_player ON results(player_id);
      CREATE INDEX IF NOT EXISTS sessions_expires ON sessions(expires);
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL);
      INSERT OR IGNORE INTO settings VALUES(1,'{"paused":false,"message":"メンテナンス中です。しばらくお待ちください。","windows":[]}');`);
    this.db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
  }
  player(id) { return this.db.prepare('SELECT id,name,created_at FROM players WHERE id=?').get(id); }
  findPlayer(name) { return this.db.prepare('SELECT id,name,created_at FROM players WHERE name_key=?').get(name); }
  register(name) {
    let player = this.findPlayer(name);
    if (!player) {
      const id = randomUUID();
      this.db.prepare('INSERT INTO players VALUES(?,?,?,?)').run(id, name, name, new Date().toISOString());
      player = this.player(id);
    }
    const token = randomBytes(32).toString('hex');
    this.db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, player.id, Date.now() + 30 * 86400000);
    return { player, token };
  }
  session(token) {
    if (!token || token.length !== 64) return null;
    return this.db.prepare('SELECT p.id,p.name,p.created_at FROM sessions s JOIN players p ON p.id=s.player_id WHERE s.token=? AND s.expires>?').get(token, Date.now());
  }
  logout(token) { this.db.prepare('DELETE FROM sessions WHERE token=?').run(token); }
  settings(value) {
    if (value) this.db.prepare('UPDATE settings SET value=? WHERE id=1').run(JSON.stringify(value));
    return JSON.parse(this.db.prepare('SELECT value FROM settings WHERE id=1').get().value);
  }
  record(match, outcome, reason) {
    const ended = Date.now(), duration = Math.max(0, Math.floor((ended - match.started) / 1000));
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO matches VALUES(?,?,?,?,?,?,?,?)').run(match.id, match.mode, match.level || null, new Date(match.started).toISOString(), new Date(ended).toISOString(), duration, outcome === 'cancelled' ? 'cancelled' : 'finished', reason);
      match.players.forEach((p, side) => {
        if (p.cpu) return;
        const opponent = match.players[1 - side];
        const result = outcome === 'cancelled' ? 'cancelled' : outcome === side ? 'win' : 'loss';
        this.db.prepare('INSERT INTO results VALUES(?,?,?,?,?,?,?)').run(match.id, p.id, opponent.cpu ? null : opponent.id, opponent.name, match.state.score[side], match.state.score[1 - side], result);
      });
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  stats(playerId, mode = 'all') {
    const filter = mode === 'online' || mode === 'cpu' ? mode : 'all';
    const rows = this.db.prepare(`SELECT r.*,m.mode,m.level,m.started_at,m.ended_at,m.duration,m.reason FROM results r JOIN matches m ON m.id=r.match_id WHERE r.player_id=? AND (?='all' OR m.mode=?) ORDER BY m.ended_at DESC`).all(playerId, filter, filter);
    const aggregate = values => {
      const finished = values.filter(r => r.outcome !== 'cancelled');
      const wins = finished.filter(r => r.outcome === 'win').length;
      return { games: finished.length, wins, losses: finished.length - wins, winRate: finished.length ? wins / finished.length : 0, score: finished.reduce((n, r) => n + r.score, 0), conceded: finished.reduce((n, r) => n + r.against, 0), playSeconds: values.reduce((n, r) => n + r.duration, 0), cancelled: values.length - finished.length };
    };
    const groups = new Map();
    for (const row of rows) {
      const key = row.opponent_id || `cpu:${row.level}`;
      if (!groups.has(key)) groups.set(key, { id: key, name: row.opponent_name, rows: [] });
      groups.get(key).rows.push(row);
    }
    return { player: this.player(playerId), ...aggregate(rows), opponents: [...groups.values()].map(g => ({ id: g.id, name: g.name, ...aggregate(g.rows) })), recent: rows.slice(0, 30) };
  }
  players() {
    return this.db.prepare(`SELECT p.id,p.name,p.created_at,COUNT(CASE WHEN r.outcome!='cancelled' THEN 1 END) AS games,
      SUM(CASE WHEN r.outcome='win' THEN 1 ELSE 0 END) AS wins,
      COALESCE(SUM(CASE WHEN r.outcome!='cancelled' THEN r.score ELSE 0 END),0) AS score,
      COALESCE(SUM(m.duration),0) AS playSeconds
      FROM players p LEFT JOIN results r ON r.player_id=p.id LEFT JOIN matches m ON m.id=r.match_id
      GROUP BY p.id ORDER BY p.created_at DESC LIMIT 1000`).all();
  }
  close() { this.db.close(); }
}
