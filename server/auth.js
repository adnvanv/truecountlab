// Accounts: email + password, sessions, password reset, account management.
'use strict';
const crypto = require('crypto');
const { db, tx } = require('./db');
const U = require('./util');
const mail = require('./mail');

const SESSION_COOKIE = 'tcl_session';
const SESSION_MS = 30 * 24 * 3600 * 1000; // 30 days, extended while you keep using it
const RESET_MS = 60 * 60 * 1000; // reset links last an hour
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

// ---- passwords -------------------------------------------------------------
function scrypt(password, salt, params = SCRYPT) {
  return new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, params, (e, k) => (e ? reject(e) : resolve(k))));
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, key] = String(stored || '').split('$');
  if (alg !== 'scrypt') return false;
  const expected = Buffer.from(key, 'base64');
  const got = await scrypt(password, Buffer.from(salt, 'base64'), { N: +N, r: +r, p: +p, maxmem: SCRYPT.maxmem });
  return got.length === expected.length && crypto.timingSafeEqual(got, expected);
}

// Checked against when the email doesn't exist, so a wrong email takes as long as a wrong password.
let dummyHash = null;
hashPassword('not-a-real-password').then((h) => { dummyHash = h; });

// ---- validation ------------------------------------------------------------
const cleanEmail = (v) => String(v || '').trim().toLowerCase();
const validEmail = (e) => e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
const cleanName = (v) => String(v || '').trim().replace(/\s+/g, ' ');
const validName = (n) => /^[A-Za-z0-9_][A-Za-z0-9_ .-]{1,18}[A-Za-z0-9_]$/.test(n);
function passwordProblem(pw, email) {
  if (typeof pw !== 'string' || pw.length < 8) return 'Use at least 8 characters for your password.';
  if (pw.length > 200) return 'That password is too long (200 characters max).';
  if (email && pw.toLowerCase() === email) return "Your password can't be your email address.";
  return null;
}

// ---- sessions ----------------------------------------------------------------
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

function startSession(req, res, userId) {
  const token = newToken();
  const now = Date.now();
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(token), userId, now, now + SESSION_MS);
  res.setHeader('set-cookie', U.cookie(req, SESSION_COOKIE, token, { maxAge: SESSION_MS / 1000 }));
}

function endSession(req, res) {
  const token = U.parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  res.setHeader('set-cookie', U.cookie(req, SESSION_COOKIE, '', { maxAge: 0 }));
}

// The signed-in user for this request, or null. Sessions slide forward while used.
function currentUser(req) {
  const token = U.parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const hash = sha256(token);
  const row = db.prepare(`SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id
                          WHERE s.token_hash = ? AND s.expires_at > ?`).get(hash, Date.now());
  if (!row) return null;
  if (row.session_expires - Date.now() < SESSION_MS / 2) {
    db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(Date.now() + SESSION_MS, hash);
  }
  return row;
}

function publicUser(u) {
  if (!u) return null;
  const providers = db.prepare('SELECT provider FROM identities WHERE user_id = ? ORDER BY provider').all(u.id).map((r) => r.provider);
  return { id: u.id, displayName: u.display_name, email: u.email, emailVerified: !!u.email_verified, hasPassword: !!u.password_hash, providers, createdAt: u.created_at };
}

// A display name that isn't taken yet, built from a preferred one (used for Google/Discord sign-ups).
function uniqueName(preferred) {
  let base = cleanName(preferred).replace(/[^A-Za-z0-9_ .-]/g, '').replace(/^[^A-Za-z0-9_]+|[^A-Za-z0-9_]+$/g, '').slice(0, 16);
  if (base.length < 3) base = 'Player';
  const taken = (n) => db.prepare('SELECT 1 FROM users WHERE display_name = ?').get(n);
  if (!taken(base)) return base;
  for (let i = 0; i < 50; i++) {
    const n = `${base}${crypto.randomInt(100, 10000)}`;
    if (!taken(n)) return n;
  }
  return `Player${crypto.randomInt(100000, 1000000)}`;
}

// ---- rate limits --------------------------------------------------------------
const perIp = U.rateLimiter(Number(process.env.AUTH_RATE_LIMIT) || 20, 60 * 1000); // auth requests per minute per IP
const failedLogins = U.rateLimiter(8, 15 * 60 * 1000); // wrong passwords per 15 min per email

function limited(req, res) {
  const wait = perIp(U.clientIp(req));
  if (wait) { U.fail(res, 429, `Too many attempts. Try again in ${wait} seconds.`, {}); return true; }
  return false;
}

// ---- routes -----------------------------------------------------------------------
async function signup(req, res) {
  if (limited(req, res)) return;
  const b = await U.readJson(req);
  const email = cleanEmail(b.email);
  const displayName = cleanName(b.displayName);
  if (!validEmail(email)) return U.fail(res, 400, 'Enter a valid email address.');
  if (!validName(displayName)) return U.fail(res, 400, 'Display names are 3–20 letters, numbers, spaces, dots, dashes or underscores.');
  const problem = passwordProblem(b.password, email);
  if (problem) return U.fail(res, 400, problem);
  const hash = await hashPassword(b.password);
  let userId;
  try {
    userId = tx(() => {
      if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw Object.assign(new Error(), { taken: 'An account with that email already exists. Try signing in.' });
      if (db.prepare('SELECT 1 FROM users WHERE display_name = ?').get(displayName)) throw Object.assign(new Error(), { taken: 'That display name is taken. Try another.' });
      return Number(db.prepare('INSERT INTO users (email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
        .run(email, displayName, hash, Date.now()).lastInsertRowid);
    });
  } catch (e) {
    if (e.taken) return U.fail(res, 409, e.taken);
    throw e;
  }
  startSession(req, res, userId);
  U.json(res, 201, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
}

async function login(req, res) {
  if (limited(req, res)) return;
  const b = await U.readJson(req);
  const email = cleanEmail(b.email);
  // Locked after too many wrong passwords, even if this one is right.
  const lock = failedLogins(email, false);
  if (lock) return U.fail(res, 429, `Too many wrong passwords for this account. Try again in ${Math.ceil(lock / 60)} minutes, or reset your password.`);
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const ok = await verifyPassword(String(b.password || ''), user?.password_hash || dummyHash);
  if (!user || !user.password_hash || !ok) {
    failedLogins(email);
    if (user && !user.password_hash) return U.fail(res, 401, 'This account signs in with Google or Discord. Use that button instead.');
    return U.fail(res, 401, 'Wrong email or password.');
  }
  startSession(req, res, user.id);
  U.json(res, 200, { user: publicUser(user) });
}

function logout(req, res) {
  endSession(req, res);
  U.json(res, 200, { ok: true });
}

async function forgot(req, res) {
  if (limited(req, res)) return;
  if (!mail.enabled()) return U.fail(res, 503, "Password reset emails aren't set up yet.");
  const b = await U.readJson(req);
  const email = cleanEmail(b.email);
  const user = validEmail(email) && db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const token = newToken();
    db.prepare('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(sha256(token), user.id, Date.now() + RESET_MS);
    const link = `${U.PUBLIC_ORIGIN}/#reset?token=${token}`;
    try {
      await mail.sendMail({
        to: email,
        subject: 'Reset your TrueCountLab password',
        text: `Hi ${user.display_name},\n\nReset your TrueCountLab password here (the link works for one hour):\n${link}\n\nIf you didn't ask for this, you can ignore this email.`,
        html: `<p>Hi ${user.display_name.replace(/[<>&]/g, '')},</p><p><a href="${link}">Reset your TrueCountLab password</a>. The link works for one hour.</p><p>If you didn't ask for this, you can ignore this email.</p>`,
      });
    } catch (e) { console.error('reset email failed:', e.message); }
  }
  // Same answer either way, so this can't be used to find out who has an account.
  U.json(res, 200, { ok: true });
}

async function reset(req, res) {
  if (limited(req, res)) return;
  const b = await U.readJson(req);
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND expires_at > ?').get(sha256(String(b.token || '')), Date.now());
  if (!row) return U.fail(res, 400, 'That reset link has expired or was already used. Ask for a new one.');
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(row.user_id);
  const problem = passwordProblem(b.password, user.email);
  if (problem) return U.fail(res, 400, problem);
  const hash = await hashPassword(b.password);
  tx(() => {
    db.prepare('UPDATE users SET password_hash = ?, email_verified = 1 WHERE id = ?').run(hash, user.id);
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id); // sign out everywhere else
  });
  startSession(req, res, user.id);
  U.json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
}

async function updateAccount(req, res, user) {
  const b = await U.readJson(req);
  if (b.displayName != null) {
    const name = cleanName(b.displayName);
    if (!validName(name)) return U.fail(res, 400, 'Display names are 3–20 letters, numbers, spaces, dots, dashes or underscores.');
    const other = db.prepare('SELECT id FROM users WHERE display_name = ?').get(name);
    if (other && other.id !== user.id) return U.fail(res, 409, 'That display name is taken. Try another.');
    db.prepare('UPDATE users SET display_name = ? WHERE id = ?').run(name, user.id);
  }
  if (b.newPassword != null) {
    if (limited(req, res)) return;
    if (user.password_hash && !(await verifyPassword(String(b.currentPassword || ''), user.password_hash))) {
      return U.fail(res, 401, 'Your current password is wrong.');
    }
    let email = user.email;
    if (!email) {
      // Google/Discord accounts without an email need one before they can sign in with a password.
      email = cleanEmail(b.email);
      if (!validEmail(email)) return U.fail(res, 400, 'Add an email address to sign in with a password.');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').get(email, user.id)) return U.fail(res, 409, 'Another account already uses that email.');
    }
    const problem = passwordProblem(b.newPassword, email);
    if (problem) return U.fail(res, 400, problem);
    const hash = await hashPassword(b.newPassword);
    const keep = sha256(U.parseCookies(req)[SESSION_COOKIE] || '');
    tx(() => {
      db.prepare('UPDATE users SET password_hash = ?, email = ? WHERE id = ?').run(hash, email, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(user.id, keep); // sign out other devices
    });
  }
  U.json(res, 200, { user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(user.id)) });
}

async function deleteAccount(req, res, user) {
  if (limited(req, res)) return;
  const b = await U.readJson(req);
  const ok = user.password_hash
    ? await verifyPassword(String(b.password || ''), user.password_hash)
    : cleanName(b.confirm).toLowerCase() === user.display_name.toLowerCase();
  if (!ok) return U.fail(res, 401, user.password_hash ? 'Your password is wrong.' : 'Type your display name exactly to confirm.');
  db.prepare('DELETE FROM users WHERE id = ?').run(user.id); // sessions, logins and progress go with it
  res.setHeader('set-cookie', U.cookie(req, SESSION_COOKIE, '', { maxAge: 0 }));
  U.json(res, 200, { ok: true });
}

function exportAccount(req, res, user) {
  const progress = db.prepare('SELECT data, updated_at FROM progress WHERE user_id = ?').get(user.id);
  const body = {
    exportedAt: new Date().toISOString(),
    account: publicUser(user),
    progress: progress ? JSON.parse(progress.data) : null,
  };
  U.send(res, 200, JSON.stringify(body, null, 2), 'application/json; charset=utf-8', {
    'content-disposition': `attachment; filename="truecountlab-${user.display_name.replace(/[^A-Za-z0-9_-]/g, '_')}.json"`,
  });
}

function unlink(req, res, user, provider) {
  const identities = db.prepare('SELECT provider FROM identities WHERE user_id = ?').all(user.id);
  if (!identities.some((i) => i.provider === provider)) return U.fail(res, 404, 'That sign-in isn’t connected.');
  if (!user.password_hash && identities.length <= 1) return U.fail(res, 400, "That's your only way to sign in. Set a password or connect another sign-in first.");
  db.prepare('DELETE FROM identities WHERE user_id = ? AND provider = ?').run(user.id, provider);
  U.json(res, 200, { user: publicUser(user) });
}

// Returns true when the request was handled here.
async function handle(req, res, url) {
  const p = url.pathname;
  const m = req.method;
  if (p === '/api/me' && m === 'GET') { U.json(res, 200, { user: publicUser(currentUser(req)) }); return true; }
  if (p === '/api/auth/config' && m === 'GET') {
    const oauth = require('./oauth');
    U.json(res, 200, { providers: oauth.enabledProviders(), passwordReset: mail.enabled() });
    return true;
  }
  if (p === '/api/auth/signup' && m === 'POST') { await signup(req, res); return true; }
  if (p === '/api/auth/login' && m === 'POST') { await login(req, res); return true; }
  if (p === '/api/auth/logout' && m === 'POST') { logout(req, res); return true; }
  if (p === '/api/auth/forgot' && m === 'POST') { await forgot(req, res); return true; }
  if (p === '/api/auth/reset' && m === 'POST') { await reset(req, res); return true; }
  if (p === '/api/account' || p.startsWith('/api/account/')) {
    const user = currentUser(req);
    if (!user) { U.fail(res, 401, 'Sign in first.'); return true; }
    if (p === '/api/account' && m === 'PATCH') await updateAccount(req, res, user);
    else if (p === '/api/account' && m === 'DELETE') await deleteAccount(req, res, user);
    else if (p === '/api/account/export' && m === 'GET') exportAccount(req, res, user);
    else if (p.startsWith('/api/account/identity/') && m === 'DELETE') unlink(req, res, user, p.split('/').pop());
    else U.fail(res, 404, 'Not found');
    return true;
  }
  return false;
}

module.exports = { handle, currentUser, publicUser, startSession, uniqueName, SESSION_COOKIE };
