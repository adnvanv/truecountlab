// Live play over WebSockets: who's connected, rooms (count battles and shared tables),
// invite codes, the public lobby and room chat. Everything here lives in memory; only
// signed-in players' results are written to the database (see records.js).
'use strict';
const path = require('path');
const crypto = require('crypto');
const { pathToFileURL } = require('url');
const WS = require('./ws');
const U = require('./util');
const auth = require('./auth');
const { db } = require('./db');
const chat = require('./chat');
const records = require('./records');

// The browser's own card and strategy code, so the server grades with the same rules.
const GAMES = {};
const ready = Promise.all(['cards.js', 'strategy.js'].map((f) => import(pathToFileURL(path.join(__dirname, '..', 'public', 'js', f)).href)))
  .then(([cards, strategy]) => {
    GAMES.battle = require('./games/battle')({ cards, strategy }, records);
    GAMES.table = require('./games/table')({ cards, strategy }, records);
  });
ready.catch((e) => console.error('Loading the game code failed:', e));

const MAX_PER_IP = 20; // phones on one carrier can share an address
const MAX_ROOMS = 300;
const GRACE_MS = 45000; // how long a dropped player keeps their place
const HELLO_MS = 10000;
const CHAT_KEEP = 50;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const conns = new Set();
const perIp = new Map();
const rooms = new Map();
const lobbyWatchers = new Set();
const createLimit = U.rateLimiter(6, 60 * 1000);

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const send = (c, msg) => c.ws.send(JSON.stringify(msg));
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
  constructor(kind, visibility, settings) {
    this.code = newCode();
    this.kind = kind;
    this.visibility = visibility;
    this.members = new Map(); // id → { id, name, guest, userId, conn, connected, timer, chatTimes }
    this.order = []; // join order, for handing over host
    this.hostId = null;
    this.banned = new Set();
    this.chat = [];
    this.createdAt = Date.now();
    this.dirty = false;
    this.game = new GAMES[kind](this, settings);
    rooms.set(this.code, this);
    lobbyChanged();
  }

  connectedMembers() { return [...this.members.values()].filter((m) => m.connected); }
  isHost(id) { return this.hostId === id; }
  get full() { return this.members.size >= this.game.capacity; }

  join(c) {
    let m = this.members.get(c.id);
    if (m) {
      // Same player again (reconnect, or a second tab): this connection takes over.
      if (m.conn && m.conn !== c && !m.conn.ws.closed) {
        send(m.conn, { t: 'left', code: this.code, reason: 'You opened this room somewhere else.' });
        m.conn.room = null;
      }
      clearTimeout(m.timer);
      const was = m.connected;
      m.conn = c;
      m.connected = true;
      m.name = c.name;
      c.room = this;
      if (!was) { this.game.onReconnect(m); this.system(`${m.name} is back.`); }
    } else {
      m = { id: c.id, name: c.name, guest: c.guest, userId: c.user?.id ?? null, conn: c, connected: true, timer: null, chatTimes: [] };
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

  // The connection dropped: keep the place for a while.
  dropped(c) {
    const m = this.members.get(c.id);
    if (!m || m.conn !== c) return;
    m.connected = false;
    m.conn = null;
    this.game.onDisconnect(m);
    m.timer = setTimeout(() => this.remove(m.id, `${m.name} left.`), GRACE_MS);
    this.changed();
    lobbyChanged();
  }

  remove(id, why) {
    const m = this.members.get(id);
    if (!m) return;
    clearTimeout(m.timer);
    this.members.delete(id);
    this.order = this.order.filter((x) => x !== id);
    if (m.conn && m.conn.room === this) m.conn.room = null;
    this.game.onLeave(m);
    if (!this.members.size) return this.destroy();
    if (this.hostId === id) {
      const next = this.order.find((x) => this.members.get(x)?.connected) || this.order[0];
      this.hostId = next;
      if (why) this.system(why);
      this.system(`${this.members.get(next).name} is the host now.`);
    } else if (why) this.system(why);
    this.changed();
    lobbyChanged();
  }

  destroy() {
    this.game.destroy();
    for (const m of this.members.values()) clearTimeout(m.timer);
    rooms.delete(this.code);
    lobbyChanged();
  }

  system(text) { this.post({ system: true, text, at: Date.now() }); }

  // A message for one player only (shown as a pop-up).
  tell(id, text) {
    const m = this.members.get(id);
    if (m?.connected) send(m.conn, { t: 'notice', code: this.code, text });
  }

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

  view(id) {
    return {
      code: this.code,
      kind: this.kind,
      visibility: this.visibility,
      hostId: this.hostId,
      youId: id,
      members: this.order.map((x) => this.members.get(x)).filter(Boolean)
        .map((m) => ({ id: m.id, name: m.name, guest: m.guest, connected: m.connected })),
      game: this.game.view(id),
    };
  }

  summary() {
    const host = this.members.get(this.hostId);
    return {
      code: this.code,
      kind: this.kind,
      host: host?.name || '—',
      players: this.kind === 'table' ? this.game.seatCount() : this.members.size,
      max: this.kind === 'table' ? 5 : this.game.capacity,
      watching: this.kind === 'table' ? Math.max(0, this.members.size - this.game.seatCount()) : 0,
      status: this.game.status(),
      detail: this.game.summary(),
    };
  }
}

// ---- lobby ------------------------------------------------------------------------
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
function upgrade(req, socket, head) {
  let url;
  try { url = new URL(req.url, 'http://x'); } catch { return WS.reject(socket, 400, 'Bad Request'); }
  if (url.pathname !== '/ws') return WS.reject(socket, 404, 'Not Found');
  if (U.viaCloudflare(req) && String(req.headers.host || '').toLowerCase() !== U.PUBLIC_HOST) return WS.reject(socket, 403, 'Forbidden');
  if (!req.headers.origin || !U.sameOrigin(req)) return WS.reject(socket, 403, 'Forbidden');
  if (!GAMES.battle) return WS.reject(socket, 503, 'Service Unavailable');
  const ip = U.clientIp(req);
  if ((perIp.get(ip) || 0) >= MAX_PER_IP) return WS.reject(socket, 429, 'Too Many Requests');
  const ws = WS.accept(req, socket, head);
  if (!ws) return;
  perIp.set(ip, (perIp.get(ip) || 0) + 1);
  const c = { ws, ip, user: auth.currentUser(req), id: null, name: null, guest: true, room: null, times: [] };
  conns.add(c);
  const helloTimer = setTimeout(() => { if (!c.id) ws.close(1008, 'Say hello'); }, HELLO_MS);
  ws.on('message', (text) => {
    try { onMessage(c, text); } catch (e) { console.error('Live message failed:', e); send(c, { t: 'error', error: 'Something went wrong.' }); }
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

function hello(c, msg) {
  if (c.user) {
    c.id = `u${c.user.id}`;
    c.name = c.user.display_name;
    c.guest = false;
  } else {
    const token = String(msg.guestToken || '');
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return send(c, { t: 'error', error: 'Bad guest token.' });
    const nick = chat.nickname(msg.guestName);
    if (nick.error) return send(c, { t: 'needName', error: nick.error });
    if (findName.get(nick.name)) return send(c, { t: 'needName', error: 'An account already uses that name. Pick another, or sign in.' });
    const id = `g${sha(token).slice(0, 16)}`;
    const clash = [...conns].some((o) => o !== c && o.id && o.id !== id && o.name.toLowerCase() === nick.name.toLowerCase());
    if (clash) return send(c, { t: 'needName', error: 'Someone online is using that name. Pick another.' });
    if (c.room && c.id !== id) return send(c, { t: 'error', error: 'Leave the room before changing who you are.' });
    c.id = id;
    c.name = nick.name;
    c.guest = true;
  }
  send(c, { t: 'welcome', you: { id: c.id, name: c.name, guest: c.guest } });
}

function onMessage(c, text) {
  // Flood control: 40 messages per 5 seconds is far beyond any real player.
  const now = Date.now();
  c.times.push(now);
  while (c.times.length && c.times[0] < now - 5000) c.times.shift();
  if (c.times.length > 40) return c.ws.close(1008, 'Too many messages');

  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (!msg || typeof msg !== 'object') return;
  if (msg.t === 'hello') return hello(c, msg);
  if (!c.id) return send(c, { t: 'error', error: 'Say hello first.' });
  const fail = (error) => send(c, { t: 'error', error, ref: msg.ref });

  switch (msg.t) {
    case 'lobby':
      if (msg.watch) { lobbyWatchers.add(c); send(c, lobbyView()); } else lobbyWatchers.delete(c);
      return;
    case 'create': {
      const kind = GAMES[msg.kind] ? msg.kind : null;
      if (!kind) return fail('Pick a battle or a table.');
      if (rooms.size >= MAX_ROOMS) return fail('The site is full right now. Try again in a few minutes.');
      if (createLimit(c.ip)) return fail('You’re making rooms too fast. Wait a minute.');
      if (c.room) c.room.remove(c.id, `${c.name} left.`);
      const room = new Room(kind, msg.visibility === 'private' ? 'private' : 'public', msg.settings);
      room.join(c);
      return;
    }
    case 'join': {
      const room = rooms.get(String(msg.code || '').toUpperCase().trim());
      if (!room) return send(c, { t: 'noRoom', code: msg.code, error: 'That room doesn’t exist any more. It closes once everyone leaves.' });
      if (room.banned.has(c.id)) return send(c, { t: 'noRoom', code: room.code, error: 'The host removed you from this room.' });
      if (c.room === room && room.members.get(c.id)?.conn === c) { room.changed(); send(c, { t: 'chatHistory', code: room.code, msgs: room.chat }); return; }
      if (!room.members.has(c.id) && room.full) return send(c, { t: 'noRoom', code: room.code, error: 'That room is full.' });
      if (c.room && c.room !== room) c.room.remove(c.id, `${c.name} left.`);
      room.join(c);
      return;
    }
    case 'quick': {
      const kind = GAMES[msg.kind] ? msg.kind : null;
      if (!kind) return fail('Pick a battle or a table.');
      const open = [...rooms.values()].filter((r) => r.kind === kind && r.visibility === 'public' && !r.full && !r.banned.has(c.id)
        && r.connectedMembers().length && (kind === 'table' ? r.game.hasRoom() : !r.game.playing))
        .sort((a, b) => b.members.size - a.members.size);
      if (open[0]) {
        if (c.room && c.room !== open[0]) c.room.remove(c.id, `${c.name} left.`);
        open[0].join(c);
        return;
      }
      if (rooms.size >= MAX_ROOMS) return fail('The site is full right now. Try again in a few minutes.');
      if (createLimit(c.ip)) return fail('You’re making rooms too fast. Wait a minute.');
      if (c.room) c.room.remove(c.id, `${c.name} left.`);
      new Room(kind, 'public', {}).join(c);
      return;
    }
    case 'leave':
      if (c.room) c.room.remove(c.id, `${c.name} left.`);
      send(c, { t: 'left', code: msg.code, reason: null });
      return;
    case 'chat': {
      const room = c.room;
      if (!room) return;
      const m = room.members.get(c.id);
      m.chatTimes = m.chatTimes.filter((t) => t > now - 10000);
      if (m.chatTimes.length >= 5) return fail('Slow down a little: 5 messages per 10 seconds.');
      const t = chat.chatText(msg.text);
      if (!t) return;
      m.chatTimes.push(now);
      room.post({ id: m.id, name: m.name, guest: m.guest, text: t, at: now });
      return;
    }
    case 'kick': {
      const room = c.room;
      if (!room || !room.isHost(c.id)) return fail('Only the host can remove players.');
      const target = room.members.get(String(msg.id));
      if (!target || target.id === c.id) return;
      room.banned.add(target.id);
      if (target.conn) send(target.conn, { t: 'left', code: room.code, reason: 'The host removed you from this room.' });
      room.remove(target.id, `${target.name} was removed by the host.`);
      return;
    }
    case 'game': {
      const room = c.room;
      if (!room) return;
      const m = room.members.get(c.id);
      const err = room.game.action(m, msg);
      if (err) fail(err);
      return;
    }
    default:
  }
}

// Numbers for the lobby page over plain HTTP.
function stats() {
  return { online: conns.size, rooms: rooms.size };
}

module.exports = { upgrade, ready, stats, rooms };
