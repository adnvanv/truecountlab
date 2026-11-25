// Zero-dependency static server + tiny JSON state API for the count trainer.
// Usage: HOST=127.0.0.1 PORT=3040 node server.js
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');

// HOST may list several addresses, e.g. "127.0.0.1,100.64.0.5" (loopback for the
// Cloudflare tunnel plus a private-network address).
const HOSTS = String(process.env.HOST || '127.0.0.1').split(',').map((s) => s.trim()).filter(Boolean);
const PORT = Number(process.env.PORT) || 3040;
const ROOT = path.join(__dirname, 'public');
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_BODY = 1024 * 1024;

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

const PUBLIC_HOST = process.env.PUBLIC_HOST || 'truecountlab.com';

// Requests from the public internet arrive through Cloudflare Tunnel, and Cloudflare's
// edge always sets CF-Connecting-IP (visitors can't strip it). Requests without it come
// straight over the private network (Tailscale) or from this machine.
const viaCloudflare = (req) => typeof req.headers['cf-connecting-ip'] === 'string';

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-frame-options': 'DENY',
  'permissions-policy': 'camera=(), geolocation=(), payment=()',
  // Cloudflare Web Analytics (cookieless visitor counts) is injected by Cloudflare's edge.
  'content-security-policy': "default-src 'self'; script-src 'self' https://static.cloudflareinsights.com; connect-src 'self' https://cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

function send(res, code, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(code, { ...SECURITY_HEADERS, 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
}

function handleState(req, res) {
  if (req.method === 'GET') {
    fs.readFile(STATE_FILE, 'utf8', (err, txt) => send(res, 200, err ? '{}' : txt, TYPES['.json']));
    return;
  }
  if (req.method !== 'PUT' && req.method !== 'POST') return send(res, 405, 'Method not allowed');
  let size = 0;
  const chunks = [];
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { send(res, 413, 'Too large'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    let parsed;
    try { parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, 'Bad JSON'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return send(res, 400, 'Expected object');
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.${process.pid}.tmp`;
    fs.writeFile(tmp, JSON.stringify(parsed), (err) => {
      if (err) return send(res, 500, 'Write failed');
      fs.rename(tmp, STATE_FILE, (err2) => (err2 ? send(res, 500, 'Write failed') : send(res, 204, '')));
    });
  });
}

function handleStatic(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed');
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { return send(res, 400, 'Bad request'); }
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, 'Forbidden');
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, 'Not found');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'content-length': st.size,
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

function handle(req, res) {
    const url = req.url || '/';
    if (viaCloudflare(req)) {
      // Public traffic: one canonical https address, no www.
      const host = String(req.headers.host || '').toLowerCase();
      let proto = 'https';
      try { proto = JSON.parse(req.headers['cf-visitor'] || '{}').scheme || proto; } catch { /* keep https */ }
      if (host !== PUBLIC_HOST || proto !== 'https') {
        res.writeHead(301, { location: `https://${PUBLIC_HOST}${url}` });
        return res.end();
      }
      res.setHeader('strict-transport-security', 'max-age=31536000');
    }
    if (url === '/api/state' || url.startsWith('/api/state?')) {
      // The shared save file has no login yet, so only the private network may use it.
      // Public visitors save progress in their own browser until accounts arrive.
      if (viaCloudflare(req)) return send(res, 404, '{"error":"Accounts are coming soon"}', TYPES['.json']);
      return handleState(req, res);
    }
    if (url === '/healthz') return send(res, 200, 'ok');
    return handleStatic(req, res);
}

// One listener per address. If an address isn't up yet (say the private network is
// still connecting at boot), keep retrying it without taking the others down.
function listen(host) {
  const server = http.createServer(handle);
  server.on('error', (err) => {
    console.error(`Can't listen on ${host}:${PORT} (${err.code}); retrying in 5s`);
    setTimeout(() => listen(host), 5000);
  });
  server.listen(PORT, host, () => console.log(`Count trainer listening on http://${host}:${PORT}`));
}
HOSTS.forEach(listen);
