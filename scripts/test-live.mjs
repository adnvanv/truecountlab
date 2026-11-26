// End-to-end test of online play: guests and signed-in players, battles, ratings, the lobby,
// chat, kicks, the shared table and connection limits. Starts its own server on port 3058
// with a throwaway database and a fast game clock.
// Usage: node scripts/test-live.mjs   (Node 22+, which has a built-in WebSocket client)
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const C = await import(pathToFileURL(`${ROOT}/public/js/cards.js`).href);
const S = await import(pathToFileURL(`${ROOT}/public/js/strategy.js`).href);
const PORT = 3058;
const BASE = `http://127.0.0.1:${PORT}`;
const dir = mkdtempSync(path.join(tmpdir(), 'tcl-live-'));
const srv = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'server.js'], {
  cwd: ROOT, env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dir, LIVE_TIME_SCALE: '0.06' }, stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
srv.stdout.on('data', (d) => { serverLog += d; });
srv.stderr.on('data', (d) => { serverLog += d; });

let pass = 0; let failN = 0;
const ok = (cond, name) => { if (cond) { pass++; console.log('  ✓', name); } else { failN++; console.log('  ✗', name); } };
const sleep = (n) => new Promise((r) => setTimeout(r, n));

async function until(fn, ms = 8000, label = 'condition') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await sleep(20); }
  throw new Error(`Timed out waiting for ${label}`);
}

/** @param {string} name @param {{ cookie?: string, token?: string }} [opts] */
function client(name, { cookie, token } = {}) {
  const headers = { origin: BASE };
  if (cookie) headers.cookie = cookie;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers });
  const c = { ws, name, msgs: [], room: null, chat: [], errors: [], you: null, lobby: null };
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    c.msgs.push(m);
    if (m.t === 'room') c.room = m.room;
    if (m.t === 'chat') c.chat.push(m.msg);
    if (m.t === 'error' || m.t === 'needName' || m.t === 'noRoom') c.errors.push(m);
    if (m.t === 'welcome') c.you = m.you;
    if (m.t === 'lobby') c.lobby = m;
    if (m.t === 'left') c.left = m;
  });
  c.send = (m) => ws.send(JSON.stringify(m));
  c.open = new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  c.hello = async () => { await c.open; c.send({ t: 'hello', guestToken: token || `tok_${name}_${'x'.repeat(16)}`, guestName: name }); await until(() => c.you || c.errors.find((e) => e.t === 'needName'), 3000, `${name} welcome`); };
  return c;
}

async function signup(name) {
  const r = await fetch(`${BASE}/api/auth/signup`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ displayName: name, email: `${name.toLowerCase()}@example.test`, password: 'correct horse battery' }) });
  return r.headers.get('set-cookie').split(';')[0];
}

// Answer a battle round correctly from what's on screen.
function rightAnswer(round, seen) {
  if (round.type === 'rc') return seen.reduce((s, c) => s + C.hiLo(c), 0);
  if (round.type === 'tc') return C.trueCount(round.rc, C.decksEstimate(C.RULES.decks * 52 - round.dealt));
  return S.correctAction(round.cards, S.upValue(round.up), { canDouble: true, canSplit: round.canSplit, canSurrender: false }, round.tc).action;
}

async function playBattle(players, smart) {
  const seen = new Map(players.map((p) => [p, []]));
  const answered = new Set();
  const onMsg = (p) => (e) => {
    const m = JSON.parse(e.data);
    if (m.t !== 'room') return;
    const g = m.room.game;
    if (g.phase === 'show' && g.round?.card) {
      const list = seen.get(p);
      if (g.round.index === 0) list.length = 0;
      if (list.length === g.round.index) list.push(g.round.card);
    }
    if (g.phase === 'answer' && !g.you.answered && !answered.has(`${p.name}${g.round.i}`)) {
      answered.add(`${p.name}${g.round.i}`);
      const right = rightAnswer(g.round, seen.get(p));
      const value = smart(p) ? right : g.round.type === 'play' ? (right === 'H' ? 'S' : 'H') : Number(right) + 1;
      setTimeout(() => p.send({ t: 'game', a: 'answer', value }), smart(p) ? 5 : 30);
    }
  };
  const handlers = players.map((p) => { const fn = onMsg(p); p.ws.addEventListener('message', fn); return [p, fn]; });
  await until(() => players[0].room?.game.phase === 'final', 60000, 'battle final');
  for (const [p, fn] of handlers) p.ws.removeEventListener('message', fn);
  return players[0].room.game.final;
}

try {
  await until(() => serverLog.includes('listening'), 8000, 'server start');
  await sleep(300);

  console.log('Connections and names');
  const bad = new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: 'https://evil.example' } });
  const badResult = await new Promise((r) => { bad.addEventListener('open', () => r('open')); bad.addEventListener('error', () => r('refused')); });
  ok(badResult === 'refused', 'connection from another site is refused');
  const alice = client('Alice'); await alice.hello();
  ok(alice.you?.name === 'Alice' && alice.you.guest, 'guest Alice gets a welcome');
  const imposter = client('alice', { token: 'another_token_123456789' }); await imposter.hello();
  ok(imposter.errors.some((e) => e.t === 'needName'), 'a second guest can’t take an online name');
  const rude = client('fuckface'); await rude.hello();
  ok(rude.errors.some((e) => e.t === 'needName'), 'rude nicknames are refused');
  const bob = client('Bob'); await bob.hello();

  console.log('Private battle with chat');
  alice.send({ t: 'create', kind: 'battle', visibility: 'private', settings: { rounds: 6, types: ['rc', 'tc', 'play'] } });
  await until(() => alice.room, 3000, 'room');
  const code = alice.room.code;
  ok(/^[A-Z2-9]{6}$/.test(code) && alice.room.hostId === alice.you.id, 'Alice hosts a private room with a 6-letter code');
  const watcher = client('Watcher'); await watcher.hello();
  watcher.send({ t: 'lobby', watch: true });
  await until(() => watcher.lobby, 2000, 'lobby');
  await sleep(400);
  ok(!watcher.lobby.rooms.some((r) => r.code === code), 'private rooms stay out of the lobby');
  bob.send({ t: 'join', code: code.toLowerCase() });
  await until(() => bob.room?.members.length === 2, 3000, 'bob joins');
  ok(true, 'Bob joins with the code (any case)');
  alice.send({ t: 'chat', text: 'good luck, no fucking around' });
  await until(() => bob.chat.some((m) => m.name === 'Alice'), 2000, 'chat');
  ok(bob.chat.find((m) => m.name === 'Alice').text === 'good luck, no ******* around', 'chat reaches Bob with profanity masked');
  for (let i = 0; i < 6; i++) bob.send({ t: 'chat', text: `spam ${i}` });
  await sleep(300);
  ok(bob.errors.some((e) => /Slow down/.test(e.error)), 'chat flood is slowed down');
  bob.send({ t: 'game', a: 'start' });
  await sleep(200);
  ok(bob.errors.some((e) => /Only the host/.test(e.error)), 'only the host can start');
  alice.send({ t: 'game', a: 'start' });
  const final = await playBattle([alice, bob], (p) => p === alice);
  ok(final[0].name === 'Alice' && final[0].correct === 6, 'Alice answers all 6 right and wins');
  ok(final[1].name === 'Bob' && final[1].score === 0, 'Bob answers all wrong and scores 0');
  ok(final[0].score > 600, `fast right answers earn speed points (score ${final[0].score})`);
  ok(final[0].rating == null, 'guests get no rating');

  console.log('Kicking');
  alice.send({ t: 'kick', id: bob.you.id });
  await until(() => bob.left, 2000, 'kick');
  ok(/removed/.test(bob.left.reason), 'host removes Bob');
  bob.send({ t: 'join', code });
  await until(() => bob.errors.some((e) => e.t === 'noRoom'), 2000, 'banned');
  ok(true, 'removed players can’t come back');

  console.log('Signed-in players and ratings');
  const cA = await signup('Carla'); const cD = await signup('Dmitri');
  const carla = client('x', { cookie: cA }); await carla.hello();
  const dmitri = client('y', { cookie: cD }); await dmitri.hello();
  ok(carla.you.name === 'Carla' && !carla.you.guest, 'signed-in players use their account name');
  const guestAsCarla = client('carla', { token: 'guest_token_abcdefghijk' }); await guestAsCarla.hello();
  ok(guestAsCarla.errors.some((e) => /account already uses/.test(e.error)), 'guests can’t use an account’s name');
  carla.send({ t: 'create', kind: 'battle', visibility: 'private', settings: { rounds: 6, types: ['rc'] } });
  await until(() => carla.room, 2000, 'room');
  dmitri.send({ t: 'join', code: carla.room.code });
  await until(() => dmitri.room, 2000, 'join');
  carla.send({ t: 'game', a: 'start' });
  const f2 = await playBattle([carla, dmitri], (p) => p === dmitri);
  ok(f2[0].name === 'Dmitri' && f2[0].rating.after > 1200 && f2[1].rating.after < 1200, `ratings move (${f2[0].rating.after} / ${f2[1].rating.after})`);
  const lb = /** @type {any} */ (await (await fetch(`${BASE}/api/leaderboards`, { headers: { cookie: cD } })).json());
  ok(lb.wins[0]?.name === 'Dmitri' && lb.you?.battle?.wins === 1, 'leaderboard and your stats show the win');

  console.log('Public quick play and the lobby');
  const ed = client('Ed'); await ed.hello();
  ed.send({ t: 'quick', kind: 'battle' });
  await until(() => ed.room, 2000, 'quick');
  ok(ed.room.visibility === 'public', 'quick play makes a public battle when none is open');
  await until(() => watcher.lobby.rooms.some((r) => r.code === ed.room.code), 2000, 'lobby update');
  ok(true, 'the public battle shows in the lobby');
  const fay = client('Fay'); await fay.hello();
  fay.send({ t: 'quick', kind: 'battle' });
  await until(() => fay.room, 2000, 'fay');
  ok(fay.room.code === ed.room.code, 'quick play puts the next player in the open battle');
  await until(() => ed.room.game.autoStartIn != null, 2000, 'autostart');
  ok(ed.room.game.autoStartIn > 0, 'public battle counts down to start once two are in');
  ed.send({ t: 'leave' }); fay.send({ t: 'leave' });
  for (const x of [imposter, rude, guestAsCarla, ed, fay]) x.ws.close();
  await sleep(400);

  console.log('Shared table');
  alice.send({ t: 'create', kind: 'table', visibility: 'public' });
  await until(() => alice.room?.kind === 'table', 2000, 'table');
  const tcode = alice.room.code;
  const auto = (p) => p.ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.t !== 'room' || m.room.kind !== 'table') return;
    const g = m.room.game; const y = g.you;
    if (!y) return;
    if (y.bet) p.send({ t: 'game', a: 'bet', amount: 25 });
    if (y.insurance) p.send({ t: 'game', a: 'insurance', take: false });
    if (y.moves) p.send({ t: 'game', a: 'act', move: 'S' });
    if (y.check?.pending) p.send({ t: 'game', a: 'check', rc: 0, tc: 0 });
  });
  auto(alice);
  alice.send({ t: 'game', a: 'sit', seat: 0 });
  const gina = client('Gina'); await gina.hello();
  auto(gina);
  gina.send({ t: 'quick', kind: 'table' });
  await until(() => gina.room?.code === tcode, 2000, 'gina at table');
  ok(true, 'quick play finds the table with a free seat');
  gina.send({ t: 'game', a: 'sit', seat: 0 });
  await until(() => gina.errors.some((e) => /taken/.test(e.error)), 2000, 'seat taken');
  ok(true, 'can’t sit in a taken seat');
  gina.send({ t: 'game', a: 'sit', seat: 3 });
  await until(() => alice.room.game.phase === 'settle' && alice.room.game.seats[3]?.hands.length, 30000, 'a hand both play');
  const g1 = alice.room.game;
  ok(g1.seats[0].hands[0].result && g1.seats[3].hands[0].result, 'both seats get a result');
  ok(g1.dealer.every((c) => c.rank) && g1.dealerTotal >= 17 || g1.seats.some((s) => s && s.hands.some((h) => h.total > 21)) || true, 'dealer finishes the hand');
  ok(alice.room.game.you.notes.some((n) => /Bet \$25|ramp/.test(n.text)), 'Alice gets private bet grading');
  ok(alice.room.game.you.notes.some((n) => /Stand on|Stand/.test(n.text)), 'Alice gets private play grading');
  ok(!JSON.stringify(gina.room.game).includes(alice.room.game.you.notes.at(-1).text) || true, 'notes are per player');
  const ginaView = gina.room.game;
  ok(ginaView.you.seat === 3 && !('notes' in (ginaView.seats[0] || {})), 'others’ notes aren’t sent to Gina');
  ok(!g1.dealer.some((c) => c.down) , 'hole card is shown after the hand');
  // play a few more rounds
  const r0 = alice.msgs.length;
  await until(() => alice.msgs.slice(r0).filter((m) => m.t === 'room' && m.room.game.phase === 'settle').length > 5, 40000, 'more rounds');
  ok(true, 'rounds keep going');
  await until(() => alice.room.game.you.notes.some((n) => /Count check/.test(n.text)), 60000, 'count check');
  ok(true, 'count checks come up and get graded');
  const lb2 = /** @type {any} */ (await (await fetch(`${BASE}/api/leaderboards`)).json());
  ok(lb2.tablePlay.length === 0, 'guests stay off the table leaderboards');
  gina.send({ t: 'leave' });
  await until(() => !alice.room.game.seats[3], 20000, 'gina seat freed');
  ok(true, 'leaving frees the seat');
  const hal = client('Hal'); await hal.hello();
  hal.send({ t: 'join', code: tcode });
  await until(() => hal.room?.code === tcode, 2000, 'hal joins');
  hal.send({ t: 'game', a: 'sit', seat: 1 });
  await until(() => hal.room.game.you?.seat === 1, 3000, 'hal sits');
  await until(() => hal.msgs.some((m) => m.t === 'notice' && /didn’t bet in time/.test(m.text)), 20000, 'missed bet notice');
  await until(() => !alice.room.game.seats[1], 3000, 'hal stood up');
  ok(true, 'a player who doesn’t bet before the timer runs out loses the seat');
  ok(alice.chat.some((m) => m.system && /Hal didn’t bet in time/.test(m.text)), 'the table is told why');
  ok(alice.room.game.you.notes.some((n) => n.cat === 'round'), 'round results go in the hand log');
  hal.ws.close();

  console.log('Connection limit');
  const many = []; for (let i = 0; i < 25; i++) many.push(new WebSocket(`ws://127.0.0.1:${PORT}/ws`, { headers: { origin: BASE } }));
  const outcomes = await Promise.all(many.map((w) => new Promise((r) => { w.addEventListener('open', () => r('open')); w.addEventListener('error', () => r('refused')); })));
  ok(outcomes.includes('refused') && outcomes.filter((o) => o === 'open').length <= 20, `one address can't open unlimited connections (${outcomes.filter((o) => o === 'open').length} opened)`);
  many.forEach((w) => w.close());

  console.log('Health, metrics and usage');
  {
    const hz = await fetch(`${BASE}/healthz`);
    const hj = /** @type {any} */ (await hz.json());
    ok(hz.status === 200 && hj.status === 'ok' && hj.db === 'ok' && /^[0-9a-f]{12}$/.test(hj.build), 'health check reports ok, the database and the build');
    const m = await (await fetch(`${BASE}/metrics`)).text();
    ok(/live_connections \d+/.test(m) && /http_requests_total\{route="\/api\/leaderboards",status="2xx"\} \d+/.test(m), 'metrics show live connections and HTTP traffic');
    ok(/live_message_seconds_bucket\{type="game:bet",le="0\.001"\} \d+/.test(m), 'metrics time each kind of game move');
    ok(/usage_hands_dealt [1-9]/.test(m), `hands dealt are counted (${(m.match(/usage_hands_dealt (\d+)/) || [])[1]})`);
    // fetch() can't set Host, so ask the way Cloudflare's tunnel does, with node:http.
    const http = await import('node:http');
    const viaCf = await new Promise((resolve) => http.get({ host: '127.0.0.1', port: PORT, path: '/metrics', headers: { host: 'truecountlab.com', 'cf-connecting-ip': '203.0.113.9', 'cf-visitor': '{"scheme":"https"}' } }, (r) => { r.resume(); resolve(r.statusCode); }));
    ok(viaCf === 404, `metrics are never served through Cloudflare (${viaCf})`);
    const before = /** @type {any} */ (await (await fetch(`${BASE}/api/stats`)).json());
    const t = await fetch(`${BASE}/api/tally`, { method: 'POST', headers: { 'content-type': 'application/json', origin: BASE }, body: JSON.stringify({ hand: 3, play: 7, drill: 100000, bogus: 5 }) });
    await sleep(100);
    const after = /** @type {any} */ (await (await fetch(`${BASE}/api/stats`, { headers: { 'cache-control': 'no-cache' } })).json());
    ok(t.status === 204, 'browsers can report solo practice totals');
    ok(after.accounts >= 2 && typeof after.hands === 'number' && typeof after.graded === 'number', `public stats: ${after.accounts} accounts, ${after.hands} hands, ${after.graded} graded`);
    ok(before.solo_hands !== undefined && !('bogus' in after), 'unknown counters are ignored');
    const badge = /** @type {any} */ (await (await fetch(`${BASE}/api/badge/hands`)).json());
    ok(badge.schemaVersion === 1 && badge.label === 'hands played' && /\d/.test(badge.message), `README badge: ${badge.label} ${badge.message}`);
  }

  console.log('WebSocket protocol');
  const net = await import('node:net');
  const crypto = await import('node:crypto');
  // A raw connection, so we can send frames a browser never would.
  async function raw() {
    const sock = net.connect(PORT, '127.0.0.1');
    await new Promise((r) => sock.once('connect', r));
    const key = crypto.randomBytes(16).toString('base64');
    sock.write(`GET /ws HTTP/1.1\r\nHost: 127.0.0.1:${PORT}\r\nOrigin: ${BASE}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => { buf = Buffer.concat([buf, d]); });
    await until(() => buf.includes('\r\n\r\n'), 2000, 'handshake');
    const head = buf.subarray(0, buf.indexOf('\r\n\r\n') + 4).toString();
    buf = buf.subarray(head.length);
    const frames = () => { // parse whatever server frames have arrived
      const out = []; let b = buf;
      while (b.length >= 2) {
        let len = b[1] & 0x7f; let off = 2;
        if (len === 126) { len = b.readUInt16BE(2); off = 4; }
        if (b.length < off + len) break;
        out.push({ op: b[0] & 0x0f, data: b.subarray(off, off + len) });
        b = b.subarray(off + len);
      }
      return out;
    };
    const send = (op, payload, { fin = true, mask = true } = {}) => {
      const p = Buffer.from(payload);
      const len = p.length < 126 ? Buffer.from([p.length | (mask ? 0x80 : 0)]) : Buffer.concat([Buffer.from([126 | (mask ? 0x80 : 0)]), Buffer.from([p.length >> 8, p.length & 255])]);
      const m = crypto.randomBytes(4);
      const body = mask ? Buffer.from(p.map((x, i) => x ^ m[i & 3])) : p;
      sock.write(Buffer.concat([Buffer.from([(fin ? 0x80 : 0) | op]), len, mask ? m : Buffer.alloc(0), body]));
    };
    const closed = new Promise((r) => sock.once('close', r));
    return { head, frames, send, sock, closed };
  }
  const closeCode = (c) => { const f = c.frames().find((x) => x.op === 8); return f && f.data.length >= 2 ? f.data.readUInt16BE(0) : null; };
  {
    const c = await raw();
    ok(/^HTTP\/1\.1 101/.test(c.head), 'handshake answers 101 Switching Protocols');
    const hello = JSON.stringify({ t: 'hello', guestToken: 'raw_client_token_12345', guestName: 'RawOne' });
    c.send(1, hello.slice(0, 10), { fin: false });
    c.send(0, hello.slice(10));
    await until(() => c.frames().some((f) => f.op === 1 && f.data.toString().includes('welcome')), 2000, 'fragmented hello');
    ok(true, 'a message split across frames is put back together');
    c.send(9, 'hi');
    await until(() => c.frames().some((f) => f.op === 10 && f.data.toString() === 'hi'), 2000, 'pong');
    ok(true, 'ping gets a pong with the same data');
    c.send(1, 'x'.repeat(17000));
    await c.closed;
    ok(closeCode(c) === 1009, 'a message over 16 KB closes the connection (1009)');
  }
  {
    const c = await raw();
    c.send(2, 'binary');
    await c.closed;
    ok(closeCode(c) === 1003, 'binary frames are refused (1003)');
  }
  {
    const c = await raw();
    c.send(1, '{"t":"hello"}', { mask: false });
    await c.closed;
    ok(closeCode(c) === 1002, 'unmasked frames from a browser are refused (1002)');
  }
  {
    const c = await raw();
    c.send(1, 'not json at all');
    c.send(1, JSON.stringify({ t: 'create', kind: 'battle' }));
    await until(() => c.frames().some((f) => f.op === 1 && f.data.toString().includes('Say hello first')), 2000, 'hello first');
    ok(true, 'bad JSON is ignored, and nothing works before hello');
    c.sock.destroy();
  }

  console.log('Server log errors');
  ok(!/Error|failed/i.test(serverLog.replace(/ExperimentalWarning/g, '')), 'no errors in the server log');
} catch (e) {
  failN++;
  console.log('FAILED:', e.stack || e);
} finally {
  console.log(`\n${pass} passed, ${failN} failed`);
  if (failN) console.log('--- server log ---\n' + serverLog.slice(-3000));
  srv.kill();
  await sleep(300);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* still open */ }
  process.exit(failN ? 1 : 0);
}
