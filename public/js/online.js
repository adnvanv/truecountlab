// The live connection for online play: one WebSocket per page, reconnecting by itself,
// rejoining your room after a drop. Guests keep a random token and nickname in this
// browser; signed-in players are recognised by their sign-in cookie.
import * as store from './store.js';

const TOKEN_KEY = 'tcl.guestToken';
const NAME_KEY = 'tcl.guestName';
const listeners = new Map();
let ws = null;
let status = 'offline'; // offline | connecting | ready | needName
let you = null;
let room = null; // code of the room we want to be in
let retry = 0;
let retryTimer = null;
let wanted = false;
let lastError = null;

function read(key) { try { return localStorage.getItem(key); } catch { return null; } }
function write(key, v) { try { localStorage.setItem(key, v); } catch { /* private mode */ } }

function token() {
  let t = read(TOKEN_KEY);
  if (!t || !/^[A-Za-z0-9_-]{16,64}$/.test(t)) {
    const b = crypto.getRandomValues(new Uint8Array(18));
    t = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    write(TOKEN_KEY, t);
  }
  return t;
}

export function guestName() {
  let n = read(NAME_KEY);
  if (!n) { n = `Player${1000 + Math.floor(Math.random() * 9000)}`; write(NAME_KEY, n); }
  return n;
}

function emit(type, msg) {
  for (const fn of listeners.get(type) || []) fn(msg);
  for (const fn of listeners.get('*') || []) fn(msg);
}

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(fn);
  return () => listeners.get(type).delete(fn);
}

const setStatus = (s) => { status = s; emit('status', { t: 'status', status: s }); };
export const getStatus = () => status;
export const me = () => you;
export const currentRoom = () => room;
export const error = () => lastError;

export function connect() {
  wanted = true;
  if (ws && ws.readyState <= 1) return;
  clearTimeout(retryTimer);
  setStatus('connecting');
  const sock = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws = sock;
  sock.addEventListener('open', () => {
    if (ws !== sock) return;
    sock.send(JSON.stringify({ t: 'hello', guestToken: token(), guestName: guestName(), strategy: strategyMsg() }));
  });
  sock.addEventListener('message', (e) => {
    if (ws !== sock) return;
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.t === 'welcome') {
      you = m.you;
      retry = 0;
      lastError = null;
      setStatus('ready');
      if (room) send({ t: 'join', code: room });
    } else if (m.t === 'needName') {
      lastError = m.error;
      setStatus('needName');
    } else if (m.t === 'room') {
      room = m.room.code;
    } else if (m.t === 'left' || m.t === 'noRoom') {
      if (!m.code || String(m.code).toUpperCase() === room) room = null;
    }
    emit(m.t, m);
  });
  sock.addEventListener('close', () => {
    if (ws !== sock) return;
    ws = null;
    if (status !== 'needName') setStatus('offline');
    if (!wanted) return;
    retry = Math.min(retry + 1, 6);
    retryTimer = setTimeout(connect, Math.min(15000, 500 * 2 ** retry));
  });
}

export function disconnect() {
  wanted = false;
  clearTimeout(retryTimer);
  room = null;
  if (ws) { const s = ws; ws = null; s.close(); }
  setStatus('offline');
}

export function send(msg) {
  if (ws && ws.readyState === 1 && status === 'ready') { ws.send(JSON.stringify(msg)); return true; }
  return false;
}

// Change the guest nickname (only while not in a room).
export function setGuestName(name) {
  write(NAME_KEY, name);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'hello', guestToken: token(), guestName: name, strategy: strategyMsg() }));
  else connect();
}

export function join(code) { room = String(code).toUpperCase(); send({ t: 'join', code: room }); }
export function leave() { const code = room; room = null; send({ t: 'leave', code }); }
export const game = (a, extra = {}) => send({ t: 'game', a, ...extra });

// The server grades with your strategy: a premade one by id, your own in full.
const strategyMsg = () => { const s = store.activeStrategy(); return s.preset ? s.id : s; };
/** Tell the server you switched strategies (it applies from the next round). */
export function strategyChanged() { if (ws && ws.readyState === 1) ws.send(JSON.stringify({ t: 'strategy', strategy: strategyMsg() })); }

// Signing in or out changes who you are: start a fresh connection.
let lastUser = store.currentUser()?.id ?? null;
store.onChange((u) => {
  const id = u?.id ?? null;
  if (id === lastUser) return;
  lastUser = id;
  if (ws) { const s = ws; ws = null; s.close(); you = null; connect(); }
});
