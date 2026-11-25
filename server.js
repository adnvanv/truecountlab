// TrueCountLab server: static files, accounts, sign-in and saved progress.
// No npm dependencies: Node's built-in http, crypto, fetch and node:sqlite.
// Usage: HOST=127.0.0.1 PORT=3040 node --disable-warning=ExperimentalWarning server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const U = require('./server/util');
const auth = require('./server/auth');
const oauth = require('./server/oauth');
const progress = require('./server/progress');

// HOST may list several addresses, e.g. "127.0.0.1,100.64.0.5" (loopback for the
// Cloudflare tunnel plus a private-network address).
const HOSTS = String(process.env.HOST || '127.0.0.1').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT) || 3040;
const ROOT = path.join(__dirname, 'public');

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
};

function serveStatic(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return U.send(res, 405, 'Method not allowed');
  let p = pathname;
  if (p === '/') p = '/index.html';
  if (p === '/privacy') p = '/privacy.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) return U.send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return U.send(res, 404, 'Not found');
    res.writeHead(200, {
      ...U.SECURITY_HEADERS,
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

async function handle(req, res) {
  let url;
  try { url = new URL(req.url || '/', 'http://x'); url.pathname = decodeURIComponent(url.pathname); } catch { return U.send(res, 400, 'Bad request'); }

  if (U.viaCloudflare(req)) {
    // Public traffic: one canonical https address, no www.
    const host = String(req.headers.host || '').toLowerCase();
    let proto = 'https';
    try { proto = JSON.parse(req.headers['cf-visitor'] || '{}').scheme || proto; } catch { /* keep https */ }
    if (host !== U.PUBLIC_HOST || proto !== 'https') {
      res.writeHead(301, { location: `${U.PUBLIC_ORIGIN}${req.url}` });
      return res.end();
    }
    res.setHeader('strict-transport-security', 'max-age=31536000');
  }

  if (url.pathname === '/healthz') return U.send(res, 200, 'ok');

  const isApi = url.pathname.startsWith('/api/') || url.pathname.startsWith('/auth/');
  if (isApi) {
    if (!['GET', 'HEAD'].includes(req.method) && !U.sameOrigin(req)) return U.fail(res, 403, 'Cross-site request blocked.');
    try {
      if (await auth.handle(req, res, url)) return;
      if (await oauth.handle(req, res, url)) return;
      if (await progress.handle(req, res, url)) return;
    } catch (e) {
      if (res.headersSent) return res.end();
      if (e.status) return U.fail(res, e.status, e.message);
      console.error(`${req.method} ${url.pathname}:`, e);
      return U.fail(res, 500, 'Something went wrong. Please try again.');
    }
    return U.fail(res, 404, 'Not found');
  }
  return serveStatic(req, res, url.pathname);
}

// One listener per address. If an address isn't up yet (say the private network is
// still connecting at boot), keep retrying it without taking the others down.
function listen(host) {
  const server = http.createServer(handle);
  server.on('error', (err) => {
    console.error(`Can't listen on ${host}:${PORT} (${err.code}); retrying in 5s`);
    setTimeout(() => listen(host), 5000);
  });
  server.listen(PORT, host, () => console.log(`TrueCountLab listening on http://${host}:${PORT}`));
}
HOSTS.forEach(listen);
