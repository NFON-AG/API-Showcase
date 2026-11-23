// Shared local-server boundary. Copied into each standalone app by sync-shared.
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');

function parseEnvValue(raw) {
  const text = String(raw).trim();
  if (text[0] === '"' || text[0] === "'") {
    const quote = text[0];
    let end = -1;
    for (let index = 1; index < text.length; index++) {
      if (text[index] === '\\') { index++; continue; }
      if (text[index] === quote) { end = index; break; }
    }
    if (end === -1 || !/^\s*(?:#.*)?$/.test(text.slice(end + 1))) throw new Error('Invalid quoted environment value');
    return text.slice(1, end);
  }
  return text.replace(/#.*$/, '').trim();
}

function parseEnvFlag(name, raw, fallback = false) {
  if (raw === undefined) return fallback;
  // Env files are parsed by their loader. Parsing again would mistake a literal
  // hash inside a quoted value for a comment and silently accept an invalid flag.
  const value = String(raw).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(value)) return true;
  if (['false', '0', 'no', 'off'].includes(value)) return false;
  throw new Error(`Invalid boolean configuration: ${name}`);
}

// Parse a whole file before applying it. Shell-provided values keep precedence,
// but a duplicate key inside a file is always ambiguous and must be rejected.
function loadEnvFile(file, env = process.env) {
  if (!file || !fsSync.existsSync(file)) return false;
  const values = new Map();
  for (const [index, line] of fsSync.readFileSync(file, 'utf8').split(/\r?\n/).entries()) {
    const text = line.trim().replace(/^export\s+/, '');
    if (!text || text.startsWith('#')) continue;
    const separator = text.indexOf('=');
    if (separator < 0) continue;
    const key = text.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    if (values.has(key)) throw new Error(`Duplicate environment key: ${key} on lines ${values.get(key).line} and ${index + 1}`);
    let value;
    try { value = parseEnvValue(text.slice(separator + 1)); }
    catch { throw new Error(`Invalid environment configuration: ${key} on line ${index + 1}`); }
    values.set(key, { value, line: index + 1 });
  }
  for (const [key, { value }] of values) if (!Object.hasOwn(env, key)) env[key] = value;
  return true;
}

// Resolve both paths before reading: a lexical containment test alone follows
// symlinks outside the public directory. Never expose their target or contents.
async function readPublicFile(publicDir, file) {
  const [root, resolved] = await Promise.all([fs.realpath(publicDir), fs.realpath(file)]);
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) {
    throw Object.assign(new Error('Forbidden'), { code: 'EACCES' });
  }
  return fs.readFile(resolved);
}

function isLoopback(address) {
  return address === '::1' || /^127\./.test(address || '') || /^::ffff:127\./i.test(address || '');
}

function errorResponse(res, status, error) {
  if (res.headersSent) { res.end(); return; }
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ ok: false, error }));
}

function guardRequest(req, res, { framePaths = [] } = {}) {
  const embedded = framePaths.includes((req.url || '').split('?')[0]);
  res.setHeader('Content-Security-Policy', `frame-ancestors ${embedded ? "'self'" : "'none'"}; object-src 'none'; base-uri 'self'`);
  res.setHeader('X-Frame-Options', embedded ? 'SAMEORIGIN' : 'DENY');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  let allowRemote;
  try { allowRemote = parseEnvFlag('NFON_ALLOW_REMOTE', process.env.NFON_ALLOW_REMOTE); }
  catch { errorResponse(res, 503, 'Invalid remote-access configuration'); return false; }
  if (!allowRemote && !isLoopback(req.socket.remoteAddress)) {
    errorResponse(res, 403, 'Local access required'); return false;
  }
  const authority = req.headers.host;
  let host;
  try {
    if (typeof authority !== 'string' || /[\s/@\\?#]/.test(authority)) throw new Error();
    host = new URL(`http://${authority}`);
    const port = Number(host.port || 80);
    if (port !== req.socket.localPort) throw new Error();
    const allowed = new Set(['localhost', '127.0.0.1', '[::1]']);
    for (const name of String(process.env.NFON_ALLOWED_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)) allowed.add(name);
    if (!allowed.has(host.hostname.toLowerCase())) throw new Error();
  } catch { errorResponse(res, 403, 'Host not allowed'); return false; }
  if ((req.url || '').length > 4096) { errorResponse(res, 414, 'Request URL too long'); return false; }
  try {
    if (!req.url.startsWith('/') || req.url.startsWith('//') || req.url.includes('\\')) throw new Error();
    const decoded = decodeURIComponent(req.url);
    if (/[\u0000-\u001f\u007f]/.test(decoded)) throw new Error();
  } catch { errorResponse(res, 400, 'Invalid request URL'); return false; }

  if (req.url.split('?')[0] === '/api/ui-config' && req.method === 'GET') {
    let cockpitUrl = '';
    try {
      const url = new URL(process.env.NFON_COCKPIT_URL || '');
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) cockpitUrl = url.href;
    } catch { /* Standalone app. */ }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ cockpitUrl })); return false;
  }

  // A random, persisted owner token lets a restarted cockpit manage only its
  // own child. No PID-based signaling of unrelated or recycled processes.
  if (req.url.split('?')[0] === '/api/_service') {
    const expected = process.env.NFON_SERVICE_TOKEN || '';
    const supplied = req.headers['x-nfon-service-token'];
    const valid = expected.length >= 32 && typeof supplied === 'string' && Buffer.byteLength(supplied) === Buffer.byteLength(expected)
      && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!isLoopback(req.socket.remoteAddress) || !valid) { errorResponse(res, 403, 'Service ownership required'); return false; }
    if (!['GET', 'DELETE'].includes(req.method)) { errorResponse(res, 405, 'Method not allowed'); return false; }
    res.writeHead(req.method === 'DELETE' ? 202 : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ ok: true, id: process.env.NFON_SERVICE_ID, pid: process.pid }));
    if (req.method === 'DELETE') setTimeout(() => process.kill(process.pid, 'SIGTERM'), 30).unref();
    return false;
  }
  return true;
}

function requestUrl(req) {
  return new URL(req.url, 'http://localhost');
}

function staticCacheControl(url) {
  const parsed = new URL(url, 'http://localhost');
  return /\.(?:js|css|svg|png|jpe?g|webp|woff2?)$/i.test(parsed.pathname) && parsed.searchParams.has('v')
    ? 'public, max-age=31536000, immutable' : 'no-cache';
}

module.exports = { parseEnvValue, parseEnvFlag, loadEnvFile, readPublicFile, isLoopback, errorResponse, guardRequest, requestUrl, staticCacheControl };
