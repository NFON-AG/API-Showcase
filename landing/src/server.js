const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { URL } = require("url");

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

function loadEnvFile(envFile) {
  if (!envFile || !fs.existsSync(envFile)) return false;
  const text = fs.readFileSync(envFile, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || Object.hasOwn(process.env, key)) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
  return true;
}

function loadLocalEnv() {
  const configDir = configuredLocalConfigDir();
  const candidates = [
    resolveMaybeRelative(process.env.LANDING_ENV_FILE || ""),
    path.join(ROOT, ".env"),
    configDir ? path.join(configDir, "env", `${APP_CONFIG_NAME}.env`) : "",
  ];
  candidates.find(loadEnvFile);
}

loadLocalEnv();

const SERVICE_CONTROL_ENABLED = ["1", "true", "yes", "on"].includes(
  String(process.env.LANDING_ENABLE_SERVICE_CONTROL || "").toLowerCase()
);
const startedChildren = new Map();

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
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:") || !parsed.hostname) return null;
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

async function saveUpstreamOverrides() {
  const file = overridesFile();
  if (!file) return false;
  await fsp.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  await fsp.writeFile(file, JSON.stringify(upstreamOverrides, null, 2), { mode: 0o600 });
  return true;
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
  if (!path.extname(cleanPath) && cleanPath !== "/") return path.join(PUBLIC_DIR, "index.html");
  return path.join(PUBLIC_DIR, cleanPath.replace(/^\/+/, ""));
}

function appRouteForPath(pathname) {
  if (pathname === "/cti" || pathname.startsWith("/cti/")) return "cti";
  if (pathname === "/portal" || pathname.startsWith("/portal/")) return "portal";
  if (pathname === "/core-history" || pathname.startsWith("/core-history/")) return "core-history";
  if (pathname === "/call-history" || pathname.startsWith("/call-history/")) return "core-history";
  return "";
}

function upstreamLocation(appId, pathname, search) {
  const upstream = UPSTREAMS[appId];
  if (!upstream) return "";
  const prefix = pathname.startsWith("/call-history")
    ? "/call-history"
    : `/${appId}`;
  let upstreamPath = pathname === prefix ? "/" : pathname.slice(prefix.length) || "/";
  if (!upstreamPath.startsWith("/")) upstreamPath = `/${upstreamPath}`;
  return new URL(`${upstreamPath}${search}`, upstream).toString();
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
  if (!responseOk) {
    return {
      health: "warning",
      detail: "Status-Endpunkt erreichbar, aber mit Hinweis.",
    };
  }

  if (id === "cti") {
    const callsConnected = payload.streams?.calls?.connected;
    const statesConnected = payload.streams?.states?.connected;
    if (payload.credentialsConfigured && callsConnected && statesConnected) {
      return {
        health: "online",
        detail: "Live-Streams verbunden.",
      };
    }
    return {
      health: "warning",
      detail: "App erreichbar, aber ein Live-Stream oder Credential fehlt.",
    };
  }

  if (id === "portal") {
    const blockingErrors = Object.keys(payload.cache?.errors || {})
      .filter((key) => !PORTAL_OPTIONAL_ENDPOINT_ERRORS.has(key));
    if (payload.ok && payload.configured && blockingErrors.length === 0) {
      return {
        health: "online",
        detail: "Geplante Portal-Features bereit.",
      };
    }
    if (payload.ok && payload.configured) {
      return {
        health: "warning",
        detail: "App erreichbar, Cache meldet Hinweise.",
      };
    }
    return {
      health: "warning",
      detail: "App erreichbar, Konfiguration unvollständig.",
    };
  }

  if (id === "core-history") {
    if (payload.ok && payload.configured && payload.authenticated) {
      return {
        health: "online",
        detail: "OAuth aktiv und History bereit.",
      };
    }
    if (payload.ok) {
      return {
        health: "warning",
        detail: "App erreichbar, Login oder Konfiguration offen.",
      };
    }
  }

  return {
    health: "warning",
    detail: "App erreichbar, Status braucht Prüfung.",
  };
}

async function checkService(id) {
  const meta = SERVICE_META[id];
  const checkedAt = new Date().toISOString();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1400);
  const publicService = {
    id,
    name: meta.name,
    route: meta.route,
    upstream: effectiveUpstream(id),
    defaultUpstream: DEFAULT_UPSTREAMS[id],
    upstreamSource: upstreamSource(id),
    editable: true,
  };

  try {
    const response = await fetch(healthUrl(id), {
      headers: { "Accept": "application/json" },
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    const payload = contentType.includes("application/json") ? await response.json() : {};
    const classification = classifyHealth(id, payload, response.ok);

    return {
      ...publicService,
      checkedAt,
      httpStatus: response.status,
      ...classification,
    };
  } catch (error) {
    return {
      ...publicService,
      checkedAt,
      httpStatus: null,
      health: "offline",
      detail: "Status-Endpunkt nicht erreichbar.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function serviceHealth() {
  const entries = await Promise.all(
    Object.keys(SERVICE_META).map(async (id) => [id, await checkService(id)])
  );
  return Object.fromEntries(entries);
}

async function startService(id) {
  const service = SERVICE_META[id];
  if (!service) {
    return { ok: false, status: 404, body: { ok: false, error: "Unknown service" } };
  }
  if (!SERVICE_CONTROL_ENABLED) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        id,
        error: "Service control is disabled",
        detail: "Set LANDING_ENABLE_SERVICE_CONTROL=true for the local monorepo cockpit.",
      },
    };
  }

  const current = await checkService(id);
  if (current.health !== "offline") {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        id,
        state: "already-running",
        detail: `${service.name} ist bereits erreichbar.`,
        service: current,
      },
    };
  }

  let child;

  try {
    child = spawn(process.execPath, ["src/server.js"], {
      cwd: service.cwd,
      detached: true,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: portForUpstream(effectiveUpstream(id), DEFAULT_UPSTREAMS[id].split(":").pop()),
      },
      stdio: "ignore",
    });
  } catch (error) {
    return {
      ok: false,
      status: 500,
      body: { ok: false, id, error: error.message },
    };
  }

  const started = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: true }), 250);
    child.once("spawn", () => {
      clearTimeout(timer);
      resolve({ ok: true });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error });
    });
  });

  if (!started.ok) {
    return {
      ok: false,
      status: 500,
      body: { ok: false, id, error: started.error.message },
    };
  }

  child.unref();
  startedChildren.set(id, {
    pid: child.pid,
    startedAt: new Date().toISOString(),
  });
  child.once("exit", () => {
    const current = startedChildren.get(id);
    if (current?.pid === child.pid) startedChildren.delete(id);
  });

  return {
    ok: true,
    status: 202,
    body: {
      ok: true,
      id,
      state: "starting",
      pid: child.pid,
      detail: `${service.name} wird gestartet.`,
    },
  };
}

async function stopService(id) {
  const service = SERVICE_META[id];
  if (!service) {
    return { ok: false, status: 404, body: { ok: false, error: "Unknown service" } };
  }
  if (!SERVICE_CONTROL_ENABLED) {
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        id,
        error: "Service control is disabled",
        detail: "Set LANDING_ENABLE_SERVICE_CONTROL=true for the local monorepo cockpit.",
      },
    };
  }

  const port = portForUpstream(effectiveUpstream(id), DEFAULT_UPSTREAMS[id].split(":").pop());
  const tracked = startedChildren.get(id);
  if (!tracked?.pid) {
    return {
      ok: true,
      status: 200,
      body: {
        ok: true,
        id,
        state: "already-stopped",
        detail: `${service.name} wurde nicht von dieser Cockpit-Sitzung gestartet.`,
      },
    };
  }

  const stopped = [];
  const failed = [];
  try {
    process.kill(tracked.pid, "SIGTERM");
    stopped.push(tracked.pid);
    startedChildren.delete(id);
  } catch (error) {
    if (error.code === "ESRCH") {
      startedChildren.delete(id);
    } else {
      failed.push({ pid: tracked.pid, error: error.message });
    }
  }

  return {
    ok: failed.length === 0,
    status: failed.length === 0 ? 202 : 500,
    body: {
      ok: failed.length === 0,
      id,
      state: failed.length === 0 ? "stopping" : "stop-failed",
      port,
      stopped,
      failed,
      detail: failed.length === 0
        ? `${service.name} wird gestoppt.`
        : `${service.name} konnte nicht vollstaendig gestoppt werden.`,
    },
  };
}

function aggregateGatewayHealth(services) {
  const values = Object.values(services).map((service) => service.health);
  if (values.length > 0 && values.every((value) => value === "offline")) return "offline";
  if (values.some((value) => value === "offline")) return "warning";
  if (values.some((value) => value === "warning")) return "warning";
  return "online";
}

async function serveStatic(req, res, urlPath) {
  const file = fileForRequest(urlPath);
  if (!isInsidePublic(file) && file !== path.join(PUBLIC_DIR, "index.html")) {
    sendJson(res, 403, { ok: false, error: "Forbidden" });
    return;
  }

  try {
    const body = await fsp.readFile(file);
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    res.end(body);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendJson(res, 404, { ok: false, error: "Not found" });
      return;
    }
    sendJson(res, 500, { ok: false, error: error.message });
  }
}

function allowedOrigins() {
  const port = process.env.PORT || 3010;
  const set = new Set([`http://localhost:${port}`, `http://127.0.0.1:${port}`]);
  if (process.env.LANDING_ALLOWED_ORIGIN) set.add(process.env.LANDING_ALLOWED_ORIGIN);
  return set;
}

// Reject cross-site POSTs to the loopback cockpit: same-origin check via
// Sec-Fetch-Site / Origin plus a double-submit CSRF token from /api/status.
function csrfRejection(req) {
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
        req.destroy();
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
    return { status: 400, body: { ok: false, id, error: "Ungültige URL. Erwartet wird http(s)://host:port." } };
  }
  if (normalized) upstreamOverrides[id] = normalized;
  else delete upstreamOverrides[id];
  try {
    await saveUpstreamOverrides();
  } catch (error) {
    return { status: 500, body: { ok: false, id, error: error.message } };
  }
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
    const result = await setUpstream(decodeURIComponent(upstreamMatch[1]), payload.upstream);
    sendJson(res, result.status, result.body);
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  if (url.pathname.startsWith("/api/") && await handleApi(req, res, url)) return;

  const appId = appRouteForPath(url.pathname);
  if (appId) {
    redirectToUpstream(res, upstreamLocation(appId, url.pathname, url.search));
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendJson(res, 405, { ok: false, error: "Method not allowed" });
    return;
  }

  await serveStatic(req, res, url.pathname);
});

const port = Number(process.env.PORT || 3010);
const host = process.env.LANDING_HOST || "127.0.0.1";

server.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Landing cockpit listening on http://${host}:${port}`);
});
