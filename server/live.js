// Live play over WebSockets: who's connected, rooms (count battles and shared tables),
// invite codes, the public lobby and room chat. Everything here lives in memory; only
// signed-in players' results and site-wide counts are written to the database (records.js).
'use strict';
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const WS = require('./ws');
const U = require('./util');
const log = require('./log');
const metrics = require('./metrics');
const auth = require('./auth');
const { db } = require('./db');
const chat = require('./chat');
const records = require('./records');

/** @typedef {Omit<import('./types').Conn, 'room'> & { room: Room | null }} Conn a connection, in the room it's in */
/** @typedef {import('./types').Member} Member */
/** @typedef {import('./types').Game} Game */
/** @typedef {import('./types').GameLibs} GameLibs */
/** @typedef {new (room: Room, settings?: unknown) => Game} GameClass */
/** @typedef {'battle' | 'table'} Kind */
/** @typedef {{ system?: boolean, id?: string, name?: string, guest?: boolean, text: string, at: number }} ChatMsg */

// The browser's own card and strategy code, so the server grades with the same rules.
/** @type {Partial<Record<Kind, GameClass>>} */
const GAMES = {};
/** @type {GameLibs | null} */
let LIBS = null;
const ready = Promise.all(['cards.js', 'strategy.js', 'strategies.js'].map((f) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href)))
  .then(([cards, strategy, strategies]) => {
    /** @type {GameLibs} */
    const libs = { cards, strategy, strategies };
    LIBS = libs;
    GAMES.battle = require('./games/battle')(libs, records);
    GAMES.table = require('./games/table')(libs, records);
  });

/**
 * The strategy a browser says it plays: a premade one by id, or (signed-in players only)
 * their own, checked field by field. Anything else gets the default.
 * @param {Conn} c @param {unknown} x
 */
function strategyFor(c, x) {
  const L = /** @type {GameLibs} */ (LIBS);
  if (typeof x === 'string') return L.strategies.strategyById(x);
  if (c.user && x && typeof x === 'object') return L.strategies.cleanStrategy(x) || L.strategies.strategyById(undefined);
  return L.strategies.strategyById(undefined);
}
ready.catch((e) => log.error('loading the game code failed', { err: e }));

// Limits. The environment overrides exist for load tests on a separate test server.
const MAX_PER_IP = Number(process.env.LIVE_MAX_PER_IP) || 20; // phones on one carrier can share an address
const MAX_ROOMS = Number(process.env.LIVE_MAX_ROOMS) || 300;
const ROOMS_PER_MIN = Number(process.env.LIVE_ROOMS_PER_MIN) || 6; // rooms one address may open per minute
const GRACE_MS = 45000; // how long a dropped player keeps their place
const HELLO_MS = 10000;
const CHAT_KEEP = 50;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** @type {Set<Conn>} */
const conns = new Set();
/** @type {Map<string, number>} */
const perIp = new Map();
/** @type {Map<string, Room>} */
const rooms = new Map();
/** @type {Set<Conn>} */
const lobbyWatchers = new Set();
const createLimit = U.rateLimiter(ROOMS_PER_MIN, 60 * 1000);

const wsMessages = metrics.counter('live_messages_total', 'WebSocket messages received, by type.');
const wsSeconds = metrics.histogram('live_message_seconds', 'Time to handle one WebSocket message on the server, by type.',
  [0.0001, 0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.1]);
const wsRejected = metrics.counter('live_rejected_total', 'WebSocket upgrades refused, by reason.');

/** @param {string} s */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
/** @param {{ ws: { send(text: string): void } } | null} c @param {object} msg */
const send = (c, msg) => { if (c) c.ws.send(JSON.stringify(msg)); };
const findName = db.prepare('SELECT 1 FROM users WHERE display_name = ?');

function newCode() {
  for (;;) {
    let code = '';
    for (const b of crypto.randomBytes(6)) code += CODE_CHARS[b % CODE_CHARS.length];
    if (!rooms.has(code)) return code;
  }
}

// ---- rooms ------------------------------------------------------------------------
class Room {
  /** @param {Kind} kind @param {'public' | 'private'} visibility @param {unknown} settings */
  constructor(kind, visibility, settings) {
    this.code = newCode();
    this.kind = kind;
    this.visibility = visibility;
    /** @type {Map<string, Member>} */
    this.members = new Map();
    /** @type {string[]} join order, for handing over host */
    this.order = [];
    /** @type {string | null} */
    this.hostId = null;
    /** @type {Set<string>} */
    this.banned = new Set();
    /** @type {ChatMsg[]} */
    this.chat = [];
    this.createdAt = Date.now();
    this.dirty = false;
    const Game = /** @type {GameClass} */ (GAMES[kind]);
    this.game = new Game(this, settings);
    rooms.set(this.code, this);
    records.bump('rooms_opened');
    log.info('room opened', { code: this.code, kind, visibility });
    lobbyChanged();
  }

  connectedMembers() { return [...this.members.values()].filter((m) => m.connected); }
  /** @param {string} id */
  isHost(id) { return this.hostId === id; }
  get full() { return this.members.size >= this.game.capacity; }

  /** @param {Conn} c */
  join(c) {
    const id = /** @type {string} */ (c.id);
    const name = /** @type {string} */ (c.name);
    let m = this.members.get(id);
    if (m) {
      // Same player again (reconnect, or a second tab): this connection takes over.
      if (m.conn && m.conn !== c && !m.conn.ws.closed) {
        send(m.conn, { t: 'left', code: this.code, reason: 'You opened this room somewhere else.' });
        m.conn.room = null;
      }
      if (m.timer) clearTimeout(m.timer);
      const was = m.connected;
      m.conn = c;
      m.connected = true;
      m.name = name;
      c.room = this;
      if (!was) { this.game.onReconnect(m); this.system(`${m.name} is back.`); }
    } else {
      m = { id, name, guest: c.guest, userId: c.user?.id ?? null, conn: c, connected: true, timer: null, chatTimes: [] };
      this.members.set(m.id, m);
      this.order.push(m.id);
      if (!this.hostId) this.hostId = m.id;
      c.room = this;
      this.system(`${m.name} joined.`);
      this.game.onJoin(m);
    }
    send(c, { t: 'chatHistory', code: this.code, msgs: this.chat });
    this.changed();
    lobbyChanged();
  }

  /** The connection dropped: keep the place for a while. @param {Conn} c */
  dropped(c) {
    const m = this.members.get(/** @type {string} */ (c.id));
    if (!m || m.conn !== c) return;
    m.connected = false;
    m.conn = null;
    this.game.onDisconnect(m);
    m.timer = setTimeout(() => this.remove(m.id, `${m.name} left.`), GRACE_MS);
    this.changed();
    lobbyChanged();
  }

  /** @param {string} id @param {string | null} why */
  remove(id, why) {
    const m = this.members.get(id);
    if (!m) return;
    if (m.timer) clearTimeout(m.timer);
    this.members.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (m.conn && m.conn.room === this) m.conn.room = null;
    this.game.onLeave(m);
    if (!this.members.size) return this.destroy();
    if (this.hostId === id) {
      const next = this.order.find((x) => this.members.get(x)?.connected) || this.order[0];
      this.hostId = next;
      if (why) this.system(why);
      this.system(`${this.members.get(next)?.name} is the host now.`);
    } else if (why) this.system(why);
    this.changed();
    lobbyChanged();
  }

  destroy() {
    this.game.destroy();
    for (const m of this.members.values()) if (m.timer) clearTimeout(m.timer);
    rooms.delete(this.code);
    log.info('room closed', { code: this.code, kind: this.kind, minutes: Math.round((Date.now() - this.createdAt) / 6000) / 10 });
    lobbyChanged();
  }

  /** @param {string} text */
  system(text) { this.post({ system: true, text, at: Date.now() }); }

  /** A message for one player only (shown as a pop-up). @param {string} id @param {string} text */
  tell(id, text) {
    const m = this.members.get(id);
    if (m?.connected) send(m.conn, { t: 'notice', code: this.code, text });
  }

  /** @param {ChatMsg} msg */
  post(msg) {
    this.chat.push(msg);
    if (this.chat.length > CHAT_KEEP) this.chat.shift();
    for (const m of this.members.values()) if (m.connected) send(m.conn, { t: 'chat', code: this.code, msg });
  }

  // Coalesce state pushes: many changes in one tick send one update.
  changed() {
    if (this.dirty) return;
    this.dirty = true;
    setImmediate(() => {
      this.dirty = false;
      if (!rooms.has(this.code)) return;
      for (const m of this.members.values()) if (m.connected) send(m.conn, { t: 'room', room: this.view(m.id) });
    });
  }

  lobbyChanged() { lobbyChanged(); }

  /** What one member sees. @param {string} id */
  view(id) {
    return {
      code: this.code,
      kind: this.kind,
      visibility: this.visibility,
      hostId: this.hostId,
      youId: id,
      members: this.order.map((x) => this.members.get(x)).filter((m) => m !== undefined)
        .map((m) => ({ id: m.id, name: m.name, guest: m.guest, connected: m.connected })),
      game: this.game.view(id),
    };
  }

  summary() {
    const host = this.hostId ? this.members.get(this.hostId) : undefined;
    const seated = this.game.seatCount();
    return {
      code: this.code,
      kind: this.kind,
      host: host?.name || '—',
      players: this.kind === 'table' ? seated : this.members.size,
      max: this.kind === 'table' ? 5 : this.game.capacity,
      watching: this.kind === 'table' ? Math.max(0, this.members.size - seated) : 0,
      status: this.game.status(),
      detail: this.game.summary(),
    };
  }
}

// ---- lobby ------------------------------------------------------------------------
/** @type {NodeJS.Timeout | null} */
let lobbyTimer = null;
function lobbyView() {
  const list = [...rooms.values()].filter((r) => r.visibility === 'public' && r.members.size).map((r) => r.summary());
  return { t: 'lobby', rooms: list, online: conns.size };
}
function lobbyChanged() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const msg = JSON.stringify(lobbyView());
    for (const c of lobbyWatchers) c.ws.send(msg);
  }, 300);
}

// ---- connections --------------------------------------------------------------------
/**
 * An HTTP upgrade request for /ws.
 * @param {import('./types').Req} req
 * @param {import('net').Socket} socket
 * @param {Buffer} head
 */
function upgrade(req, socket, head) {
  /** @param {number} code @param {string} text @param {string} reason */
  const refuse = (code, text, reason) => { wsRejected.inc({ reason }); WS.reject(socket, code, text); };
  /** @type {URL} */
  let url;
  try { url = new URL(req.url || '/', 'http://x'); } catch { return refuse(400, 'Bad Request', 'bad-url'); }
  if (url.pathname !== '/ws') return refuse(404, 'Not Found', 'path');
  if (U.viaCloudflare(req) && String(req.headers.host || '').toLowerCase() !== U.PUBLIC_HOST) return refuse(403, 'Forbidden', 'host');
  if (!req.headers.origin || !U.sameOrigin(req)) return refuse(403, 'Forbidden', 'origin');
  if (!GAMES.battle || shuttingDown) return refuse(503, 'Service Unavailable', 'not-ready');
  const ip = U.clientIp(req);
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) return refuse(429, 'Too Many Requests', 'per-ip');
  const ws = WS.accept(req, socket, head);
  if (!ws) return;
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  /** @type {Conn} */
  const c = { ws, ip, user: auth.currentUser(req), id: null, name: null, guest: true, room: null, times: [], strategy: null };
  conns.add(c);
  const helloTimer = setTimeout(() => { if (!c.id) ws.close(1008, 'Say hello'); }, HELLO_MS);
  ws.on('message', (/** @type {string} */ text) => {
    const t0 = process.hrtime.bigint();
    /** @type {string} */
    let type = 'bad';
    try { type = onMessage(c, text) || 'bad'; } catch (e) {
      log.error('live message failed', { err: e });
      send(c, { t: 'error', error: 'Something went wrong.' });
    }
    // Game moves are labelled by what they do (bet, act, answer...), the rest by type.
    wsMessages.inc({ type });
    wsSeconds.observe(Number(process.hrtime.bigint() - t0) / 1e9, { type });
  });
  ws.on('close', () => {
    clearTimeout(helloTimer);
    conns.delete(c);
    lobbyWatchers.delete(c);
    const n = (perIp.get(ip) || 1) - 1;
    if (n > 0) perIp.set(ip, n); else perIp.delete(ip);
    if (c.room) c.room.dropped(c);
    lobbyChanged();
  });
}

// Keep connections alive through Cloudflare (it drops idle ones after 100s) and clear dead ones.
setInterval(() => {
  for (const c of conns) {
    if (!c.ws.alive) { c.ws.terminate(); continue; }
    c.ws.alive = false;
    c.ws.ping();
  }
}, 25000).unref();

/** @param {Conn} c @param {Record<string, any>} msg */
function hello(c, msg) {
  c.strategy = strategyFor(c, msg.strategy);
  if (c.user) {
    c.id = `u${c.user.id}`;
    c.name = c.user.display_name;
    c.guest = false;
  } else {
    const token = String(msg.guestToken || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return send(c, { t: 'error', error: 'Bad guest token.' });
    const nick = chat.nickname(msg.guestName);
    if (nick.error !== undefined) return send(c, { t: 'needName', error: nick.error });
    const name = nick.name;
    if (findName.get(name)) return send(c, { t: 'needName', error: 'An account already uses that name. Pick another, or sign in.' });
    const id = `g${sha(token).slice(0, 16)}`;
    const clash = [...conns].some((o) => o !== c && o.id && o.id !== id && String(o.name).toLowerCase() === name.toLowerCase());
    if (clash) return send(c, { t: 'needName', error: 'Someone online is using that name. Pick another.' });
    if (c.room && c.id !== id) return send(c, { t: 'error', error: 'Leave the room before changing who you are.' });
    c.id = id;
    c.name = name;
    c.guest = true;
  }
  send(c, { t: 'welcome', you: { id: c.id, name: c.name, guest: c.guest } });
}

/** Battles only use premade strategies: yours if you play one, otherwise the default. @param {Conn} c */
const presetOf = (c) => (c.strategy?.preset ? c.strategy.id : 'tcl');

/** @param {unknown} kind @returns {Kind | null} */
const kindOf = (kind) => (kind === 'battle' || kind === 'table') && GAMES[kind] ? kind : null;

/**
 * Handle one message from a browser. Returns a short label for metrics.
 * @param {Conn} c
 * @param {string} text
 * @returns {string | undefined}
 */
function onMessage(c, text) {
  // Flood control: 40 messages per 5 seconds is far beyond any real player.
  const now = Date.now();
  c.times.push(now);
  while (c.times.length && c.times[0] < now - 5000) c.times.shift();
  if (c.times.length > 40) { c.ws.close(1008, 'Too many messages'); return 'flood'; }

  /** @type {Record<string, any>} */
  let msg;
  try { msg = JSON.parse(text); } catch { return 'bad'; }
  if (!msg || typeof msg !== 'object') return 'bad';
  if (msg.t === 'hello') { hello(c, msg); return 'hello'; }
  if (!c.id) { send(c, { t: 'error', error: 'Say hello first.' }); return 'no-hello'; }
  const id = c.id;
  const name = String(c.name);
  /** @param {string} error */
  const fail = (error) => send(c, { t: 'error', error, ref: msg.ref });

  switch (msg.t) {
    case 'strategy':
      // Switched strategies: shared tables grade with it from the next round.
      c.strategy = strategyFor(c, msg.strategy);
      if (c.room) c.room.changed();
      return 'strategy';
    case 'lobby':
      if (msg.watch) { lobbyWatchers.add(c); send(c, lobbyView()); } else lobbyWatchers.delete(c);
      return 'lobby';
    case 'create': {
      const kind = kindOf(msg.kind);
      if (!kind) { fail('Pick a battle or a table.'); return 'create'; }
      if (rooms.size >= MAX_ROOMS) { fail('The site is full right now. Try again in a few minutes.'); return 'create'; }
      if (createLimit(c.ip)) { fail('You’re making rooms too fast. Wait a minute.'); return 'create'; }
      if (c.room) c.room.remove(id, `${name} left.`);
      const settings = { ...(msg.settings && typeof msg.settings === 'object' ? msg.settings : {}), strategy: presetOf(c) };
      const room = new Room(kind, msg.visibility === 'private' ? 'private' : 'public', settings);
      room.join(c);
      return 'create';
    }
    case 'join': {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) { send(c, { t: 'noRoom', code: msg.code, error: 'That room doesn’t exist any more. It closes once everyone leaves.' }); return 'join'; }
      if (room.banned.has(id)) { send(c, { t: 'noRoom', code: room.code, error: 'The host removed you from this room.' }); return 'join'; }
      if (c.room === room && room.members.get(id)?.conn === c) { room.changed(); send(c, { t: 'chatHistory', code: room.code, msgs: room.chat }); return 'join'; }
      if (!room.members.has(id) && room.full) { send(c, { t: 'noRoom', code: room.code, error: 'That room is full.' }); return 'join'; }
      if (c.room && c.room !== room) c.room.remove(id, `${name} left.`);
      room.join(c);
      return 'join';
    }
    case 'quick': {
      const kind = kindOf(msg.kind);
      if (!kind) { fail('Pick a battle or a table.'); return 'quick'; }
      const open = [...rooms.values()].filter((r) => r.kind === kind && r.visibility === 'public' && !r.full && !r.banned.has(id)
        && r.connectedMembers().length && (kind === 'table' ? r.game.hasRoom() : !r.game.playing && r.game.strategyId === presetOf(c)))
        .sort((a, b) => b.members.size - a.members.size);
      if (open[0]) {
        if (c.room && c.room !== open[0]) c.room.remove(id, `${name} left.`);
        open[0].join(c);
        return 'quick';
      }
      if (rooms.size >= MAX_ROOMS) { fail('The site is full right now. Try again in a few minutes.'); return 'quick'; }
      if (createLimit(c.ip)) { fail('You’re making rooms too fast. Wait a minute.'); return 'quick'; }
      if (c.room) c.room.remove(id, `${name} left.`);
      new Room(kind, 'public', { strategy: presetOf(c) }).join(c);
      return 'quick';
    }
    case 'leave':
      if (c.room) c.room.remove(id, `${name} left.`);
      send(c, { t: 'left', code: msg.code, reason: null });
      return 'leave';
    case 'chat': {
      const room = c.room;
      const m = room?.members.get(id);
      if (!room || !m) return 'chat';
      m.chatTimes = m.chatTimes.filter((t) => t > now - 10000);
      if (m.chatTimes.length >= 5) { fail('Slow down a little: 5 messages per 10 seconds.'); return 'chat'; }
      const t = chat.chatText(msg.text);
      if (!t) return 'chat';
      m.chatTimes.push(now);
      room.post({ id: m.id, name: m.name, guest: m.guest, text: t, at: now });
      return 'chat';
    }
    case 'kick': {
      const room = c.room;
      if (!room || !room.isHost(id)) { fail('Only the host can remove players.'); return 'kick'; }
      const target = room.members.get(String(msg.id));
      if (!target || target.id === id) return 'kick';
      room.banned.add(target.id);
      if (target.conn) send(target.conn, { t: 'left', code: room.code, reason: 'The host removed you from this room.' });
      room.remove(target.id, `${target.name} was removed by the host.`);
      return 'kick';
    }
    case 'game': {
      const room = c.room;
      const m = room?.members.get(id);
      if (!room || !m) return 'game';
      const err = room.game.action(m, msg);
      if (err) fail(err);
      return GAME_MOVES.has(msg.a) ? `game:${msg.a}` : 'game:other'; // fixed labels: browsers can't add metric series
    }
    default:
      return 'unknown';
  }
}
const GAME_MOVES = new Set(['start', 'settings', 'answer', 'sit', 'stand', 'bet', 'sitout', 'insurance', 'act', 'check']);

// Numbers for the lobby page over plain HTTP.
function stats() {
  return { online: conns.size, rooms: rooms.size };
}

// Live numbers for /metrics.
function gauges() {
  let tables = 0; let battles = 0; let seated = 0;
  for (const r of rooms.values()) {
    if (r.kind === 'table') { tables++; seated += r.game.seatCount(); } else battles++;
  }
  return { live_connections: conns.size, live_rooms_table: tables, live_rooms_battle: battles, live_players_seated: seated };
}

// Before a restart: tell everyone, then close their connections with "service restart"
// (1012). Browsers reconnect by themselves once the new version is up.
let shuttingDown = false;
function shutdown() {
  shuttingDown = true;
  for (const c of conns) {
    send(c, { t: 'notice', text: 'The site is updating. You’ll reconnect in a few seconds.' });
    c.ws.close(1012, 'Restarting');
  }
}

module.exports = { upgrade, ready, stats, gauges, shutdown, rooms };
