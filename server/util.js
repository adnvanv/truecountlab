// Shared HTTP helpers: responses, JSON bodies, cookies, client IPs, rate limits, origin checks.
'use strict';

const PUBLIC_HOST = process.env.PUBLIC_HOST || 'truecountlab.com';
const PUBLIC_ORIGIN = `https://${PUBLIC_HOST}`;

// Requests from the public internet arrive through Cloudflare Tunnel, and Cloudflare's
// edge always sets CF-Connecting-IP (visitors can't strip it). Requests without it come
// straight over the private network (Tailscale) or from this machine.
const viaCloudflare = (req) => typeof req.headers['cf-connecting-ip'] === 'string';

const clientIp = (req) => (viaCloudflare(req) ? req.headers['cf-connecting-ip'] : req.socket.remoteAddress) || 'unknown';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), geolocation=(), payment=()',
  // Cloudflare Web Analytics (cookieless visitor counts) is injected by Cloudflare's edge.
  'content-security-policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function send(res, code, body, type = 'text/plain; charset=utf-8', extra = {}) {
  res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store', ...extra });
  res.end(body);
}

const json = (res, code, obj, extra = {}) => send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8', extra);
const fail = (res, code, error, extra = {}) => json(res, code, { error, ...extra });

function redirect(res, location, extra = {}) {
  res.writeHead(302, { ...SECURITY_HEADERS, location, 'cache-control': 'no-store', ...extra });
  res.end();
}

// Read a JSON request body (objects only), capped in size.
function readJson(req, max = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const type = String(req.headers['content-type'] || '');
    if (!type.startsWith('application/json')) return reject(Object.assign(new Error('Expected JSON'), { status: 415 }));
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > max) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Expected an object');
        resolve(v);
      } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

// Cookies are Secure on the public https site; over the private network (plain http)
// browsers would drop a Secure cookie, so it's left off there.
function cookie(req, name, value, { maxAge, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly', 'SameSite=Lax'];
  if (maxAge != null) parts.push(`Max-Age=${maxAge}`);
  if (viaCloudflare(req)) parts.push('Secure');
  return parts.join('; ');
}

// Simple in-memory sliding-window limiter: allow `limit` hits per `windowMs` per key.
// Returns 0 when allowed, else seconds to wait. Pass record=false to check without counting.
function rateLimiter(limit, windowMs) {
  const hits = new Map();
  setInterval(() => {
    const cutoff = Date.now() - windowMs;
    for (const [k, list] of hits) {
      while (list.length && list[0] < cutoff) list.shift();
      if (!list.length) hits.delete(k);
    }
  }, windowMs).unref();
  return (key, record = true) => {
    const now = Date.now();
    const list = hits.get(key) || [];
    while (list.length && list[0] < now - windowMs) list.shift();
    if (list.length >= limit) { hits.set(key, list); return Math.ceil((list[0] + windowMs - now) / 1000); }
    if (record) { list.push(now); hits.set(key, list); }
    return 0;
  };
}

// Blocks cross-site form posts and scripted requests from other sites. Browsers always
// send Origin on POST/PUT/DELETE; it must be our own site.
function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients (curl, server scripts)
  const host = String(req.headers.host || '');
  return origin === PUBLIC_ORIGIN || origin === `http://${host}` || origin === `https://${host}`;
}

module.exports = {
  PUBLIC_HOST, PUBLIC_ORIGIN, SECURITY_HEADERS, viaCloudflare, clientIp,
  send, json, fail, redirect, readJson, parseCookies, cookie, rateLimiter, sameOrigin,
};
