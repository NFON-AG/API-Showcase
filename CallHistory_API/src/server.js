const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { URL } = require("url");
const { loadEnvFile, parseEnvFlag, guardRequest, requestUrl, staticCacheControl, readPublicFile } = require("./server-safety.cjs");

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const APP_CONFIG_NAME = "CallHistory_API";

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

function loadLocalEnv(appName) {
  const configDir = configuredLocalConfigDir();
  const candidates = [
    resolveMaybeRelative(process.env[`${appName}_ENV_FILE`] || ""),
    path.join(ROOT, ".env"),
    configDir ? path.join(configDir, "env", `${appName}.env`) : "",
  ];
  candidates.find(file => loadEnvFile(file));
}

function dataDirForApp(appName, envName) {
  const explicit = resolveMaybeRelative(process.env[envName] || "");
  if (explicit) return explicit;
  const configDir = configuredLocalConfigDir();
  return configDir ? path.join(configDir, "data", appName) : path.join(ROOT, "data");
}

function failConfiguration(error) {
  console.error(`Configuration error: ${error.message}`);
  process.exit(1);
}

try { loadLocalEnv(APP_CONFIG_NAME); }
catch (error) { failConfiguration(error); }

const DATA_DIR = dataDirForApp(APP_CONFIG_NAME, "CALLHISTORY_DATA_DIR");
const TOKEN_FILE = path.join(DATA_DIR, "callhistory-token.json");
const OAUTH_STATE_FILE = path.join(DATA_DIR, "callhistory-oauth-state.json");
const DEFAULT_AUTH_URL = "https://sso.cloud-cfg.com/realms/login/protocol/openid-connect/auth";
const DEFAULT_TOKEN_URL = "https://sso.cloud-cfg.com/realms/login/protocol/openid-connect/token";
const DEFAULT_API_BASE_URL = "https://start.cloudya.com/api/callhistory";
const DEFAULT_RECORDS_PATH = "/records";
const DEFAULT_PORT = 3000;
const DEFAULT_JSON_LIMIT = 512 * 1024;
const DEMO_CALL_HISTORY_CALLS_PER_DAY = 20;
const csrfToken = crypto.randomBytes(32).toString("base64url");

const MIME_TYPES = {
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

function envFlag(name, fallback = false) {
  return parseEnvFlag(name, process.env[name], fallback);
}

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function splitOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function localhostOriginVariants(origin) {
  const variants = new Set();
  try {
    const parsed = new URL(origin);
    variants.add(parsed.origin);
    if (parsed.hostname === "localhost") {
      variants.add(`${parsed.protocol}//127.0.0.1${parsed.port ? `:${parsed.port}` : ""}`);
    }
    if (parsed.hostname === "127.0.0.1") {
      variants.add(`${parsed.protocol}//localhost${parsed.port ? `:${parsed.port}` : ""}`);
    }
  } catch {
    if (origin) variants.add(origin);
  }
  return [...variants];
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function integerSetting(name, fallback, min, max) {
  if (process.env[name] === undefined) return fallback;
  const raw = process.env[name].trim();
  const value = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`Invalid integer configuration: ${name} (expected ${min}–${max})`);
  }
  return value;
}

function readConfig() {
  const port = Number(process.env.PORT || DEFAULT_PORT);
  const publicBaseUrl = trimTrailingSlash(process.env.CALLHISTORY_PUBLIC_BASE_URL || process.env.PUBLIC_BASE_URL || "http://localhost:3000");
  const config = {
    appName: process.env.APP_NAME || "nfon-callhistory-api-showcase",
    appVersion: process.env.APP_VERSION || "1.2.0",
    host: process.env.HOST || "127.0.0.1",
    port,
    publicBaseUrl,
    authUrl: process.env.CALLHISTORY_AUTH_URL || DEFAULT_AUTH_URL,
    tokenUrl: process.env.CALLHISTORY_TOKEN_URL || DEFAULT_TOKEN_URL,
    clientId: process.env.CALLHISTORY_CLIENT_ID || "",
    redirectUri: process.env.CALLHISTORY_REDIRECT_URI || publicBaseUrl,
    scope: process.env.CALLHISTORY_SCOPE || "openid profile email basic",
    apiBaseUrl: process.env.CALLHISTORY_API_BASE_URL || DEFAULT_API_BASE_URL,
    callsPath: process.env.CALLHISTORY_CALLS_PATH || process.env.CALLHISTORY_RECORDS_PATH || DEFAULT_RECORDS_PATH,
    recordDetailsPath: process.env.CALLHISTORY_RECORD_DETAILS_PATH || process.env.CALLHISTORY_TRANSCRIPTS_PATH || `${DEFAULT_RECORDS_PATH}/{uuid}`,
    limit: integerSetting("CALLHISTORY_LIMIT", 100, 1, 500),
    maxRequests: integerSetting("CALLHISTORY_MAX_REQUESTS", 100, 1, 1000),
    maxRecords: integerSetting("CALLHISTORY_MAX_RECORDS", 10000, 1, 100000),
    timeoutMs: integerSetting("CALLHISTORY_TIMEOUT_MS", 15000, 100, 2147483647),
    pagingBudgetMs: integerSetting("CALLHISTORY_PAGING_BUDGET_MS", 30000, 250, 60000),
    queryParams: {
      start: process.env.CALLHISTORY_QUERY_START_PARAM || "from",
      end: process.env.CALLHISTORY_QUERY_END_PARAM || "to",
      search: process.env.CALLHISTORY_QUERY_SEARCH_PARAM || "search",
      filter: process.env.CALLHISTORY_QUERY_FILTER_PARAM || "filter",
      limit: process.env.CALLHISTORY_QUERY_LIMIT_PARAM || "limit",
      complete: process.env.CALLHISTORY_QUERY_COMPLETE_PARAM || "complete",
    },
    envAccessToken: process.env.CALLHISTORY_ACCESS_TOKEN || "",
    envRefreshToken: process.env.CALLHISTORY_REFRESH_TOKEN || "",
    demoMode: envFlag("DEMO_MODE", envFlag("CALLHISTORY_DEMO_MODE", false)),
    allowedOrigin: process.env.CALLHISTORY_ALLOWED_ORIGIN || process.env.ALLOWED_ORIGIN || publicBaseUrl,
  };

  config.oauthConfigured = Boolean(config.clientId && config.authUrl && config.tokenUrl);
  config.historyConfigured = Boolean(config.apiBaseUrl && config.callsPath);
  config.transcriptsConfigured = Boolean(config.apiBaseUrl && config.recordDetailsPath);
  config.configured = Boolean(config.oauthConfigured && config.historyConfigured);
  return config;
}

let config;
try { config = readConfig(); }
catch (error) { failConfiguration(error); }
const allowedOrigins = new Set([
  ...localhostOriginVariants(`http://localhost:${config.port}`),
  ...localhostOriginVariants(`http://127.0.0.1:${config.port}`),
  ...localhostOriginVariants(config.publicBaseUrl),
  ...splitOrigins(config.allowedOrigin).flatMap(localhostOriginVariants),
]);
let sessionGeneration = 0;
// Public context identity, independent of credentials and account display text.
// The boot nonce prevents a persisted session from reusing an old process's ID.
const sessionRevisionBase = crypto.randomBytes(18).toString("base64url");
let oauthGeneration = 0;
let refreshInFlight = null;
// Undefined means not loaded; null is an explicitly invalidated session.
let sessionToken;
let tokenMutationTail = Promise.resolve();
const oauthStates = new Map();
const userAgent = `${config.appName}/${config.appVersion}`;
const runtimeSettings = {
  authMode: "env",
  browserCredentialsActive: false,
  browserCredentialsUpdatedAt: "",
};

function recomputeConfigFlags() {
  config.oauthConfigured = Boolean(config.clientId && config.authUrl && config.tokenUrl);
  config.historyConfigured = Boolean(config.apiBaseUrl && config.callsPath);
  config.transcriptsConfigured = Boolean(config.apiBaseUrl && config.recordDetailsPath);
  config.configured = Boolean(config.oauthConfigured && config.historyConfigured);
}

function requestOrigin(req) {
  return req.headers.origin || "";
}

function originAllowed(origin) {
  return !origin || allowedOrigins.has(origin);
}

function corsHeaders(req, headers = {}) {
  const origin = requestOrigin(req);
  const allowOrigin = origin && allowedOrigins.has(origin)
    ? origin
    : config.allowedOrigin;
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Accept, Content-Type, X-CSRF-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    ...headers,
  };
}

function sendJson(req, res, status, body, headers = {}) {
  res.writeHead(status, corsHeaders(req, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...headers,
  }));
  res.end(JSON.stringify(body, null, 2));
}

function sendError(req, res, status, message, details = {}) {
  sendJson(req, res, status, { ok: false, error: message, ...details });
}

function sendRedirect(res, location) {
  res.writeHead(302, {
    "Location": location,
    "Cache-Control": "no-store",
  });
  res.end();
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function requireLocalRequest(req) {
  if (isLoopbackRequest(req)) return;
  throw httpError(403, "Call History setup actions are restricted to local requests");
}

function assertAllowedOrigin(req) {
  const origin = requestOrigin(req);
  if (originAllowed(origin)) return;
  throw httpError(403, "Origin is not allowed for this local Call History API");
}

function requireCsrf(req) {
  assertAllowedOrigin(req);
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "same-site", "none"].includes(String(site))) {
    throw httpError(403, "Cross-site Call History actions are blocked");
  }
  if (req.headers["x-csrf-token"] !== csrfToken) {
    throw httpError(403, "Missing or invalid CSRF token");
  }
}

async function readRequestJson(req, options = {}) {
  const limit = options.limit || DEFAULT_JSON_LIMIT;
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > limit) {
      throw httpError(413, `Request body exceeds ${formatBytes(limit)}`);
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw httpError(400, "Malformed JSON request body");
  }
}

async function readResponseBody(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatApiError(body) {
  if (!body) return "";
  if (typeof body === "string") return body.slice(0, 180);
  return body.error_description || body.error || body.message || "remote API error";
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

async function ensureDataDir() {
  await fsp.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await fsp.chmod(DATA_DIR, 0o700).catch(() => {});
}

async function repairPrivateFileMode(file) {
  try {
    await fsp.chmod(file, 0o600);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writePrivateJson(file, body) {
  await ensureDataDir();
  const candidate = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  try {
    await fsp.writeFile(candidate, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    await fsp.chmod(candidate, 0o600);
    // The rename is the commit. Do not add fallible persistence work after it.
    await fsp.rename(candidate, file);
  } catch (error) {
    await fsp.rm(candidate, { force: true }).catch(() => {});
    throw error;
  }
}

async function repairRuntimeFileModes() {
  await ensureDataDir();
  await Promise.all([
    TOKEN_FILE,
    OAUTH_STATE_FILE,
  ].map(repairPrivateFileMode));
}

function decodeJwtExp(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return 0;
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

function base64Url(value) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function sha256Base64Url(value) {
  return base64Url(crypto.createHash("sha256").update(value).digest());
}

function tokenRequestParams(params) {
  return new URLSearchParams({
    ...params,
    client_id: config.clientId,
  });
}

function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function extractUserFromToken(body, fallback = {}) {
  const claims = body?.id_token ? decodeJwtPayload(body.id_token) : null;
  return {
    userName: claims?.name || fallback.userName || "",
    userEmail: claims?.email || fallback.userEmail || "",
  };
}

function normalizeToken(body, fallback = {}) {
  const accessToken = body?.access_token || body?.accessToken || fallback.accessToken || "";
  const refreshToken = body?.refresh_token || body?.refreshToken || fallback.refreshToken || "";
  const expiresIn = Number(body?.expires_in || body?.expiresIn || 0);
  const expiresAt = expiresIn
    ? Date.now() + (expiresIn * 1000)
    : decodeJwtExp(accessToken) || fallback.expiresAt || 0;
  const { userName, userEmail } = extractUserFromToken(body, fallback);
  return {
    accessToken,
    refreshToken,
    tokenType: body?.token_type || body?.tokenType || fallback.tokenType || "Bearer",
    scope: body?.scope || fallback.scope || config.scope,
    expiresAt,
    userName,
    userEmail,
    updatedAt: new Date().toISOString(),
  };
}

function readStoredToken() {
  if (sessionToken !== undefined) return sessionToken;
  if (config.envAccessToken) {
    sessionToken = normalizeToken({
      access_token: config.envAccessToken,
      refresh_token: config.envRefreshToken,
    }, { expiresAt: Date.now() + 60 * 60 * 1000, source: "env" });
  } else {
    sessionToken = safeReadJson(TOKEN_FILE, null);
  }
  return sessionToken;
}

function queueTokenMutation(operation) {
  const result = tokenMutationTail.then(operation);
  tokenMutationTail = result.catch(() => {});
  return result;
}

function requireSessionGeneration(generation) {
  if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
}

async function writeStoredToken(token, generation, { newSession = false } = {}) {
  return queueTokenMutation(async () => {
    let previousToken;
    if (newSession) {
      if (generation !== oauthGeneration) throw httpError(401, "OAuth login is no longer valid");
      previousToken = readStoredToken();
      // A new OAuth login owns a new generation, even without a prior logout.
      // Hide the previous token while persisting so no request can refresh it
      // under the new generation. Other tabs retain their single-use PKCE states.
      generation = ++sessionGeneration;
      sessionToken = null;
    } else requireSessionGeneration(generation);
    try {
      await writePrivateJson(TOKEN_FILE, token);
    } catch (error) {
      // A failed replacement keeps the last committed session. A concurrent
      // logout owns its invalidation and must never be undone by this catch.
      if (newSession && generation === sessionGeneration) sessionToken = previousToken;
      throw error;
    }
    if (generation !== sessionGeneration) {
      // Logout invalidates memory immediately. Remove a write that completed
      // afterwards before any queued logout or newer login may touch the file.
      await fsp.rm(TOKEN_FILE, { force: true });
      requireSessionGeneration(generation);
    }
    sessionToken = token;
    return generation;
  });
}

async function clearStoredToken() {
  sessionGeneration += 1;
  oauthGeneration += 1;
  oauthStates.clear();
  sessionToken = null;
  config.envAccessToken = "";
  config.envRefreshToken = "";
  await queueTokenMutation(async () => {
    // Keep the queue until every deletion finishes, even when one fails early.
    // A pending old deletion must never reach a later login's token file.
    const removals = await Promise.allSettled([
      fsp.rm(TOKEN_FILE, { force: true }),
      fsp.rm(OAUTH_STATE_FILE, { force: true }),
    ]);
    const failure = removals.find(result => result.status === "rejected");
    if (failure) throw failure.reason;
  });
}

async function fetchUpstream(url, options = {}) {
  return fetch(url, { ...options, signal: options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(config.timeoutMs)]) : AbortSignal.timeout(config.timeoutMs) });
}

async function expireSession() {
  await clearStoredToken();
  throw httpError(401, "Login with NFON is required for live call history");
}

async function refreshAccessToken(token) {
  const generation = sessionGeneration;
  if (refreshInFlight?.generation === generation) return refreshInFlight.promise;
  const pending = { generation };
  pending.promise = performTokenRefresh(token, generation).finally(() => {
    if (refreshInFlight === pending) refreshInFlight = null;
  });
  refreshInFlight = pending;
  return pending.promise;
}

async function performTokenRefresh(token, generation) {
  if (!config.oauthConfigured || !token?.refreshToken) return token;
  const form = tokenRequestParams({
    grant_type: "refresh_token",
    refresh_token: token.refreshToken,
  });
  const response = await fetchUpstream(config.tokenUrl, {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": userAgent,
    },
    body: form,
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
    if (response.status === 401 || body?.error === "invalid_grant") return expireSession();
    throw new Error(`Token refresh failed with HTTP ${response.status}`);
  }
  if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
  const nextToken = normalizeToken(body, token);
  await writeStoredToken(nextToken, generation);
  return nextToken;
}

async function getAccessToken() {
  const token = readStoredToken();
  if (!token?.accessToken) {
    throw httpError(401, "Login with NFON is required for live call history");
  }
  if (token.expiresAt && token.expiresAt - Date.now() < 45_000 && token.refreshToken) {
    return (await refreshAccessToken(token)).accessToken;
  }
  if (token.expiresAt && token.expiresAt <= Date.now()) return expireSession();
  return token.accessToken;
}

function apiUrl(apiPath) {
  if (/^https?:\/\//i.test(apiPath)) return new URL(apiPath);
  if (!config.apiBaseUrl) throw new Error("CALLHISTORY_API_BASE_URL is missing");
  return new URL(apiPath.replace(/^\/+/, ""), config.apiBaseUrl.endsWith("/") ? config.apiBaseUrl : `${config.apiBaseUrl}/`);
}

function pathWithId(template, id) {
  const encoded = encodeURIComponent(id);
  if (template.includes("{id}")) return template.replaceAll("{id}", encoded);
  if (template.includes("{uuid}")) return template.replaceAll("{uuid}", encoded);
  if (template.includes(":id")) return template.replaceAll(":id", encoded);
  if (template.includes(":uuid")) return template.replaceAll(":uuid", encoded);
  return `${template.replace(/\/+$/, "")}/${encoded}`;
}

function requestFilters(searchParams) {
  return {
    mode: searchParams.get("mode") || "",
    range: searchParams.get("range") || "7d",
    start: searchParams.get("start") || "",
    end: searchParams.get("end") || "",
    direction: searchParams.get("direction") || "all",
    outcome: searchParams.get("outcome") || "all",
    party: searchParams.get("party") || "",
  };
}

function dateWindow(filters) {
  const now = new Date();
  let start = filters.start ? new Date(filters.start) : null;
  let end = filters.end ? new Date(filters.end) : now;

  if (!start || Number.isNaN(start.getTime())) {
    if (filters.range === "today") {
      start = new Date(now);
      start.setHours(0, 0, 0, 0);
    } else if (filters.range === "30d") {
      start = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    } else {
      start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    }
  }

  if (!end || Number.isNaN(end.getTime())) end = now;
  return { start, end };
}

function unixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function officialApiFilters(filters) {
  const out = [];
  if (filters.direction && filters.direction !== "all") {
    out.push(`direction:${filters.direction}`);
  }
  if (filters.outcome && filters.outcome !== "all") {
    const status = filters.outcome === "failed" || filters.outcome === "busy"
      ? "cancelled"
      : filters.outcome;
    out.push(`status:${status}`);
  }
  return out;
}

function withinSignal(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

async function liveCallHistory(filters) {
  const generation = sessionGeneration;
  const deadline = Date.now() + config.pagingBudgetMs;
  const budgetSignal = AbortSignal.timeout(config.pagingBudgetMs);
  let accessToken = await withinSignal(getAccessToken(), budgetSignal);
  let refreshed = false;
  const { start, end } = dateWindow(filters);
  const url = apiUrl(config.callsPath);
  url.searchParams.set(config.queryParams.start, String(unixSeconds(start)));
  url.searchParams.set(config.queryParams.end, String(unixSeconds(end)));
  url.searchParams.set(config.queryParams.limit, String(config.limit));
  url.searchParams.set("sort", "desc");
  const apiFilters = officialApiFilters(filters);
  if (apiFilters.length) url.searchParams.set(config.queryParams.filter, apiFilters.join(","));
  // Search locally after paging: phone formatting must not change the results.
  const records = [];
  const seen = new Set();
  let offset = 0;
  let complete = false;
  let requests = 0;
  while (records.length < config.maxRecords && requests < config.maxRequests && Date.now() < deadline) {
    requests += 1;
    url.searchParams.set("offset", String(offset));
    let response;
    try { response = await fetchUpstream(url, { signal: budgetSignal, headers: {
      Accept: "application/json", Authorization: "Bearer " + accessToken, "User-Agent": userAgent
    }}); } catch (error) {
      if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
      if (records.length) break;
      throw error;
    }
    if (generation !== sessionGeneration) {
      response.body?.cancel().catch(() => {});
      throw httpError(401, "Login with NFON is required for live call history");
    }
    // Authorization is decided by the status, even if its error body is unreadable.
    if (response.status === 401) {
      response.body?.cancel().catch(() => {});
      const current = readStoredToken();
      if (!refreshed && current?.refreshToken) {
        refreshed = true;
        accessToken = current.accessToken !== accessToken ? current.accessToken : (await withinSignal(refreshAccessToken(current), budgetSignal)).accessToken;
        if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
        continue;
      }
      return expireSession();
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      if (records.length && response.status !== 403) break;
      throw new Error("Call History API failed with HTTP " + response.status);
    }
    let body;
    try { body = await readResponseBody(response); } catch (error) {
      if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
      if (records.length) break;
      throw error;
    }
    if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live call history");
    let page;
    try {
      page = extractList(body);
      if (page.some(record => !record || typeof record !== "object" || Array.isArray(record))) {
        throw new Error("Call History API returned an unexpected response");
      }
    }
    catch (error) { if (records.length) break; throw error; }
    let added = 0;
    for (const record of page) {
      const key = record.uuid || record.id || JSON.stringify(record);
      if (seen.has(key)) continue;
      seen.add(key); records.push(record); added += 1;
    }
    offset += page.length;
    // The provider can cap page size. Only an empty page proves exhaustion;
    // undocumented totals and short pages are not completeness guarantees.
    if (!page.length) { complete = true; break; }
    if (!added) break; // An upstream ignoring offset must not loop forever or claim completeness.
  }
  const normalized = normalizeCalls(records.slice(0, config.maxRecords), "callhistory-live");
  const calls = normalized.filter(call => call.startedAt);
  return { calls, pagination: { complete, loaded: calls.length, limit: config.maxRecords }, invalidRecords: normalized.length - calls.length };
}

async function liveTranscript(transcriptId) {
  const generation = sessionGeneration;
  let accessToken = await getAccessToken();
  const url = apiUrl(pathWithId(config.recordDetailsPath, transcriptId));
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchUpstream(url, {
      headers: { Accept: "application/json", Authorization: `Bearer ${accessToken}`, "User-Agent": userAgent },
    });
    if (generation !== sessionGeneration) {
      response.body?.cancel().catch(() => {});
      throw httpError(401, "Login with NFON is required for live transcript details");
    }
    if (response.status === 401) {
      response.body?.cancel().catch(() => {});
      const current = readStoredToken();
      if (!attempt && current?.refreshToken) {
        accessToken = current.accessToken !== accessToken ? current.accessToken : (await refreshAccessToken(current)).accessToken;
        if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live transcript details");
        continue;
      }
      return expireSession();
    }
    if (!response.ok) {
      response.body?.cancel().catch(() => {});
      throw new Error(`Transcript API failed with HTTP ${response.status}`);
    }
    const body = await readResponseBody(response);
    if (generation !== sessionGeneration) throw httpError(401, "Login with NFON is required for live transcript details");
    return normalizeTranscript(body, "callhistory-live");
  }
}

function extractList(body) {
  if (!body) throw new Error("Call History API returned an unexpected response");
  if (Array.isArray(body)) return body;
  if (Array.isArray(body.items)) return body.items;
  if (Array.isArray(body.calls)) return body.calls;
  if (Array.isArray(body.callHistory)) return body.callHistory;
  if (Array.isArray(body.entries)) return body.entries;
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.collection?.items)) return body.collection.items;
  throw new Error("Call History API returned an unexpected response");
}

function pickField(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizeParty(value, fallbackLabel = "") {
  if (!value || typeof value !== "object") {
    return {
      number: String(value || ""),
      name: String(value || ""),
      email: "",
      type: "",
    };
  }
  return {
    number: String(pickField(value, ["number", "phoneNumber", "phone", "uri"], "")),
    name: String(pickField(value, ["name", "displayName", "label"], value.number || "")),
    email: String(pickField(value, ["email", "mail"], "")),
    type: String(pickField(value, ["service", "type", "kind", "destination_type"], "")),
    context: String(pickField(value, ["context"], "")),
  };
}

function normalizeDirection(value) {
  const text = String(value || "").toLowerCase();
  if (["in", "incoming", "inbound", "eingehend"].includes(text)) return "inbound";
  if (["out", "outgoing", "outbound", "ausgehend"].includes(text)) return "outbound";
  return "unknown";
}

function normalizeOutcome(value) {
  const text = String(value || "").toLowerCase();
  if (["answered"].includes(text)) return "answered";
  if (["missed"].includes(text)) return "missed";
  if (["cancelled"].includes(text)) return "cancelled";
  return "unknown";
}

function safeIsoDate(value) {
  if (!value) return "";
  // Numeric epochs are accepted only when their magnitude unambiguously denotes
  // modern Unix seconds or milliseconds. Ambiguous numbers remain undated.
  const numeric = typeof value === "number" || /^\d{10,13}$/.test(String(value)) ? Number(value) : NaN;
  const date = new Date(Number.isFinite(numeric) ? (numeric >= 1e9 && numeric < 1e11 ? numeric * 1000 : numeric >= 1e12 && numeric < 1e14 ? numeric : NaN) : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : "";
}

function callQueue(item) {
  const destinations = [item.callee, item.to, ...(Array.isArray(item.history) ? item.history.filter(hop => hop && typeof hop === "object").map(hop => hop.callee) : []), item.caller, item.from];
  const queue = destinations.find(party => ["queue", "skill"].includes(String(party?.service || party?.destination_type || "").toLowerCase()));
  return queue ? normalizeParty(queue) : null;
}

function normalizeCalls(items, source) {
  return items.map((item, index) => {
    const startedAt = pickField(item, ["startedAt", "startTime", "started_at", "timestamp", "time", "created"], "");
    const endedAt = pickField(item, ["endedAt", "endTime", "ended_at"], "");
    const durationSeconds = Number(pickField(item, ["durationSeconds", "duration", "talkTimeSeconds", "duration_sec"], 0)) || 0;
    const from = normalizeParty(pickField(item, ["from", "caller", "source", "origin"], {
      number: pickField(item, ["fromNumber", "callerNumber", "sourceNumber"], ""),
      name: pickField(item, ["fromName", "callerName", "sourceName"], ""),
    }), "Anrufer");
    const to = normalizeParty(pickField(item, ["to", "callee", "target", "destination"], {
      number: pickField(item, ["toNumber", "calleeNumber", "targetNumber", "destinationNumber"], ""),
      name: pickField(item, ["toName", "calleeName", "targetName", "destinationName"], ""),
    }), "Ziel");
    const direction = normalizeDirection(pickField(item, ["direction", "callDirection"], ""));
    const outcome = normalizeOutcome(pickField(item, ["outcome", "result", "status", "disposition"], ""));
    const transcription = item.transcription && typeof item.transcription === "object" ? item.transcription : null;
    const user = item.user || item.owner || item.agent || (direction === "outbound" ? from : to);
    return {
      id: String(pickField(item, ["id", "callId", "uuid", "conversationId"], `${source}-${index + 1}`)),
      startedAt: safeIsoDate(startedAt),
      endedAt: safeIsoDate(endedAt),
      queue: source === "demo" && item.queue ? normalizeParty(item.queue) : callQueue(item),
      direction,
      outcome,
      durationSeconds,
      from,
      to,
      user: normalizeParty(user, "User"),
      transcriptId: transcription?.available === false ? "" : String(pickField(item, ["transcriptId", "transcript_id", "summaryId"], transcription?.available === true ? item.uuid : "")),
      summary: String(pickField(item, ["summary", "callSummary", "note"], transcription?.summary || "")),
      contact: item.contact || null,
      tags: Array.isArray(item.tags) ? item.tags : [
        transcription?.available ? "transcription" : "",
        item.trunk_code ? `trunk ${item.trunk_code}` : "",
      ].filter(Boolean),
      source,
      ...(source === "demo" && item.demoTemplate === "call-history-v1" ? { demoTemplate: item.demoTemplate } : {}),
      rawType: item.type || "",
      transcriptionAvailable: transcription ? transcription.available === true : Boolean(item.transcriptId || item.transcript_id),
    };
  });
}

function loadDemoCalls() {
  return createDemoCallHistoryData().calls;
}

function loadDemoTranscript(transcriptId) {
  const transcripts = createDemoCallHistoryData().transcripts;
  const found = transcripts.find((item) => String(item.id) === String(transcriptId));
  if (!found) {
    return {
      ok: false,
      id: transcriptId,
      source: "demo",
      summary: "No transcript is available for this demo call.",
      text: "",
      topics: [],
    };
  }
  return normalizeTranscript(found, "demo");
}

function createDemoCallHistoryData() {
  const customers = [
    ["Mara Seidel", "Demo Account A", "mara.seidel@example.local", "+49 89 0000 2101"],
    ["Klaus Berger", "Demo Account B", "klaus.berger@example.local", "+49 89 0000 2102"],
    ["Nadine Roth", "Demo Account C", "nadine.roth@example.local", "+49 89 0000 2103"],
    ["Oliver Brandt", "Demo Account D", "oliver.brandt@example.local", "+49 89 0000 2104"],
    ["Fatima Yildiz", "Demo Account E", "fatima.yildiz@example.local", "+49 89 0000 2105"],
    ["Henrik Vogt", "Demo Account F", "henrik.vogt@example.local", "+49 89 0000 2106"],
    ["Carla Nguyen", "Demo Account G", "carla.nguyen@example.local", "+49 89 0000 2107"],
    ["Ben Hoffmann", "Demo Account H", "ben.hoffmann@example.local", "+49 89 0000 2108"],
    ["Iris Schaefer", "Demo Account I", "iris.schaefer@example.local", "+49 89 0000 2109"],
    ["David Lorenz", "Demo Account J", "david.lorenz@example.local", "+49 89 0000 2110"],
    ["Selin Aydin", "Demo Account K", "selin.aydin@example.local", "+49 89 0000 2111"],
    ["Robert Hahn", "Demo Account L", "robert.hahn@example.local", "+49 89 0000 2112"],
  ];
  const agents = [
    ["201", "Anna Weber", "Reception"],
    ["202", "Max Schneider", "Sales"],
    ["203", "Laura Fischer", "Support"],
    ["204", "Mehmet Kaya", "Customer Success"],
    ["205", "Sophie Neumann", "Operations"],
    ["206", "Jonas Becker", "Sales"],
    ["207", "Mira Hoffmann", "Support"],
    ["208", "Daniel Wagner", "Finance"],
    ["209", "Nina Bauer", "Service"],
    ["210", "Felix Richter", "Service"],
    ["211", "Lea Wolf", "Backoffice"],
    ["212", "Tim Schwarz", "Logistics"],
  ];
  const queues = ["Reception", "Sales", "Support", "Customer Success", "Service", "Backoffice"];
  const calls = [];
  const today = new Date();

  for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
    const date = new Date(today);
    date.setDate(today.getDate() - dayOffset);
    const count = demoCallHistoryBusinessVolume(date, dayOffset);
    for (let index = 0; index < count; index += 1) {
      const customer = customers[(index * 5 + dayOffset) % customers.length];
      const agent = agents[(index * 7 + dayOffset) % agents.length];
      const queue = queues[(index * 3 + dayOffset) % queues.length];
      const direction = seededDemoPick(index * 17 + dayOffset * 13, 100) < 64 ? "inbound" : "outbound";
      const answered = direction === "outbound"
        ? seededDemoPick(index * 31 + dayOffset, 100) < 92
        : seededDemoPick(index * 29 + dayOffset, 100) < 76;
      const outcome = answered
        ? "answered"
        : direction === "outbound" && seededDemoPick(index * 11 + dayOffset, 100) < 55
          ? "cancelled"
          : "missed";
      const durationSeconds = outcome === "answered"
        ? 65 + seededDemoPick(index * 37 + dayOffset * 19, 870)
        : 0;
      const startedAt = demoCallHistoryStartedAt(date, index, dayOffset);
      if (startedAt.getTime() + durationSeconds * 1000 > today.getTime()) continue;
      const id = `demo-call-${demoDayKey(startedAt).replaceAll("-", "")}-${String(index + 1).padStart(3, "0")}`;
      const hasTranscript = outcome === "answered"
        && seededDemoPick(index * 41 + dayOffset * 23, 100) < (direction === "inbound" ? 72 : 46);
      calls.push(demoCallAt({
        id,
        startedAt,
        direction,
        outcome,
        transcriptId: hasTranscript ? `tr-${id}` : "",
        contactName: customer[0],
        company: customer[1],
        email: customer[2],
        phone: customer[3],
        queue,
        extension: agent[0],
        agentName: agent[1],
        durationSeconds,
      }));
    }
  }

  calls.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
  const transcripts = calls.filter((call) => call.transcriptId).map(demoCallHistoryTranscript);
  return { calls, transcripts };
}

function demoCallAt({ id, startedAt, direction, outcome, transcriptId, contactName, company, email, phone, queue, extension, agentName, durationSeconds }) {
  const relativeMinutesAgo = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 60000));
  const external = { number: phone, name: contactName, type: "external" };
  const internal = { number: extension, name: queue, type: "extension" };
  const endedAt = durationSeconds ? new Date(startedAt.getTime() + durationSeconds * 1000).toISOString() : "";
  return {
    id,
    relativeMinutesAgo,
    queue: { name: queue, number: "", service: "queue" },
    demoTemplate: "call-history-v1",
    startedAt: startedAt.toISOString(),
    endedAt,
    direction,
    from: direction === "inbound" ? external : internal,
    to: direction === "inbound" ? internal : external,
    user: {
      number: extension,
      name: agentName,
      email: `${agentName.toLowerCase().replaceAll(" ", ".")}@example.local`,
    },
    durationSeconds,
    outcome,
    transcriptId,
    summary: `${contactName} · ${queue} · Demo system`,
    contact: company ? { name: contactName, company, email } : null,
    tags: ["demo", queue.toLowerCase().replaceAll(" ", "-")],
    source: "demo",
  };
}

function demoCallHistoryTranscript(call) {
  const customerName = call.contact?.name || (call.direction === "outbound" ? call.to.name : call.from.name);
  const company = call.contact?.company || "Demo system";
  return {
    ok: true,
    id: call.transcriptId,
    callId: call.id,
    language: "en",
    confidence: 0.89 + seededDemoPick(call.relativeMinutesAgo, 9) / 100,
    summary: `${customerName} from ${company} discussed the current service request. The next steps were documented.`,
    text: [
      `${customerName}: We need an update on the current service request.`,
      `${call.user.name}: I will check the status and document the next steps.`,
    ].join("\n"),
    topics: ["Demo", "Call History", call.user.name, call.contact?.company || "Unknown"],
    assignee: { name: call.user.name, email: call.user.email },
  };
}

function demoCallHistoryStartedAt(date, index, dayOffset) {
  const startedAt = new Date(date);
  startedAt.setHours(
    demoCallHistoryBusinessHour(index, dayOffset),
    seededDemoPick(index * 43 + dayOffset, 60),
    seededDemoPick(index * 47 + dayOffset, 60),
    0,
  );
  return startedAt;
}

function demoCallHistoryBusinessVolume(date, dayOffset) {
  return DEMO_CALL_HISTORY_CALLS_PER_DAY;
}

function demoCallHistoryBusinessHour(index, dayOffset) {
  const buckets = [
    [8, 7],
    [9, 13],
    [10, 15],
    [11, 12],
    [12, 6],
    [13, 10],
    [14, 16],
    [15, 12],
    [16, 7],
    [17, 2],
  ];
  let pick = seededDemoPick(index * 19 + dayOffset * 31, 100);
  for (const [hour, weight] of buckets) {
    if (pick < weight) return hour;
    pick -= weight;
  }
  return 16;
}

function demoDayKey(date) {
  return new Date(date).toLocaleDateString("sv-SE");
}

function seededDemoPick(seed, max) {
  const x = Math.sin(seed + 1) * 10000;
  return Math.floor((x - Math.floor(x)) * max);
}

function normalizeTranscript(body, source) {
  const item = body?.transcript && typeof body.transcript === "object" ? body.transcript : body;
  const transcription = item?.transcription && typeof item.transcription === "object" ? item.transcription : null;
  const transcriptEntries = Array.isArray(transcription?.transcript) ? transcription.transcript : [];
  const transcriptText = transcriptEntries
    .filter((entry) => entry?.event === "speech" && entry.text)
    .map((entry) => {
      const party = entry.source === "caller" ? item.caller : entry.source === "callee" ? item.callee : null;
      return `${party?.name || party?.number || entry.source || ""}: ${entry.text}`;
    })
    .join("\n");
  return {
    ok: true,
    id: String(pickField(item, ["id", "transcriptId", "uuid"], "")),
    source,
    language: String(pickField(item, ["language", "locale"], transcription?.language_autodetect ? "auto" : "")),
    summary: String(pickField(item, ["summary", "callSummary"], transcription?.summary || "")),
    text: String(pickField(item, ["text", "content"], transcriptText)),
    topics: Array.isArray(item?.topics) ? item.topics : [],
    assignee: item?.assignee || null,
    confidence: Number(pickField(item, ["confidence"], 0)) || 0,
    transcript: transcriptEntries,
    available: Boolean(transcription?.available || item.available),
  };
}

function phoneSearchDigits(value) {
  return String(value || "").replace(/\(0\)/g, "").replace(/^\s*00/, "+").replace(/\D/g, "");
}
function phoneSearchMatches(value, query) {
  const haystack = phoneSearchDigits(value), needle = phoneSearchDigits(query);
  if (!needle) return false;
  return haystack.includes(needle) || (needle.startsWith("0") && needle.length >= 7 && haystack.includes(needle.slice(1)));
}

function filterCalls(calls, filters) {
  const { start, end } = dateWindow(filters);
  const party = filters.party.trim().toLowerCase();
  const digits = party.replace(/\D/g, "");
  const phoneSearch = /^[+\d\s()./-]+$/.test(party) && Boolean(digits);
  return calls.filter((call) => {
    const started = new Date(call.startedAt);
    if (!call.startedAt || started < start || started > end) return false;
    if (filters.direction !== "all" && call.direction !== filters.direction) return false;
    if (filters.outcome !== "all" && call.outcome !== filters.outcome) return false;
    if (party) {
      const haystack = [
        call.from?.number,
        call.from?.name,
        call.to?.number,
        call.to?.name,
        call.user?.name,
        call.user?.number,
        call.contact?.name,
        call.contact?.company,
      ].filter(Boolean).join(" ").toLowerCase();
      const phoneMatch = phoneSearch && [call.from?.number, call.to?.number, call.user?.number].some(value => phoneSearchMatches(value, party));
      if (!haystack.includes(party) && !phoneMatch) return false;
    }
    return true;
  });
}

function statusPayload() {
  const token = readStoredToken();
  const authenticated = Boolean(token?.accessToken && (!token.expiresAt || token.expiresAt > Date.now() || token.refreshToken));
  return {
    ok: true,
    configured: config.configured,
    oauthConfigured: config.oauthConfigured,
    historyConfigured: config.historyConfigured,
    transcriptsConfigured: config.transcriptsConfigured,
    authenticated,
    sessionRevision: `${sessionRevisionBase}:${sessionGeneration}`,
    appId: "core-history",
    tokenExpiresAt: token?.expiresAt || 0,
    account: authenticated ? [token.userName, token.userEmail].filter(Boolean).join(" · ") : "",
    redirectUri: config.redirectUri,
    publicBaseUrl: config.publicBaseUrl,
    csrfToken,
    demoMode: config.demoMode,
    settings: {
      authMode: runtimeSettings.authMode,
      browserCredentialsActive: runtimeSettings.browserCredentialsActive,
      browserCredentialsUpdatedAt: runtimeSettings.browserCredentialsUpdatedAt,
      envFileSupported: true,
      required: [
        "CALLHISTORY_CLIENT_ID",
      ],
      optional: ["CALLHISTORY_REDIRECT_URI"],
    },
    secrets: {
      clientIdConfigured: Boolean(config.clientId),
      envAccessTokenConfigured: Boolean(config.envAccessToken),
    },
  };
}

function applyBrowserLoginSettings(payload) {
  const next = {
    clientId: String(payload.clientId || "").trim(),
    redirectUri: String(payload.redirectUri || "").trim(),
  };
  if (!next.clientId) {
    const error = new Error("Client ID is required");
    error.statusCode = 400;
    throw error;
  }
  if (next.redirectUri) {
    let parsed;
    try {
      parsed = new URL(next.redirectUri);
    } catch {
      const error = new Error("Redirect URI is not a valid URL");
      error.statusCode = 400;
      throw error;
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.hash) {
      const error = new Error("Redirect URI must use HTTP/HTTPS and must not contain a fragment");
      error.statusCode = 400;
      throw error;
    }
    config.redirectUri = parsed.toString().replace(/\/$/, "");
  }
  config.clientId = next.clientId;
  config.envAccessToken = "";
  config.envRefreshToken = "";
  runtimeSettings.authMode = "browser";
  runtimeSettings.browserCredentialsActive = true;
  runtimeSettings.browserCredentialsUpdatedAt = new Date().toISOString();
  recomputeConfigFlags();
}

function hasLiveAccessToken() {
  if (config.envAccessToken) return true;
  return Boolean(readStoredToken()?.accessToken);
}

function demoCallsPayload(filters, reason = "") {
  const calls = filterCalls(normalizeCalls(loadDemoCalls(), "demo"), filters);
  return {
    ok: true,
    source: reason ? "demo-fallback" : "demo",
    reason,
    generatedAt: new Date().toISOString(),
    filters,
    calls,
  };
}

async function handleAuthLogin(req, res, url) {
  assertAllowedOrigin(req);
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "same-site", "none"].includes(String(site))) {
    sendError(req, res, 403, "Cross-site OAuth start is blocked");
    return;
  }
  if (!config.oauthConfigured) {
    sendError(req, res, 400, "Login with NFON is not configured");
    return;
  }
  const state = crypto.randomBytes(18).toString("base64url");
  const codeVerifier = base64Url(crypto.randomBytes(48));
  const codeChallenge = sha256Base64Url(codeVerifier);
  for (const [key, entry] of oauthStates) if (Date.now() - entry.createdAt > 600000) oauthStates.delete(key);
  if (oauthStates.size >= 10) oauthStates.delete(oauthStates.keys().next().value);
  const theme = ["classic", "admin-portal"].includes(url.searchParams.get("theme")) ? url.searchParams.get("theme") : "";
  const lang = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "cs"].includes(url.searchParams.get("lang")) ? url.searchParams.get("lang") : "";
  const cockpit = validatedCockpit(url.searchParams.get("cockpit"), url.origin);
  oauthStates.set(state, { codeVerifier, createdAt: Date.now(), generation: oauthGeneration, theme, lang, cockpit });

  const authUrl = new URL(config.authUrl);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", config.clientId);
  authUrl.searchParams.set("redirect_uri", config.redirectUri);
  authUrl.searchParams.set("scope", config.scope);
  authUrl.searchParams.set("state", state);
  authUrl.searchParams.set("code_challenge", codeChallenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  sendRedirect(res, authUrl.toString());
}

function validatedCockpit(value, currentOrigin) {
  if (!value) return "";
  try {
    const target = new URL(value);
    const current = new URL(currentOrigin);
    const loopback = hostname => ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
    if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) return "";
    if (target.origin !== current.origin && !(loopback(target.hostname) && loopback(current.hostname))) return "";
    target.hash = "";
    return target.href;
  } catch { return ""; }
}

function authReturnPath(auth, preferences = {}) {
  const query = new URLSearchParams({ auth });
  if (preferences.theme) query.set("theme", preferences.theme);
  if (preferences.lang) query.set("lang", preferences.lang);
  if (preferences.cockpit) query.set("cockpit", preferences.cockpit);
  return "/?" + query;
}

function sendAuthFailure(res, preferences) {
  // Only validated presentation preferences cross origins; no token or provider text.
  sendRedirect(res, authReturnPath("failed", preferences));
}

async function handleAuthCallback(req, res, url) {
  const returnedState = url.searchParams.get("state");
  const storedState = oauthStates.get(returnedState);
  if (!storedState || storedState.generation !== oauthGeneration) { sendAuthFailure(res); return; }
  if (Date.now() - storedState.createdAt > 600000) {
    oauthStates.delete(returnedState);
    sendAuthFailure(res, storedState); return;
  }
  oauthStates.delete(returnedState); // Single-use before any asynchronous exchange.
  const code = url.searchParams.get("code");
  if (url.searchParams.get("error") || !code) { sendAuthFailure(res, storedState); return; }

  try {
    const form = tokenRequestParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: storedState.codeVerifier,
    });
    const response = await fetchUpstream(config.tokenUrl, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": userAgent,
      },
      body: form,
    });
    const body = await readResponseBody(response);
    if (!response.ok || !body?.access_token || storedState.generation !== oauthGeneration) {
      sendAuthFailure(res, storedState); return;
    }
    const generation = await writeStoredToken(normalizeToken(body), storedState.generation, { newSession: true });
    requireSessionGeneration(generation);
    sendRedirect(res, authReturnPath("connected", storedState));
  } catch { sendAuthFailure(res, storedState); }
}

function isAuthCallbackRequest(url) {
  const callbackPaths = new Set([
    "/",
    "/auth/call-history/callback",
    "/auth/nfon/callback",
  ]);
  const hasCallbackPayload = url.searchParams.has("code")
    || (url.searchParams.has("error") && url.searchParams.has("state"));
  return callbackPaths.has(url.pathname) && hasCallbackPayload;
}

async function handleApi(req, res, url) {
  assertAllowedOrigin(req);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    requireCsrf(req);
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    sendJson(req, res, 200, statusPayload());
    return;
  }

  if (url.pathname === "/api/settings/browser-login" && req.method === "POST") {
    requireLocalRequest(req);
    applyBrowserLoginSettings(await readRequestJson(req));
    await clearStoredToken();
    sendJson(req, res, 200, { ok: true, status: statusPayload() });
    return;
  }

  if (url.pathname === "/api/auth/logout" && req.method === "POST") {
    requireLocalRequest(req);
    await clearStoredToken();
    sendJson(req, res, 200, { ok: true });
    return;
  }

  if (url.pathname === "/api/calls" && req.method === "GET") {
    const filters = requestFilters(url.searchParams);
    if (filters.mode === "demo" || config.demoMode || !config.configured) {
      const reason = config.configured ? "" : "Call History API is not fully configured.";
      sendJson(req, res, 200, demoCallsPayload(filters, reason));
      return;
    }
    if (!hasLiveAccessToken()) {
      sendError(req, res, 401, "Login with NFON is required for live call history");
      return;
    }

    try {
      const result = await liveCallHistory(filters);
      const calls = filterCalls(result.calls, filters);
      sendJson(req, res, 200, {
        ok: true,
        source: "callhistory-live",
        generatedAt: new Date().toISOString(),
        filters,
        calls,
        pagination: result.pagination,
        invalidRecords: result.invalidRecords,
      });
    } catch (error) {
      sendError(req, res, error.statusCode || 502, error.statusCode === 401 ? "Login with NFON is required for live call history" : "Live Call History request failed", {
        source: "callhistory-live",
        reason: error.message,
      });
    }
    return;
  }

  const transcriptMatch = url.pathname.match(/^\/api\/transcripts\/([^/]+)$/);
  if (transcriptMatch && req.method === "GET") {
    const transcriptId = decodeURIComponent(transcriptMatch[1]);
    const mode = url.searchParams.get("mode") || "";
    if (mode === "demo" || config.demoMode || !config.configured || !config.transcriptsConfigured) {
      sendJson(req, res, 200, loadDemoTranscript(transcriptId));
      return;
    }
    if (!hasLiveAccessToken()) {
      sendError(req, res, 401, "Login with NFON is required for live transcript details");
      return;
    }

    try {
      sendJson(req, res, 200, await liveTranscript(transcriptId));
    } catch (error) {
      sendError(req, res, error.statusCode || 502, error.statusCode === 401 ? "Login with NFON is required for live transcript details" : "Live transcript request failed", {
        source: "callhistory-live",
        reason: error.message,
      });
    }
    return;
  }


  sendError(req, res, 404, "API route not found");
}

async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(req, res, 403, "Forbidden");
    return;
  }

  const ext = path.extname(filePath);
  let data;
  try { data = await readPublicFile(PUBLIC_DIR, filePath); }
  catch (error) {
    const forbidden = error.code === "EACCES";
    if (forbidden || ["ENOENT", "ENOTDIR", "EISDIR", "ENAMETOOLONG"].includes(error.code)) {
      sendError(req, res, forbidden ? 403 : 404, forbidden ? "Forbidden" : "File not found"); return;
    }
    throw error;
  }
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    // The sandboxed CRM has an opaque origin. Only public font files are shared.
    ...(ext === ".woff2" && pathname.startsWith("/assets/fonts/") ? { "Access-Control-Allow-Origin": "*" } : {}),
    "Cache-Control": staticCacheControl(req.url),
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  if (!guardRequest(req, res, { framePaths: ["/crm-demo/", "/crm-demo/index.html", "/crm-demo/offline.html"] })) return;
  try {
    if (req.method === "OPTIONS") {
      assertAllowedOrigin(req);
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    const url = requestUrl(req);
    if (req.method === "GET" && isAuthCallbackRequest(url)) {
      await handleAuthCallback(req, res, url).catch(() => sendAuthFailure(res));
      return;
    }
    if (url.pathname === "/auth/login" && req.method === "GET") {
      await handleAuthLogin(req, res, url);
      return;
    }
    if (url.pathname === "/auth/call-history/callback" && req.method === "GET") {
      await handleAuthCallback(req, res, url);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(req, res, 405, "Method not allowed");
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendError(req, res, error.statusCode || 500, error.message || "Unexpected server error");
  }
});

repairRuntimeFileModes()
  .then(() => {
    server.listen(config.port, config.host, () => {
      console.log(`NFON Call History API listening at http://${config.host}:${config.port}`);
      console.log(`Call History configured: ${config.configured ? "yes" : "no"}; OAuth: ${config.oauthConfigured ? "yes" : "no"}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
