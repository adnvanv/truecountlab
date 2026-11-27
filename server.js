// TrueCountLab server: static files, accounts, sign-in, saved progress and live play.
// No npm dependencies: Node's built-in http, crypto, fetch and node:sqlite.
// Usage: HOST=127.0.0.1 PORT=3040 node --disable-warning=ExperimentalWarning server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const U = require('./server/util');
const log = require('./server/log');
const metrics = require('./server/metrics');
const { db, DATA_DIR } = require('./server/db');
const auth = require('./server/auth');
const oauth = require('./server/oauth');
const progress = require('./server/progress');
const records = require('./server/records');
const live = require('./server/live');

/** @typedef {import('./server/types').Req} Req */
/** @typedef {import('./server/types').Res} Res */

// HOST may list several addresses, e.g. "127.0.0.1,100.64.0.5" (loopback for the
// Cloudflare tunnel plus a private-network address).
const HOSTS = String(process.env.HOST || '127.0.0.1').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT) || 3040;
const ROOT = path.join(__dirname, 'public');

/** @type {Record<string, string>} */
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.jpg': 'image/jpeg',
};

// Every deploy gets a new build id (a hash of everything in public/). Pages load their
// scripts and styles from /v/<build>/..., so a deploy changes every asset URL and no
// browser or Cloudflare cache can keep serving old code. Those URLs never change
// content, so they can be cached for a year. Pages themselves are never cached.
function buildId() {
  const hash = require('crypto').createHash('sha256');
  /** @param {string} dir */
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, name);
      if (fs.statSync(p).isDirectory()) walk(p);
      else hash.update(path.relative(ROOT, p)).update(fs.readFileSync(p));
    }
  };
  walk(ROOT);
  return hash.digest('hex').slice(0, 12);
}
const BUILD = buildId();
const COMMIT = process.env.GIT_COMMIT || ''; // set by the deploy script
const LONG_CACHE = process.env.NODE_ENV === 'production'; // local dev: always refetch
const VERSIONED = /^\/v\/([a-z0-9]{1,32})(\/.*)$/;
// Point a page's own scripts and stylesheets at this build.
/** @param {string} html */
const versionPage = (html) => html.replace(/(src|href)="(?![a-z]+:|\/|#)([^"?#]+\.(?:js|css))"/g, `$1="/v/${BUILD}/$2"`);

/** @param {Req} req @param {Res} res @param {string} pathname */
function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return U.send(res, 405, 'Method not allowed');
  let p = pathname;
  let cache = 'no-cache';
  const v = VERSIONED.exec(p);
  if (v) {
    p = v[2];
    // Only the current build is cacheable; an old id still gets today's file, uncached.
    if (v[1] === BUILD && LONG_CACHE) cache = 'public, max-age=31536000, immutable';
  }
  if (p === '/') p = '/index.html';
  if (p === '/privacy') p = '/privacy.html';
  // The Learn guides have clean URLs: /learn and /learn/<guide>, no .html and no trailing slash.
  if (/^\/learn(\/[a-z-]+)?\/$/.test(p) || /^\/learn\/[a-z-]+\.html$/.test(p)) {
    res.writeHead(301, { location: p.replace(/\/$/, '').replace(/\.html$/, '').replace(/\/index$/, '') });
    return res.end();
  }
  if (p === '/learn') p = '/learn/index.html';
  else if (/^\/learn\/[a-z-]+$/.test(p)) p += '.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) return U.send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return U.send(res, 404, 'Not found');
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    if (path.extname(file) === '.html') {
      return fs.readFile(file, 'utf8', (err2, html) => {
        if (err2) return U.send(res, 500, 'Could not read the page');
        const body = Buffer.from(versionPage(html));
        res.writeHead(200, { ...U.SECURITY_HEADERS, 'content-type': type, 'content-length': body.length, 'cache-control': 'no-cache' });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    }
    res.writeHead(200, { ...U.SECURITY_HEADERS, 'content-type': type, 'content-length': st.size, 'cache-control': cache });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Health: the process is up and the database answers. Used by the deploy script
// (it rolls back if this fails after a deploy) and by uptime monitors.
/** @param {Res} res */
function health(res) {
  let dbOk = false;
  try { dbOk = db.prepare('SELECT 1 AS ok').get()?.ok === 1; } catch { /* reported below */ }
  U.json(res, dbOk ? 200 : 503, { status: dbOk ? 'ok' : 'degraded', db: dbOk ? 'ok' : 'error', build: BUILD, commit: COMMIT, uptime: Math.round(process.uptime()), backups: backupStatus() });
}

/**
 * What deploy/backup-status.sh found on its last hourly run, with times turned into ages.
 * Backups don't change `status`: the app is healthy either way, and deploys wait on it.
 * The Uptime workflow alerts on these fields instead.
 * @returns {{ checkedMinAgo: number, localHoursAgo: number | null, replica: string, detail?: string } | null}
 */
function backupStatus() {
  /** @type {{ checked?: string, local?: string, replica?: string, detail?: string }} */
  let s;
  try { s = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'backup-status.json'), 'utf8')); } catch { return null; }
  const ago = (/** @type {string | undefined} */ iso, /** @type {number} */ unit) => (iso && Number.isFinite(Date.parse(iso)) ? Math.round(((Date.now() - Date.parse(iso)) / unit) * 10) / 10 : null);
  return {
    checkedMinAgo: ago(s.checked, 60e3) ?? -1,
    localHoursAgo: ago(s.local, 3600e3),
    replica: String(s.replica || 'unknown'),
    ...(s.detail ? { detail: String(s.detail) } : {}),
  };
}

const httpRequests = metrics.counter('http_requests_total', 'HTTP requests by route group and status class.');
const httpSeconds = metrics.histogram('http_request_duration_seconds', 'HTTP response time by route group.', [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]);

/** Group paths for metrics, so one series per kind of request, not per URL. @param {string} p */
const routeGroup = (p) => (p.startsWith('/api/') ? `/api/${p.split('/')[2]}` : p.startsWith('/auth/') ? '/auth' : p === '/healthz' || p === '/metrics' ? p : 'static');

/** @param {Req} req @param {Res} res */
async function handle(req, res) {
  const t0 = process.hrtime.bigint();
  /** @type {URL} */
  let url;
  try { url = new URL(req.url || '/', 'http://x'); url.pathname = decodeURIComponent(url.pathname); } catch { return U.send(res, 400, 'Bad request'); }
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    const group = routeGroup(url.pathname);
    httpRequests.inc({ route: group, status: `${Math.floor(res.statusCode / 100)}xx` });
    httpSeconds.observe(ms / 1000, { route: group });
    // API calls are logged at info; static files only at debug (there are a lot of them).
    const level = group === 'static' || group === '/healthz' || group === '/metrics' ? 'debug' : res.statusCode >= 500 ? 'error' : 'info';
    if (log.enabled(level)) log[level]('http', { method: req.method, path: url.pathname, status: res.statusCode, ms: Math.round(ms * 10) / 10 });
  });

  if (U.viaCloudflare(req)) {
    // Public traffic: one canonical https address, no www.
    const host = String(req.headers.host || '').toLowerCase();
    let proto = 'https';
    try { proto = JSON.parse(String(req.headers['cf-visitor'] || '{}')).scheme || proto; } catch { /* keep https */ }
    if (host !== U.PUBLIC_HOST || proto !== 'https') {
      res.writeHead(301, { location: `${U.PUBLIC_ORIGIN}${req.url}` });
      return res.end();
    }
    res.setHeader('strict-transport-security', 'max-age=31536000');
  }

  if (url.pathname === '/healthz') return health(res);
  if (url.pathname === '/metrics') {
    // The server itself and the private network only: never published through Cloudflare.
    if (U.viaCloudflare(req)) return U.send(res, 404, 'Not found');
    return U.send(res, 200, metrics.render({ ...live.gauges(), ...prefixed(records.usage()) }), 'text/plain; version=0.0.4; charset=utf-8');
  }
  if (url.pathname === '/api/online' && req.method === 'GET') return U.json(res, 200, live.stats());

  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
  if (isApi) {
    if (!['GET', 'HEAD'].includes(String(req.method)) && !U.sameOrigin(req)) return U.fail(res, 403, 'Cross-site request blocked.');
    try {
      if (await auth.handle(req, res, url)) return;
      if (await oauth.handle(req, res, url)) return;
      if (await progress.handle(req, res, url)) return;
      if (await records.handle(req, res, url, auth.currentUser)) return;
    } catch (e) {
      if (res.headersSent) return res.end();
      const status = /** @type {{ status?: number }} */ (e).status;
      if (status) return U.fail(res, status, /** @type {Error} */ (e).message);
      log.error('request failed', { method: req.method, path: url.pathname, err: e });
      return U.fail(res, 500, 'Something went wrong. Please try again.');
    }
    return U.fail(res, 404, 'Not found');
  }
  return serveStatic(req, res, url.pathname);
}

/** Usage counters as gauges: usage_hands_dealt etc. @param {Record<string, number>} u */
const prefixed = (u) => Object.fromEntries(Object.entries(u).map(([k, v]) => [`usage_${k}`, v]));

/** @type {http.Server[]} */
const servers = [];
// One listener per address. If an address isn't up yet (say the private network is
// still connecting at boot), keep retrying it without taking the others down.
/** @param {string} host */
function listen(host) {
  const server = http.createServer(handle);
  server.on('upgrade', (req, socket, head) => live.upgrade(req, /** @type {import('net').Socket} */ (socket), head)); // live play at /ws
  server.on('error', (/** @type {NodeJS.ErrnoException} */ err) => {
    log.warn('listen failed, retrying in 5s', { host, port: PORT, code: err.code });
    setTimeout(() => listen(host), 5000);
  });
  server.listen(PORT, host, () => log.info('listening', { url: `http://${host}:${PORT}`, build: BUILD, commit: COMMIT, node: process.version }));
  servers.push(server);
}
HOSTS.forEach(listen);

// systemd stops the service with SIGTERM on every deploy: stop taking new connections,
// tell live players, and exit. The database needs no flushing (every write is committed).
let stopping = false;
for (const sig of /** @type {const} */ (['SIGTERM', 'SIGINT'])) {
  process.on(sig, () => {
    if (stopping) return;
    stopping = true;
    log.info('shutting down', { signal: sig });
    live.shutdown();
    try { records.flush(); } catch (e) { log.error('saving usage counters failed', { err: e }); }
    for (const s of servers) s.close();
    setTimeout(() => process.exit(0), 500).unref();
  });
}
process.on('unhandledRejection', (err) => log.error('unhandled rejection', { err }));
