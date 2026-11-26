// "Sign in with Google / Discord" (OAuth 2 authorization-code flow).
// A provider is on only when its client ID and secret are in the server's .env.
'use strict';
const crypto = require('crypto');
const { db, tx, one } = require('./db');
const U = require('./util');
const auth = require('./auth');
const log = require('./log');

/** @typedef {import('./types').Req} Req */
/** @typedef {import('./types').Res} Res */
/** @typedef {{ subject: string, email: string | null, emailVerified: boolean, name: string }} Profile */
/**
 * @typedef {object} Provider
 * @property {string} authorize
 * @property {string} token
 * @property {string} scope
 * @property {boolean} pkce
 * @property {Record<string, string>} extra
 * @property {() => string | undefined} id
 * @property {() => string | undefined} secret
 * @property {(accessToken: string) => Promise<Profile>} profile
 */
/** @typedef {'google' | 'discord'} ProviderName */

/** @type {Record<ProviderName, Provider>} */
const PROVIDERS = {
  google: {
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
    extra: { prompt: 'select_account' },
    id: () => process.env.GOOGLE_CLIENT_ID,
    secret: () => process.env.GOOGLE_CLIENT_SECRET,
    async profile(accessToken) {
      const r = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`Google userinfo ${r.status}`);
      const p = /** @type {any} */ (await r.json()); // the provider's profile JSON
      return { subject: String(p.sub), email: p.email || null, emailVerified: p.email_verified === true, name: p.given_name || p.name || '' };
    },
  },
  discord: {
    authorize: 'https://discord.com/oauth2/authorize',
    token: 'https://discord.com/api/oauth2/token',
    scope: 'identify email',
    pkce: false,
    extra: { prompt: 'none' },
    id: () => process.env.DISCORD_CLIENT_ID,
    secret: () => process.env.DISCORD_CLIENT_SECRET,
    async profile(accessToken) {
      const r = await fetch('https://discord.com/api/users/@me', { headers: { authorization: `Bearer ${accessToken}` } });
      if (!r.ok) throw new Error(`Discord user ${r.status}`);
      const p = /** @type {any} */ (await r.json()); // the provider's profile JSON
      return { subject: String(p.id), email: p.email || null, emailVerified: p.verified === true, name: p.global_name || p.username || '' };
    },
  },
};

// Offered only on the public address (not on the private-network one); see U.onPublicHost.
/** @param {Req} req @returns {Record<string, boolean>} */
const enabledProviders = (req) => Object.fromEntries(Object.entries(PROVIDERS).map(([k, p]) => [k, Boolean(p.id() && p.secret() && U.onPublicHost(req))]));
/** @param {string} provider */
const redirectUri = (provider) => `${U.PUBLIC_ORIGIN}/auth/${provider}/callback`;

// Sign-ins in progress: state -> { provider, verifier, linkUserId, at }. Ten minutes to finish.
/** @type {Map<string, { provider: string, verifier: string, linkUserId: number | null, at: number }>} */
const pending = new Map();
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [k, v] of pending) if (v.at < cutoff) pending.delete(k);
}, 60 * 1000).unref();

const STATE_COOKIE = 'tcl_oauth';
/** @param {Res} res @param {string} hash @param {Record<string, string>} [extra] */
const back = (res, hash, extra) => U.redirect(res, `/#${hash}`, extra);

/** @param {Req} req @param {Res} res @param {ProviderName} provider @param {URL} url */
function start(req, res, provider, url) {
  const p = PROVIDERS[provider];
  if (!p || !p.id() || !p.secret()) return U.fail(res, 404, 'That sign-in option is not set up.');
  if (!U.onPublicHost(req)) return U.redirect(res, `${U.PUBLIC_ORIGIN}${url.pathname}${url.search}`);
  const linking = url.searchParams.get('mode') === 'link';
  const user = linking ? auth.currentUser(req) : null;
  if (linking && !user) return back(res, 'account?error=signin-first');
  const state = crypto.randomBytes(24).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  pending.set(state, { provider, verifier, linkUserId: user?.id || null, at: Date.now() });
  const q = new URLSearchParams({ client_id: String(p.id()), redirect_uri: redirectUri(provider), response_type: 'code', scope: p.scope, state, ...p.extra });
  if (p.pkce) {
    q.set('code_challenge', crypto.createHash('sha256').update(verifier).digest('base64url'));
    q.set('code_challenge_method', 'S256');
  }
  // The state cookie ties the callback to this browser (stops login CSRF).
  U.redirect(res, `${p.authorize}?${q}`, { 'set-cookie': U.cookie(req, STATE_COOKIE, state, { maxAge: 600, path: '/auth' }) });
}

/** @param {Req} req @param {Res} res @param {ProviderName} provider @param {URL} url */
async function callback(req, res, provider, url) {
  const p = PROVIDERS[provider];
  const clearState = U.cookie(req, STATE_COOKIE, '', { maxAge: 0, path: '/auth' });
  if (!p || !p.id()) return U.fail(res, 404, 'Not found');
  if (url.searchParams.get('error')) return back(res, `account?error=cancelled&provider=${provider}`, { 'set-cookie': clearState });
  const state = url.searchParams.get('state') || '';
  const flow = pending.get(state);
  pending.delete(state);
  if (!flow || flow.provider !== provider || U.parseCookies(req)[STATE_COOKIE] !== state) {
    return back(res, 'account?error=expired', { 'set-cookie': clearState });
  }

  /** @type {Profile} */
  let profile;
  try {
    const body = new URLSearchParams({
      client_id: String(p.id()), client_secret: String(p.secret()), code: url.searchParams.get('code') || '',
      grant_type: 'authorization_code', redirect_uri: redirectUri(provider),
    });
    if (p.pkce) body.set('code_verifier', flow.verifier);
    const r = await fetch(p.token, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body });
    if (!r.ok) throw new Error(`${provider} token ${r.status}: ${(await r.text()).slice(0, 200)}`);
    profile = await p.profile(String(/** @type {{ access_token?: string }} */ (await r.json()).access_token));
  } catch (e) {
    log.warn('oauth failed', { provider, err: e });
    return back(res, `account?error=failed&provider=${provider}`, { 'set-cookie': clearState });
  }

  /** @type {{ user_id: number } | undefined} */
  const existing = one('SELECT user_id FROM identities WHERE provider = ? AND subject = ?', provider, profile.subject);

  // Connecting a login to the signed-in account (from the Account page).
  if (flow.linkUserId) {
    if (existing && existing.user_id !== flow.linkUserId) return back(res, `account?error=linked-elsewhere&provider=${provider}`, { 'set-cookie': clearState });
    if (!existing) {
      db.prepare('INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(provider, profile.subject, flow.linkUserId, profile.email, Date.now());
    }
    return back(res, `account?linked=${provider}`, { 'set-cookie': clearState });
  }

  // Signing in with a login that's already connected.
  if (existing) {
    auth.startSession(req, res, existing.user_id);
    res.setHeader('set-cookie', [String(res.getHeader('set-cookie') || ''), clearState].filter(Boolean));
    return back(res, 'home');
  }

  // A new login whose email already has an account: don't merge automatically (that
  // would let anyone who registered your email first take over). Sign in, then connect.
  const email = profile.email && profile.emailVerified ? profile.email.toLowerCase() : null;
  if (email && db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return back(res, `account?error=email-exists&provider=${provider}`, { 'set-cookie': clearState });
  }

  // Brand-new player.
  const userId = tx(() => {
    const id = Number(db.prepare('INSERT INTO users (email, email_verified, display_name, created_at) VALUES (?, ?, ?, ?)')
      .run(email, email ? 1 : 0, auth.uniqueName(profile.name), Date.now()).lastInsertRowid);
    db.prepare('INSERT INTO identities (provider, subject, user_id, email, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(provider, profile.subject, id, profile.email, Date.now());
    return id;
  });
  auth.startSession(req, res, userId);
  res.setHeader('set-cookie', [String(res.getHeader('set-cookie') || ''), clearState].filter(Boolean));
  return back(res, 'account?welcome=1');
}

/** Returns true when the request was handled here. @param {Req} req @param {Res} res @param {URL} url */
async function handle(req, res, url) {
  const m = url.pathname.match(/^\/auth\/(google|discord)\/(start|callback)$/);
  if (!m || req.method !== 'GET') return false;
  const provider = /** @type {ProviderName} */ (m[1]);
  if (m[2] === 'start') start(req, res, provider, url);
  else await callback(req, res, provider, url);
  return true;
}

module.exports = { handle, enabledProviders };
