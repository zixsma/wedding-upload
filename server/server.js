// Web server: serves the page and the three small JSON calls it makes.
// Photo/video bytes never come through here; the browser sends them straight to Google Drive.

import http from 'node:http';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

try { process.loadEnvFile(); } catch { /* no .env file: settings come from the environment */ }

const { startUpload, listMedia, listUploaders, PublicError } = await import('./drive.js');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const API = { startUpload, listMedia, listUploaders };

// Static files, loaded once at start.
const STATIC = {
  '/': file('public/index.html', 'text/html; charset=utf-8', 'no-cache'),
  '/photos/grownups.webp': file('photos/grownups.webp', 'image/webp', 'public, max-age=86400'),
  '/photos/kids.webp': file('photos/kids.webp', 'image/webp', 'public, max-age=86400'),
};
STATIC['/index.html'] = STATIC['/'];

function file(rel, type, cacheControl) {
  let body = readFileSync(path.join(ROOT, rel));
  if (type.startsWith('text/')) {
    // Link previews (LINE, Facebook) need a full image URL.
    const origin = (process.env.PUBLIC_ORIGIN || '').split(',')[0].trim().replace(/\/+$/, '');
    body = Buffer.from(body.toString('utf8').replaceAll('__ORIGIN__', origin));
  }
  return { body, gz: type.startsWith('text/') ? gzipSync(body) : null, type, cacheControl };
}

// Generous per-IP limit. Guests at the venue may all share one Wi-Fi IP.
const LIMIT = Number(process.env.RATE_LIMIT_PER_10MIN) || 5000;
const hits = new Map();
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();
function limited(ip) {
  const n = (hits.get(ip) || 0) + 1;
  hits.set(ip, n);
  return n > LIMIT;
}

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');

  if (req.method === 'GET' || req.method === 'HEAD') {
    if (url.pathname === '/healthz') return send(res, 200, 'text/plain', 'ok');
    const f = STATIC[url.pathname];
    if (!f) return send(res, 404, 'text/plain', 'Not found');
    const useGz = f.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': f.type,
      'Cache-Control': f.cacheControl,
      Vary: 'Accept-Encoding',
      ...(useGz ? { 'Content-Encoding': 'gzip' } : {}),
    });
    return res.end(req.method === 'HEAD' ? undefined : useGz ? f.gz : f.body);
  }

  const m = /^\/api\/(\w+)$/.exec(url.pathname);
  if (req.method !== 'POST' || !m || !Object.hasOwn(API, m[1])) {
    return send(res, 404, 'text/plain', 'Not found');
  }

  const ip = req.headers['cf-connecting-ip'] || req.socket.remoteAddress || '';
  if (limited(ip)) return json(res, 429, { ok: false, error: 'Too many requests. Please wait a few minutes.' });

  let arg;
  try {
    arg = JSON.parse((await readBody(req, 10 * 1024)) || '{}');
  } catch {
    return json(res, 400, { ok: false, error: 'Bad request.' });
  }

  try {
    const data = await API[m[1]](arg);
    json(res, 200, { ok: true, data });
  } catch (e) {
    if (!(e instanceof PublicError)) console.error(m[1], e);
    json(res, e instanceof PublicError ? 400 : 500, {
      ok: false,
      error: e instanceof PublicError ? e.message : 'Something went wrong. Please try again.',
    });
  }
});

function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size <= max) chunks.push(c); // keep reading (and dropping) the rest so we can still reply
    });
    req.on('end', () => size > max ? reject(new Error('too big')) : resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, obj) {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj), { 'Cache-Control': 'no-store' });
}

function send(res, status, type, body, extra = {}) {
  res.writeHead(status, { ...SECURITY_HEADERS, 'Content-Type': type, ...extra });
  res.end(body);
}

server.listen(PORT, () => console.log(`Wedding album on http://localhost:${PORT}`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); server.closeAllConnections(); });
