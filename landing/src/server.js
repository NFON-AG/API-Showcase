const http = require("http");
const https = require("https");
const net = require("net");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");
const { loadEnvFile, parseEnvFlag, readPublicFile, guardRequest, requestUrl, isLoopback, errorResponse, staticCacheControl } = require('./server-safety.cjs');

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const APP_ROUTES = new Set(["/", "/combined/"]);
const PORTAL_OPTIONAL_ENDPOINT_ERRORS = new Set(["version", "basicData", "contract", "featureStatus"]);
const APP_CONFIG_NAME = "landing";

function resolveMaybeRelative(file) {
  if (!file) return "";
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

function defaultLocalConfigDir() {
  const home = process.env.HOME || process.env.USERPROFILE || "";
  return home ? path.join(home, ".config", "nfon-api-showcase") : "";
}

function configuredLocalConfigDir() {
  const explicit = resolveMaybeRelative(process.env.NFON_SHOWCASE_CONFIG_DIR || "");
  if (explicit) return explicit;
  const fallback = defaultLocalConfigDir();
  return fs.existsSync(fallback) ? fallback : "";
}

function loadLocalEnv() {
  const configDir = configuredLocalConfigDir();
  const candidates = [
    resolveMaybeRelative(process.env.LANDING_ENV_FILE || ""),
    path.join(ROOT, ".env"),
    configDir ? path.join(configDir, "env", `${APP_CONFIG_NAME}.env`) : "",
  ];
  candidates.find(file => loadEnvFile(file));
}

let SERVICE_CONTROL_ENABLED;
try {
  loadLocalEnv();
  SERVICE_CONTROL_ENABLED = parseEnvFlag('LANDING_ENABLE_SERVICE_CONTROL', process.env.LANDING_ENABLE_SERVICE_CONTROL);
} catch (error) {
  console.error('Cockpit configuration error: ' + error.message);
  process.exit(1);
}
const startedChildren = new Map();
const childHandles = new Map();
const readyChildren = new WeakSet();
const serviceFailures = new Map();
const serviceActions = new Map();
let ownershipWrite = Promise.resolve();

// CSRF token for state-changing endpoints (start/stop/upstream). Served via
// /api/status and required back as X-CSRF-Token. Combined with the same-origin
// (Sec-Fetch-Site / Origin) check this blocks cross-site POSTs to the loopback cockpit.
const CSRF_TOKEN = crypto.randomBytes(32).toString("hex");

const DEFAULT_UPSTREAMS = {
  cti: "http://127.0.0.1:3002",
  portal: "http://127.0.0.1:3001",
  "core-history": "http://127.0.0.1:3000",
};

const ENV_UPSTREAMS = {
  cti: process.env.CTI_UPSTREAM || "",
  portal: process.env.PORTAL_UPSTREAM || "",
  "core-history": process.env.CORE_HISTORY_UPSTREAM || process.env.CALL_HISTORY_UPSTREAM || "",
};

const SERVICE_META = {
  cti: {
    name: "NFON CTI API",
    route: "/cti/",
    statusPath: "/api/status",
    cwd: path.resolve(ROOT, "..", "CTI_API"),
  },
  portal: {
    name: "NFON Portal API",
    route: "/portal/",
    statusPath: "/api/status",
    cwd: path.resolve(ROOT, "..", "Portal_API"),
  },
  "core-history": {
    name: "NFON Call History API",
    route: "/call-history/",
    statusPath: "/api/status",
    cwd: path.resolve(ROOT, "..", "CallHistory_API"),
  },
};

function overridesFile() {
  const base = resolveMaybeRelative(process.env.NFON_SHOWCASE_CONFIG_DIR || "") || defaultLocalConfigDir();
  return base ? path.join(base, "landing-upstreams.json") : "";
}

// Normalize a user-supplied upstream to an http/https origin, or "" to clear an
// override, or null if the value is not a usable URL.
function normalizeUpstream(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname || parsed.username || parsed.password) return null;
  return parsed.origin;
}

function loadUpstreamOverrides() {
  const file = overridesFile();
  if (!file || !fs.existsSync(file)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    const clean = {};
    for (const id of Object.keys(SERVICE_META)) {
      const normalized = normalizeUpstream(parsed?.[id]);
      if (normalized) clean[id] = normalized;
    }
    return clean;
  } catch {
    return {};
  }
}

let upstreamOverrides = loadUpstreamOverrides();
let upstreamSaveQueue = Promise.resolve();

async function saveUpstreamOverrides(candidate) {
  const file = overridesFile();
  if (!file) throw new Error('Upstream storage is unavailable.');
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  // Respect an explicitly read-only configuration even though rename would
  // otherwise replace it whenever the containing directory is writable.
  await fsp.access(file, fs.constants.W_OK).catch(error => { if (error.code !== 'ENOENT') throw error; });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    await fsp.writeFile(temporary, JSON.stringify(candidate, null, 2), { mode: 0o600 });
    await fsp.rename(temporary, file);
  } catch (error) {
    // A successful rename already removed the temporary pathname and committed
    // the save. Cleanup is only needed after failure and must keep its cause.
    await fsp.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

function effectiveUpstream(id) {
  return upstreamOverrides[id] || ENV_UPSTREAMS[id] || DEFAULT_UPSTREAMS[id] || "";
}

function upstreamSource(id) {
  if (upstreamOverrides[id]) return "override";
  if (ENV_UPSTREAMS[id]) return "env";
  return "default";
}

function portForUpstream(upstream, fallback) {
  try {
    const explicit = new URL(upstream).port;
    if (explicit) return explicit;
    return new URL(upstream).protocol === 'https:' ? '443' : '80';
  } catch {
    /* fall through to default */
  }
  return String(fallback);
}

// Back-compat accessor: current effective upstreams keyed by service id.
const UPSTREAMS = {
  get cti() { return effectiveUpstream("cti"); },
  get portal() { return effectiveUpstream("portal"); },
  get ["core-history"]() { return effectiveUpstream("core-history"); },
};

const MIME_TYPES = {
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml; charset=utf-8",
  ".ico": "image/x-icon",
};

function corsHeaders(headers = {}) {
  return {
    "Access-Control-Allow-Origin": process.env.LANDING_ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || 3010}`,
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    ...headers,
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, corsHeaders({
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  }));
  res.end(JSON.stringify(body, null, 2));
}

function isInsidePublic(file) {
  const relative = path.relative(PUBLIC_DIR, file);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function fileForRequest(urlPath) {
  const cleanPath = decodeURIComponent(urlPath);
  if (APP_ROUTES.has(cleanPath)) return path.join(PUBLIC_DIR, "index.html");
  return path.join(PUBLIC_DIR, cleanPath.replace(/^\/+/, ""));
}

function appRouteForPath(pathname) {
  if (pathname === "/cti" || pathname.startsWith("/cti/")) return "cti";
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return "portal";
  if (pathname === "/core-history" || pathname.startsWith("/core-history/")) return "core-history";
  if (pathname === "/call-history" || pathname.startsWith("/call-history/")) return "core-history";
  return "";
}

function upstreamLocation(appId, pathname, search, cockpit) {
  const upstream = UPSTREAMS[appId];
  if (!upstream) return "";
  const prefix = pathname.startsWith("/call-history")
    ? "/call-history"
    : `/${appId}`;
  let upstreamPath = pathname === prefix ? "/" : pathname.slice(prefix.length) || "/";
  if (!upstreamPath.startsWith("/")) upstreamPath = `/${upstreamPath}`;
  const target = new URL(upstream);
  target.pathname = upstreamPath;
  target.search = search;
  if (cockpit) target.searchParams.set('cockpit', cockpit);
  return target.toString();
}

function redirectToUpstream(res, location) {
  res.writeHead(302, {
    "Location": location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function healthUrl(id) {
  return new URL(SERVICE_META[id].statusPath, effectiveUpstream(id)).toString();
}

function classifyHealth(id, payload, responseOk) {
  if (payload?.appId !== id) return { health: 'warning', detail: 'Unexpected service on this address.', detailKey: 'landing.unexpectedService', reason: 'unexpected-service' };
  if (!responseOk) {
    return {
      health: "warning",
      detail: "Status endpoint available with a warning.", detailKey: "landing.statusNotice",
    };
  }

  if (id === "cti") {
    if (!payload.credentialsConfigured && !payload.demo) return { health: 'auth-required', detail: 'Sign in required', detailKey: 'shared.authRequired' };
    const callsConnected = payload.streams?.calls?.connected;
    const statesConnected = payload.streams?.states?.connected;
    if (payload.credentialsConfigured && callsConnected && statesConnected) {
      return {
        health: "online",
        detail: "Live streams connected.", detailKey: "landing.streamsConnected",
      };
    }
    return {
      health: "warning",
      detail: "App available; a live stream or credential is missing.", detailKey: "landing.streamMissing",
    };
  }

  if (id === "portal") {
    const connectionState = payload.connection?.state;
    if ((payload.connection?.authenticationRequired || ['unconfigured', 'auth-required'].includes(connectionState))) return { health: 'auth-required', detail: 'Sign in required', detailKey: 'shared.authRequired' };
    if (connectionState) {
      const details = {
        connected: "Portal data connected.",
        partial: "Portal data partially available.",
        unavailable: "Portal API connection failed.",
        unchecked: "Portal connection not checked yet.",
        unconfigured: "App available; configuration incomplete.",
      };
      return {
        health: connectionState === "connected" ? "online" : "warning",
        detail: details[connectionState] || 'App available; status needs review.',
        detailKey: ({connected:'landing.portalConnected',partial:'landing.portalPartial',unavailable:'landing.portalUnavailable',unchecked:'landing.portalUnchecked',unconfigured:'landing.configIncomplete'})[connectionState] || 'landing.statusReview',
      };
    }
    const blockingErrors = Object.keys(payload.cache?.errors || {})
      .filter((key) => !PORTAL_OPTIONAL_ENDPOINT_ERRORS.has(key));
    if (payload.ok && payload.configured && blockingErrors.length === 0 && payload.cache?.syncedAt) {
      return {
        health: "online",
        detail: "Portal data connected.", detailKey: "landing.portalConnected",
      };
    }
    if (payload.ok && payload.configured) {
      return {
        health: "warning",
        detail: blockingErrors.length ? "App available; cache reports warnings." : "Portal connection not checked yet.",
        detailKey: blockingErrors.length ? "landing.cacheNotice" : "landing.portalUnchecked",
      };
    }
    return {
      health: "warning",
      detail: "App available; configuration incomplete.", detailKey: "landing.configIncomplete",
    };
  }

  if (id === "core-history") {
    if (payload.ok && !payload.authenticated && !payload.demo) return { health: 'auth-required', detail: 'Sign in required', detailKey: 'shared.authRequired' };
    if (payload.ok && payload.configured && payload.authenticated) {
      return {
        health: "online",
        detail: "OAuth active and history ready.", detailKey: "landing.historyReady",
      };
    }
    if (payload.ok) {
      return {
        health: "warning",
        detail: "App available; login or configuration pending.", detailKey: "landing.loginPending",
      };
    }
  }

  return {
    health: "warning",
    detail: "App available; status needs review.", detailKey: "landing.statusReview",
  };
}

// Own the socket and the total deadline: aborted fetch body readers can stall
// on supported Node versions. Always destroy rejected or unfinished responses.
function requestStatusJson(url, headers = {}, timeoutMs = 1400) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === 'https:' ? https : http;
    let response, settled = false, status = null;
    const finish = (error, result) => {
      if (settled) return;
      settled = true; clearTimeout(timer);
      response?.destroy(); request.destroy();
      if (error) reject(Object.assign(error, { httpStatus: status })); else resolve(result);
    };
    const request = transport.get(target, { headers: { Accept: 'application/json', ...headers }, agent: false }, res => {
      response = res; status = res.statusCode;
      if (status >= 300 && status < 400 || !(res.headers['content-type'] || '').includes('application/json')) return finish(new Error('invalid-response'));
      const chunks = []; let size = 0;
      res.on('data', chunk => {
        size += chunk.length;
        if (size > 256 * 1024) return finish(new Error('invalid-response'));
        chunks.push(chunk);
      });
      res.on('error', error => finish(error));
      res.on('end', () => {
        try { finish(null, { status, ok: status >= 200 && status < 300, payload: JSON.parse(Buffer.concat(chunks).toString('utf8')) }); }
        catch { finish(new Error('invalid-response')); }
      });
    });
    const timer = setTimeout(() => finish(new Error('timeout')), timeoutMs);
    request.on('error', error => finish(error));
  });
}

async function checkService(id) {
  const meta = SERVICE_META[id];
  const publicService = {
    id, name: meta.name, route: meta.route, upstream: effectiveUpstream(id),
    defaultUpstream: DEFAULT_UPSTREAMS[id], upstreamSource: upstreamSource(id),
    editable: true, managed: false, startError: serviceFailures.get(id) || '', checkedAt: new Date().toISOString(),
  };
  let result;
  try {
    const response = await requestStatusJson(healthUrl(id));
    const classification = classifyHealth(id, response.payload, response.ok);
    if (response.ok && response.payload?.appId === id) { serviceFailures.delete(id); publicService.startError = ''; }
    result = { ...publicService, httpStatus: response.status, ...classification };
  } catch (error) {
    const invalid = error.httpStatus !== null && error.httpStatus !== undefined;
    result = { ...publicService, httpStatus: error.httpStatus ?? null, health: invalid ? 'warning' : 'offline',
      reason: invalid ? 'invalid-response' : 'unavailable',
      detail: invalid ? 'The service response could not be verified.' : 'Status endpoint unavailable.',
      detailKey: invalid ? 'landing.invalidResponse' : 'landing.endpointUnavailable' };
  }
  const owned = startedChildren.get(id);
  if (owned) {
    const verified = await verifyOwnership(id);
    if (verified && childHandles.has(id)) readyChildren.add(childHandles.get(id));
    result.managed = verified && owned.upstream === effectiveUpstream(id);
    result.managedElsewhere = verified && owned.upstream !== effectiveUpstream(id);
    result.staleOwnership = !verified && !childHandles.has(id);
  }
  return result;
}

async function serviceHealth() {
  const entries = await Promise.all(
    Object.keys(SERVICE_META).map(async (id) => [id, await checkService(id)])
  );
  return Object.fromEntries(entries);
}


function ownershipFile() {
  return path.join(resolveMaybeRelative(process.env.NFON_SHOWCASE_CONFIG_DIR || '') || defaultLocalConfigDir(), 'landing-services.json');
}
function loadOwnership() {
  try {
    const stored = JSON.parse(fs.readFileSync(ownershipFile(), 'utf8'));
    for (const [id, entry] of Object.entries(stored)) {
      if (SERVICE_META[id] && typeof entry.token === 'string' && entry.token.length === 64 && normalizeUpstream(entry.upstream)) startedChildren.set(id, entry);
    }
  } catch { /* No managed services on first run. */ }
}
async function saveOwnership() {
  const write = async () => {
  const file = ownershipFile();
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = file + '.' + process.pid + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(Object.fromEntries(startedChildren)), { mode: 0o600 });
  await fsp.rename(tmp, file);
  };
  ownershipWrite = ownershipWrite.catch(() => {}).then(write);
  return ownershipWrite;
}
loadOwnership();

async function verifyOwnership(id) {
  const owned = startedChildren.get(id);
  if (!owned) return false;
  try {
    const response = await requestStatusJson(new URL('/api/_service', owned.upstream), { 'X-NFON-Service-Token': owned.token }, 1000);
    if (!response.ok) return false;
    const data = response.payload;
    return data.ok === true && data.id === id && data.pid === owned.pid;
  } catch { return false; }
}

function ownerProcessExists(owned) {
  if (!Number.isInteger(owned?.pid) || owned.pid <= 0) return false;
  try { process.kill(owned.pid, 0); return true; }
  catch (error) { return error.code !== 'ESRCH'; }
}

async function localAddressIsFree(upstream) {
  const url = new URL(upstream);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) return false;
  // A failed health request also occurs with a silent or unrelated listener.
  // Probe the socket without signaling a PID or taking ownership of that service.
  const hosts = url.hostname === 'localhost' ? ['127.0.0.1', '::1'] : [url.hostname.replace(/[\[\]]/g, '')];
  for (const host of hosts) {
    const free = await new Promise(resolve => {
      const probe = net.createServer();
      probe.once('error', () => resolve(false));
      probe.listen({ host, port: Number(url.port || 80), exclusive: true }, () => probe.close(() => resolve(true)));
    });
    if (!free) return false;
  }
  return true;
}

function controlError(id, status, error) {
  const keys = {
    'Unknown service': 'landing.unknownService', 'Service control is disabled': 'landing.controlDisabled',
    'Only local services can be controlled': 'landing.localOnly', 'A service action is already in progress': 'landing.actionPending',
    'A managed service is still running at its previous address.': 'landing.previousAddress',
    'Service ownership could not be verified.': 'landing.ownershipUnverified',
    'Service was started outside this cockpit.': 'landing.externalService',
    'Service ownership could not be saved.': 'landing.ownershipSaveFailed',
    'Service could not be started.': 'landing.startFailed', 'Unexpected service on this address.': 'landing.unexpectedService',
  };
  return { status, body: { ok: false, id, error, errorKey: keys[error] || 'landing.controlFailed' } };
}
function localService(id, useOwned = false) {
  const url = new URL(useOwned ? startedChildren.get(id)?.upstream || effectiveUpstream(id) : effectiveUpstream(id));
  return url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
async function withServiceAction(id, operation, useOwned = false) {
  if (!SERVICE_META[id]) return controlError(id, 404, 'Unknown service');
  if (!SERVICE_CONTROL_ENABLED) return controlError(id, 403, 'Service control is disabled');
  if (!localService(id, useOwned)) return controlError(id, 403, 'Only local services can be controlled');
  if (serviceActions.has(id)) return controlError(id, 409, 'A service action is already in progress');
  const pending = operation();
  serviceActions.set(id, pending);
  try { return await pending; } finally { serviceActions.delete(id); }
}

function startService(id) {
  return withServiceAction(id, async () => {
    const current = await checkService(id);
    if (current.httpStatus !== null) {
      if (['unexpected-service', 'invalid-response'].includes(current.reason)) return controlError(id, 409, 'Unexpected service on this address.');
      return { status: 200, body: { ok: true, id, state: 'already-running', service: current } };
    }
    const previous = startedChildren.get(id);
    if (previous) {
      // Retain a live child handle or privately verified ownership even if its
      // health endpoint is slow. A saved PID alone may now belong to someone else.
      if (childHandles.has(id) || await verifyOwnership(id)) {
        if (previous.upstream !== effectiveUpstream(id)) return controlError(id, 409, 'A managed service is still running at its previous address.');
        return { status: 202, body: { ok: true, id, state: 'starting' } };
      }
      if (!await localAddressIsFree(previous.upstream)) return controlError(id, 409, 'Service ownership could not be verified.');
    }
    if (!await localAddressIsFree(effectiveUpstream(id))) return controlError(id, 409, 'Unexpected service on this address.');
    if (previous) {
      startedChildren.delete(id);
      try { await saveOwnership(); }
      catch {
        startedChildren.set(id, previous);
        return controlError(id, 500, 'Service ownership could not be saved.');
      }
    }
    serviceFailures.delete(id);
    const token = crypto.randomBytes(32).toString('hex');
    const configDir = resolveMaybeRelative(process.env.NFON_SHOWCASE_CONFIG_DIR || '') || defaultLocalConfigDir();
    const logs = path.join(configDir, 'logs');
    await fsp.mkdir(logs, { recursive: true, mode: 0o700 });
    const log = fs.openSync(path.join(logs, id + '.log'), 'a', 0o600);
    const logStart = fs.fstatSync(log).size;
    // Do not leak sibling credentials or cockpit overrides into a child's env.
    const env = {};
    const appEnvKeys = {
      cti: ['CTI_API_ENV_FILE', 'CTI_DATA_DIR', 'NFON_SECRET_FILE'],
      portal: ['Portal_API_ENV_FILE', 'PORTAL_API_ENV_FILE', 'PORTAL_DATA_DIR'],
      'core-history': ['CallHistory_API_ENV_FILE', 'CALLHISTORY_DATA_DIR'],
    };
    for (const key of ['PATH', 'HOME', 'USERPROFILE', 'TMPDIR', 'TEMP', 'LANG', 'LC_ALL', 'SYSTEMROOT',
      'NODE_OPTIONS', 'NODE_EXTRA_CA_CERTS', 'NODE_USE_SYSTEM_CA', 'SSL_CERT_FILE', 'SSL_CERT_DIR',
      'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'NO_PROXY', 'http_proxy', 'https_proxy', 'all_proxy', 'no_proxy',
      ...appEnvKeys[id]]) {
      if (process.env[key]) env[key] = process.env[key];
    }
    const host = new URL(effectiveUpstream(id)).hostname === '[::1]' ? '::1' : '127.0.0.1';
    const cockpitHost = server.address().address === '::1' ? '[::1]' : '127.0.0.1';
    Object.assign(env, { NFON_SHOWCASE_CONFIG_DIR: configDir, HOST: host, PORT: portForUpstream(effectiveUpstream(id)), NFON_SERVICE_TOKEN: token, NFON_SERVICE_ID: id, NFON_COCKPIT_URL: `http://${cockpitHost}:${server.address().port}/` });
    let child;
    try {
      child = spawn(process.execPath, ['src/server.js'], { cwd: SERVICE_META[id].cwd, detached: true, env, stdio: ['ignore', log, log] });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    } catch { return controlError(id, 500, 'Service could not be started.'); }
    finally { fs.closeSync(log); }
    child.unref();
    childHandles.set(id, child);
    startedChildren.set(id, { token, pid: child.pid, upstream: effectiveUpstream(id), startedAt: new Date().toISOString() });
    child.once('exit', () => {
      if (childHandles.get(id) === child) childHandles.delete(id);
      if (startedChildren.get(id)?.pid === child.pid) {
        startedChildren.delete(id);
        const wasReady = readyChildren.has(child);
        let reason = wasReady ? 'service-exited' : 'start-failed';
        try {
          const file = fs.openSync(path.join(logs, id + '.log'), 'r');
          let text;
          try {
            const end = fs.fstatSync(file).size;
            const start = Math.max(logStart, end - 8192);
            const tail = Buffer.alloc(Math.max(0, end - start));
            fs.readSync(file, tail, 0, tail.length, start);
            text = tail.toString('utf8');
          } finally { fs.closeSync(file); }
          if (!wasReady && text.includes('EADDRINUSE')) reason = 'port-in-use';
          else if (!wasReady && /configuration|environment|credential/i.test(text)) reason = 'configuration';
        } catch { /* A stable code is safer than returning process logs. */ }
        serviceFailures.set(id, reason);
        saveOwnership().catch(() => {});
      }
    });
    try { await saveOwnership(); }
    catch {
      child.kill(); startedChildren.delete(id);
      return controlError(id, 500, 'Service ownership could not be saved.');
    }
    return { status: 202, body: { ok: true, id, state: 'starting' } };
  });
}

function stopService(id) {
  return withServiceAction(id, async () => {
    const owned = startedChildren.get(id);
    if (!owned) {
      const current = await checkService(id);
      return current.httpStatus === null
        ? { status: 200, body: { ok: true, id, state: 'already-stopped' } }
        : controlError(id, 409, 'Service was started outside this cockpit.');
    }
    try {
      if (!await verifyOwnership(id)) return controlError(id, 409, 'Service ownership could not be verified.');
      const response = await fetch(new URL('/api/_service', owned.upstream), {
        method: 'DELETE', headers: { 'X-NFON-Service-Token': owned.token }, redirect: 'error', signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return controlError(id, 409, 'Service ownership could not be verified.');
      startedChildren.delete(id); await saveOwnership();
      return { status: 202, body: { ok: true, id, state: 'stopping' } };
    } catch {
      const current = await checkService(id);
      if (current.httpStatus !== null || ownerProcessExists(owned)) return controlError(id, 409, 'Service ownership could not be verified.');
      startedChildren.delete(id); await saveOwnership();
      return { status: 200, body: { ok: true, id, state: 'already-stopped' } };
    }
  }, true);
}

function aggregateGatewayHealth(services) {
  const values = Object.values(services).map((service) => service.health);
  if (values.length > 0 && values.every((value) => value === "offline")) return "offline";
  if (values.some((value) => value === "offline")) return "warning";
  if (values.some((value) => value === "warning")) return "warning";
  if (values.some((value) => value === "auth-required")) return "auth-required";
  return "online";
}

async function serveStatic(req, res, urlPath) {
  const file = fileForRequest(urlPath);
  if (!isInsidePublic(file) && file !== path.join(PUBLIC_DIR, "index.html")) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }

  try {
    const body = await readPublicFile(PUBLIC_DIR, file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": staticCacheControl(req.url),
    });
    res.end(body);
  } catch (error) {
    if (error.code === 'EACCES') { sendJson(res, 403, { ok: false, error: 'Forbidden' }); return; }
    if (error.code === "ENOENT" || error.code === 'EISDIR' || error.code === 'ENAMETOOLONG') {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    sendJson(res, 500, { ok: false, error: 'File could not be read.' });
  }
}

function allowedOrigins() {
  const port = process.env.PORT || 3010;
  const set = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://[::1]:${port}`]);
  if (process.env.LANDING_ALLOWED_ORIGIN) set.add(process.env.LANDING_ALLOWED_ORIGIN);
  return set;
}

// Reject cross-site POSTs to the loopback cockpit: same-origin check via
// Sec-Fetch-Site / Origin plus a double-submit CSRF token from /api/status.
function csrfRejection(req) {
  if (!isLoopback(req.socket.remoteAddress)) return { status: 403, body: { ok: false, error: 'Local service control required' } };
  const site = req.headers["sec-fetch-site"];
  if (site && site !== "same-origin" && site !== "none") {
    return { status: 403, body: { ok: false, error: "Cross-site request blocked" } };
  }
  const origin = req.headers.origin;
  if (origin && !allowedOrigins().has(origin)) {
    return { status: 403, body: { ok: false, error: "Origin not allowed" } };
  }
  const token = req.headers["x-csrf-token"];
  if (!token || token !== CSRF_TOKEN) {
    return { status: 403, body: { ok: false, error: "Invalid CSRF token" } };
  }
  return null;
}

function readJsonBody(req, limit = 16 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("Body too large"), { statusCode: 413 }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(Object.assign(new Error("Invalid JSON"), { statusCode: 400 }));
      }
    });
    req.on("error", reject);
  });
}

async function setUpstream(id, value) {
  if (!SERVICE_META[id]) {
    return { status: 404, body: { ok: false, error: "Unknown service" } };
  }
  const normalized = normalizeUpstream(value);
  if (normalized === null) {
    return { status: 400, body: { ok: false, id, error: "Invalid URL. Expected http(s)://host:port." } };
  }
  const save = upstreamSaveQueue.then(async () => {
    const candidate = { ...upstreamOverrides };
    if (normalized) candidate[id] = normalized;
    else delete candidate[id];
    await saveUpstreamOverrides(candidate);
    upstreamOverrides = candidate;
  });
  upstreamSaveQueue = save.catch(() => {});
  try { await save; }
  catch { return { status: 500, body: { ok: false, id, error: 'Saving failed.' } }; }
  return {
    status: 200,
    body: {
      ok: true,
      id,
      upstream: effectiveUpstream(id),
      defaultUpstream: DEFAULT_UPSTREAMS[id],
      upstreamSource: upstreamSource(id),
    },
  };
}

async function handleApi(req, res, url) {
  if (url.pathname === "/api/status" && req.method === "GET") {
    const services = await serviceHealth();
    sendJson(res, 200, {
      ok: true,
      app: "landing",
      status: aggregateGatewayHealth(services).toUpperCase(),
      health: aggregateGatewayHealth(services),
      dataScope: "local-route-health",
      serverTime: new Date().toISOString(),
      csrfToken: CSRF_TOKEN,
      serviceControl: SERVICE_CONTROL_ENABLED,
      routes: {
        cti: { path: "/cti/", upstream: UPSTREAMS.cti },
        portal: { path: "/portal/", upstream: UPSTREAMS.portal },
        coreHistory: { path: "/call-history/", upstream: UPSTREAMS["core-history"], legacyPath: "/core-history/" },
        combined: { path: "/combined/", upstream: null },
      },
      services,
    });
    return true;
  }

  const startMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/start$/);
  if (startMatch && req.method === "POST") {
    const rejected = csrfRejection(req);
    if (rejected) return sendJson(res, rejected.status, rejected.body), true;
    const result = await startService(decodeURIComponent(startMatch[1]));
    sendJson(res, result.status, result.body);
    return true;
  }

  const stopMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/stop$/);
  if (stopMatch && req.method === "POST") {
    const rejected = csrfRejection(req);
    if (rejected) return sendJson(res, rejected.status, rejected.body), true;
    const result = await stopService(decodeURIComponent(stopMatch[1]));
    sendJson(res, result.status, result.body);
    return true;
  }

  const upstreamMatch = url.pathname.match(/^\/api\/services\/([^/]+)\/upstream$/);
  if (upstreamMatch && req.method === "POST") {
    const rejected = csrfRejection(req);
    if (rejected) return sendJson(res, rejected.status, rejected.body), true;
    let payload;
    try {
      payload = await readJsonBody(req);
    } catch (error) {
      sendJson(res, error.statusCode || 400, { ok: false, error: error.message });
      return true;
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)
      || (Object.hasOwn(payload, 'upstream') && typeof payload.upstream !== 'string')) {
      sendJson(res, 400, { ok: false, error: 'Expected an object with a string upstream value.' });
      return true;
    }
    const result = await setUpstream(decodeURIComponent(upstreamMatch[1]), payload.upstream);
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  if (!guardRequest(req, res)) return;
  try {
  const url = requestUrl(req);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    if (!await handleApi(req, res, url)) sendJson(res, 404, { ok: false, error: 'Not found' });
    return;
  }

  const appId = appRouteForPath(url.pathname);
  if (appId) {
    redirectToUpstream(res, upstreamLocation(appId, url.pathname, url.search, `http://${req.headers.host}/`));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  await serveStatic(req, res, url.pathname);
  } catch (error) {
    errorResponse(res, error instanceof URIError ? 400 : 500, error instanceof URIError ? 'Invalid request URL' : 'Request failed');
  }
});

const port = Number(process.env.PORT || 3010);
const host = process.env.LANDING_HOST || "127.0.0.1";

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Landing cockpit listening on http://${host}:${port}`);
});
