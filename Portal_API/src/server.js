const { responseMessages, serverMessage, messageDescriptor } = require("./messages.cjs");
const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { URL } = require("url");
const { loadEnvFile, parseEnvFlag, guardRequest, requestUrl, staticCacheControl, readPublicFile } = require("./server-safety.cjs");
const { AsyncLocalStorage } = require("async_hooks");
const requestContext = new AsyncLocalStorage();
let accountGeneration = 0;
// Bound to the displayed account/login session, not just to a CSRF/browser session.
// A fresh process and every credential/account change invalidate prepared writes.
let writeContext = crypto.randomBytes(32).toString("hex");
let mutationInFlight = false;

const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const APP_CONFIG_NAME = "Portal_API";

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

try {
  loadLocalEnv(APP_CONFIG_NAME);
} catch (error) {
  console.error(`Portal configuration error: ${error.message}`);
  process.exit(1);
}

const DATA_DIR = dataDirForApp(APP_CONFIG_NAME, "PORTAL_DATA_DIR");
const DAYNIGHT_GATEWAY_SNAPSHOT = path.join(DATA_DIR, "daynight-gateway-migration.json");
const DEFAULT_PORT = 3001;
const DEFAULT_JSON_LIMIT = 1024 * 1024;
const UPLOAD_JSON_LIMIT = 5 * 1024 * 1024;
const csrfToken = crypto.randomBytes(32).toString("base64url");
const REQUIRED_ENDPOINT_KEYS = ["extensions", "devices", "trunks", "dids", "phoneBooks", "groups", "ivrs", "timeControls", "announcements"];
const OPTIONAL_ENDPOINT_KEYS = new Set(["version", "basicData", "contract", "featureStatus", "queues", "skills", "voicemails", "frontdesks"]);

const MIME_TYPES = {
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

const cache = {
  overview: null,
  callflow: null,
  syncedAt: null,
  errors: {},
};

function firstExistingFile(files) {
  return files.find((file) => file && fs.existsSync(file)) || "";
}

function resolveLocalFile(file) {
  if (!file) return "";
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

function envFlag(name, fallback = false) {
  return parseEnvFlag(name, process.env[name], fallback);
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

function httpError(status, message) {
  const error = new Error(message);
  if (message?.messageKey) error.localizedMessage = message;
  error.status = status;
  return error;
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round(bytes / 1024 / 1024)} MB`;
}

function stripRtf(text) {
  return text
    .replace(/\\par[d]?/g, "\n")
    .replace(/\\'[0-9a-fA-F]{2}/g, "")
    .replace(/\\[a-zA-Z]+\d* ?/g, "")
    .replace(/[{}]/g, "")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}

function readTextFile(file) {
  if (!file || !fs.existsSync(file)) return "";
  const raw = fs.readFileSync(file, "utf8");
  if (!raw.trimStart().startsWith("{\\rtf")) return raw.trim();

  try {
    return execFileSync("textutil", ["-convert", "txt", "-stdout", file], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return stripRtf(raw);
  }
}

function normalizeSecretKey(key) {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseKeyValueSecret(text) {
  const pairs = {};
  const looseValues = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = line.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (match) {
      pairs[normalizeSecretKey(match[1])] = match[2].trim();
    } else {
      looseValues.push(line);
    }
  }

  const pick = (...keys) => {
    for (const key of keys) {
      const value = pairs[normalizeSecretKey(key)];
      if (value) return value;
    }
    return "";
  };

  return {
    apiKeyId: pick("API_KEY_ID", "apiKeyId", "keyId", "publicKey", "PUBLIC_KEY", "id", "clientId") || looseValues[0] || "",
    apiKeySecret: pick("API_KEY_SECRET", "apiKeySecret", "keySecret", "secret") || looseValues[1] || "",
    customerAccount: pick("CUSTOMER_ACCOUNT", "customer", "customerId", "account", "kAccount"),
  };
}

function parseCtiAccount(text) {
  return text.trim().split(/\s+/, 1)[0] || "";
}

function localSecretCandidates(names) {
  const configDir = configuredLocalConfigDir();
  const dirs = [
    configDir ? path.join(configDir, "secrets", APP_CONFIG_NAME) : "",
  ].filter(Boolean);
  return dirs.flatMap((dir) => names.map((name) => path.join(dir, name)));
}

function readConfig() {
  const configDir = configuredLocalConfigDir();
  const portalSecretFile = process.env.PORTAL_SECRET_FILE
    ? resolveLocalFile(process.env.PORTAL_SECRET_FILE)
    : firstExistingFile(localSecretCandidates([
      "Portal_API_secret.rtf",
      "Portal_API_secret.txt",
      "portal_api_secret.txt",
      "portal-api-secret.txt",
    ]));
  const ctiSecretFile = process.env.NFON_SECRET_FILE
    ? resolveLocalFile(process.env.NFON_SECRET_FILE)
    : firstExistingFile([
      configDir ? path.join(configDir, "secrets", APP_CONFIG_NAME, "CTI_secret.txt") : "",
    ]);

  const portalSecret = parseKeyValueSecret(readTextFile(portalSecretFile));
  const customerFromCti = parseCtiAccount(readTextFile(ctiSecretFile));
  const liveWritesLocked = envFlag("PORTAL_DISABLE_LIVE_WRITES", false);
  // Server permission unlocks the Setup switch; each process still starts read-only.
  const liveWritesEnabled = false;
  const config = {
    baseUrl: process.env.PORTAL_BASE_URL || "https://portal-api.nfon.net:8090",
    apiKeyId: process.env.PORTAL_API_KEY_ID || portalSecret.apiKeyId,
    apiKeySecret: process.env.PORTAL_API_KEY_SECRET || portalSecret.apiKeySecret,
    customerAccount: process.env.PORTAL_CUSTOMER_ACCOUNT || portalSecret.customerAccount || customerFromCti,
    appName: process.env.APP_NAME || "nfon-portal-api-showcase",
    appVersion: process.env.APP_VERSION || "1.2.0",
    port: Number(process.env.PORT || DEFAULT_PORT),
    host: process.env.HOST || "127.0.0.1",
    allowedOrigin: process.env.PORTAL_ALLOWED_ORIGIN || process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || DEFAULT_PORT}`,
    portalSecretFile,
    ctiSecretFile,
    googleContactsFile: process.env.PORTAL_GOOGLE_CONTACTS_FILE
      ? resolveLocalFile(process.env.PORTAL_GOOGLE_CONTACTS_FILE)
      : firstExistingFile([
        configDir ? path.join(configDir, "data", "CTI_API", "google-contacts.json") : "",
        path.join(ROOT, "data", "google-contacts.json"),
      ]),
    liveWritesEnabled,
    liveWritesPermitted: envFlag("PORTAL_ENABLE_LIVE_WRITES", false),
    liveWritesLocked,
  };

  config.configured = Boolean(config.apiKeyId && config.apiKeySecret && config.customerAccount);
  return config;
}

let config;
try {
  config = readConfig();
} catch (error) {
  console.error(`Portal configuration error: ${error.message}`);
  process.exit(1);
}
const allowedOrigins = new Set([
  ...localhostOriginVariants(`http://localhost:${config.port}`),
  ...localhostOriginVariants(`http://127.0.0.1:${config.port}`),
  ...splitOrigins(config.allowedOrigin).flatMap(localhostOriginVariants),
]);
const runtimeSettings = {
  liveWritesEnabled: config.liveWritesEnabled,
  liveWritesChangedAt: "",
  authMode: "env",
  browserCredentialsChangedAt: "",
  googleContactsFile: "",
  phonebookMapping: {
    firstName: "firstName",
    lastName: "name",
    displayName: "name",
    displayNumber: "phones",
  },
};

function currentUserAgent() {
  return `${config.appName}/${config.appVersion} (${config.customerAccount || "unknown"})`;
}

function liveWritesDisabledMessage() {
  if (config.liveWritesLocked) return "Live writes are locked by the server configuration (PORTAL_DISABLE_LIVE_WRITES).";
  return "Live-Schreiben ist fuer diese Sitzung deaktiviert. Aktiviere es bewusst im Setup, wenn Confirmations, Audit-Log und Rollback fuer die Aktion freigegeben sind.";
}

function areLiveWritesEnabled() {
  return config.configured && config.liveWritesPermitted && runtimeSettings.liveWritesEnabled && !config.liveWritesLocked;
}

function liveWritesDisabledError() {
  const error = new Error(liveWritesDisabledMessage());
  error.status = 423;
  error.code = config.liveWritesLocked ? "LIVE_WRITES_LOCKED" : "LIVE_WRITES_DISABLED";
  return error;
}

function assertLiveWritesEnabled() {
  if (areLiveWritesEnabled()) return;
  if (config.liveWritesPermitted && !config.liveWritesLocked && !config.configured) throw httpError(409, serverMessage("portal.error.notConfigured"));
  throw liveWritesDisabledError();
}

function clearPortalCache() {
  accountGeneration += 1;
  writeContext = crypto.randomBytes(32).toString("hex");
  const scope = requestContext.getStore();
  if (scope?.changesAccount) scope.generation = accountGeneration;
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  cache.errors = {};
  cache.managedTimeControls = [];
  discoveryCache.clear();
  upstreamRetryAfter = 0;
}

function liveWritesDisabledResult(base = {}) {
  return {
    ...base,
    ok: false,
    status: 423,
    dryRun: false,
    applied: false,
    blocked: true,
    code: config.liveWritesLocked ? "LIVE_WRITES_LOCKED" : "LIVE_WRITES_DISABLED",
    title: "Live-Schreiben deaktiviert",
    message: liveWritesDisabledMessage(),
    liveWritesEnabled: areLiveWritesEnabled(),
    createdAt: base.createdAt || new Date().toISOString(),
  };
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
  res.end(JSON.stringify(responseMessages(body, status), null, 2));
}

function sendError(req, res, status, message, details = {}) {
  sendJson(req, res, status, { ok: false, error: message, ...details });
}

function portalErrorMessage(error) {
  if (error?.localizedMessage) return error.localizedMessage;
  if (!(error instanceof PortalApiError)) return error?.message || "Portal API Fehler";
  const body = error?.body;
  const bodyText = typeof body === "string"
    ? body
    : body?.message || body?.error || body?.title || JSON.stringify(body || "");
  return [error?.message || "Portal API Fehler", bodyText]
    .filter(Boolean)
    .join(" · ");
}

function portalErrorDetail(error) {
  const body = error?.body;
  if (!body) return "";
  if (typeof body === "string") return body.slice(0, 600);

  const details = [];
  for (const key of ["detail", "details", "description", "reason"]) {
    if (body[key]) details.push(String(body[key]));
  }
  const nestedErrors = Array.isArray(body.errors)
    ? body.errors
    : Array.isArray(body.validationErrors)
      ? body.validationErrors
      : [];
  for (const item of nestedErrors.slice(0, 5)) {
    if (typeof item === "string") {
      details.push(item);
    } else if (item && typeof item === "object") {
      details.push([item.field, item.name, item.message, item.error].filter(Boolean).join(": "));
    }
  }
  if (!details.length) details.push(JSON.stringify(body));
  return details.filter(Boolean).join(" · ").slice(0, 600);
}

function assertAllowedOrigin(req) {
  const origin = requestOrigin(req);
  if (originAllowed(origin)) return;
  throw httpError(403, "Origin is not allowed for this local Portal API");
}

function requireCsrf(req) {
  assertAllowedOrigin(req);
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "same-site", "none"].includes(String(site))) {
    throw httpError(403, "Cross-site Portal actions are blocked");
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
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw httpError(400, "JSON request body must be an object.");
    return value;
  } catch (error) {
    if (error.status) throw error;
    throw httpError(400, "Malformed JSON request body");
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
  const temporary = file + "." + crypto.randomUUID() + ".tmp";
  await fsp.writeFile(temporary, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 });
  await fsp.rename(temporary, file);
  await repairPrivateFileMode(file);
}

async function repairRuntimeFileModes() {
  await ensureDataDir();
  await Promise.all([
    DAYNIGHT_GATEWAY_SNAPSHOT,
    path.join(DATA_DIR, "google-contacts-upload.json"),
  ].map(repairPrivateFileMode));
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

function makePortalHeaders(method, requestPath, bodyText = "", credentials = config) {
  const upperMethod = method.toUpperCase();
  const date = new Date().toUTCString();
  const headers = {
    "Accept": "application/vnd.collection.next+json, application/json;q=0.9, */*;q=0.8",
    "User-Agent": currentUserAgent(),
    "x-nfon-date": date,
  };

  let stringToSign = `${upperMethod}\n${date}\n${requestPath}`;
  if (bodyText && !["GET", "DELETE"].includes(upperMethod)) {
    const contentType = "application/json";
    const contentMd5 = crypto.createHash("md5").update(bodyText, "utf8").digest("hex");
    headers["Content-Type"] = contentType;
    headers["Content-MD5"] = contentMd5;
    stringToSign = `${upperMethod}\n${contentMd5}\n${contentType}\n${date}\n${requestPath}`;
  }

  const signature = crypto
    .createHmac("sha1", credentials.apiKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");

  headers.Authorization = `NFON-API ${credentials.apiKeyId}:${signature}`;
  return headers;
}

class PortalApiError extends Error {
  constructor(message, response, body) {
    super(message);
    this.name = "PortalApiError";
    if (message?.messageKey) this.localizedMessage = message;
    this.status = response?.status || 0;
    this.body = body;
  }
}

function portalTransportError(cause) {
  // Native fetch nests transport diagnostics in cause/AggregateError. Only expose
  // known codes and fixed messages, never raw connection details or credentials.
  const categories = [
    { kind: "dns", codes: ["ENOTFOUND", "EAI_AGAIN"], message: "Portal API hostname could not be resolved" },
    { kind: "timeout", codes: ["ETIMEDOUT", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT"], message: "Portal API connection timed out" },
    { kind: "tls", codes: ["CERT_HAS_EXPIRED", "CERT_NOT_YET_VALID", "DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "ERR_TLS_CERT_ALTNAME_INVALID"], message: "Portal API TLS certificate could not be verified" },
    { kind: "connection", codes: ["ECONNREFUSED", "ECONNRESET", "ENETUNREACH", "EHOSTUNREACH", "UND_ERR_SOCKET"], message: "Portal API connection could not be established" },
  ];
  const pending = [cause];
  const seen = new Set();
  let diagnostic;
  while (pending.length && seen.size < 16 && !diagnostic) {
    const current = pending.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const category = categories.find((entry) => entry.codes.includes(current.code));
    if (category) diagnostic = { ...category, code: current.code };
    else if (current.name === "TimeoutError") diagnostic = { kind: "timeout", code: "TIMEOUT", message: "Portal API connection timed out" };
    if (current.cause) pending.push(current.cause);
    if (Array.isArray(current.errors)) pending.push(...current.errors);
  }
  const error = new Error(diagnostic ? `${diagnostic.message} (${diagnostic.code}).` : "Portal API network request failed.");
  error.code = diagnostic?.code || "PORTAL_NETWORK_ERROR";
  error.kind = diagnostic?.kind || "network";
  return error;
}

let upstreamRetryAfter = 0;
const discoveryCache = new Map();

async function portalFetch(apiPath, options = {}) {
  const credentials = options.credentials || config;
  if (!credentials.configured) {
    throw httpError(409, serverMessage("portal.error.notConfigured"));
  }

  const scope = requestContext.getStore();
  if (scope && scope.generation !== accountGeneration) throw httpError(409, "Account changed. Reload before continuing.");
  const generation = accountGeneration;
  const method = (options.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
    assertLiveWritesEnabled();
    if (cache.overview?.endpoints) requireCompleteInventory(cache.overview);
    assertCustomerPath(apiPath);
    for (const link of options.body?.links || []) {
      if (link.href && String(link.href).includes("/customers/")) assertCustomerPath(link.href);
    }
  }
  if (Date.now() < upstreamRetryAfter) throw httpError(429, "Portal API rate limit reached. Retry later.");
  const bodyText = options.body ? JSON.stringify(options.body) : "";
  const url = new URL(apiPath, credentials.baseUrl);
  if (url.origin !== new URL(credentials.baseUrl).origin) throw httpError(400, "Portal URL must use the configured origin.");
  const requestPath = `${url.pathname}${url.search}`;
  let response;
  let body;
  try {
    response = await fetch(url, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: makePortalHeaders(method, requestPath, bodyText, credentials),
      body: bodyText || undefined,
    });
    body = await readResponseBody(response);
  } catch (error) {
    throw portalTransportError(error);
  }

  if (generation !== accountGeneration) throw httpError(409, "Account changed. Reload before continuing.");
  if (!response.ok) {
    if (response.status === 429) {
      const retry = response.headers.get("retry-after");
      const seconds = /^\d+$/.test(retry || "") ? Number(retry) : Math.ceil((Date.parse(retry) - Date.now()) / 1000);
      upstreamRetryAfter = Date.now() + Math.max(1, Math.min(300, Number.isFinite(seconds) ? seconds : 30)) * 1000;
    }
    // Do not reflect arbitrary upstream bodies or secrets into the browser.
    const message = response.status === 429 ? serverMessage("portal.error.rateLimit") : serverMessage("portal.requestFailed", {status:response.status});
    throw new PortalApiError(message, response, null);
  }

  return {
    ok: true,
    status: response.status,
    path: requestPath,
    location: response.headers.get("location") || "",
    contentType: response.headers.get("content-type") || "",
    body,
  };
}

function flattenData(data) {
  const out = {};
  if (!Array.isArray(data)) return out;

  for (const entry of data) {
    if (!entry || typeof entry !== "object") continue;
    if (entry.name) {
      out[entry.name] = entry.value ?? entry.values ?? entry.href ?? "";
    }
  }
  return out;
}

function normalizeItem(item) {
  if (!item || typeof item !== "object") return {};
  const links = item.links && typeof item.links === "object" && !Array.isArray(item.links) ? { ...item.links } : {};
  if (Array.isArray(item.links)) {
    for (const link of item.links) {
      const key = link.rel || link.name || link.prompt || link.href;
      if (key) links[key] = link.href || link;
    }
  }

  return {
    ...item,
    ...flattenData(item.data),
    href: item.href || "",
    links,
  };
}

function extractItems(body) {
  if (!body) return [];
  if (Array.isArray(body.items)) return body.items.map(normalizeItem);
  if (Array.isArray(body.entries)) return body.entries.map(normalizeItem);
  if (Array.isArray(body.collection?.items)) return body.collection.items.map(normalizeItem);
  if (Array.isArray(body)) return body.map(normalizeItem);
  if (Array.isArray(body.data) && body.data.some((entry) => entry?.name)) return [normalizeItem(body)];
  if (Array.isArray(body.data)) return body.data.map(normalizeItem);
  return [normalizeItem(body)];
}

function objectFromBody(body) {
  if (!body || typeof body !== "object") return {};
  return {
    ...body,
    ...flattenData(body.data),
  };
}

function lowerFieldMap(item) {
  const map = new Map();
  for (const [key, value] of Object.entries(item || {})) {
    map.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), value);
  }
  return map;
}

function pickField(item, keys, fallback = "") {
  const map = lowerFieldMap(item);
  for (const key of keys) {
    const value = map.get(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return fallback;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function valueByPath(item, pathName) {
  if (!pathName) return undefined;
  const direct = item?.[pathName];
  if (direct !== undefined) return direct;
  const parts = String(pathName).split(".").filter(Boolean);
  let value = item;
  for (const part of parts) {
    if (value === undefined || value === null) return undefined;
    value = value[part];
  }
  return value;
}

function stringFromMappedField(item, pathName, fallbackKeys = []) {
  const mapped = valueByPath(item, pathName);
  const first = firstArrayValue(mapped);
  if (first !== undefined && first !== null && first !== "") return String(first);
  return pickField(item, fallbackKeys, "");
}

function assertCustomerPath(value) {
  const url = new URL(value, config.baseUrl);
  const expected = "/api/customers/" + encodeURIComponent(config.customerAccount) + "/";
  if (url.origin !== new URL(config.baseUrl).origin || !url.pathname.startsWith(expected)) {
    throw httpError(403, "Write target does not belong to the active account.");
  }
  return url.pathname + url.search;
}

async function fetchAllPages(apiPath) {
  const deadline = Date.now() + 60000;
  const initial = await portalFetch(apiPath);
  let current = validatedPortalCollection(initial.body, apiPath);
  const items = [...current.items];
  let total = current.total;
  const identities = new Set(current.identities);
  if (identities.size !== items.length) throw httpError(502, "Repeated Portal page; operation blocked.");
  for (let pages=1;;pages++) {
    const next = current.next;
    if (total !== null && items.length === total && !next) break;
    if (total !== null && items.length > total) throw httpError(502, "Portal collection changed while loading; retry.");
    if (pages >= 100 || items.length >= 50000 || Date.now() > deadline) throw httpError(502, "Portal pagination limit reached; operation blocked.");
    const url = new URL(apiPath, config.baseUrl);
    url.searchParams.set("_offset", String(items.length)); url.searchParams.set("_pagesize", "100");
    current = validatedPortalCollection((await portalFetch(url.pathname + url.search)).body, apiPath);
    const page = current.items;
    if (current.total !== null) {
      if (total !== null && current.total !== total) throw httpError(502, "Portal collection changed while loading; retry.");
      total = current.total;
    }
    if (!page.length) {
      if ((total === null || items.length === total) && !current.next) break;
      throw httpError(502, "Incomplete Portal collection; operation blocked.");
    }
    for (const identity of current.identities) { if(identities.has(identity)) throw httpError(502, "Repeated Portal page; operation blocked."); identities.add(identity); }
    items.push(...page);
  }
  return {...initial,body:{...initial.body,items},items,complete:true,total:items.length};
}

function validatedPortalCollection(body, apiPath) {
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  const collection = record(body) && hasOwn(body, "collection") ? body.collection : body;
  if (!record(collection)) throw httpError(502, "Incomplete Portal collection; operation blocked.");
  const rawItems = Array.isArray(collection.items) ? collection.items : collection.entries;
  if (!Array.isArray(rawItems)) throw httpError(502, "Incomplete Portal collection; operation blocked.");

  // Absence means unknown. Explicit null, booleans and strings are not counts.
  const totals = [collection, ...(collection === body ? [] : [body])]
    .filter(value => hasOwn(value, "total")).map(value => value.total);
  if (totals.some(value => typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)) throw httpError(502, "Invalid Portal collection total.");
  if (totals.length > 1 && totals.some(value => value !== totals[0])) throw httpError(502, "Portal collection changed while loading; retry.");

  const scalarIdentity = value => (typeof value === "string" && value.trim() !== "") || (typeof value === "number" && Number.isFinite(value));
  const collectionUrl = new URL(apiPath, config.baseUrl);
  const prefix = collectionUrl.pathname.replace(/\/+$/, "") + "/";
  const resourceUrl = value => {
    const url = new URL(value, collectionUrl.origin + prefix);
    // Fragments and a terminal slash do not distinguish Portal resources.
    // Normalize each segment separately so encoded separators keep their scope.
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "").split("/").map(segment => encodeURIComponent(decodeURIComponent(segment))).join("/");
    return url;
  };
  const extensions = /\/targets\/phone-extensions\/?$/.test(collectionUrl.pathname);
  const identityKeys = extensions ? ["extensionNumber", "extension", "number", "id"]
    : ["id", "number", "extensionNumber", "extension", "serviceNumber", "didNumber", "trunkNumber", "deviceId", "uniqueIdentifier", "externalIdentifier"];
  const identities = [];
  const items = rawItems.map(raw => {
    if (!record(raw)) throw httpError(502, "Invalid Portal collection item; operation blocked.");
    if (hasOwn(raw, "href") && typeof raw.href !== "string") throw httpError(502, "Invalid Portal resource identity; operation blocked.");
    const item = normalizeItem(raw);
    const fields = lowerFieldMap(item);
    const values = identityKeys.map(key => fields.get(key.toLowerCase())).filter(value => value !== undefined && value !== null && value !== "");
    if (values.some(value => !scalarIdentity(value))) throw httpError(502, "Invalid Portal resource identity; operation blocked.");
    let route = "";
    let href;
    if (item.href) {
      href = resourceUrl(item.href);
      const suffix = href.pathname.replace(/\/+$/, "").slice(prefix.length);
      if (href.origin !== collectionUrl.origin || href.pathname === "/") throw httpError(502, "Invalid Portal resource identity; operation blocked.");
      // A DID collection may link to an inbound-trunk-number resource. Only
      // extension-number inference needs the collection's direct child route.
      if (extensions && (!href.pathname.startsWith(prefix) || !suffix || suffix.includes("/"))) throw httpError(502, "Invalid Portal resource identity; operation blocked.");
      route = extensions ? decodeURIComponent(suffix) : href.pathname;
    }
    // Collection+JSON identifies a resource by href; flat representations use
    // the existing identity fields. Display labels alone cannot prove inventory.
    if (!route && !values.length) throw httpError(502, "Missing Portal resource identity; operation blocked.");
    // Never let compactExtension invent an index as an extension number.
    if (extensions) {
      if (route && values.length && String(values[0]) !== route) throw httpError(502, "Conflicting Portal resource identity; operation blocked.");
      item.extensionNumber = String(values[0] ?? route);
    }
    identities.push(extensions ? `extension:${item.extensionNumber}`
      : `resource:${(href || resourceUrl(encodeURIComponent(String(values[0])))).href}`);
    return item;
  });
  const next = (collection.links || []).some(link => /^(next|next-page)$/i.test(link.rel));
  return { items, identities, total: totals[0] ?? null, next };
}

function requireCompleteInventory(overview, keys = REQUIRED_ENDPOINT_KEYS) {
  if (!overview || overview.demo || keys.some(key => !overview.endpoints?.[key]?.ok || overview.endpoints[key].complete !== true)) {
    throw httpError(409, "Complete live inventory is required. Reload before applying changes.");
  }
}

function summarizeEndpoint(result) {
  if (!result.ok) return result;
  // Collection items already carry validated identities; flattening raw data
  // again could erase an extension number inferred from its resource href.
  const items = result.items || extractItems(result.body);
  return {
    ok: true,
    status: result.status,
    path: result.path,
    count: items.length,
    item: items[0] || objectFromBody(result.body),
    items,
    complete: result.complete === true,
    total: result.total ?? items.length,
    data: objectFromBody(result.body),
  };
}

async function safePortalCall(key, apiPath, { collection = true } = {}) {
  try {
    return summarizeEndpoint(await (collection ? fetchAllPages(apiPath) : portalFetch(apiPath)));
  } catch (error) {
    return {
      ok: false,
      path: apiPath,
      status: error.status || 0,
      error: error.message,
      errorCode: error.code || "",
      errorKind: error.kind || (error.status ? "http" : "unknown"),
    };
  }
}

async function firstAvailablePortalCall(key, apiPaths) {
  const cacheKey = `${accountGeneration}:${key}`;
  const known = discoveryCache.get(cacheKey);
  if (known?.unavailable && known.expires > Date.now()) return known.result;
  const paths = known?.path ? [known.path, ...apiPaths.filter(path => path !== known.path)] : apiPaths;
  const attempts = [];

  for (const apiPath of paths) {
    const result = await safePortalCall(key, apiPath);
    attempts.push(result);
    if (result.ok) { discoveryCache.set(cacheKey, { path: apiPath }); return result; }
    // Only a missing route justifies discovery. Do not multiply auth/rate-limit/outage failures.
    if (![404, 405].includes(result.status)) return { ...result, optional: true, count: 0, items: [], data: {} };
  }

  const unavailable = {
    ok: false,
    optional: true,
    path: apiPaths.join(" | "),
    status: attempts.find((attempt) => attempt.status)?.status || 0,
    error: attempts.find(attempt => attempt.status)?.error || "Optional Portal feature unavailable.",
    attempts,
    errorCode: attempts.find((attempt) => attempt.errorCode)?.errorCode || "",
    errorKind: attempts.find((attempt) => attempt.errorKind)?.errorKind || "unknown",
    count: 0,
    items: [],
    data: {},
  };
  discoveryCache.set(cacheKey, { unavailable: true, result: unavailable, expires: Date.now() + 300000 });
  return unavailable;
}

function extensionLabel(extension) {
  const number = pickField(extension, ["extensionNumber", "extension", "number", "id", "name"], "N/A");
  const name = pickField(extension, ["displayName", "name", "firstName", "lastName", "description"], "Nebenstelle");
  return `${number} ${name}`.trim();
}

function isCompactFieldValue(value) {
  return ["string", "number", "boolean"].includes(typeof value) && value !== "";
}

function compactFieldValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "boolean") return value;
  return String(value ?? "").trim();
}

function compactExtensionFields(extension, number, name, type, device, voicemailHref, voicemailNumber) {
  const fields = {
    extensionNumber: number,
    displayName: name,
    targetType: type,
  };
  for (const [key, value] of Object.entries(extension || {})) {
    if (["data", "links", "_links", "embedded", "_embedded"].includes(key)) continue;
    if ((key === "name" && String(value || "") === name) || (key === "type" && String(value || "") === type)) continue;
    if (isCompactFieldValue(value)) fields[key] = compactFieldValue(value);
  }
  for (const entry of Array.isArray(extension?.data) ? extension.data : []) {
    if (!entry?.name || !isCompactFieldValue(entry.value)) continue;
    fields[entry.name] = compactFieldValue(entry.value);
  }
  if (device) fields.device = device;
  if (extension?.href) fields.href = extension.href;
  if (voicemailHref) fields.voicemailHref = voicemailHref;
  if (voicemailNumber) fields.voicemailNumber = voicemailNumber;
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function compactExtension(extension, index) {
  const number = pickField(extension, ["extensionNumber", "extension", "number", "id", "name"], String(index + 1));
  const firstName = pickField(extension, ["firstName"], "");
  const lastName = pickField(extension, ["lastName"], "");
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();
  const voicemailHref = linkHref(extension, ["voicemail", "voiceMail", "voiceMailbox", "mailbox", "answeringMachine", "answeringMachineTarget"]);
  const name = pickField(extension, ["displayName", "name", "description"], fullName || "Nebenstelle");
  const type = pickField(extension, ["targetType", "type", "class"], "Phone Extension");
  const device = pickField(extension, ["device", "macAddress", "deviceId"], "");
  const voicemailNumber = pickField(extension, ["voicemailNumber", "voiceMailNumber", "mailboxNumber", "answeringMachineNumber"], "");
  return {
    id: number,
    number,
    name,
    type,
    email: pickField(extension, ["email", "mail"], ""),
    device,
    href: extension.href || "",
    voicemailHref,
    voicemailNumber,
    fields: compactExtensionFields(extension, number, name, type, device, voicemailHref, voicemailNumber),
  };
}

function compactGeneric(item, fallbackPrefix, index, options = {}) {
  const nameKeys = options.nameKeys || ["displayName", "name", "description", "number", "id"];
  const valueKeys = options.valueKeys || ["number", "extensionNumber", "trunkNumber", "did", "id", "href"];
  return {
    id: pickField(item, ["id", "number", "name", "href"], `${fallbackPrefix}-${index + 1}`),
    name: pickField(item, nameKeys, `${fallbackPrefix} ${index + 1}`),
    value: pickField(item, valueKeys, ""),
    serviceNumber: pickField(item, ["serviceNumber"], ""),
    extensionNumber: pickField(item, ["extensionNumber"], ""),
    serviceCode: pickField(item, ["serviceCode"], ""),
    href: item.href || "",
  };
}

function normalizeDisplayName(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function validatePortalDisplayName(value, label = "Name") {
  if (typeof value !== "string") throw httpError(400, serverMessage("portal.error.invalidJson"));
  const name = normalizeDisplayName(value);
  if (!name || name.length > 50) {
    throw httpError(400, serverMessage("portal.server.valueMustContainBetween1And50Characters", {p0: label}));
  }
  if (/[&$!?=|"{}<>]/.test(name)) {
    throw httpError(400, serverMessage("portal.server.valueContainsUnsupportedCharacters", {p0: label}));
  }
  return name;
}

function compactServiceTarget(item, fallbackPrefix, index) {
  const extensionNumber = pickField(item, ["extensionNumber", "number"], "");
  const serviceNumber = pickField(item, ["serviceNumber"], "");
  const name = pickField(item, ["displayName", "name", "extensionNumber", "serviceNumber"], `${fallbackPrefix} ${index + 1}`);
  return {
    id: serviceNumber || extensionNumber || name,
    name,
    value: extensionNumber || serviceNumber,
    serviceNumber,
    extensionNumber,
    serviceCode: pickField(item, ["serviceCode"], ""),
    href: item.href || "",
  };
}

function compactDid(item, index) {
  const didNumber = pickField(item, ["didNumber", "number", "name"], `DID ${index + 1}`);
  const destinationName = pickField(item, ["destinationDisplayName", "displayName", "name"], "");
  const destinationExtension = pickField(item, ["destinationExtensionNumber", "extensionNumber"], "");
  const destinationServiceNumber = pickField(item, ["destinationServiceNumber", "serviceNumber"], "");
  const destinationType = pickField(item, ["destinationType", "type"], "");
  return {
    id: didNumber,
    name: didNumber,
    href: item.href || "",
    value: destinationName || destinationExtension || "",
    trunkNumber: pickField(item, ["trunkNumber"], ""),
    didExtension: pickField(item, ["didExtension"], ""),
    destinationName,
    destinationExtension,
    destinationServiceNumber,
    destinationType,
  };
}

function linkHref(item, rels) {
  const links = item?.links || {};
  for (const rel of rels) {
    const direct = links[rel] || item?.[rel];
    if (!direct) continue;
    if (typeof direct === "string") return direct;
    if (direct.href) return direct.href;
  }
  return "";
}

function targetFromHref(href, inventory) {
  const value = String(href || "");
  const routeNumber = lastPathSegment(value);
  const matchByHrefOrRoute = (items = []) => items.find((item) => item.href === value || item.serviceNumber === routeNumber || item.value === routeNumber || item.extensionNumber === routeNumber);

  if (value.includes("/queue-services/")) {
    const queue = matchByHrefOrRoute(inventory.queues);
    return {
      type: "QUEUE",
      title: queue?.name || serverMessage("portal.queueValue", {p0: routeNumber}),
      subtitle: queue?.extensionNumber ? serverMessage("portal.queueValue", {p0: queue.extensionNumber}) : "Warteschlange",
      targetNumber: queue?.extensionNumber || "",
      routeNumber: queue?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.includes("/skill-services/")) {
    const skill = matchByHrefOrRoute(inventory.skills);
    return {
      type: "SKILL",
      title: skill?.name || serverMessage("portal.skillGroupValue", {p0: routeNumber}),
      subtitle: skill?.extensionNumber ? serverMessage("portal.skillGroupValue", {p0: skill.extensionNumber}) : serverMessage("portal.skillGroup"),
      targetNumber: skill?.extensionNumber || "",
      routeNumber: skill?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.includes("/phone-extensions/")) {
    const extension = (inventory.extensions || []).find((item) => item.id === routeNumber || item.number === routeNumber);
    return {
      type: "PHONEEXTENSION",
      title: extension?.name || serverMessage("portal.extensionValue", {p0: routeNumber}),
      subtitle: serverMessage("portal.extensionValue", {p0: extension?.number || routeNumber}),
      targetNumber: extension?.number || routeNumber,
      routeNumber: extension?.number || routeNumber,
      href: value,
    };
  }
  if (value.includes("/voicemail") || value.includes("/voice-mail") || value.includes("/mailbox") || value.includes("/answering-machine")) {
    const voicemail = matchByHrefOrRoute(inventory.voicemails);
    const extension = (inventory.extensions || []).find((item) => item.voicemailHref === value || item.voicemailNumber === routeNumber || item.number === routeNumber);
    return {
      type: "VOICEMAIL",
      title: voicemail?.name || extension?.name || serverMessage("portal.server.voicemailValue", {p0: routeNumber}),
      subtitle: extension?.number ? serverMessage("portal.voicemailValue", {p0: extension.number}) : "Anrufbeantworter",
      targetNumber: extension?.number || voicemail?.extensionNumber || "",
      routeNumber: voicemail?.serviceNumber || extension?.voicemailNumber || routeNumber,
      href: value,
    };
  }
  if (value.includes("/frontdesk-services/")) {
    const did = (inventory.dids || []).find((item) => item.destinationServiceNumber === routeNumber && normalizeDestinationType(item.destinationType) === "FRONTDESK");
    return {
      type: "FRONTDESK",
      title: did?.destinationName || `Frontdesk ${routeNumber}`,
      subtitle: did?.destinationExtension ? `Frontdesk ${did.destinationExtension}` : "Frontdesk",
      targetNumber: did?.destinationExtension || "",
      routeNumber,
      href: value,
    };
  }
  if (value.includes("/ivr-services/")) {
    const ivr = matchByHrefOrRoute(inventory.ivrs);
    return {
      type: "IVR",
      title: ivr?.name || serverMessage("portal.voiceDialogValue", {p0: routeNumber}),
      subtitle: ivr?.extensionNumber ? serverMessage("portal.voiceDialogValue", {p0: ivr.extensionNumber}) : "Sprachdialog",
      targetNumber: ivr?.extensionNumber || "",
      routeNumber: ivr?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.includes("/time-control-services/")) {
    const timeControl = matchByHrefOrRoute(inventory.timeControls);
    return {
      type: "TIMECONTROL",
      title: timeControl?.name || serverMessage("portal.timeControlValue", {p0: routeNumber}),
      subtitle: timeControl?.extensionNumber ? serverMessage("portal.timeControlValue", {p0: timeControl.extensionNumber}) : "Zeitsteuerung",
      targetNumber: timeControl?.extensionNumber || "",
      routeNumber: timeControl?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.toUpperCase().includes("HANGUP")) {
    return { type: "HANGUP", title: serverMessage("portal.hangUp"), subtitle: serverMessage("portal.endCall"), targetNumber: "HANGUP", routeNumber: "HANGUP", href: value };
  }
  return null;
}

async function hydrateIvrDetails(ivrs, inventory) {
  return Promise.all((ivrs || []).map(async (ivr) => {
    if (!ivr.href) return ivr;
    const [detail, keys, timeout] = await Promise.all([
      safePortalCall(`ivr-detail-${ivr.serviceNumber || ivr.value}`, ivr.href, { collection: false }),
      safePortalCall(`ivr-keys-${ivr.serviceNumber || ivr.value}`, `${ivr.href}/key-assignments`),
      safePortalCall(`ivr-timeout-${ivr.serviceNumber || ivr.value}`, `${ivr.href}/timeout`, { collection: false }),
    ]);
    const detailItem = detail.item || {};
    const announcementHref = linkHref(detailItem, ["announcement"]);
    const announcement = (inventory.announcements || []).find((item) => item.href === announcementHref);
    const keyRoutes = (keys.items || [])
      .map((item) => {
        const number = pickField(item, ["number", "key", "digit", "digits", "dtmf", "dtmfDigit"], "");
        const target = targetFromHref(linkHref(item, ["target", "destination", "destinationTarget", "routingTarget"]), inventory);
        return number && target ? { number, target } : null;
      })
      .filter(Boolean);
    const timeoutItem = timeout.item || {};
    const timeoutTarget = targetFromHref(linkHref(timeoutItem, ["destinationOnTimeout", "target", "destination"]), inventory);
    const detailName = pickField(detailItem, ["displayName", "name"], "");
    const detailExtension = pickField(detailItem, ["extensionNumber"], "");
    return {
      ...ivr,
      detailError: [detail, keys, timeout].find(result => !result.ok)?.error || "",
      name: detailName || ivr.name,
      extensionNumber: detailExtension || ivr.extensionNumber,
      announcement: announcement?.name || pickField(detailItem, ["announcementName", "announcement"], ""),
      timeoutSeconds: pickField(timeoutItem, ["timeoutDelay", "delay"], ""),
      timeoutTarget,
      keyRoutes,
    };
  }));
}

function timeWindowFromDetails(detail) {
  const days = { MONDAY: "Mon", TUESDAY: "Tue", WEDNESDAY: "Wed", THURSDAY: "Thu", FRIDAY: "Fri", SATURDAY: "Sat", SUNDAY: "Sun" };
  const fromDay = days[String(detail.fromDay || "").toUpperCase()];
  const toDay = days[String(detail.toDay || "").toUpperCase()];
  const clock = value => {
    const match = String(value || "").trim().match(/^(\d{1,2}):([0-5]\d)(?:\s*(AM|PM))?$/i);
    if (!match) return "";
    const hour = Number(match[1]), period = match[3]?.toUpperCase();
    if (hour > (period ? 12 : 23) || (period && hour < 1)) return "";
    return `${String(period ? hour % 12 + (period === "PM" ? 12 : 0) : hour).padStart(2, "0")}:${match[2]}`;
  };
  const fromTime = clock(detail.fromTimeOfDay), toTime = clock(detail.toTimeOfDay);
  return fromDay && toDay && fromTime && toTime ? `${fromDay}${fromDay === toDay ? "" : `-${toDay}`} ${fromTime}-${toTime}` : "";
}

async function hydrateTimeControlDetails(timeControls) {
  return Promise.all((timeControls || []).map(async (timeControl) => {
    if (!timeControl.href) return timeControl;
    const detail = await safePortalCall(`time-control-detail-${timeControl.serviceNumber || timeControl.value}`, timeControl.href, { collection: false });
    const detailItem = detail.item || {};
    return {
      ...timeControl,
      detailError: detail.ok ? "" : detail.error,
      dayTargetHref: apiPathFromHref(linkHref(detailItem, ["destinationIfAllowed", "allowedDestination", "targetIfAllowed"])),
      nightTargetHref: apiPathFromHref(linkHref(detailItem, ["destinationIfDenied", "deniedDestination", "targetIfDenied"])),
      timezoneHref: timeZoneHref(linkHref(detailItem, ["timezone", "timeZone"])),
      evaluationStrategy: pickField(detailItem, ["evaluationStrategy"], ""),
      hours: timeWindowFromDetails(detailItem),
      routingBody: { links: Array.isArray(detailItem.links) ? detailItem.links : Object.entries(detailItem.links || {}).map(([rel,href]) => ({rel,href})), data: Object.entries(detailItem).filter(([key,value]) => !["href","links"].includes(key) && value !== undefined && typeof value !== "object").map(([name,value])=>({name,value})) },
    };
  }));
}

function normalizeDestinationType(type) {
  const normalized = String(type || "").toUpperCase();
  const aliases = {
    PHONE: "PHONEEXTENSION",
    NEBENSTELLE: "PHONEEXTENSION",
    WARTESCHLANGE: "QUEUE",
    AUSWAHL: "IVR",
    AB: "VOICEMAIL",
    ANRUFBEANTWORTER: "VOICEMAIL",
    MAILBOX: "VOICEMAIL",
    VOICEMAILBOX: "VOICEMAIL",
  };
  return aliases[normalized] || normalized;
}

function targetTypeLabel(type) {
  const labels = {
    PHONEEXTENSION: "Nebenstelle",
    PHONE: "Nebenstelle",
    QUEUE: "Warteschlange",
    GROUP: "Gruppe",
    SKILL: "Skillgruppe",
    VOICEMAIL: "Anrufbeantworter",
    FRONTDESK: "Frontdesk",
    IVR: "Sprachdialog",
    TIMECONTROL: "Zeitsteuerung",
    UNASSIGNED: "Kein Ziel",
    TRUNK: "Leitung",
  };
  return labels[String(type || "").toUpperCase()] || "Ziel";
}

function numberFromText(value) {
  const match = String(value || "").match(/\b\d{1,8}\b/);
  return match ? match[0] : "";
}

function toNfonDataBody(fields) {
  return {
    data: Object.entries(fields)
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
      .map(([name, value]) => ({ name, value: String(value) })),
  };
}

function inboundTargetPath(type) {
  const targetType = normalizeDestinationType(type);
  const paths = {
    PHONEEXTENSION: "phone-extensions",
    QUEUE: "queue-services",
    GROUP: "group-services",
    FRONTDESK: "frontdesk-services",
    IVR: "ivr-services",
    TIMECONTROL: "time-control-services",
    SKILL: "skill-services",
    CONFERENCE: "conference-services",
    VOICEMAIL: "voicemail-services",
  };
  return paths[targetType] || "";
}

function lastPathSegment(value) {
  const clean = String(value || "").split("?")[0].replace(/\/+$/, "");
  return clean.split("/").pop() || "";
}

function apiPathFromHref(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    // Not an absolute URL. Keep the value pinned to the Portal host: normalize
    // backslashes and collapse leading slashes so protocol-relative inputs like
    // "//evil.com/api" or "/\evil.com" cannot resolve to a foreign origin in portalFetch.
    const normalized = raw.replace(/\\/g, "/");
    const withLeadingSlash = normalized.startsWith("/") ? normalized : `/${normalized}`;
    return withLeadingSlash.replace(/^\/+/, "/");
  }
}

function didDestinationOperation(did, targetHref, action = "set-destination") {
  const id = inboundNumberIdForDid(did);
  if (!id) throw httpError(400, "DID identifier missing.");
  const customer = encodeURIComponent(config.customerAccount);
  const destination = targetHref || "/api/customers/" + customer + "/targets/NO_ACTION";
  assertCustomerPath(destination);
  if (did.href) assertCustomerPath(did.href);
  return { action, method: "PUT", endpoint: "/api/customers/" + customer + "/dids/" + encodeURIComponent(id) + "/destination", body: { links: [{ rel: "destination", href: destination }] } };
}

function inboundNumberIdForDid(did) {
  return lastPathSegment(did.href) || String(did.name || did.id || "").replace(/^\+/, "00").replace(/[ ()]/g, "").replace(/-/g, "-");
}

function buildCallflowUpdate(payload) {
  assertUnambiguousFlow(payload.flow);
  const did = payload.did || {};
  const target = payload.target || {};
  const destinationType = normalizeDestinationType(target.type);
  const destinationExtensionNumber = target.number || numberFromText(target.subtitle);
  const explicitTargetHref = apiPathFromHref(target.href || "");
  const explicitTargetBase = explicitTargetHref
    ? explicitTargetHref.replace(/\/inbound-trunk-numbers(?:\/.*)?$/, "").replace(/\/+$/, "")
    : "";
  const destinationRouteNumber = target.routeNumber || target.serviceNumber || lastPathSegment(explicitTargetBase) || destinationExtensionNumber;
  const sourceRouteNumber = didDestinationRoute(did);
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const oldTargetPath = inboundTargetPath(did.destinationType);
  const newTargetPath = inboundTargetPath(destinationType);
  const fields = {
    destinationType,
    destinationExtensionNumber,
    destinationDisplayName: target.title || "",
    destinationRouteNumber,
  };

  const destination = explicitTargetBase || (newTargetPath && destinationRouteNumber ? "/api/customers/" + customer + "/targets/" + newTargetPath + "/" + encodeURIComponent(destinationRouteNumber) : "");
  if (!destination) throw httpError(400, "Routing target missing.");
  const operation = didDestinationOperation(did, destination);
  const previousTarget = oldTargetPath && sourceRouteNumber ? "/api/customers/" + customer + "/targets/" + oldTargetPath + "/" + encodeURIComponent(sourceRouteNumber) : "";
  const rollback = didDestinationOperation(did, previousTarget, "restore-original-routing");
  return { endpoint: operation.endpoint, method: "PUT", fields, body: operation.body, operations: [operation], rollback, rollbackOperations: [rollback] };

}

function validateCallflowUpdate(payload, update) {
  const didName = payload.did?.name || payload.did?.id || "";

  if (!didName) {
    throw httpError(400, "Keine Rufnummer für die Übernahme gefunden.");
  }
  if (!update.fields.destinationType) {
    throw httpError(400, "Kein Zieltyp für die Übernahme gefunden.");
  }
  if (!update.fields.destinationRouteNumber) {
    throw httpError(400, "Keine Zielroute gefunden. Bitte ein bestehendes Ziel aus der Liste wählen.");
  }
  if (!update.operations.length || update.operations.some((operation) => !operation.endpoint)) {
    throw httpError(400, "Die Portal-API-Zielroute konnte nicht eindeutig gebildet werden.");
  }
}

function flowHasComplexPayload(payload = {}) {
  validateFlowShape(payload.flow);
  return (payload.flow?.nodes || []).some((node) => {
    const kind = normalizeDestinationType(node.type);
    if (node.locked) return false;
    if (["QUEUE", "GROUP", "SKILL"].includes(kind)) return Boolean(node.config?.portalMode || node.config?.timeoutSeconds || node.config?.timeoutTarget);
    return ["TIMECONTROL", "IVR", "ANNOUNCEMENT", "HANGUP", "PLACEHOLDER"].includes(kind);
  });
}

function targetHrefForRoute(type, routeNumber) {
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const normalized = normalizeDestinationType(type);
  if (normalized === "HANGUP") return `/api/customers/${customer}/targets/HANGUP`;
  if (normalized === "BUSY") return `/api/customers/${customer}/targets/BUSY`;
  const targetPath = inboundTargetPath(normalized);
  return targetPath && routeNumber
    ? `/api/customers/${customer}/targets/${targetPath}/${encodeURIComponent(routeNumber)}`
    : "";
}

function targetRouteFromNode(node) {
  // New resources have no Portal identity. Descriptive text can contain numbers
  // (for example an announcement name), but it must never identify a live target.
  if (node?.config?.portalMode === "new" && ["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"].includes(normalizeDestinationType(node.type))) return "";
  return node?.routeNumber || node?.targetNumber || numberFromText(node?.subtitle) || "";
}

function nodeToPortalTarget(node) {
  const type = normalizeDestinationType(node?.type);
  const routeNumber = targetRouteFromNode(node);
  return {
    type,
    title: node?.title || targetTypeLabel(type),
    subtitle: node?.subtitle || "",
    number: node?.targetNumber || numberFromText(node?.subtitle),
    routeNumber,
    href: node?.href || "",
  };
}

function flowRoutingConflicts(flow) {
  const nodes = flow?.nodes || [];
  const outputs = new Map();
  for (const edge of flow?.edges || []) {
    if (edge.virtual) continue;
    const source = nodes.find(node => node.id === edge.from);
    const isStart = source?.id === "inbound" || ["DID", "TRUNK"].includes(normalizeDestinationType(source?.type));
    const field = isStart ? "" : edge.branchField || "";
    const key = JSON.stringify([edge.from, field]);
    const output = outputs.get(key) || { count: 0, kind: isStart ? "start" : field ? "branch" : "direct" };
    output.count += 1;
    outputs.set(key, output);
  }
  const conflicts = new Set([...outputs.values()].filter(output => output.count > 1).map(output => output.kind));
  // Stable priority makes old drafts fail the same way regardless of edge order.
  return ["start", "branch", "direct"].filter(kind => conflicts.has(kind));
}

function validateFlowShape(flow) {
  if (flow == null) return;
  if (typeof flow !== "object" || Array.isArray(flow) || !Array.isArray(flow.nodes) || !Array.isArray(flow.edges)
      || flow.nodes.some(node => !node || typeof node !== "object" || Array.isArray(node) || typeof node.id !== "string")
      || flow.edges.some(edge => !edge || typeof edge !== "object" || Array.isArray(edge) || typeof edge.from !== "string" || typeof edge.to !== "string")) {
    throw httpError(400, "Callflow nodes and connections must be valid lists.");
  }
  if (flow.nodes.length > 256 || flow.edges.length > 1024) throw httpError(400, serverMessage("portal.error.flowTooLarge", { max: 256 }));
  for (const node of flow.nodes) {
    if (["type", "title", "href", "subtitle"].some(key => node[key] != null && typeof node[key] !== "string")
        || ["routeNumber", "targetNumber"].some(key => node[key] != null && !["string", "number"].includes(typeof node[key]))
        || (node.config != null && (typeof node.config !== "object" || Array.isArray(node.config)))) throw httpError(400, serverMessage("portal.error.invalidJson"));
    const timeout = node.config?.timeoutSeconds;
    if (timeout != null && timeout !== "" && (!["string", "number"].includes(typeof timeout) || !Number.isInteger(Number(timeout)) || Number(timeout) < 1)) throw httpError(400, serverMessage("portal.error.invalidFlow"));
  }
  const ids = new Set(flow.nodes.map(node => node.id));
  if (ids.size !== flow.nodes.length || flow.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) throw httpError(400, "Callflow connections must reference unique existing nodes.");
}

function assertUnambiguousFlow(flow) {
  validateFlowShape(flow);
  const conflict = flowRoutingConflicts(flow)[0];
  if (!conflict) return;
  const messages = {
    start: "Der Callflow hat mehrere Startverbindungen. Vom eingehenden Anruf darf genau eine Verbindung ausgehen.",
    branch: "Ein Callflow-Ausgang hat mehrere Ziele. Pro Taste oder Ausgang ist genau ein Ziel erlaubt.",
    direct: "Ein Callflow-Schritt hat mehrere direkte Ziele. Von diesem Schritt darf genau eine Verbindung ausgehen.",
  };
  throw httpError(400, messages[conflict]);
}

function getFlowStartNode(flow) {
  assertUnambiguousFlow(flow);
  const nodes = flow?.nodes || [];
  const edges = flow?.edges || [];
  let node = nodes.find(item => item.id === "inbound")
    || nodes.find(item => item.locked && normalizeDestinationType(item.type) === "DID")
    || nodes.find(item => item.locked);
  if (!node) return nodes.find(item => !item.floating && !item.branchTarget && !edges.some(edge => edge.to === item.id)) || null;
  const visited = new Set();
  while (node?.locked || normalizeDestinationType(node?.type) === "TRUNK") {
    if (visited.has(node.id)) return null;
    visited.add(node.id);
    const edge = edges.find(item => item.from === node.id && !item.virtual && !item.branchField);
    node = nodes.find(item => item.id === edge?.to);
  }
  return node || null;
}

function getFlowNode(flow, id) {
  return (flow?.nodes || []).find((node) => node.id === id) || null;
}

function getFlowEdge(flow, from, branchField = "") {
  return (flow?.edges || []).find((edge) => edge.from === from && (!branchField || edge.branchField === branchField)) || null;
}

function getTargetNode(flow, from, branchField = "") {
  const edge = getFlowEdge(flow, from, branchField);
  return getFlowNode(flow, edge?.to);
}

function createdTargetFromResult(type, result, fallbackRouteNumber = "") {
  const item = extractItems(result.body)[0] || objectFromBody(result.body);
  const href = canonicalResourceHref(result.location || item.href || "");
  const hrefId = lastPathSegment(href);
  const serviceNumber = pickField(item, ["serviceNumber"], "");
  const extensionNumber = pickField(item, ["extensionNumber"], "");
  const routeNumber = hrefId || serviceNumber || fallbackRouteNumber || extensionNumber;
  return {
    href: href || targetHrefForRoute(type, routeNumber),
    routeNumber,
    extensionNumber,
  };
}

function existingAnnouncementHref(name, overview) {
  const needle = String(name || "").trim().toLowerCase();
  const announcements = overview?.inventory?.announcements || [];
  const match = announcements.find((announcement) => {
    return [announcement.name, announcement.id, announcement.value]
      .filter(Boolean)
      .some((value) => String(value).trim().toLowerCase() === needle);
  });
  return match?.href || "";
}

function targetSignature(target) {
  if (!target) return "";
  const type = normalizeDestinationType(target.type);
  if (type === "HANGUP") return "HANGUP:HANGUP";
  const route = target.routeNumber || target.serviceNumber || target.targetNumber || target.number || target.extensionNumber || numberFromText(target.subtitle);
  return `${type}:${route || ""}`;
}

function didAlreadyTargetsTarget(did, target) {
  if (!did || !target) return false;
  if (normalizeDestinationType(did.destinationType) !== normalizeDestinationType(target.type)) return false;
  const didRoute = String(did.destinationServiceNumber || did.destinationExtension || "").trim();
  const didExtension = String(did.destinationExtension || "").trim();
  const targetRoute = String(target.routeNumber || target.serviceNumber || target.number || target.targetNumber || target.extensionNumber || "").trim();
  const targetExtension = String(target.extensionNumber || target.targetNumber || target.number || "").trim();
  return Boolean(
    (didRoute && targetRoute && didRoute === targetRoute)
      || (didExtension && targetExtension && didExtension === targetExtension)
      || (didRoute && targetExtension && didRoute === targetExtension)
      || (didExtension && targetRoute && didExtension === targetRoute),
  );
}

function findInventoryIvrForNode(node, overview) {
  if (normalizeDestinationType(node?.type) !== "IVR" || node?.config?.portalMode === "new") return null;
  const route = String(node?.routeNumber || "").trim();
  const extension = String(node?.targetNumber || numberFromText(node?.subtitle) || "").trim();
  return (overview?.inventory?.ivrs || []).find((ivr) => {
    const serviceNumber = String(ivr.serviceNumber || ivr.id || "").trim();
    const extensionNumber = String(ivr.extensionNumber || ivr.value || "").trim();
    return (route && (serviceNumber === route || extensionNumber === route))
      || (extension && (extensionNumber === extension || serviceNumber === extension));
  }) || null;
}

function targetFromLiveIvr(node, liveIvr) {
  const routeNumber = String(liveIvr?.serviceNumber || liveIvr?.id || liveIvr?.routeNumber || node?.routeNumber || liveIvr?.extensionNumber || liveIvr?.value || "").trim();
  const extensionNumber = String(liveIvr?.extensionNumber || liveIvr?.value || node?.targetNumber || numberFromText(node?.subtitle) || "").trim();
  return {
    ...nodeToPortalTarget(node),
    href: liveIvr?.href || targetHrefForRoute("IVR", routeNumber || extensionNumber),
    routeNumber,
    extensionNumber,
    number: extensionNumber || routeNumber,
  };
}

function sameInventoryIvr(a, b) {
  if (!a || !b) return false;
  const left = [
    a.href,
    a.serviceNumber,
    a.id,
    a.extensionNumber,
    a.value,
    a.routeNumber,
  ].filter(Boolean).map((value) => String(value).trim());
  const right = new Set([
    b.href,
    b.serviceNumber,
    b.id,
    b.extensionNumber,
    b.value,
    b.routeNumber,
  ].filter(Boolean).map((value) => String(value).trim()));
  return left.some((value) => right.has(value));
}

function findIvrNameConflict(displayName, currentIvr, overview) {
  const name = normalizeDisplayName(displayName);
  if (!name) return null;
  return (overview?.inventory?.ivrs || []).find((ivr) => {
    return normalizeDisplayName(ivr.name) === name && !sameInventoryIvr(ivr, currentIvr);
  }) || null;
}

function ivrTopologyMatchesLive(node, liveIvr, flow) {
  if (!node || !liveIvr) return false;
  const nodeAnnouncement = normalizeDisplayName(node.config?.announcement || "");
  const liveAnnouncement = normalizeDisplayName(liveIvr.announcement || "");
  if (nodeAnnouncement !== liveAnnouncement) return false;

  const nodeKeys = Array.isArray(node.config?.ivrKeys) && node.config.ivrKeys.length
    ? node.config.ivrKeys.map(String).sort()
    : [];
  const liveKeys = (liveIvr.keyRoutes || []).map((route) => String(route.number || "")).filter(Boolean).sort();
  if (nodeKeys.join("|") !== liveKeys.join("|")) return false;

  for (const key of nodeKeys) {
    const nodeTarget = getTargetNode(flow, node.id, `key${key}Target`);
    const liveTarget = (liveIvr.keyRoutes || []).find((route) => String(route.number || "") === key)?.target;
    if (targetSignature(nodeTarget) !== targetSignature(liveTarget)) return false;
  }

  const nodeTimeoutTarget = getTargetNode(flow, node.id, "timeoutTarget");
  if (targetSignature(nodeTimeoutTarget) !== targetSignature(liveIvr.timeoutTarget)) return false;

  const nodeTimeout = String(node.config?.timeoutSeconds || "20");
  const liveTimeout = String(liveIvr.timeoutSeconds || "20");
  return nodeTimeout === liveTimeout;
}

function findReusableIvrForNode(node, overview, flow) {
  const direct = findInventoryIvrForNode(node, overview);
  if (direct) return { ivr: direct, reason: "number" };

  const name = normalizeDisplayName(node?.title || "");
  if (!name) return null;
  const nameMatches = (overview?.inventory?.ivrs || []).filter((ivr) => normalizeDisplayName(ivr.name) === name);
  if (!nameMatches.length) return null;

  const topologyMatches = nameMatches.filter((ivr) => ivrTopologyMatchesLive(node, ivr, flow));
  if (topologyMatches.length === 1) return { ivr: topologyMatches[0], reason: "name+topology" };
  if (topologyMatches.length > 1) return { ambiguous: true, name: node?.title || name, count: topologyMatches.length };
  return { conflict: true, name: node?.title || name, count: nameMatches.length };
}

function ivrBaseBody(node, liveIvr, overview) {
  const displayName = validatePortalDisplayName(node?.title || liveIvr?.name || "Sprachdialog", "Sprachdialog-Name");
  const announcementHref = existingAnnouncementHref(node?.config?.announcement || liveIvr?.announcement, overview);
  if (!announcementHref) throw httpError(400, serverMessage("portal.server.voiceDialogValueRequiresAnExistingAnnouncement", {p0: displayName}));
  const keys = Array.isArray(node?.config?.ivrKeys) && node.config.ivrKeys.length ? node.config.ivrKeys : ["1"];
  const extensionNumber = liveIvr?.extensionNumber || node?.targetNumber || numberFromText(node?.subtitle);
  const data = [
    { name: "displayName", value: displayName },
    { name: "extensionNumber", value: extensionNumber },
    { name: "interpretUnknownAsExtension", value: true },
    { name: "maxNumberOfDigits", value: Math.max(...keys.map((key) => String(key).length), 1) },
  ].filter((field) => field.value !== undefined && field.value !== null && field.value !== "");
  return {
    links: [{ rel: "announcement", href: announcementHref }],
    data,
  };
}

function usedExtensionNumbers(overview) {
  const used = new Set();
  const add = (value) => {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) used.add(number);
  };
  for (const item of overview?.inventory?.extensions || []) add(item.number);
  for (const item of overview?.inventory?.queues || []) add(item.extensionNumber || item.value);
  for (const item of overview?.inventory?.ivrs || []) add(item.extensionNumber || item.value);
  for (const item of overview?.inventory?.timeControls || []) add(item.extensionNumber || item.value);
  return used;
}

function nextServiceExtension(overview, allocated, preferred = 7000) {
  const used = usedExtensionNumbers(overview);
  for (const value of allocated) used.add(Number(value));
  let next = preferred;
  while (used.has(next)) next += 1;
  allocated.add(next);
  return String(next);
}

function nextServiceNumber(overview, type, allocated) {
  const normalized = normalizeDestinationType(type);
  const key = normalized === "IVR" ? "ivrs" : normalized === "TIMECONTROL" ? "timeControls" : "";
  const used = new Set();
  for (const item of overview?.inventory?.[key] || []) {
    const number = Number(item.serviceNumber || item.id);
    if (Number.isFinite(number) && number >= 0) used.add(number);
  }
  for (const value of allocated) used.add(Number(value));
  let next = 0;
  while (used.has(next)) next += 1;
  allocated.add(next);
  return String(next);
}

function nfonDay(day) {
  // English three-letter or full day names are an unambiguous, locale-independent input format.
  const map = { MON:"MONDAY", MONDAY:"MONDAY", TUE:"TUESDAY", TUESDAY:"TUESDAY", WED:"WEDNESDAY", WEDNESDAY:"WEDNESDAY", THU:"THURSDAY", THURSDAY:"THURSDAY", FRI:"FRIDAY", FRIDAY:"FRIDAY", SAT:"SATURDAY", SATURDAY:"SATURDAY", SUN:"SUNDAY", SUNDAY:"SUNDAY" };
  const result = map[String(day || "").trim().toUpperCase()];
  if (!result) throw httpError(400, "Invalid day. Use Mon-Fri 08:00-17:00.");
  return result;
}

function nfonTime(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})$/);
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw httpError(400, "Invalid time. Use 00:00 through 23:59.");
  let hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${String(hours).padStart(2, "0")}:${minutes} ${suffix}`;
}

function nfonInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : value;
}

function parseTimeWindow(value) {
  const match = String(value || "").trim().match(/^([A-Za-zÄÖÜäöü]+)(?:\s*-\s*([A-Za-zÄÖÜäöü]+))?\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  if (!match) throw httpError(400, "Invalid time window. Use Mon-Fri 08:00-17:00.");
  return { fromDay: nfonDay(match[1]), toDay: nfonDay(match[2] || match[1]), fromTimeOfDay: nfonTime(match[3]), toTimeOfDay: nfonTime(match[4]) };
}

function timeZoneHref(value = "INHERIT") {
  if (value === "INHERIT" || !value) return "INHERIT";
  const normalized = apiPathFromHref(value);
  if (!/^\/api\/time-zones\/[A-Za-z0-9._/-]+$/.test(normalized)) throw httpError(400, "Invalid time zone.");
  return normalized;
}

function targetSummary(target) {
  if (!target) return "-";
  return `${target.title || target.type || "Ziel"}${target.number ? ` ${target.number}` : ""}`.trim();
}

async function applyComplexCallflowChange(payload) {
  assertUnambiguousFlow(payload.flow);
  const overview = cache.overview || await loadOverview();
  const flow = payload.flow || {};
  const didName = payload.did?.name || payload.did?.id || "";
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const attempts = [];
  const createdTargets = [];
  const restoredResources = [];
  const priorTimeouts = new Map();
  const allocatedExtensions = new Set();
  const allocatedServiceNumbers = new Set();
  const root = getFlowStartNode(flow);
  const routedNodeIds = new Set();
  const visit = (nodeId) => {
    if (!nodeId || routedNodeIds.has(nodeId)) return;
    routedNodeIds.add(nodeId);
    for (const edge of flow.edges || []) if (edge.from === nodeId) visit(edge.to);
  };
  visit(root?.id);
  // Old drafts may still carry an identity from a previous step type. New mode
  // must never silently reuse that object, even when its number happens to exist.
  for (const node of flow.nodes || []) {
    if (routedNodeIds.has(node.id) && node.config?.portalMode === "new"
      && ["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"].includes(normalizeDestinationType(node.type))
      && [node.routeNumber, node.targetNumber, node.serviceNumber, node.extensionNumber, node.href].some(value => value !== undefined && value !== null && String(value).trim() !== "")) {
      throw httpError(400, serverMessage("portal.chooseWhetherThisStepCreatesANewPortalObject"));
    }
  }
  for (const node of flow.nodes || []) {
    if (routedNodeIds.has(node.id) && normalizeDestinationType(node.type) === "PLACEHOLDER") throw httpError(400, serverMessage("portal.server.pathValueIsStillEmpty", {p0: node.title || "Neuer Schritt"}));
  }
  const visiting = new Set(), visited = new Set();
  const validateAcyclic = id => {
    if (visiting.has(id)) throw httpError(400, "Callflow routing must not contain a cycle.");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const edge of flow.edges || []) if (edge.from === id && !edge.virtual) validateAcyclic(edge.to);
    visiting.delete(id); visited.add(id);
  };
  if (root) validateAcyclic(root.id);
  // The complete graph is validated before any write. Preview follows the same
  // recursive resolver, including queue timeouts and every IVR branch.
  if (payload.commit) {
    const preflight = await applyComplexCallflowChange({ ...payload, commit: false });
    if (!preflight.ok) return { ...preflight, dryRun: false, applied: false };
    for (const node of flow.nodes || []) {
      if (!routedNodeIds.has(node.id) || normalizeDestinationType(node.type) !== "QUEUE" || !node.config?.timeoutSeconds || !targetRouteFromNode(node)) continue;
      const endpoint = `/api/customers/${customer}/targets/queue-services/${encodeURIComponent(targetRouteFromNode(node))}/timeout`;
      const prior = await portalFetch(endpoint);
      const item = objectFromBody(prior.body);
      const links = Array.isArray(prior.body?.links) ? prior.body.links : Object.entries(item.links || {}).map(([rel, href]) => ({ rel, href }));
      const data = Array.isArray(prior.body?.data) ? prior.body.data : Object.entries(item).filter(([key,value]) => !["href","links"].includes(key) && value != null && typeof value !== "object").map(([name,value]) => ({name,value}));
      if (!links.some(link => link.rel === "destinationOnTimeout") || !data.some(field => field.name === "timeoutDelay")) throw httpError(409, "Queue timeout could not be captured. Reload before applying.");
      priorTimeouts.set(endpoint, { links, data });
    }
  }
  const writeExisting = async (operation, before) => {
    const result = await runPortalOperation(operation, attempts);
    restoredResources.push({ action: "restore-" + operation.action, method: "PUT", endpoint: operation.endpoint, body: before });
    return result;
  };

  if (!didName) throw httpError(400, "Keine Rufnummer fuer die Uebernahme gefunden.");
  if (!root) throw httpError(400, "Der Callflow hat keinen Start nach der Leitung.");

  const basePlan = {
    ok: true,
    type: "callflow",
    title: "Komplexer Callflow zur Uebernahme bereit",
    message: "Zeitsteuerung, Sprachdialog und Queue-Timeout werden als Portal-Zielobjekte vorbereitet.",
    did: didName,
    before: `${didName} → ${payload.did?.destinationName || payload.did?.destinationExtension || payload.did?.destinationType || "-"}`,
    after: `${didName} → ${targetSummary(nodeToPortalTarget(root))}`,
    method: "CREATE+ROUTE",
    flow,
    applyPayload: payload,
    createdAt: new Date().toISOString(),
  };

  if (payload.commit && !areLiveWritesEnabled()) return liveWritesDisabledResult(basePlan);

  const resolvedTargets = new Map();
  // Bind only after all provider operations succeed. Failure/rollback responses
  // retain the editable original draft and cannot claim rolled-back identities.
  const appliedFlow = async () => {
    const applied = JSON.parse(JSON.stringify(flow));
    const nodes = new Map((applied.nodes || []).map(node => [node.id, node]));
    for (const [id, pending] of resolvedTargets) {
      const target = await pending;
      const node = nodes.get(id);
      if (!node || !target?.routeNumber) continue;
      node.type = target.type;
      node.routeNumber = String(target.routeNumber);
      node.targetNumber = String(target.extensionNumber || target.number || target.routeNumber);
      node.href = target.href;
      if (["QUEUE", "GROUP", "SKILL", "IVR", "TIMECONTROL"].includes(node.type)) {
        node.config = { ...node.config, portalMode: "existing" };
      }
    }
    const syncBranches = id => {
      const node = nodes.get(id);
      if (!node) return;
      for (const edge of applied.edges || []) {
        if (edge.from !== id || edge.virtual) continue;
        syncBranches(edge.to);
        const child = nodes.get(edge.to);
        if (!edge.branchField || !child) continue;
        node.config ||= {};
        node.config[edge.branchField] = {
          ...node.config[edge.branchField], type: child.type, title: child.title,
          subtitle: child.subtitle, targetNumber: child.targetNumber,
          routeNumber: child.routeNumber, href: child.href,
          config: JSON.parse(JSON.stringify(child.config || {})),
        };
      }
    };
    syncBranches(root.id);
    return applied;
  };
  const ensurePortalTarget = async node => {
    if (!node) throw httpError(400, "Ein Flow-Pfad hat kein Ziel.");
    if (!resolvedTargets.has(node.id)) resolvedTargets.set(node.id, resolvePortalTarget(node));
    return resolvedTargets.get(node.id);
  };
  const resolvePortalTarget = async (node) => {
    if (!node) throw httpError(400, "Ein Flow-Pfad hat kein Ziel.");
    const type = normalizeDestinationType(node.type);

    if (type === "PLACEHOLDER") {
      throw httpError(400, serverMessage("portal.server.pathValueIsStillEmpty", {p0: node.title || "Neuer Schritt"}));
    }
    if (type === "HANGUP") {
      return { type, title: "Auflegen", routeNumber: "HANGUP", href: targetHrefForRoute("HANGUP", "HANGUP") };
    }
    if (type === "ANNOUNCEMENT") {
      throw httpError(400, "Ansagen sind in der Portal API Medien, aber keine eigenstaendigen Routing-Ziele. Nutze sie in Sprachdialog oder Queue.");
    }

    const existingRoute = targetRouteFromNode(node);
    const existingHref = targetHrefForRoute(type, existingRoute);

    if (type === "QUEUE") {
      if (node.config?.portalMode === "new" && !existingRoute) {
        const displayName = validatePortalDisplayName(node.title || "Neue Warteschlange", "Warteschlangen-Name");
        let timeoutTarget;
        if (node.config?.timeoutSeconds) {
          if (!Number.isInteger(Number(node.config.timeoutSeconds)) || Number(node.config.timeoutSeconds) < 1) throw httpError(400, "Queue timeout must be a positive integer.");
          timeoutTarget = await ensurePortalTarget(getTargetNode(flow, node.id, "timeoutTarget"));
        }
        if (!payload.commit) {
          const routeNumber = nextResourceNumber(overview, "queues");
          return { ...nodeToPortalTarget(node), routeNumber, href: targetHrefForRoute("QUEUE", routeNumber) };
        }
        const created = await createPortalResource("queues", { displayName });
        if (!created.ok) throw httpError(created.status || 502, created.error || "Queue creation failed.");
        createdTargets.push({ type: "QUEUE", href: created.resource.href });
        attempts.push({ action: `create-queue-${displayName}`, method: "POST", status: created.status, endpoint: created.endpoint });
        if (timeoutTarget) await runPortalOperation({ action: `queue-timeout-${node.title}`, method: "PUT", endpoint: `${created.resource.href}/timeout`, body: {
          links: [{ rel: "destinationOnTimeout", href: timeoutTarget.href }],
          data: [{ name: "timeoutDelay", value: Number(node.config.timeoutSeconds) }],
        } }, attempts);
        return {
          ...nodeToPortalTarget(node),
          type: "QUEUE",
          routeNumber: created.resource.routeNumber,
          href: created.resource.href,
          extensionNumber: created.resource.extensionNumber,
        };
      }
      if (!existingRoute) throw httpError(400, serverMessage("portal.server.queueValueHasNoPortalNumber", {p0: node.title}));
      if (node.config?.timeoutSeconds) {
        const timeoutTargetNode = getTargetNode(flow, node.id, "timeoutTarget");
        const timeoutTarget = await ensurePortalTarget(timeoutTargetNode);
        const endpoint = `/api/customers/${customer}/targets/queue-services/${encodeURIComponent(existingRoute)}/timeout`;
        const body = {
          links: [{ rel: "destinationOnTimeout", href: timeoutTarget.href }],
          data: [{ name: "timeoutDelay", value: Number(node.config.timeoutSeconds) || 120 }],
        };
        if (!Number.isInteger(Number(node.config.timeoutSeconds)) || Number(node.config.timeoutSeconds) < 1) throw httpError(400, "Queue timeout must be a positive integer.");
        if (payload.commit) await writeExisting({ action: `queue-timeout-${node.title}`, method: "PUT", endpoint, body }, priorTimeouts.get(endpoint));
      }
      return { ...nodeToPortalTarget(node), href: existingHref };
    }

    if (["GROUP", "SKILL"].includes(type) && node.config?.portalMode === "new" && !existingRoute) {
      const displayName = validatePortalDisplayName(node.title || "Neue Skillgruppe", "Skillgruppen-Name");
      if (!payload.commit) {
        const routeNumber = nextResourceNumber(overview, "skills");
        return { ...nodeToPortalTarget(node), type: "SKILL", routeNumber, href: targetHrefForRoute("SKILL", routeNumber) };
      }
      const created = await createPortalResource("skills", { displayName });
      if (!created.ok) throw httpError(created.status || 502, created.error || "Skill creation failed.");
      createdTargets.push({ type: "SKILL", href: created.resource.href });
      attempts.push({ action: `create-skill-${displayName}`, method: "POST", status: created.status, endpoint: created.endpoint });
      return {
        ...nodeToPortalTarget(node),
        type: "SKILL",
        routeNumber: created.resource.routeNumber,
        href: created.resource.href,
        extensionNumber: created.resource.extensionNumber,
      };
    }

    if (["PHONEEXTENSION", "FRONTDESK", "GROUP", "SKILL", "CONFERENCE", "VOICEMAIL"].includes(type)) {
      if (!existingRoute) throw httpError(400, serverMessage("portal.server.targetValueHasNoPortalRoute", {p0: node.title}));
      return { ...nodeToPortalTarget(node), href: existingHref };
    }

    if (type === "IVR") {
      if (node.config?.portalMode === "existing") {
        if (!existingRoute) throw httpError(400, serverMessage("portal.server.existingVoiceDialogValueHasNoPortalRoute", {p0: node.title}));
        const liveIvr = findInventoryIvrForNode(node, overview);
        const includesTopology = (flow.edges || []).some(edge => edge.from === node.id && !edge.virtual)
          || node.config?.ivrKeys?.length || node.config?.announcement || node.config?.timeoutSeconds;
        if (includesTopology && !ivrTopologyMatchesLive(node, liveIvr, flow)) {
          throw httpError(400, serverMessage("portal.server.voiceDialogValueAlreadyExistsValueButItsKeys", {p0: node.title, p1: liveIvr?.extensionNumber || existingRoute}));
        }
        return { ...nodeToPortalTarget(node), href: existingHref };
      }
      const displayName = validatePortalDisplayName(node.title || "API Demo Sprachdialog", "Sprachdialog-Name");
      const keys = Array.isArray(node.config?.ivrKeys) && node.config.ivrKeys.length ? node.config.ivrKeys : ["1", "2"];
      const reusable = findReusableIvrForNode(node, overview, flow);

      if (reusable?.ambiguous) {
        throw httpError(400, serverMessage("portal.server.multipleMatchingVoiceDialogsNamedValueWereFoundRemove", {p0: displayName}));
      }
      if (reusable?.conflict) {
        throw httpError(400, serverMessage("portal.server.voiceDialogValueAlreadyExistsvalueButItsAnnouncementKeys", {p0: displayName, p1: reusable.count > 1 ? ` ${reusable.count}x` : ""}));
      }
      if (reusable?.ivr) {
        const existingTarget = targetFromLiveIvr(node, reusable.ivr);
        if (reusable.reason === "number" && !ivrTopologyMatchesLive(node, reusable.ivr, flow)) {
          throw httpError(400, serverMessage("portal.server.voiceDialogValueAlreadyExistsValueButItsKeys", {p0: displayName, p1: existingTarget.extensionNumber || existingTarget.routeNumber}));
        }
        if (!payload.commit) return existingTarget;

        const nameChanged = normalizeDisplayName(displayName) !== normalizeDisplayName(reusable.ivr.name);
        if (nameChanged) {
          await writeExisting({
            action: `update-ivr-name-${displayName}`,
            method: "PUT",
            endpoint: existingTarget.href,
            body: ivrBaseBody(node, reusable.ivr, overview),
          }, ivrBaseBody({ ...node, title: reusable.ivr.name }, reusable.ivr, overview));
        }
        return existingTarget;
      }

      const announcementHref = existingAnnouncementHref(node.config?.announcement, overview);
      if (!announcementHref) throw httpError(400, serverMessage("portal.server.voiceDialogValueRequiresAnExistingAnnouncement", {p0: node.title}));
      const extensionNumber = nextServiceExtension(overview, allocatedExtensions, 7100);
      const endpoint = `/api/customers/${customer}/targets/ivr-services`;
      const body = {
        links: [{ rel: "announcement", href: announcementHref }],
        data: [
          { name: "displayName", value: displayName },
          { name: "extensionNumber", value: extensionNumber },
          { name: "interpretUnknownAsExtension", value: true },
          { name: "maxNumberOfDigits", value: Math.max(...keys.map((key) => String(key).length), 1) },
        ],
      };
      if (!payload.commit) {
        if (keys.some(key => !/^\d+$/.test(String(key))) || new Set(keys.map(String)).size !== keys.length) throw httpError(400, "Voice menu keys must be unique numbers.");
        for (const key of keys) {
          const child = getTargetNode(flow, node.id, `key${key}Target`);
          if (!child) throw httpError(400, "Every voice menu key needs a destination.");
          await ensurePortalTarget(child);
        }
        const timeout = getTargetNode(flow, node.id, "timeoutTarget");
        if (timeout) await ensurePortalTarget(timeout);
        return { ...nodeToPortalTarget(node), number: extensionNumber, href: targetHrefForRoute("IVR", extensionNumber), routeNumber: extensionNumber, extensionNumber };
      }

      const result = await runPortalOperation({ action: `create-ivr-${displayName}`, method: "POST", endpoint, body }, attempts);
      const created = createdTargetFromResult("IVR", result, extensionNumber);
      createdTargets.push({ type: "IVR", href: created.href });

      for (const key of keys) {
        const keyTargetNode = getTargetNode(flow, node.id, `key${key}Target`);
        if (!keyTargetNode) continue;
        const keyTarget = await ensurePortalTarget(keyTargetNode);
        await runPortalOperation({
          action: `ivr-key-${key}`,
          method: "POST",
          endpoint: `${created.href}/key-assignments`,
          body: {
            data: [{ name: "number", value: String(key) }],
            links: [{ rel: "target", href: keyTarget.href }],
          },
        }, attempts);
      }

      const timeoutTargetNode = getTargetNode(flow, node.id, "timeoutTarget");
      if (timeoutTargetNode) {
        const timeoutTarget = await ensurePortalTarget(timeoutTargetNode);
        await runPortalOperation({
          action: "ivr-timeout",
          method: "PUT",
          endpoint: `${created.href}/timeout`,
          body: {
            links: [{ rel: "destinationOnTimeout", href: timeoutTarget.href }],
            data: [{ name: "timeoutDelay", value: Number(node.config?.timeoutSeconds) || 20 }],
          },
        }, attempts);
      }

      return { ...nodeToPortalTarget(node), number: created.extensionNumber || extensionNumber, href: created.href, routeNumber: created.routeNumber, extensionNumber: created.extensionNumber };
    }

    if (type === "TIMECONTROL") {
      if (node.config?.portalMode === "existing") {
        if (!existingRoute) throw httpError(400, serverMessage("portal.server.existingTimeRuleValueHasNoPortalRoute", {p0: node.title}));
        return { ...nodeToPortalTarget(node), href: existingHref };
      }
      const openTarget = await ensurePortalTarget(getTargetNode(flow, node.id, "openTarget"));
      const closedTarget = await ensurePortalTarget(getTargetNode(flow, node.id, "closedTarget"));
      const serviceNumber = nextServiceNumber(overview, "TIMECONTROL", allocatedServiceNumbers);
      const extensionNumber = nextServiceExtension(overview, allocatedExtensions, 7200);
      const serviceCode = `*740${String(serviceNumber).padStart(3, "0")}`;
      const window = parseTimeWindow(node.config?.hours || node.subtitle);
      const endpoint = `/api/customers/${customer}/targets/time-control-services`;
      const body = {
        links: [
          { rel: "destinationIfAllowed", href: openTarget.href },
          { rel: "destinationIfDenied", href: closedTarget.href },
          { rel: "timezone", href: timeZoneHref() },
        ],
        data: [
          { name: "name", value: node.title || "API Demo Zeitregel" },
          { name: "serviceNumber", value: nfonInteger(serviceNumber) },
          { name: "serviceCode", value: serviceCode },
          { name: "extensionNumber", value: extensionNumber },
          { name: "displayName", value: node.title || "API Demo Zeitregel" },
          { name: "evaluationStrategy", value: "AUTO" },
          { name: "fromDay", value: window.fromDay },
          { name: "fromTimeOfDay", value: window.fromTimeOfDay },
          { name: "toDay", value: window.toDay },
          { name: "toTimeOfDay", value: window.toTimeOfDay },
        ],
      };
      if (!payload.commit) return { ...nodeToPortalTarget(node), number: extensionNumber, href: targetHrefForRoute("TIMECONTROL", serviceNumber), routeNumber: serviceNumber, extensionNumber };

      const result = await runPortalOperation({ action: `create-time-control-${node.title}`, method: "POST", endpoint, body }, attempts);
      const created = createdTargetFromResult("TIMECONTROL", result, serviceNumber);
      createdTargets.push({ type: "TIMECONTROL", href: created.href });
      return { ...nodeToPortalTarget(node), number: created.extensionNumber || extensionNumber, href: created.href, routeNumber: created.routeNumber, extensionNumber: created.extensionNumber };
    }

    throw httpError(400, serverMessage("portal.server.targetTypeValueIsNotYetSupportedForLive", {p0: type || "-"}));
  };

  const updateExistingIvrName = async (node) => {
    if (normalizeDestinationType(node?.type) !== "IVR") return false;
    const liveIvr = findInventoryIvrForNode(node, overview);
    if (!liveIvr) return false;
    const displayName = validatePortalDisplayName(node.title || liveIvr.name || "Sprachdialog", "Sprachdialog-Name");
    if (normalizeDisplayName(displayName) === normalizeDisplayName(liveIvr.name)) return false;

    const duplicateName = findIvrNameConflict(displayName, liveIvr, overview);
    if (duplicateName) {
      throw httpError(400, serverMessage("portal.server.anotherVoiceDialogNamedValueAlreadyExistsChooseA", {p0: displayName}));
    }

    const endpoint = liveIvr.href || targetHrefForRoute("IVR", liveIvr.serviceNumber || node.routeNumber);
    await writeExisting({
      action: `rename-ivr-${liveIvr.serviceNumber || node.routeNumber || displayName}`,
      method: "PUT",
      endpoint,
      body: ivrBaseBody(node, liveIvr, overview),
    }, ivrBaseBody({ ...node, title: liveIvr.name }, liveIvr, overview));
    return true;
  };

  if (!payload.commit) {
    for (const node of flow.nodes || []) {
      if (!routedNodeIds.has(node.id) || normalizeDestinationType(node.type) !== "IVR") continue;
      const liveIvr = findInventoryIvrForNode(node, overview);
      if (!liveIvr) continue;
      const displayName = validatePortalDisplayName(node.title || liveIvr.name || "Sprachdialog", "Sprachdialog-Name");
      if (findIvrNameConflict(displayName, liveIvr, overview)) throw httpError(400, serverMessage("portal.server.anotherVoiceDialogNamedValueAlreadyExistsChooseA", {p0: displayName}));
      ivrBaseBody(node, liveIvr, overview);
    }
    const topTarget = await ensurePortalTarget(root);
    return {
      ...basePlan,
      dryRun: true,
      title: "Komplexer Callflow geprüft",
      message: "Die Portal-API kann die benoetigten Zielobjekte grundsaetzlich schreiben. Live erst nach Bestaetigung.",
      after: `${didName} → ${targetSummary(topTarget)}`,
      target: topTarget,
    };
  }

  let topTarget;
  let update;
  let deletedOldRouting = false;
  try {
    for (const node of flow.nodes || []) {
      if (routedNodeIds.has(node.id)) await updateExistingIvrName(node);
    }
    topTarget = await ensurePortalTarget(root);
    if (didAlreadyTargetsTarget(payload.did, topTarget)) {
      cache.overview = null;
      cache.callflow = null;
      return {
        ...basePlan,
        ok: true,
        dryRun: false,
        applied: true,
        flow: await appliedFlow(),
        title: attempts.length ? serverMessage("portal.callflowApplied") : "Keine Routing-Aenderung noetig",
        message: attempts.length
          ? serverMessage("portal.server.callflowUpdatedNumberUnchanged")
          : "Die Rufnummer war bereits mit diesem Ziel verbunden.",
        after: `${didName} → ${targetSummary(topTarget)}`,
        target: topTarget,
        response: attempts,
        appliedAt: new Date().toISOString(),
      };
    }
    update = buildCallflowUpdate({ ...payload, target: topTarget, flow: null });
    validateCallflowUpdate({ ...payload, target: topTarget }, update);

    for (const operation of update.operations) {
      const result = await runPortalOperation(operation, attempts);
      if (operation.action === "delete-old-routing") deletedOldRouting = true;
      attempts.push({ action: `${operation.action}-done`, method: operation.method, status: result.status, endpoint: operation.endpoint });
    }
  } catch (error) {
    attempts.push({
      action: "failed",
      method: error.method || "CREATE+ROUTE",
      status: error.status || 0,
      endpoint: error.endpoint || "",
      message: error.message,
      body: error.body,
    });

    if (deletedOldRouting && update?.rollback) {
      await runRollbackOperations([update.rollback], attempts);
    }
    await runRollbackOperations(restoredResources.reverse(), attempts);
    for (const created of createdTargets.reverse()) {
      if (!created.href) continue;
      await runRollbackOperations([{ action: `delete-created-${created.type}`, method: "DELETE", endpoint: created.href }], attempts);
    }

    return {
      ...basePlan,
      ok: false,
      dryRun: false,
      applied: false,
      title: "Komplexe Uebernahme fehlgeschlagen",
      rolledBack: !attempts.some(item => item.action === "rollback-failed"),
      message: attempts.map((attempt) => `${attempt.method || "-"}: ${attempt.message || attempt.action}`).join(" | "),
      attempts,
    };
  }

  cache.overview = null;
  cache.callflow = null;
  return {
    ...basePlan,
    ok: true,
    dryRun: false,
    applied: true,
    flow: await appliedFlow(),
    title: serverMessage("portal.callflowApplied"),
    message: serverMessage("portal.server.callflowAndRoutingUpdated"),
    after: `${didName} → ${targetSummary(topTarget)}`,
    target: topTarget,
    response: attempts,
    appliedAt: new Date().toISOString(),
  };
}

async function runPortalOperation(operation, attempts, context = {}) {
  let result;
  try {
    if (!["GET", "HEAD"].includes(String(operation.method || "").toUpperCase())) assertLiveWritesEnabled();
    result = await portalFetch(operation.endpoint, { method: operation.method, body: operation.body });
  } catch (error) {
    if (operation.method === "DELETE" && error.status === 404) {
      attempts.push({
        ...context,
        action: operation.action,
        method: operation.method,
        status: 404,
        endpoint: operation.endpoint,
        ignored: true,
        message: "Bereits entfernt oder nicht an diesem Ziel vorhanden.",
      });
      return {
        ok: true,
        status: 404,
        path: operation.endpoint,
        body: error.body || null,
      };
    }
    error.method = operation.method;
    error.endpoint = operation.endpoint;
    error.message = `${operation.action}: ${error.message}`;
    throw error;
  }
  attempts.push({
    ...context,
    action: operation.action,
    method: operation.method,
    status: result.status,
    endpoint: operation.endpoint,
  });
  return result;
}

async function runRollbackOperations(operations, attempts, context = {}) {
  for (const operation of operations || []) {
    try {
      await runPortalOperation(operation, attempts, { ...context, rollback: true });
    } catch (error) {
      attempts.push({
        ...context,
        rollback: true,
        action: "rollback-failed",
        method: operation.method,
        status: error.status || 0,
        endpoint: operation.endpoint,
        message: error.message,
      });
    }
  }
}

function serviceCollection(kind) {
  return kind === "skill" ? "skill-services" : "queue-services";
}

function serviceMemberData(kind, member, options = {}) {
  if (kind === "skill") {
    const data = [{ name: "skillLevel", value: Number(member.skillLevel || 1) }];
    if (options.includeEnabled) data.push({ name: "enabled", value: member.enabled !== false });
    return data;
  }
  return [{ name: "penalty", value: Number(member.penalty || 0) }];
}

function serviceEndpoint(kind, serviceNumber, suffix = "") {
  const customer = encodeURIComponent(config.customerAccount || "");
  return `/api/customers/${customer}/targets/${serviceCollection(kind)}/${encodeURIComponent(serviceNumber)}${suffix}`;
}

function phoneExtensionHref(extensionNumber) {
  const customer = encodeURIComponent(config.customerAccount || "");
  return `/api/customers/${customer}/targets/phone-extensions/${encodeURIComponent(extensionNumber)}`;
}

function compactServiceMember(item, overview, kind) {
  const href = linkHref(item, ["phoneExtension", "target", "self"]);
  const fromHref = href.includes("/phone-extensions/") ? lastPathSegment(href) : "";
  const extensionNumber = pickField(item, ["extensionNumber", "number", "phoneExtension"], fromHref);
  const extension = (overview.inventory?.extensions || []).find((entry) => entry.number === extensionNumber || entry.id === extensionNumber);
  return {
    id: extensionNumber,
    extensionNumber,
    name: extension?.name || pickField(item, ["displayName", "name"], serverMessage("portal.extensionValue", {p0: extensionNumber})),
    type: extension?.type || "PHONE",
    penalty: Number(pickField(item, ["penalty"], kind === "queue" ? 0 : "")) || 0,
    skillLevel: Number(pickField(item, ["skillLevel"], kind === "skill" ? 1 : "")) || 1,
    enabled: lowerFieldMap(item).get("enabled") !== false,
    href: item.href || href,
  };
}

function memberRevision(members) {
  const normalized = members.map(member => ({ extensionNumber: String(member.extensionNumber), penalty: Number(member.penalty || 0), skillLevel: Number(member.skillLevel || 1), enabled: member.enabled !== false })).sort((a,b) => a.extensionNumber.localeCompare(b.extensionNumber));
  return crypto.createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}

async function hydrateServiceMembers(kind, services, overview) {
  return Promise.all((services || []).map(async (service) => {
    const serviceNumber = service.serviceNumber || service.extensionNumber || service.value || service.id;
    if (!serviceNumber) return { ...service, kind, members: [], memberError: serverMessage("portal.error.memberLoad") };
    try {
      const endpoint = await fetchAllPages(`${serviceEndpoint(kind, serviceNumber)}/members`);
      const members = endpoint.items.map((item) => compactServiceMember(item, overview, kind));
      return { ...service, kind, serviceNumber, members, memberRevision: memberRevision(members) };
    } catch (error) {
      return { ...service, kind, serviceNumber, members: [], memberError: portalErrorMessage(error) };
    }
  }));
}

async function loadServiceGroups() {
  const overview = cache.overview || await loadOverview();
  const [queues, skills] = await Promise.all([
    hydrateServiceMembers("queue", overview.inventory?.queues || [], overview),
    hydrateServiceMembers("skill", overview.inventory?.skills || [], overview),
  ]);
  return {
    ok: true,
    account: overview.account,
    queues,
    skills,
    extensions: overview.inventory?.extensions || [],
    syncedAt: new Date().toISOString(),
  };
}

function normalizeDesiredMember(kind, member) {
  if (!member || typeof member !== "object" || Array.isArray(member)) return null;
  if (kind === "skill" && Object.prototype.hasOwnProperty.call(member, "enabled") && typeof member.enabled !== "boolean") {
    throw httpError(400, "Invalid membership settings.");
  }
  const extensionNumber = String(member.extensionNumber || member.number || member.id || "").trim();
  if (!extensionNumber) return null;
  return {
    extensionNumber,
    penalty: Number(member.penalty || 0),
    skillLevel: Number(member.skillLevel || 1),
    enabled: member.enabled !== false,
    kind,
  };
}

async function applyServiceGroupChanges(payload) {
  if (!Array.isArray(payload.services) || payload.services.some(service => !service || typeof service !== "object" || Array.isArray(service))) throw httpError(400, serverMessage("portal.error.invalidJson"));
  assertLiveWritesEnabled();
  await loadOverview();
  const serviceGroups = await loadServiceGroups();
  requireCompleteInventory(cache.overview);
  if (payload.account !== config.customerAccount) throw httpError(409, "Account changed. Reload the memberships.");
  const services = Array.isArray(payload.services) ? payload.services : [];
  if (!services.length) throw httpError(400, "No membership changes provided.");
  const operations = [];
  const touched = new Set();
  for (const service of services) {
    if (!["queue", "skill"].includes(service.kind)) throw httpError(400, "Invalid service kind.");
    const kind = service.kind;
    const source = (kind === "skill" ? serviceGroups.skills : serviceGroups.queues).find(item => String(item.serviceNumber) === String(service.serviceNumber));
    if (!source || source.memberError || !source.memberRevision) throw httpError(409, "Memberships could not be loaded. Reload before applying.");
    if (!service.baseRevision || service.baseRevision !== source.memberRevision) throw httpError(409, "Memberships changed since this draft. Reload and review the changes.");
    const serviceNumber = source.serviceNumber;
    if (touched.has(kind + serviceNumber)) throw httpError(400, "Duplicate service change.");
    touched.add(kind + serviceNumber);
    if (![service.add, service.remove, service.update].every(Array.isArray)) throw httpError(400, "Explicit add, remove and update lists are required.");
    const current = new Map(source.members.map(member => [String(member.extensionNumber), member]));
    const seen = new Set();
    for (const [action, entries] of [["add",service.add],["remove",service.remove],["update",service.update]]) {
      for (const input of entries) {
        const member = normalizeDesiredMember(kind, typeof input === "string" ? { extensionNumber: input } : input);
        if (!member || !/^\d+$/.test(member.extensionNumber) || seen.has(member.extensionNumber)) throw httpError(400, "Invalid or duplicate member change.");
        seen.add(member.extensionNumber);
        if ((action === "add") === current.has(member.extensionNumber)) throw httpError(409, "Membership changed. Reload before applying.");
        if (action !== "remove" && !serviceGroups.extensions.some(ext => String(ext.number) === member.extensionNumber)) throw httpError(400, "Unknown extension.");
        if (!Number.isInteger(member.penalty) || member.penalty < 0 || !Number.isInteger(member.skillLevel) || member.skillLevel < 1) throw httpError(400, "Invalid membership settings.");
        const endpoint = serviceEndpoint(kind, serviceNumber, "/members") + (action === "add" ? "" : "/" + encodeURIComponent(member.extensionNumber));
        operations.push({ action: kind + "-member-" + action, method: action === "add" ? "POST" : action === "remove" ? "DELETE" : "PUT", endpoint, body: action === "remove" ? undefined : { ...(action === "add" ? { links: [{ rel: "phoneExtension", href: phoneExtensionHref(member.extensionNumber) }] } : {}), data: serviceMemberData(kind, member, { includeEnabled: action === "update" }) } });
      }
    }
  }
  // Validate every group before the first write; untouched groups never appear here.
  const attempts = [];
  for (let index=0; index<operations.length; index++) {
    const operation=operations[index];
    try { await runPortalOperation(operation, attempts); } catch (error) {
      cache.overview=null; cache.callflow=null;
      return {ok:false,status:502,error:portalErrorMessage(error),partial:attempts.length>0,completed:operations.slice(0,index),failed:{...operation,status:error.status||502},notAttempted:operations.slice(index+1),attempts};
    }
  }
  cache.overview = null;
  cache.callflow = null;
  const overview = await loadOverview();
  return { ok: true, title: "Mitgliedschaften übernommen", message: "Warteschlangen und Skillgruppen wurden über die Portal API aktualisiert.", attempts, overview, serviceGroups: await loadServiceGroups(), appliedAt: new Date().toISOString() };
}

async function applyCallflowChange(payload) {
  if (payload.flow) assertUnambiguousFlow(payload.flow);
  if (payload.commit && areLiveWritesEnabled()) {
    const overview = await loadOverview();
    requireCompleteInventory(overview);
    const requested = payload.did?.name || payload.did?.id;
    const actualDid = overview.inventory.dids.find(did => (did.name || did.id) === requested);
    if (!actualDid) throw httpError(409, "Number is no longer available. Reload before applying.");
    payload = { ...payload, did: actualDid };
  }
  if (flowHasComplexPayload(payload)) {
    return applyComplexCallflowChange(payload);
  }

  const update = buildCallflowUpdate(payload);
  const didName = payload.did?.name || payload.did?.id || "";
  const target = payload.target || {};

  if (!didName) {
    throw httpError(400, "Keine Rufnummer für die Übernahme gefunden.");
  }
  if (!update.fields.destinationType) {
    throw httpError(400, "Kein Zieltyp für die Übernahme gefunden.");
  }
  if (!update.fields.destinationRouteNumber) {
    throw httpError(400, "Keine Zielroute gefunden. Bitte ein bestehendes Ziel aus der Liste wählen.");
  }
  if (!update.operations.length || update.operations.some((operation) => !operation.endpoint)) {
    throw httpError(400, "Die Portal-API-Zielroute konnte nicht eindeutig gebildet werden.");
  }

  const basePlan = {
    ok: true,
    type: "callflow",
    target: { ...target, type: update.fields.destinationType, number: update.fields.destinationExtensionNumber, routeNumber: update.fields.destinationRouteNumber, href: update.body.links[0].href },
    title: "Callflow zur Übernahme bereit",
    message: "Die Änderung ist technisch vorbereitet.",
    did: didName,
    before: `${didName} → ${payload.did?.destinationName || payload.did?.destinationExtension || payload.did?.destinationType || "-"}`,
    after: `${didName} → ${target.title || "-"} · ${targetTypeLabel(update.fields.destinationType)} ${update.fields.destinationExtensionNumber || update.fields.destinationRouteNumber}`,
    endpoint: update.endpoint,
    method: update.method,
    body: update.body,
    fields: update.fields,
    operations: update.operations,
    applyPayload: payload,
    flow: payload.flow || null,
    createdAt: new Date().toISOString(),
  };

  if (!payload.commit) return { ...basePlan, dryRun: true };
  if (!areLiveWritesEnabled()) return liveWritesDisabledResult(basePlan);

  const attempts = [];
  let deletedOldRouting = false;
  try {
    for (const operation of update.operations) {
      const result = await runPortalOperation(operation, attempts);
      if (operation.action === "delete-old-routing" && !result.ignored) deletedOldRouting = true;
    }
  } catch (error) {
    attempts.push({
      action: "failed",
      method: error.method || update.method,
      status: error.status || 0,
      message: error.message,
    });

    if (deletedOldRouting && update.rollback) {
      try {
        const rollbackResult = await portalFetch(update.rollback.endpoint, { method: update.rollback.method, body: update.rollback.body });
        attempts.push({
          action: update.rollback.action,
          method: update.rollback.method,
          status: rollbackResult.status,
          endpoint: update.rollback.endpoint,
        });
      } catch (rollbackError) {
        attempts.push({
          action: "rollback-failed",
          method: update.rollback.method,
          status: rollbackError.status || 0,
          message: rollbackError.message,
        });
      }
    }
  }

  const isForbidden = attempts.some((attempt) => attempt.status === 403);
  const failedAttempt = attempts.find((attempt) => attempt.action === "failed" || attempt.action === "rollback-failed");

  if (!failedAttempt) {
    cache.overview = null;
    cache.callflow = null;
    return {
      ...basePlan,
      ok: true,
      dryRun: false,
      applied: true,
      title: "Callflow übernommen",
      message: "Die Portal API hat die Änderung angenommen.",
      response: attempts,
      appliedAt: new Date().toISOString(),
    };
  }

  return {
    ...basePlan,
    ok: false,
    dryRun: false,
    applied: false,
    title: "Übernahme fehlgeschlagen",
    message: isForbidden
      ? "Die Portal API hat den Schreibzugriff mit 403 abgelehnt. Der API-Key kann lesen, hat aber offenbar keine Freigabe fuer diese Routing-Aenderung."
      : attempts.map((attempt) => `${attempt.method || "-"}: ${attempt.message || attempt.action}`).join(" | "),
    attempts,
  };
}

async function applyBulkCallflowChange(payload) {
  if (!Array.isArray(payload.changes)) throw httpError(400, serverMessage("portal.error.invalidJson"));
  if (payload.commit) assertLiveWritesEnabled();
  let changes = Array.isArray(payload.changes) ? payload.changes : [];
  changes.forEach(change => {
    if (!change || typeof change !== "object" || Array.isArray(change)) throw httpError(400, "Each callflow change must be an object.");
    assertUnambiguousFlow(change.flow);
  });
  if (payload.commit) {
    const overview = await loadOverview();
    requireCompleteInventory(overview);
    changes = changes.map(change => {
      const current = overview.inventory.dids.find(did => inboundNumberIdForDid(did) === inboundNumberIdForDid(change.did || {}));
      if (!current) throw httpError(409, "Number changed. Reload before applying.");
      return {...change, did: current};
    });
  }
  const profileName = payload.profileName || "Callflow-Profil";

  if (!changes.length) {
    return {
      ok: true,
      dryRun: true,
      type: "profile",
      title: "Keine Änderung nötig",
      message: "Das Profil entspricht bereits dem aktuellen Routing.",
      profileName,
      changeCount: 0,
      changes: [],
      operations: [],
      createdAt: new Date().toISOString(),
    };
  }

  const plans = changes.map((change, index) => {
    const update = buildCallflowUpdate(change);
    validateCallflowUpdate(change, update);
    const didName = change.did?.name || change.did?.id || serverMessage("portal.numberValue", {p0: index + 1});
    const target = change.target || {};
    return {
      index,
      change,
      update,
      didName,
      before: `${didName} → ${change.did?.destinationName || change.did?.destinationExtension || change.did?.destinationType || "-"}`,
      after: `${didName} → ${target.title || "-"} · ${targetTypeLabel(update.fields.destinationType)} ${update.fields.destinationExtensionNumber || update.fields.destinationRouteNumber}`,
    };
  });

  const basePlan = {
    ok: true,
    dryRun: !payload.commit,
    type: "profile",
    title: serverMessage("portal.server.valueReadyToApply", {p0: profileName}),
    message: serverMessage("portal.server.valueRoutingChangesTechnicallyPrepared", {p0: plans.length, p1: plans.length === 1 ? "" : "en"}),
    profileName,
    changeCount: plans.length,
    changes: plans.map((plan) => ({
      did: plan.didName,
      before: plan.before,
      after: plan.after,
      fields: plan.update.fields,
    })),
    operations: plans.flatMap((plan) => plan.update.operations.map((operation) => ({
      did: plan.didName,
      action: operation.action,
      method: operation.method,
      endpoint: operation.endpoint,
      body: operation.body,
    }))),
    applyPayload: {
      profileName,
      changes,
    },
    createdAt: new Date().toISOString(),
  };

  if (!payload.commit) return basePlan;
  if (!areLiveWritesEnabled()) return liveWritesDisabledResult(basePlan);

  const attempts = [];
  const appliedPlans = [];

  for (const plan of plans) {
    const completed = [];
    try {
      for (const operation of plan.update.operations) {
        await runPortalOperation(operation, attempts, { did: plan.didName, index: plan.index });
        completed.push(operation.action);
      }
      appliedPlans.push(plan);
    } catch (error) {
      attempts.push({
        did: plan.didName,
        index: plan.index,
        action: "failed",
        method: error.method || "-",
        status: error.status || 0,
        message: error.message,
      });

      const currentRollback = completed.includes("create-new-routing")
        ? plan.update.rollbackOperations
        : completed.includes("delete-old-routing") && plan.update.rollback
          ? [plan.update.rollback]
          : [];
      await runRollbackOperations(currentRollback, attempts, { did: plan.didName, index: plan.index });

      for (const applied of appliedPlans.reverse()) {
        await runRollbackOperations(applied.update.rollbackOperations, attempts, {
          did: applied.didName,
          index: applied.index,
        });
      }

      const failedText = attempts
        .filter((attempt) => attempt.action === "failed" || attempt.action === "rollback-failed")
        .map((attempt) => `${attempt.did || "Rufnummer"}: ${attempt.method || "-"} ${attempt.status || ""} ${attempt.message || attempt.action}`.trim())
        .join(" | ");

      return {
        ...basePlan,
        ok: false,
        dryRun: false,
        applied: false,
        title: "Profil-Übernahme fehlgeschlagen",
        message: failedText || "Die Portal API hat eine Bulk-Änderung abgelehnt.",
        attempts,
        rolledBack: !attempts.some(item => item.action === "rollback-failed"),
      };
    }
  }

  cache.overview = null;
  cache.callflow = null;
  return {
    ...basePlan,
    ok: true,
    dryRun: false,
    applied: true,
    title: serverMessage("portal.server.valueApplied", {p0: profileName}),
    message: "Alle Routing-Änderungen wurden von der Portal API angenommen.",
    attempts,
    appliedAt: new Date().toISOString(),
  };
}

function publicEndpoint(endpoint) {
  if (!endpoint) return { ok: false, status: 0, count: 0, error: "Not requested" };
  return {
    ok: endpoint.ok,
    status: endpoint.status || 0,
    path: endpoint.path || "",
    count: endpoint.count || 0,
    complete: endpoint.complete === true,
    total: endpoint.total ?? endpoint.count ?? 0,
    error: endpoint.ok ? "" : endpoint.error || "Unknown error",
    errorCode: endpoint.ok ? "" : endpoint.errorCode || "",
    errorKind: endpoint.ok ? "" : endpoint.errorKind || (endpoint.status ? "http" : "unknown"),
    optional: Boolean(endpoint.optional),
  };
}

function publicCustomer(data) {
  return {
    externalIdentifier: data.externalIdentifier || config.customerAccount,
    name: data.name || "Portal Customer",
    snomTransfer: data.snomTransfer || "",
    customCrAnn: data.customCrAnn ?? "",
  };
}

function compactPublicFields(data, fieldDefs) {
  return Object.fromEntries(fieldDefs
    .map(([key, label, aliases]) => {
      const value = pickField(data, [key, ...(aliases || [])], "");
      return value ? [key, { label, value }] : null;
    })
    .filter(Boolean));
}

function publicContract(data) {
  const preferred = compactPublicFields(data, [
    ["contractNumber", "Vertragsnummer", ["contractId", "contractIdentifier", "number"]],
    ["customerNumber", "Kundennummer", ["customerId", "debtorNumber", "accountNumber"]],
    ["contractType", "Vertragstyp", ["type", "tariff", "product"]],
    ["status", "Status", ["state", "contractStatus"]],
    ["startDate", "Start", ["contractStart", "validFrom"]],
    ["endDate", "Ende", ["contractEnd", "validTo"]],
  ]);
  if (Object.keys(preferred).length) return preferred;

  const ignored = new Set(["href", "links", "data", "items", "entries", "collection"]);
  return Object.fromEntries(Object.entries(data || {})
    .filter(([key, value]) => !ignored.has(key) && isCompactFieldValue(value))
    .slice(0, 6)
    .map(([key, value]) => [
      key,
      {
        label: contractFieldLabel(key),
        value: compactFieldValue(value),
      },
    ]));
}

function contractFieldLabel(key) {
  const labels = {
    name: "Vertrag",
    nameSdr: "Produktcode",
    nameEnum: "Vertragstyp",
    allowServiceportalLogin: "Serviceportal",
    allowAdminportalLogin: "Adminportal",
    maxDevicesPerExtension: "Geräte je Nebenstelle",
  };
  return labels[key] || key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function compactCustomerOption(customer, index = 0) {
  const account = pickField(customer, ["externalIdentifier", "customerId", "customer", "account", "id", "number"], "");
  const name = pickField(customer, ["name", "displayName", "company", "description"], account || serverMessage("portal.server.pbxValue", {p0: index + 1}));
  return {
    id: account || name,
    account: account || name,
    name,
    label: account && name && name !== account ? `${account} · ${name}` : name || account,
    href: customer.href || "",
  };
}

async function listPortalCustomers() {
  if (!config.apiKeyId || !config.apiKeySecret) {
    return {
      ok: false,
      customers: config.customerAccount
        ? [{ id: config.customerAccount, account: config.customerAccount, name: config.customerAccount, label: config.customerAccount, href: "" }]
        : [],
      activeAccount: config.customerAccount || "",
      error: "Portal API Zugang ist nicht vollständig konfiguriert.",
    };
  }

  try {
    const endpoint = summarizeEndpoint(await fetchAllPages("/api/customers/"));
    const customers = (endpoint.items || []).map(compactCustomerOption).filter((customer) => customer.account);
    if (config.customerAccount && !customers.some((customer) => customer.account === config.customerAccount)) {
      customers.unshift({ id: config.customerAccount, account: config.customerAccount, name: config.customerAccount, label: config.customerAccount, href: "" });
    }
    return {
      ok: true,
      customers,
      activeAccount: config.customerAccount || customers[0]?.account || "",
      count: customers.length,
      path: endpoint.path,
    };
  } catch (error) {
    return {
      ok: false,
      customers: config.customerAccount
        ? [{ id: config.customerAccount, account: config.customerAccount, name: config.customerAccount, label: config.customerAccount, href: "" }]
        : [],
      activeAccount: config.customerAccount || "",
      error: portalErrorMessage(error),
      status: error.status || 0,
    };
  }
}

async function switchCustomerAccount(account) {
  if (typeof account !== "string") throw httpError(400, serverMessage("portal.error.invalidJson"));
  const normalized = String(account || "").trim();
  if (!normalized) {
    const error = new Error("Keine Anlage ausgewählt.");
    error.status = 400;
    throw error;
  }
  if (!config.apiKeyId || !config.apiKeySecret) {
    const error = new Error("Portal API Zugang ist nicht vollständig konfiguriert.");
    error.status = 400;
    throw error;
  }

  const customers = await listPortalCustomers();
  const known = customers.customers.find((customer) => customer.account === normalized);
  if (customers.ok && customers.customers.length && !known) {
    const error = new Error(serverMessage("portal.server.pbxValueIsNotVisibleWithTheseApiCredentials", {p0: normalized}));
    error.status = 403;
    throw error;
  }
  const validation = await safePortalCall("customerValidation", `/api/customers/${encodeURIComponent(normalized)}/basic-data`, { collection: false });
  if (!validation.ok) {
    const error = new Error(serverMessage("portal.server.pbxValueCouldNotBeReadValue", {p0: normalized, p1: validation.error || `HTTP ${validation.status}`}));
    error.status = validation.status || 403;
    throw error;
  }

  const previousAccount = config.customerAccount || "";
  config.customerAccount = normalized;
  config.configured = Boolean(config.apiKeyId && config.apiKeySecret && config.customerAccount);
  clearPortalCache();
  if (previousAccount && previousAccount !== normalized && runtimeSettings.liveWritesEnabled) {
    runtimeSettings.liveWritesEnabled = false;
    runtimeSettings.liveWritesChangedAt = new Date().toISOString();
  }

  return {
    ok: true,
    previousAccount,
    account: config.customerAccount,
    customer: known || { id: normalized, account: normalized, name: normalized, label: normalized, href: "" },
    customers: customers.customers,
    settings: publicSettingsPayload(),
    message: previousAccount && previousAccount !== normalized
      ? "Anlage gewechselt. Live-Schreiben wurde zur Sicherheit deaktiviert."
      : "Anlage ist aktiv.",
  };
}

function sanitizeBrowserLogin(body = {}) {
  const credentials = {
    baseUrl: String(body.baseUrl || "").trim() || "https://portal-api.nfon.net:8090",
    apiKeyId: String(body.apiKeyId || "").trim(),
    apiKeySecret: String(body.apiKeySecret || "").trim(),
    customerAccount: String(body.customerAccount || "").trim(),
  };
  const missing = Object.entries({
    PORTAL_API_KEY_ID: credentials.apiKeyId,
    PORTAL_API_KEY_SECRET: credentials.apiKeySecret,
    PORTAL_CUSTOMER_ACCOUNT: credentials.customerAccount,
  })
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length) {
    const error = new Error(serverMessage("portal.server.browserLoginIncompleteValueIsMissing", {p0: missing.join(", ")}));
    error.status = 400;
    throw error;
  }

  try {
    const parsed = new URL(credentials.baseUrl);
    if (!["https:", "http:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash || !["", "/"].includes(parsed.pathname)) throw new Error("Unsupported endpoint");
    if (parsed.origin !== new URL(config.baseUrl).origin) throw new Error("Endpoint must match server configuration");
    credentials.baseUrl = parsed.toString().replace(/\/$/, "");
  } catch {
    const error = new Error("PORTAL_BASE_URL ist keine gültige HTTP/HTTPS URL.");
    error.status = 400;
    throw error;
  }
  return credentials;
}

async function applyBrowserLogin(body = {}) {
  const credentials = sanitizeBrowserLogin(body);
  await portalFetch(`/api/customers/${encodeURIComponent(credentials.customerAccount)}/basic-data`, { credentials: { ...credentials, configured: true } });
  config.baseUrl = credentials.baseUrl;
  config.apiKeyId = credentials.apiKeyId;
  config.apiKeySecret = credentials.apiKeySecret;
  config.customerAccount = credentials.customerAccount;
  config.configured = true;
  runtimeSettings.authMode = "browser";
  runtimeSettings.browserCredentialsChangedAt = new Date().toISOString();
  runtimeSettings.liveWritesEnabled = false;
  runtimeSettings.liveWritesChangedAt = runtimeSettings.browserCredentialsChangedAt;
  clearPortalCache();


  return {
    ok: true,
    account: config.customerAccount,
    baseUrl: config.baseUrl,
    settings: publicSettingsPayload(),
    message: "Browser-Login ist für diese Server-Sitzung aktiv. Live-Schreiben wurde zur Sicherheit deaktiviert.",
  };
}


function demoOverview(reason = "") {
  const extensions = [
    { id: "201", number: "201", name: "Reception", type: "Phone Extension", email: "reception@example.local", device: "Yealink T54W" },
    { id: "202", number: "202", name: "Sales", type: "Phone Extension", email: "sales@example.local", device: "Softphone" },
    { id: "203", number: "203", name: "Support", type: "Phone Extension", email: "support@example.local", device: "Yealink T46S" },
  ];
  return {
    ok: false,
    demo: true,
    reason,
    account: config.customerAccount || "Demo",
    version: { version: "Demo", host: "local" },
    customer: { company: "Demo Customer", account: config.customerAccount || "Demo" },
    counts: {
      extensions: extensions.length,
      devices: 2,
      trunks: 1,
      dids: 1,
    phoneBooks: 1,
    groups: 1,
    queues: 1,
    skills: 1,
    ivrs: 1,
    timeControls: 1,
    announcements: 1,
  },
    inventory: {
      extensions,
      devices: [{ id: "demo-softphone", name: "Softphone" }, { id: "demo-t54", name: "Yealink T54W" }],
      trunks: [{ id: "demo-trunk", name: "Main SIP Trunk", value: "+49 89 12345-0" }],
      dids: [
        {
          id: "+49 89 12345-0",
          name: "+49 89 12345-0",
          value: "Reception",
          trunkNumber: "+49 89 12345(0-9)",
          didExtension: "0",
          destinationName: "Reception",
          destinationExtension: "201",
          destinationType: "PHONEEXTENSION",
        },
      ],
    phoneBooks: [{ id: "demo-pb", name: "Company" }],
    groups: [{ id: "10", name: "Reception Group" }],
    queues: [{ id: "10000", name: "Demo Frontdesk", value: "10000" }],
    skills: [{ id: "11", name: "Demo Skill", value: "11" }],
    ivrs: [{ id: "20", name: "Welcome IVR" }],
    timeControls: [{ id: "30", name: "Business Hours" }],
    announcements: [{ id: "40", name: "Nachtansage", value: "GENERAL_ANNOUNCEMENT" }],
  },
    endpoints: {},
    callflow: buildCallflow({ demo: true, inventory: { extensions } }),
    settings: publicSettingsPayload(),
    syncedAt: new Date().toISOString(),
  };
}

function buildCallflow(overview) {
  const inventory = overview.inventory || {};
  const did = inventory.dids?.[0] || {};
  const didNumber = did.name || did.id || "+49 89 12345-0";
  const trunk = did.trunkNumber || inventory.trunks?.[0]?.name || "SIP Trunk";
  const destinationType = did.destinationType || "PHONEEXTENSION";
  const destinationLabel = did.destinationName || did.value || did.destinationExtension || "Ziel wählen";
  const destinationDetail = did.destinationExtension
    ? `${destinationType} ${did.destinationExtension}`
    : destinationType;

  return {
    source: overview.demo ? "demo" : "portal-live",
    didId: did.id || didNumber,
    original: {
      did: didNumber,
      destinationName: did.destinationName || did.value || "",
      destinationExtension: did.destinationExtension || "",
      destinationType,
    },
    nodes: [
      { id: "inbound", type: "DID", title: "Eingehender Anruf", subtitle: didNumber, x: 8, y: 45, tone: "blue", locked: true },
      { id: "trunk", type: "Trunk", title: "Leitung", subtitle: trunk, x: 34, y: 45, tone: "purple", locked: true },
      { id: "target", type: destinationType, title: destinationLabel, subtitle: destinationDetail, x: 68, y: 45, tone: "green", isTarget: true },
    ],
    edges: [
      { from: "inbound", to: "trunk", label: "kommt an" },
      { from: "trunk", to: "target", label: "führt zu" },
    ],
  };
}

async function loadOverview() {
  const generation = accountGeneration;
  const account = config.customerAccount;
  if (!config.configured) {
    cache.overview = demoOverview("Portal API ist noch nicht vollständig konfiguriert.");
    cache.syncedAt = cache.overview.syncedAt;
    cache.overview.connection = portalConnection();
    return cache.overview;
  }

  const customer = encodeURIComponent(config.customerAccount);
  const snapshot = await readDaynightSnapshot(account);
  if (generation !== accountGeneration) throw httpError(409, "Account changed. Reload before continuing.");
  cache.managedTimeControls = snapshot?.ownedTimeControls || [];
  const base = `/api/customers/${customer}`;
  const endpointDefs = {
    version: "/api/version",
    basicData: `${base}/basic-data`,
    contract: `${base}/contract-information`,
    featureStatus: `${base}/feature-status`,
    extensions: `${base}/targets/phone-extensions`,
    devices: `${base}/devices`,
    trunks: `${base}/trunks?inboundCallsEnabled=true`,
    dids: `${base}/dids`,
    phoneBooks: `${base}/phone-books`,
    groups: `${base}/targets/group-services`,
    ivrs: `${base}/targets/ivr-services`,
    timeControls: `${base}/targets/time-control-services`,
    announcements: `${base}/announcements`,
  };

  const entries = await Promise.all(
    Object.entries(endpointDefs).map(async ([key, apiPath]) => [key, await safePortalCall(key, apiPath, {
      collection: !["version", "basicData", "contract", "featureStatus"].includes(key),
    })])
  );
  const endpoints = Object.fromEntries(entries);
  const optionalTargetEntries = await Promise.all([
    firstAvailablePortalCall("queues", [
      `${base}/targets/queue-services`,
      `${base}/targets/queues`,
      `${base}/queue-services`,
      `${base}/queues`,
    ]),
    firstAvailablePortalCall("skills", [
      `${base}/targets/skill-services`,
      `${base}/targets/skills`,
      `${base}/skill-services`,
      `${base}/skills`,
    ]),
    firstAvailablePortalCall("voicemails", [
      `${base}/targets/voicemail-services`,
      `${base}/targets/voice-mail-services`,
      `${base}/targets/mailbox-services`,
      `${base}/targets/answering-machine-services`,
      `${base}/voicemail-services`,
      `${base}/mailbox-services`,
    ]),
    firstAvailablePortalCall("frontdesks", [
      `${base}/targets/frontdesk-services`,
      `${base}/targets/frontdesks`,
      `${base}/frontdesk-services`,
      `${base}/frontdesks`,
    ]),
  ]);
  const [queuesEndpoint, skillsEndpoint, voicemailsEndpoint, frontdesksEndpoint] = optionalTargetEntries;
  Object.assign(endpoints, { queues: queuesEndpoint, skills: skillsEndpoint, voicemails: voicemailsEndpoint, frontdesks: frontdesksEndpoint });
  for (const [key, endpoint] of Object.entries(endpoints)) endpoint.optional = OPTIONAL_ENDPOINT_KEYS.has(key);

  const inventory = {
    extensions: (endpoints.extensions.items || []).map(compactExtension),
    devices: (endpoints.devices.items || []).map((item, index) => compactGeneric(item, "Device", index, {
      nameKeys: ["deviceType", "deviceId", "uniqueIdentifier", "name"],
      valueKeys: ["extension", "active", "deviceCategory"],
    })),
    trunks: (endpoints.trunks.items || []).map((item, index) => compactGeneric(item, "Trunk", index, {
      nameKeys: ["baseNumber", "trunkNumber", "name"],
      valueKeys: ["trunkNumber", "dropExtensionName", "inboundCallsEnabled"],
    })),
    dids: (endpoints.dids.items || []).map(compactDid),
    phoneBooks: (endpoints.phoneBooks.items || []).map((item, index) => compactPhonebookEntry(item, { id: "portal-phone-books", name: "Portal Phonebook" }, index)),
    groups: (endpoints.groups.items || []).map((item, index) => compactGeneric(item, "Group", index, {
      nameKeys: ["displayName", "name", "serviceNumber", "extensionNumber"],
      valueKeys: ["serviceNumber", "extensionNumber", "type"],
    })),
    queues: (queuesEndpoint.items || []).map((item, index) => compactServiceTarget(item, "Queue", index)),
    skills: (skillsEndpoint.items || []).map((item, index) => compactServiceTarget(item, "Skill", index)),
    frontdesks: (frontdesksEndpoint.items || []).map((item, index) => compactServiceTarget(item, "Frontdesk", index)),
    voicemails: (voicemailsEndpoint.items || []).map((item, index) => compactGeneric(item, "Voicemail", index, {
      nameKeys: ["displayName", "name", "extensionNumber", "number", "serviceNumber"],
      valueKeys: ["extensionNumber", "number", "serviceNumber", "id", "href"],
    })),
    ivrs: (endpoints.ivrs.items || []).map((item, index) => compactGeneric(item, "IVR", index, {
      nameKeys: ["displayName", "name", "serviceNumber", "extensionNumber"],
      valueKeys: ["serviceNumber", "extensionNumber", "type"],
    })),
    timeControls: (endpoints.timeControls.items || []).map((item, index) => compactGeneric(item, "TimeControl", index, {
      nameKeys: ["displayName", "name", "serviceNumber", "extensionNumber"],
      valueKeys: ["serviceNumber", "extensionNumber", "type"],
    })),
    announcements: (endpoints.announcements.items || []).map((item, index) => compactGeneric(item, "Announcement", index, {
      nameKeys: ["displayName", "name", "fileName", "filename"],
      valueKeys: ["type", "announcementType", "fileName", "filename"],
    })),
  };
  inventory.ivrs = await hydrateIvrDetails(inventory.ivrs, inventory);
  inventory.timeControls = (await hydrateTimeControlDetails(inventory.timeControls)).map(control => ({
    ...control, dayTarget: targetFromHref(control.dayTargetHref, inventory), nightTarget: targetFromHref(control.nightTargetHref, inventory),
  }));
  if (generation !== accountGeneration) throw httpError(409, "Account changed. Reload before continuing.");
  // Overview is read-only. Pruning a persisted backup here raced both account
  // changes and live mutations. Explicit cleanup/save owns persistence instead.
  cache.managedTimeControls = (snapshot?.ownedTimeControls || []).filter(item =>
    inventory.timeControls.some(control => sameApiHref(control.href, item.href)));

  for (const kind of ["ivrs", "timeControls"]) {
    if (inventory[kind].some(item => item.detailError)) Object.assign(endpoints[kind], { ok: false, complete: false, error: "Routing details could not be loaded.", status: 502 });
  }

  const overview = {
    ok: Object.values(endpoints).some((endpoint) => endpoint.ok),
    demo: false,
    account,
    version: endpoints.version.data || {},
    customer: publicCustomer(endpoints.basicData.data || {}),
    contract: publicContract(endpoints.contract.data || {}),
    counts: {
      extensions: inventory.extensions.length,
      devices: inventory.devices.length,
      trunks: inventory.trunks.length,
      dids: inventory.dids.length,
      phoneBooks: inventory.phoneBooks.length,
      groups: inventory.groups.length,
      queues: inventory.queues.length,
      skills: inventory.skills.length,
      frontdesks: inventory.frontdesks.length,
      voicemails: inventory.voicemails.length,
      ivrs: inventory.ivrs.length,
      timeControls: inventory.timeControls.length,
      announcements: inventory.announcements.length,
    },
    inventory,
    endpoints: Object.fromEntries(
      Object.entries(endpoints).map(([key, endpoint]) => [key, publicEndpoint(endpoint)])
    ),
    settings: publicSettingsPayload(),
    syncedAt: new Date().toISOString(),
  };
  overview.daynight = {active:Boolean(snapshot?.routingActive || inventory.dids.some(did => inventory.timeControls.some(tc => ownedDaynightTimeControl(tc) && didTargetsTimeControl(did,tc)))), nightTarget:snapshot?.nightTarget || null};
  overview.connection = portalConnection(overview.endpoints, overview.syncedAt);
  overview.callflow = buildCallflow(overview);

  if (generation !== accountGeneration) throw httpError(409, "Account changed. Reload before continuing.");
  cache.overview = overview;
  cache.callflow = overview.callflow;
  cache.syncedAt = overview.syncedAt;
  cache.errors = Object.fromEntries(
    Object.entries(endpoints)
      .filter(([, endpoint]) => !endpoint.ok)
      .map(([key, endpoint]) => [key, endpoint.error])
  );
  return overview;
}

function portalConnection(endpoints = cache.overview?.endpoints, checkedAt = cache.overview?.syncedAt || null) {
  const required = REQUIRED_ENDPOINT_KEYS.map((key) => endpoints?.[key]);
  const optional = [...OPTIONAL_ENDPOINT_KEYS].map((key) => endpoints?.[key]);
  const requiredLoaded = required.filter((endpoint) => endpoint?.ok).length;
  const requiredFailed = required.filter((endpoint) => endpoint && !endpoint.ok).length;
  let state = "unchecked";
  if (!config.configured) state = "unconfigured";
  else if (requiredLoaded === required.length) state = "connected";
  else if (requiredLoaded) state = "partial";
  else if (requiredFailed) state = "unavailable";
  return {
    state,
    authenticationRequired: required.some(endpoint => endpoint?.status === 401),
    checkedAt,
    requiredTotal: required.length,
    requiredLoaded,
    requiredFailed,
    optionalTotal: optional.length,
    optionalLoaded: optional.filter((endpoint) => endpoint?.ok).length,
    optionalFailed: optional.filter((endpoint) => endpoint && !endpoint.ok).length,
  };
}

function publicSettingsPayload() {
  const googleContactsFile = runtimeSettings.googleContactsFile || config.googleContactsFile;
  return {
    configured: config.configured,
    account: config.customerAccount || "",
    baseUrl: config.baseUrl,
    authMode: runtimeSettings.authMode,
    browserCredentialsActive: runtimeSettings.authMode === "browser",
    browserCredentialsChangedAt: runtimeSettings.browserCredentialsChangedAt,
    apiKeyIdConfigured: Boolean(config.apiKeyId),
    liveWritesEnabled: areLiveWritesEnabled(),
    liveWritesLocked: config.liveWritesLocked,
    liveWritesDefaultEnabled: config.liveWritesEnabled,
    liveWritesPermitted: config.liveWritesPermitted,
    liveWritesRuntimeOverride: runtimeSettings.liveWritesEnabled !== config.liveWritesEnabled,
    liveWritesChangedAt: runtimeSettings.liveWritesChangedAt,
    csrfToken,
    writeContext,
    sources: {
      environment: Boolean(process.env.PORTAL_API_KEY_ID || process.env.PORTAL_API_KEY_SECRET || process.env.PORTAL_CUSTOMER_ACCOUNT),
      portalSecretFound: Boolean(config.portalSecretFile && fs.existsSync(config.portalSecretFile)),
      ctiSecretFound: Boolean(config.ctiSecretFile && fs.existsSync(config.ctiSecretFile)),
      googleContactsCacheFound: Boolean(googleContactsFile && fs.existsSync(googleContactsFile)),
    },
    googleContactsFile: googleContactsFile ? path.basename(googleContactsFile) : "",
    phonebookMapping: runtimeSettings.phonebookMapping,
    variables: [
      "PORTAL_BASE_URL",
      "PORTAL_API_KEY_ID",
      "PORTAL_API_KEY_SECRET",
      "PORTAL_CUSTOMER_ACCOUNT",
      "PORTAL_SECRET_FILE",
      "NFON_SECRET_FILE",
      "PORTAL_GOOGLE_CONTACTS_FILE",
      "PORTAL_ENABLE_LIVE_WRITES",
      "PORTAL_DISABLE_LIVE_WRITES",
      "PORTAL_ALLOWED_ORIGIN",
    ],
  };
}

function getStatusPayload() {
  const settings = publicSettingsPayload();
  return {
    appId: "portal",
    ok: settings.configured,
    configured: settings.configured,
    account: settings.account,
    baseUrl: settings.baseUrl,
    secrets: settings.sources,
    settings,
    connection: portalConnection(),
    cache: {
      syncedAt: cache.syncedAt,
      counts: cache.overview?.counts || null,
      errors: cache.errors,
    },
  };
}

function normalizeSyncPhone(value) {
  const raw = String(value || "").trim().replace(/\(0\)/g, "");
  if (!/^(?:\+|00)[\d () .-]+$/.test(raw)) return "";
  const digits = raw.replace(/[^\d]/g, "").replace(/^00/, "");
  return /^[1-9]\d{6,14}$/.test(digits) ? digits : "";
}

function displaySyncPhone(value) {
  const digits = normalizeSyncPhone(value);
  return digits ? "+" + digits : "";
}

function normalizeSyncName(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function firstArrayValue(value) {
  if (!Array.isArray(value)) return value;
  const first = value.find((item) => item !== undefined && item !== null && item !== "");
  if (first && typeof first === "object") return first.value || first.number || first.phoneNumber || "";
  return first || "";
}

function phoneValuesFromItem(item) {
  const values = [];
  for (const key of ["displayNumber", "phoneNumber", "phone", "number", "businessPhone", "mobilePhone", "privatePhone", "telephoneNumber"]) {
    const value = firstArrayValue(item?.[key]);
    if (value) values.push(value);
  }
  if (Array.isArray(item?.phoneNumbers)) {
    for (const phone of item.phoneNumbers) {
      if (typeof phone === "string") values.push(phone);
      else if (phone?.value || phone?.canonical || phone?.canonicalForm) values.push(phone.value || phone.canonical || phone.canonicalForm);
    }
  }
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function currentGoogleContactsFile() {
  return runtimeSettings.googleContactsFile || config.googleContactsFile;
}

async function readGoogleContactsCache() {
  const googleContactsFile = currentGoogleContactsFile();
  if (!googleContactsFile) {
    return {
      ok: false,
      syncedAt: null,
      contacts: [],
      error: "Keine lokale Kontaktquelle gefunden. Bitte Kontakte hochladen oder die Kontaktquelle per Umgebung setzen.",
    };
  }
  try {
    const body = JSON.parse(await fsp.readFile(googleContactsFile, "utf8"));
    return {
      ok: true,
      syncedAt: body.syncedAt || null,
      contacts: Array.isArray(body.contacts) ? body.contacts : [],
      file: googleContactsFile,
      error: "",
    };
  } catch (error) {
    return {
      ok: false,
      syncedAt: null,
      contacts: [],
      error: serverMessage("portal.server.theContactSourceCouldNotBeReadValue", {p0: error.message}),
    };
  }
}

function mappedPhoneValues(contact, mapping) {
  const value = valueByPath(contact, mapping.displayNumber);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === "string") return [item];
      return item;
    }).flat();
  }
  if (value && typeof value === "object") {
    return [
      value.value,
      value.canonical,
      value.canonicalForm,
      value.normalized,
      value.number,
      value.phoneNumber,
    ].filter(Boolean);
  }
  if (value) return [value];
  return phoneValuesFromItem(contact);
}

function compactGoogleContactForSync(contact, index) {
  const mapping = runtimeSettings.phonebookMapping;
  const firstName = normalizeDisplayName(stringFromMappedField(contact, mapping.firstName, ["firstName", "givenName"]));
  const lastName = normalizeDisplayName(stringFromMappedField(contact, mapping.lastName, ["lastName", "familyName", "surname", "name"]));
  const fallbackName = contact.name || [contact.givenName || contact.firstName, contact.familyName || contact.lastName].filter(Boolean).join(" ");
  const mappedDisplayName = normalizeDisplayName(stringFromMappedField(contact, mapping.displayName, ["displayName", "name", "fullName"]));
  const alreadyIncludesFirstName = firstName && mappedDisplayName.toLocaleLowerCase().split(/[\s,;-]+/).includes(firstName.toLocaleLowerCase());
  const displayName = normalizeDisplayName(
    (mappedDisplayName && (mapping.displayName !== mapping.lastName || !firstName || alreadyIncludesFirstName) ? mappedDisplayName : "")
      || (firstName && lastName && firstName !== lastName && !alreadyIncludesFirstName ? [firstName, lastName].join(" ") : "")
      || stringFromMappedField(contact, mapping.displayName, ["displayName", "name", "fullName"])
      || [firstName, lastName].filter(Boolean).join(" ")
      || fallbackName
      || "Kontakt",
  );
  const phones = mappedPhoneValues(contact, mapping)
    .map((phone) => ({
      value: typeof phone === "object"
        ? phone.value || phone.canonical || phone.canonicalForm || phone.number || phone.phoneNumber || ""
        : phone,
      normalized: normalizeSyncPhone(typeof phone === "object"
        ? phone.value || phone.canonical || phone.canonicalForm || phone.number || phone.phoneNumber || phone.normalized
        : phone),
    }))
    .filter((phone) => phone.value && phone.normalized);
  return {
    id: contact.id || `contact-${index + 1}`,
    name: displayName,
    firstName,
    lastName,
    phones,
  };
}

function phonebookEntryEndpoint(book, entry) {
  const explicit = apiPathFromHref(entry?.href || "");
  if (explicit) return explicit;
  const bookHref = apiPathFromHref(book?.href || "");
  const entryId = lastPathSegment(entry?.href || entry?.id || entry?.value || entry?.number || "");
  if (bookHref && entryId) return `${bookHref.replace(/\/+$/, "")}/entries/${encodeURIComponent(entryId)}`;
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  return `/api/customers/${customer}/phone-books${entryId ? `/${encodeURIComponent(entryId)}` : ""}`;
}

function phonebookEntryCreateEndpoint(book) {
  const bookHref = apiPathFromHref(book?.href || "");
  if (bookHref) return bookHref.replace(/\/+$/, "");
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  return `/api/customers/${customer}/phone-books`;
}

function compactPhonebookEntry(item, book, index) {
  const firstName = pickField(item, ["firstName", "givenName"], "");
  const lastName = pickField(item, ["lastName", "familyName", "surname"], "");
  const displayName = pickField(item, ["displayName", "name", "fullName", "description"], [firstName, lastName].filter(Boolean).join(" "));
  const phones = phoneValuesFromItem(item)
    .map((phone) => ({ value: phone, normalized: normalizeSyncPhone(phone) }))
    .filter((phone) => phone.normalized);
  return {
    id: pickField(item, ["id", "number", "name", "href"], `phonebook-entry-${index + 1}`),
    name: normalizeDisplayName(displayName || "Telefonbuch-Eintrag"),
    organization: pickField(item, ["company", "companyName", "organization", "organisation"], ""),
    email: pickField(item, ["email", "mail", "emailAddress"], ""),
    phones,
    href: item.href || "",
    bookId: book?.id || book?.value || book?.name || "",
    bookName: book?.name || book?.value || "Telefonbuch",
    endpoint: phonebookEntryEndpoint(book, item),
  };
}

function phonebookEntryReadPaths(book) {
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const bookHref = apiPathFromHref(book?.href || "");
  return [
    bookHref || "",
    `/api/customers/${customer}/phone-books`,
  ].filter(Boolean);
}

async function loadPhonebookEntries(overview) {
  const entries = overview?.inventory?.phoneBooks || [];
  const virtualBook = { id: "portal-phone-books", name: "Portal Phonebook" };
  if (overview?.demo) {
    return {
      books: [virtualBook],
      entries: [
        compactPhonebookEntry({ id: "demo-1", displayName: "Max Mustermann", displayNumber: "+49 89 12345-201" }, virtualBook, 0),
      ],
      results: [{ book: virtualBook.name, ok: true, count: 1, path: "demo" }],
    };
  }
  return {
    books: [virtualBook],
    entries,
    results: [{
      book: virtualBook.name,
      ok: true,
      count: entries.length,
      path: `/api/customers/${encodeURIComponent(config.customerAccount || "{customer}")}/phone-books`,
    }],
  };
}

function buildPhonebookEntryBody(contact, phone) {
  const displayNumber = displaySyncPhone(phone.value || phone.normalized);
  return {
    data: [
      { name: "displayName", value: contact.name },
      { name: "displayNumber", value: displayNumber },
    ].filter((field) => field.value !== undefined && field.value !== null && field.value !== ""),
  };
}

async function buildPhonebookSyncPreview() {
  const [overview, google] = await Promise.all([
    cache.overview || loadOverview(),
    readGoogleContactsCache(),
  ]);
  if (!overview.demo) requireCompleteInventory(overview, ["phoneBooks"]);
  const portal = await loadPhonebookEntries(overview);
  const syncBook = portal.books[0] || null;
  const portalByPhone = new Map();
  for (const entry of portal.entries) {
    for (const phone of entry.phones || []) {
      if (!portalByPhone.has(phone.normalized)) portalByPhone.set(phone.normalized, entry);
    }
  }

  const googleContacts = google.contacts.map(compactGoogleContactForSync);
  const seenGooglePhones = new Set();
  const actions = [];
  const unchanged = [];
  const skipped = [];
  const googlePreview = [];
  for (const contact of googleContacts) {
    if (!contact.phones.length) {
      skipped.push({ reason: "invalid-phone", contact: contact.name, phone: "" });
      googlePreview.push({ contact: contact.name, phone: "", status: "skipped", reason: serverMessage("portal.invalidContactPhone") });
      continue;
    }
    for (const phone of contact.phones) {
      if (seenGooglePhones.has(phone.normalized)) {
        skipped.push({ reason: "duplicate-google-phone", contact: contact.name, phone: phone.value });
        googlePreview.push({
          contact: contact.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          status: "skipped",
          reason: "Doppelte Telefonnummer in der Kontaktquelle",
        });
        continue;
      }
      seenGooglePhones.add(phone.normalized);
      const existing = portalByPhone.get(phone.normalized);
      if (!existing) {
        googlePreview.push({
          contact: contact.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          status: "create",
          reason: "Fehlt in NFON",
        });
        actions.push({
          action: "create",
          method: "POST",
          endpoint: phonebookEntryCreateEndpoint(syncBook),
          contact: contact.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          body: buildPhonebookEntryBody(contact, phone),
        });
        continue;
      }
      if (normalizeSyncName(existing.name) !== normalizeSyncName(contact.name)) {
        googlePreview.push({
          contact: contact.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          status: "update",
          reason: serverMessage("portal.server.nameInNfonValue", {p0: existing.name}),
        });
        actions.push({
          action: "update",
          method: "PUT",
          endpoint: existing.endpoint,
          contact: contact.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          before: existing.name,
          body: buildPhonebookEntryBody(contact, phone),
        });
      } else {
        googlePreview.push({
          contact: contact.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          status: "unchanged",
          reason: "Bereits synchron",
        });
        unchanged.push({ contact: contact.name, phone: phone.value, book: existing.bookName });
      }
    }
  }
  const nfonPreview = [];
  for (const entry of portal.entries) {
    if (entry.phones?.length) {
      for (const phone of entry.phones) {
        nfonPreview.push({
          contact: entry.name,
          phone: displaySyncPhone(phone.value || phone.normalized),
          book: entry.bookName || "Portal Phonebook",
          status: portalByPhone.has(phone.normalized) ? "present" : "unmapped",
        });
      }
    } else {
      nfonPreview.push({
        contact: entry.name,
        phone: "",
        book: entry.bookName || "Portal Phonebook",
        status: "no-phone",
      });
    }
  }

  const summary = {
    create: actions.filter((action) => action.action === "create").length,
    update: actions.filter((action) => action.action === "update").length,
    unchanged: unchanged.length,
    skipped: skipped.length,
    delete: 0,
    createPhoneBook: 0,
  };
  const changeCount = summary.create + summary.update;

  return {
    ok: google.ok,
    blocked: false,
    dryRun: true,
    type: "phonebook-sync",
    title: !google.ok
      ? "Telefonbuch-Sync fehlgeschlagen"
      : changeCount > 0
        ? "Änderungen gefunden"
        : "Alles synchron",
    message: !google.ok
      ? google.error
      : changeCount > 0
        ? serverMessage("portal.server.valueChangesFoundNothingHasBeenSavedYet", {p0: changeCount, p1: changeCount === 1 ? "" : "en"})
        : serverMessage("portal.valueEntriesAreAlreadyInSyncThereAreNo", {p0: unchanged.length}),
    source: {
      googleCacheFound: Boolean(config.googleContactsFile),
      googleSyncedAt: google.syncedAt,
      googleContacts: googleContacts.length,
      googlePhones: seenGooglePhones.size,
      file: google.file ? path.relative(ROOT, google.file) : "",
    },
    target: {
      phoneBooks: portal.books.length,
      phoneBook: syncBook?.name || syncBook?.id || "Portal Phonebook",
      portalEntries: portal.entries.length,
      reads: portal.results,
    },
    summary,
    actions: actions.slice(0, 250),
    preview: {
      google: googlePreview.slice(0, 500),
      nfon: nfonPreview.slice(0, 500),
      mapping: runtimeSettings.phonebookMapping,
    },
    unchanged: unchanged.slice(0, 50),
    skipped: skipped.slice(0, 50),
    followUp: [
      "Pruefen zeigt nur Differenzen und schreibt nichts.",
      "Uebernehmen sendet nur create/update-Aktionen und keine Deletes.",
      "Der globale Live-Schalter wird separat in Settings gesteuert.",
    ],
    createdAt: new Date().toISOString(),
  };
}

async function applyPhonebookSync() {
  assertLiveWritesEnabled();
  await loadOverview();
  const plan = await buildPhonebookSyncPreview();
  if (!plan.ok) {
    return {
      ...plan,
      dryRun: false,
      applied: false,
      ok: false,
      status: 400,
      message: plan.message || "Telefonbuch-Sync kann nicht ausgefuehrt werden.",
    };
  }

  const allowedActions = (plan.actions || []).filter((action) => (
    ["create", "update"].includes(action.action)
    && ["POST", "PUT"].includes(String(action.method || "").toUpperCase())
    && action.endpoint
    && action.body
  ));
  const results = [];

  for (const action of allowedActions) {
    try {
      const result = await portalFetch(action.endpoint, {
        method: action.method,
        body: action.body,
      });
      results.push({
        ok: true,
        action: action.action,
        method: action.method,
        endpoint: action.endpoint,
        contact: action.contact || "",
        phone: action.phone || "",
        status: result.status,
        location: result.location,
      });
    } catch (error) {
      results.push({
        ok: false,
        action: action.action,
        method: action.method,
        endpoint: action.endpoint,
        contact: action.contact || "",
        phone: action.phone || "",
        status: error.status || 0,
        error: portalErrorMessage(error),
      });
    }
  }

  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  const failed = results.filter((result) => !result.ok);
  const noActions = allowedActions.length === 0;
  return {
    ...plan,
    ok: failed.length === 0,
    status: failed.length === 0 ? 200 : 502,
    dryRun: false,
    applied: failed.length === 0,
    title: failed.length === 0
      ? noActions
        ? "Alles synchron"
        : "Änderungen übernommen"
      : "Telefonbuch-Sync teilweise fehlgeschlagen",
    message: failed.length === 0
      ? noActions
        ? serverMessage("portal.server.valueEntriesAreAlreadyInSyncNothingWasSaved", {p0: plan.summary?.unchanged || 0})
        : serverMessage("portal.server.valuePhonebookActionsWereSentToThePortalApi", {p0: results.length, p1: results.length === 1 ? "" : "en"})
      : serverMessage("portal.server.valueOfValuePhonebookActionsFailed", {p0: failed.length, p1: results.length}),
    results,
    appliedAt: new Date().toISOString(),
  };
}

function sanitizePhonebookMapping(mapping = {}) {
  const current = runtimeSettings.phonebookMapping;
  const next = {
    firstName: String(mapping.firstName || current.firstName || "firstName").trim() || "firstName",
    lastName: String(mapping.lastName || current.lastName || "name").trim() || "name",
    displayName: String(mapping.displayName || current.displayName || "name").trim() || "name",
    displayNumber: String(mapping.displayNumber || current.displayNumber || "phones").trim() || "phones",
  };
  for (const value of Object.values(next)) {
    if (value.length > 80 || !/^[A-Za-z0-9_.-]+$/.test(value)) {
      const error = new Error("Mapping darf nur Feldnamen mit Buchstaben, Zahlen, Punkt, Unterstrich und Bindestrich enthalten.");
      error.status = 400;
      throw error;
    }
  }
  return next;
}

async function saveUploadedGoogleContacts(body = {}) {
  const contacts = Array.isArray(body.contacts)
    ? body.contacts
    : Array.isArray(body)
      ? body
      : [];
  if (!contacts.length) {
    const error = new Error("Upload enthaelt keine Kontakte.");
    error.status = 400;
    throw error;
  }
  if (contacts.some(contact => !contact || typeof contact !== "object" || Array.isArray(contact))) throw httpError(400, "Each contact must be an object.");
  if (contacts.length > 5000) {
    const error = new Error("Upload ist zu gross. Maximal 5000 Kontakte pro Datei.");
    error.status = 413;
    throw error;
  }
  if (!contacts.some((contact, index) => compactGoogleContactForSync(contact, index).phones.length)) throw httpError(400, "No contacts contain an explicit international phone number.");
  const payload = {
    syncedAt: body.syncedAt || new Date().toISOString(),
    source: body.source || "portal-upload",
    contacts,
  };
  const file = path.join(DATA_DIR, "google-contacts-upload.json");
  await writePrivateJson(file, payload);
  runtimeSettings.googleContactsFile = file;
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  return {
    ok: true,
    contacts: contacts.length,
    file: path.basename(file),
    syncedAt: payload.syncedAt,
    settings: publicSettingsPayload(),
  };
}

const RESOURCE_COLLECTIONS = {
  queues: "queue-services",
  skills: "skill-services",
  ivrs: "ivr-services",
  timeControls: "time-control-services",
};

function resourceRouteNumber(item) {
  return String(item?.serviceNumber || item?.id || item?.extensionNumber || item?.value || "").trim();
}

function nextResourceNumber(overview, kind) {
  const used = new Set((overview.inventory?.[kind] || [])
    .map((item) => Number(item.serviceNumber || item.id))
    .filter((value) => Number.isFinite(value) && value >= 0));
  let next = 0;
  while (used.has(next)) next += 1;
  return String(next);
}

function linkForTargetPayload(target) {
  if (!target) return "";
  if (typeof target !== "object" || Array.isArray(target)
      || ["type", "href"].some(key => target[key] != null && typeof target[key] !== "string")
      || ["routeNumber", "serviceNumber", "number", "targetNumber"].some(key => target[key] != null && !["string", "number"].includes(typeof target[key]))) throw httpError(400, serverMessage("portal.error.invalidJson"));
  if (target.href) return assertCustomerPath(target.href);
  const explicitHref = "";
  const type = normalizeDestinationType(target.type);
  const route = target.routeNumber || target.serviceNumber || target.number || target.targetNumber || "";
  return targetHrefForRoute(type, route);
}

async function deletePortalResource(kind, id) {
  assertLiveWritesEnabled();
  const collection = RESOURCE_COLLECTIONS[kind];
  if (!collection) {
    const error = new Error("Unbekannter Ressourcentyp.");
    error.status = 400;
    throw error;
  }

  const overview = await loadOverview();
  requireCompleteInventory(overview);
  const item = (overview.inventory?.[kind] || []).find((entry) => resourceRouteNumber(entry) === String(id));
  if (!item) {
    const error = new Error("Ressource nicht gefunden.");
    error.status = 404;
    throw error;
  }

  const customer = encodeURIComponent(config.customerAccount || "");
  const endpoint = item.href || `/api/customers/${customer}/targets/${collection}/${encodeURIComponent(resourceRouteNumber(item))}`;
  const type = { queues: "QUEUE", skills: "SKILL", ivrs: "IVR", timeControls: "TIMECONTROL" }[kind];
  await loadDeletionReferences(overview.inventory);
  const referenced = (overview.inventory.dids || []).some(did => normalizeDestinationType(did.destinationType) === type && String(didDestinationRoute(did)) === String(resourceRouteNumber(item)))
    || [...(overview.inventory.ivrs || []), ...(overview.inventory.timeControls || []), ...(overview.inventory.queues || []), ...(overview.inventory.skills || []), ...(overview.inventory.groups || [])].some(other => !sameApiHref(other.href, endpoint) && containsTargetReference(other, endpoint));
  if (referenced) throw httpError(409, "Resource remains referenced; deletion blocked.");
  const result = await portalFetch(endpoint, { method: "DELETE" });
  if (kind === "timeControls") await forgetManagedTimeControl(endpoint);
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  cache.errors = {};
  return {
    ok: true,
    deleted: true,
    kind,
    id,
    endpoint,
    status: result.status,
  };
}

async function createPortalResource(kind, payload = {}) {
  if (["serviceNumber", "extensionNumber", "keyNumber"].some(key => payload[key] != null && (!["string", "number"].includes(typeof payload[key]) || (String(payload[key]) !== "" && !/^\d+$/.test(String(payload[key])))))) throw httpError(400, serverMessage("portal.error.invalidJson"));
  assertLiveWritesEnabled();
  const collection = RESOURCE_COLLECTIONS[kind];
  if (!collection) {
    const error = new Error("Unbekannter Ressourcentyp.");
    error.status = 400;
    throw error;
  }

  const overview = cache.overview || await loadOverview();
  const customer = encodeURIComponent(config.customerAccount || "");
  const displayName = validatePortalDisplayName(payload.displayName, "Name");
  const serviceNumber = String(kind === "queues" || kind === "skills"
    ? payload.serviceNumber ?? ""
    : payload.serviceNumber || nextResourceNumber(overview, kind)).trim();
  const preferredExtension = kind === "ivrs" ? 7100 : kind === "timeControls" ? 7200 : 10;
  const extensionNumber = String(payload.extensionNumber || (kind === "queues" || kind === "skills" ? "" : nextServiceExtension(overview, new Set(), preferredExtension))).trim();
  const endpoint = `/api/customers/${customer}/targets/${collection}`;
  let body;

  if (kind === "queues" || kind === "skills") {
    body = {
      data: [
        { name: "displayName", value: displayName },
        { name: "name", value: displayName },
        { name: "serviceNumber", value: serviceNumber === "" ? "" : nfonInteger(serviceNumber) },
        { name: "extensionNumber", value: extensionNumber },
      ].filter((field) => field.value !== ""),
    };
  } else if (kind === "ivrs") {
    const announcementHref = existingAnnouncementHref(payload.announcementName, overview);
    if (!announcementHref) {
      const error = new Error("Bitte eine vorhandene Ansage auswählen.");
      error.status = 400;
      throw error;
    }
    body = {
      links: [{ rel: "announcement", href: announcementHref }],
      data: [
        { name: "displayName", value: displayName },
        { name: "extensionNumber", value: extensionNumber },
        { name: "interpretUnknownAsExtension", value: true },
        { name: "maxNumberOfDigits", value: String(payload.keyNumber || "1").length || 1 },
      ],
    };
  } else if (kind === "timeControls") {
    const openHref = linkForTargetPayload(payload.openTarget);
    const closedHref = linkForTargetPayload(payload.closedTarget);
    if (!openHref || !closedHref) {
      const error = new Error("Zeitsteuerungen brauchen ein Ziel innerhalb und außerhalb der Zeit.");
      error.status = 400;
      throw error;
    }
    body = {
      links: [
        { rel: "destinationIfAllowed", href: openHref },
        { rel: "destinationIfDenied", href: closedHref },
        { rel: "timezone", href: timeZoneHref() },
      ],
      data: [
        { name: "name", value: displayName },
        { name: "displayName", value: displayName },
        { name: "serviceNumber", value: nfonInteger(serviceNumber) },
        { name: "serviceCode", value: `*740${String(serviceNumber).padStart(3, "0")}` },
        { name: "extensionNumber", value: extensionNumber },
        { name: "evaluationStrategy", value: "AUTO" },
        { name: "fromDay", value: nfonDay(payload.fromDay || "MONDAY") },
        { name: "fromTimeOfDay", value: nfonTime(payload.fromTime || "08:00") },
        { name: "toDay", value: nfonDay(payload.toDay || "FRIDAY") },
        { name: "toTimeOfDay", value: nfonTime(payload.toTime || "17:00") },
      ],
    };
  }

  // Validate every dependent target before creating the resource.
  if (kind === "ivrs") { linkForTargetPayload(payload.keyTarget); linkForTargetPayload(payload.timeoutTarget); }
  const result = await portalFetch(endpoint, { method: "POST", body });
  const created = createdTargetFromResult(kind === "ivrs" ? "IVR" : kind === "timeControls" ? "TIMECONTROL" : kind === "skills" ? "SKILL" : "QUEUE", result, serviceNumber);

  try {
  if (kind === "ivrs" && created.href) {
    const keyTargetHref = linkForTargetPayload(payload.keyTarget);
    if (payload.keyNumber && keyTargetHref) {
      await portalFetch(`${created.href}/key-assignments`, {
        method: "POST",
        body: {
          data: [{ name: "number", value: String(payload.keyNumber) }],
          links: [{ rel: "target", href: keyTargetHref }],
        },
      });
    }
    const timeoutHref = linkForTargetPayload(payload.timeoutTarget);
    if (timeoutHref) {
      await portalFetch(`${created.href}/timeout`, {
        method: "PUT",
        body: {
          links: [{ rel: "destinationOnTimeout", href: timeoutHref }],
          data: [{ name: "timeoutDelay", value: Number(payload.timeoutDelay) || 1 }],
        },
      });
    }
  }

  } catch (error) {
    const actualHref = result.location || result.body?.href || extractItems(result.body)[0]?.href;
    const attempts = [];
    if (actualHref) await runRollbackOperations([{action:"delete-incomplete-resource",method:"DELETE",endpoint:assertCustomerPath(apiPathFromHref(actualHref).replace(/\/+$/, ""))}], attempts);
    cache.overview = null; cache.callflow = null;
    return {ok:false,status:502,created:false,error:portalErrorMessage(error),attempts,rolledBack:Boolean(actualHref) && !attempts.some(item=>item.action==="rollback-failed")};
  }
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  cache.errors = {};
  return {
    ok: true,
    created: true,
    kind,
    endpoint,
    status: result.status,
    resource: created,
  };
}

function announcementTargetPlan(payload = {}) {
  const overview = cache.overview || null;
  const customer = encodeURIComponent(config.customerAccount || "");
  const announcementName = String(payload.announcementName || "").trim();
  const announcementHref = existingAnnouncementHref(announcementName, overview);
  const afterTarget = payload.afterTarget || { type: "HANGUP", title: "Auflegen", routeNumber: "HANGUP", number: "HANGUP" };
  const afterHref = linkForTargetPayload(afterTarget);
  const displayName = validatePortalDisplayName(payload.displayName || serverMessage("portal.nightAnnouncementValue", {p0: announcementName || "Ansage"}), "Ansage-Ziel");
  const serviceNumber = nextResourceNumber(overview, "ivrs");
  const extensionNumber = nextServiceExtension(overview, new Set(), 7110);
  const endpoint = `/api/customers/${customer}/targets/ivr-services`;
  const blockers = [];
  if (!announcementName || !announcementHref) blockers.push("Bitte eine vorhandene Ansage auswählen.");
  if (!afterHref) blockers.push("Bitte ein Ziel nach der Ansage auswählen.");
  return {
    ok: blockers.length === 0,
    readOnly: true,
    type: "daynight-announcement-target",
    title: blockers.length ? "Ansage-Ziel unvollständig" : "Ansage-Ziel bereit",
    message: blockers.length
      ? blockers.join(" ")
      : serverMessage("portal.server.voiceDialogValueWouldPlayTheAnnouncementAndThen", {p0: displayName, p1: afterTarget.title || targetTypeLabel(afterTarget.type)}),
    displayName,
    announcementName,
    announcementHref,
    afterTarget,
    afterHref,
    target: {
      type: "IVR",
      title: displayName,
      subtitle: serverMessage("portal.voiceDialogValue", {p0: extensionNumber}),
      targetNumber: extensionNumber,
      routeNumber: serviceNumber,
      href: `${endpoint}/${encodeURIComponent(serviceNumber)}`,
    },
    operations: [
      {
        action: "create-announcement-ivr",
        method: "POST",
        endpoint,
        body: {
          links: [{ rel: "announcement", href: announcementHref || "{announcement}" }],
          data: [
            { name: "displayName", value: displayName },
            { name: "extensionNumber", value: extensionNumber },
            { name: "interpretUnknownAsExtension", value: true },
            { name: "maxNumberOfDigits", value: 1 },
          ],
        },
      },
      {
        action: "set-announcement-timeout",
        method: "PUT",
        endpoint: `${endpoint}/${encodeURIComponent(serviceNumber)}/timeout`,
        body: {
          links: [{ rel: "destinationOnTimeout", href: afterHref || "{after-target}" }],
          data: [{ name: "timeoutDelay", value: Number(payload.timeoutDelay) || 1 }],
        },
      },
    ],
    blockers,
    createdAt: new Date().toISOString(),
  };
}

async function planAnnouncementTarget(payload = {}) {
  if (!cache.overview) await loadOverview();
  return announcementTargetPlan(payload);
}

async function applyAnnouncementTarget(payload = {}) {
  assertLiveWritesEnabled();
  if (!cache.overview) await loadOverview();
  const plan = announcementTargetPlan(payload);
  if (!plan.ok) return { ...plan, dryRun: false, applied: false, status: 400 };
  const created = await createPortalResource("ivrs", {
    displayName: plan.displayName,
    serviceNumber: plan.target.routeNumber,
    extensionNumber: plan.target.targetNumber,
    announcementName: plan.announcementName,
    timeoutTarget: plan.afterTarget,
    timeoutDelay: Number(payload.timeoutDelay) || 1,
  });
  if (!created.ok) return {...created,applied:false};
  const target = {
    ...plan.target,
    href: created.resource?.href || plan.target.href,
    routeNumber: created.resource?.routeNumber || plan.target.routeNumber,
    targetNumber: created.resource?.extensionNumber || plan.target.targetNumber,
  };
  return {
    ...plan,
    ok: true,
    dryRun: false,
    applied: true,
    status: 200,
    title: "Ansage-Ziel angelegt",
    message: serverMessage("portal.server.voiceDialogValueWasCreatedAndCanBeUsed", {p0: plan.displayName}),
    target,
    option: {
      label: serverMessage("portal.server.valueVoiceDialogValue", {p0: target.targetNumber || target.routeNumber, p1: target.title}),
      value: JSON.stringify({ ...target, tone: "coral" }),
    },
    result: created,
    appliedAt: new Date().toISOString(),
  };
}

function actionPlan(type, payload) {
  const source = payload.source || {};
  const extensionNumber = payload.extensionNumber || payload.newNumber || "";
  const displayName = payload.displayName || payload.name || "";
  const base = `/api/customers/${encodeURIComponent(config.customerAccount || "{customer}")}/targets/phone-extensions`;
  const body = {
    extensionNumber,
    displayName,
    email: payload.email || source.email || "",
    templateSource: source.number || source.id || "",
  };

  return {
    ok: true,
    dryRun: true,
    type,
    title: type === "clone-extension" ? "Kopie vorbereitet" : "Neue Nebenstelle vorbereitet",
    message: "Geprüft. Es wurde nichts im Portal gespeichert.",
    endpoint: base,
    method: "POST",
    body,
    followUp: [
      "Optionale Gerätezuordnung prüfen",
      "Outbound-/Inbound-Rufnummern übernehmen",
      "Funktionskeys und Voicemail-Regeln kontrollieren",
    ],
    createdAt: new Date().toISOString(),
  };
}

function extensionBatchEndpoint() {
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  return `/api/customers/${customer}/targets/phone-extensions`;
}

function extensionVoiceMailEndpoint(extensionNumber) {
  return `${extensionBatchEndpoint()}/${encodeURIComponent(extensionNumber)}/voice-mail`;
}

const EXTENSION_BATCH_FIELD_DEFS = [
  { key: "accessCentralPhoneBook", label: "Zentrales Telefonbuch", type: "boolean", target: "extension", defaultValue: true },
  { key: "phoneBookHide", label: "Im Telefonbuch ausblenden", type: "boolean", target: "extension", defaultValue: false },
  { key: "language", label: "Sprache", type: "string", target: "extension", defaultValue: "de" },
  { key: "costCenter", label: "Kostenstelle", type: "string", target: "extension", defaultValue: "" },
  { key: "callWaitingIndication", label: "Anklopfen", type: "boolean", target: "extension", defaultValue: true },
  { key: "intercomEnabled", label: "Intercom", type: "boolean", target: "extension", defaultValue: false },
  { key: "clirEnabled", label: "Rufnummernanzeige", type: "string", target: "extension", defaultValue: "SHOW_BASE_NUMBER" },
  { key: "recordingMode", label: "Aufzeichnungsmodus", type: "string", target: "extension", defaultValue: "NEVER" },
  { key: "ctiInfo", label: "CTI Info", type: "string", target: "extension", defaultValue: "NONE" },
  { key: "clickToDialState", label: "Click-to-Dial", type: "string", target: "extension", defaultValue: "DEFAULT" },
  { key: "autodialTimeout", label: "Autodial Timeout", type: "number", target: "extension", defaultValue: 0 },
  { key: "numberguessingLength", label: "Nummernlaenge", type: "number", target: "extension", defaultValue: 0 },
  { key: "ncontrolEnabled", label: "Ncontrol", type: "boolean", target: "extension", defaultValue: false },
  { key: "ccbs", label: "Rueckruf bei besetzt", type: "boolean", target: "extension", defaultValue: true },
  { key: "replicateAgent", label: "Agent replizieren", type: "boolean", target: "extension", defaultValue: false },
  { key: "timeoutAfterSipTransfer", label: "Timeout nach SIP Transfer", type: "number", target: "extension", defaultValue: 0 },
  { key: "abandonOtherSoftphones", label: "Andere Softphones abmelden", type: "boolean", target: "extension", defaultValue: false },
  { key: "mediaGatewayEmergencyDialplanPriority", label: "Notruf-Dialplan", type: "string", target: "extension", defaultValue: "OFF" },
  { key: "dialPrefix", label: "Wahlpraefix", type: "string", target: "extension", defaultValue: "" },
  { key: "nMeeting", label: "Nmeeting", type: "boolean", target: "extension", defaultValue: false },
  { key: "useTps", label: "TPS nutzen", type: "boolean", target: "extension", defaultValue: false },
  { key: "nhospitalityRoom", label: "Hospitality Room", type: "boolean", target: "extension", defaultValue: false },
  { key: "authorizeExternalByPin", label: "Extern per PIN autorisieren", type: "boolean", target: "extension", defaultValue: false },
  { key: "isCoach", label: "Coach", type: "boolean", target: "extension", defaultValue: false },
  { key: "isCoachee", label: "Coachee", type: "boolean", target: "extension", defaultValue: false },
  { key: "deskphoneCallTranscriptionNotificationEnabled", label: "Deskphone Transkript-Hinweis", type: "boolean", target: "extension", defaultValue: true },
  { key: "voicemailEmail", label: "Voicemail E-Mail", type: "string", target: "voiceMail", defaultValue: "" },
  { key: "announceCID", label: "Mailbox: Rufnummer ansagen", type: "boolean", target: "voiceMail", defaultValue: true },
  { key: "announceDateTime", label: "Mailbox: Datum/Zeit ansagen", type: "boolean", target: "voiceMail", defaultValue: true },
  { key: "sendEmail", label: "Mailbox per E-Mail senden", type: "boolean", target: "voiceMail", defaultValue: false },
  { key: "deleteAfterSending", label: "Mailbox nach Versand loeschen", type: "boolean", target: "voiceMail", defaultValue: false },
];

const EXTENSION_BATCH_FIELD_MAP = new Map(EXTENSION_BATCH_FIELD_DEFS.map((field) => [field.key, field]));

function coerceExtensionBatchField(value, field) {
  if (field.type === "boolean") return value === true || value === "true" || value === "1" || value === 1 || value === "yes" || value === "ja";
  if (field.type === "number") {
    if (value === "" || value === undefined || value === null) return field.defaultValue || 0;
    return Number(value);
  }
  return String(value ?? "").trim();
}

function extensionBatchDataEntries(row, target) {
  return EXTENSION_BATCH_FIELD_DEFS
    .filter((field) => field.target === target && hasOwn(row, field.key))
    .map((field) => ({ name: field.key, value: row[field.key] }));
}

function buildExtensionBody(row) {
  const fields = [
    ["extensionNumber", row.extensionNumber],
    ["displayName", row.displayName],
  ];
  return {
    data: [
      ...fields.map(([name, value]) => ({ name, value })),
      ...extensionBatchDataEntries(row, "extension"),
    ],
  };
}

function buildExtensionVoiceMailBody(row) {
  const entries = [
    { name: "password", value: row.mailboxPin },
    ...extensionBatchDataEntries(row, "voiceMail"),
  ];
  if (row.voicemailEmail && !hasOwn(row, "sendEmail")) entries.push({ name: "sendEmail", value: true });
  return {
    data: entries,
  };
}

function normalizeExtensionBatchRows(rows = []) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row !== "object" || Array.isArray(row))) throw httpError(400, serverMessage("portal.error.invalidJson"));
  return rows.map((row, index) => {
    const normalized = {
      index,
      extensionNumber: String(row.extensionNumber || row.number || "").trim(),
      displayName: normalizeDisplayName(row.displayName || row.name || ""),
      mailboxPin: String(row.mailboxPin || row.pin || "").trim(),
    };
    for (const field of EXTENSION_BATCH_FIELD_DEFS) {
      if (hasOwn(row, field.key)) normalized[field.key] = coerceExtensionBatchField(row[field.key], field);
      else if (field.key === "voicemailEmail" && hasOwn(row, "email")) normalized.voicemailEmail = String(row.email || "").trim();
    }
    return normalized;
  });
}

function buildExtensionBatchPlan(payload = {}) {
  const overview = cache.overview || null;
  const existing = new Set((overview?.inventory?.extensions || []).map((extension) => String(extension.number || extension.id || "")));
  const rows = normalizeExtensionBatchRows(payload.rows ?? []);
  const seen = new Set();
  const entries = rows.map((row) => {
    const errors = [];
    if (!row.extensionNumber) errors.push("Nummer fehlt");
    if (!/^[1-9]\d{1,7}$/.test(row.extensionNumber)) errors.push("Nummer muss 2 bis 8 Ziffern enthalten");
    if (!row.displayName) errors.push("Name fehlt");
    if (!row.mailboxPin) errors.push("Mailbox-PIN fehlt");
    if (row.mailboxPin && !/^\d{4,12}$/.test(row.mailboxPin)) errors.push("Mailbox-PIN muss 4 bis 12 Ziffern enthalten");
    for (const field of EXTENSION_BATCH_FIELD_DEFS.filter((definition) => definition.type === "number")) {
      if (hasOwn(row, field.key) && !Number.isFinite(row[field.key])) errors.push(serverMessage("portal.server.valueMustBeANumber", {p0: field.label}));
    }
    if (existing.has(row.extensionNumber)) errors.push("Nebenstelle existiert bereits");
    if (seen.has(row.extensionNumber)) errors.push("Nummer ist doppelt in der Liste");
    seen.add(row.extensionNumber);
    const ok = errors.length === 0;
    return {
      ...row,
      ok,
      errors,
      endpoint: extensionBatchEndpoint(),
      voiceMailEndpoint: row.extensionNumber ? extensionVoiceMailEndpoint(row.extensionNumber) : "",
      body: ok ? buildExtensionBody(row) : null,
      voiceMailBody: ok ? buildExtensionVoiceMailBody(row) : null,
    };
  });
  const valid = entries.filter((entry) => entry.ok);
  const invalid = entries.filter((entry) => !entry.ok);
  return {
    ok: invalid.length === 0 && valid.length > 0,
    blocked: invalid.length > 0 || valid.length === 0,
    dryRun: true,
    type: "extension-batch",
    title: invalid.length
      ? "Batch Import unvollständig"
      : valid.length
        ? "Batch Import geprüft"
        : "Keine Nebenstellen in der Liste",
    message: invalid.length
      ? serverMessage("portal.server.valueOfValueRowsNeedCorrection", {p0: invalid.length, p1: entries.length, p2: entries.length === 1 ? "" : "n"})
      : valid.length
        ? serverMessage("portal.server.valueExtensionsCanBeCreated", {p0: valid.length, p1: valid.length === 1 ? "" : "n"})
        : "Bitte mindestens eine Nebenstelle erfassen.",
    summary: {
      total: entries.length,
      valid: valid.length,
      invalid: invalid.length,
      existing: entries.filter((entry) => entry.errors.includes("Nebenstelle existiert bereits")).length,
    },
    entries,
    createdAt: new Date().toISOString(),
  };
}

async function planExtensionBatch(payload = {}) {
  if (!cache.overview) await loadOverview();
  return buildExtensionBatchPlan(payload);
}

async function applyExtensionBatch(payload = {}) {
  assertLiveWritesEnabled();
  if (!cache.overview) await loadOverview();
  requireCompleteInventory(cache.overview);
  const plan = buildExtensionBatchPlan(payload);
  if (!plan.ok) return { ...plan, dryRun: false, applied: false, status: 400 };
  const results = [];
  for (const entry of plan.entries.filter((item) => item.ok)) {
    try {
      const created = await portalFetch(entry.endpoint, { method: "POST", body: entry.body });
      let voiceMail = null;
      try {
        voiceMail = await portalFetch(entry.voiceMailEndpoint, { method: "PUT", body: entry.voiceMailBody });
      } catch (error) {
        results.push({
          ok: false,
          extensionNumber: entry.extensionNumber,
          displayName: entry.displayName,
          stage: "voice-mail",
          status: error.status || 0,
          error: portalErrorMessage(error),
        });
        continue;
      }
      results.push({
        ok: true,
        extensionNumber: entry.extensionNumber,
        displayName: entry.displayName,
        stage: "created",
        status: created.status,
        voiceMailStatus: voiceMail.status,
      });
    } catch (error) {
      results.push({
        ok: false,
        extensionNumber: entry.extensionNumber,
        displayName: entry.displayName,
        stage: "extension",
        status: error.status || 0,
        error: portalErrorMessage(error),
      });
    }
  }
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  const failed = results.filter((result) => !result.ok);
  return {
    ...plan,
    ok: failed.length === 0,
    dryRun: false,
    applied: failed.length === 0,
    status: failed.length === 0 ? 200 : 502,
    title: failed.length === 0 ? "Batch Import übernommen" : "Batch Import teilweise fehlgeschlagen",
    message: failed.length === 0
      ? serverMessage("portal.server.valueExtensionsWereCreated", {p0: results.length, p1: results.length === 1 ? "" : "n"})
      : serverMessage("portal.server.valueOfValueExtensionsCouldNotBeFullyCreated", {p0: failed.length, p1: results.length, p2: results.length === 1 ? "" : "n"}),
    results,
    appliedAt: new Date().toISOString(),
  };
}

function didDestinationRoute(did = {}) {
  const type = normalizeDestinationType(did.destinationType);
  if (["QUEUE", "GROUP", "SKILL", "FRONTDESK", "IVR", "TIMECONTROL", "CONFERENCE", "VOICEMAIL"].includes(type)) {
    return did.destinationServiceNumber || did.destinationExtension || "";
  }
  return did.destinationExtension || did.destinationServiceNumber || "";
}

function nightTargetFromPayload(payload = {}) {
  const target = payload.nightTarget || payload.target || {};
  linkForTargetPayload(target);
  const type = normalizeDestinationType(target.type);
  const explicitHref = apiPathFromHref(target.href || "");
  const routeNumber = target.routeNumber || target.serviceNumber || lastPathSegment(explicitHref) || target.targetNumber || target.number || "";
  const href = explicitHref || targetHrefForRoute(type, routeNumber);
  return {
    type,
    title: target.title || target.name || targetTypeLabel(type),
    routeNumber,
    href,
  };
}

function targetPreviewFromDid(did = {}, inventory = {}) {
  const type = normalizeDestinationType(did.destinationType);
  const routeNumber = didDestinationRoute(did);
  const href = targetHrefForRoute(type, routeNumber);
  if (!type && !routeNumber && !href) {
    return {
      type: "UNASSIGNED",
      label: "kein Ziel",
      routeNumber: "",
      extensionNumber: "",
      href: "",
      isFrontdesk: false,
      isUnassigned: true,
      frontdeskName: "",
      frontdeskHref: "",
    };
  }
  const frontdesk = type === "FRONTDESK"
    ? (inventory.frontdesks || []).find((item) => {
      return String(item.serviceNumber || item.id || item.value || "") === String(routeNumber)
        || String(item.extensionNumber || "") === String(did.destinationExtension || "");
    })
    : null;
  return {
    type,
    label: did.destinationName || did.value || `${targetTypeLabel(type)} ${routeNumber}`.trim(),
    routeNumber,
    extensionNumber: did.destinationExtension || "",
    href,
    isFrontdesk: type === "FRONTDESK",
    isUnassigned: false,
    frontdeskName: frontdesk?.name || "",
    frontdeskHref: frontdesk?.href || "",
  };
}

function unassignedDayTargetPreview() {
  return {
    type: "UNASSIGNED",
    label: "kein Ziel",
    routeNumber: "",
    extensionNumber: "",
    href: "",
    isFrontdesk: false,
    isUnassigned: true,
    frontdeskName: "",
    frontdeskHref: "",
  };
}

function targetPreviewFromHref(href, inventory = {}) {
  const normalizedHref = apiPathFromHref(href || "");
  if (!normalizedHref || normalizedHref.toUpperCase().includes("/TARGETS/HANGUP")) {
    return unassignedDayTargetPreview();
  }
  const target = targetFromHref(normalizedHref, inventory);
  if (!target) {
    return {
      type: "",
      label: "",
      routeNumber: "",
      extensionNumber: "",
      href: normalizedHref,
      isFrontdesk: false,
      isUnassigned: false,
      frontdeskName: "",
      frontdeskHref: "",
    };
  }
  return {
    type: normalizeDestinationType(target.type),
    label: target.title || targetTypeLabel(target.type),
    routeNumber: target.routeNumber || target.targetNumber || lastPathSegment(normalizedHref),
    extensionNumber: target.targetNumber || "",
    href: normalizedHref,
    isFrontdesk: normalizeDestinationType(target.type) === "FRONTDESK",
    isUnassigned: false,
    frontdeskName: normalizeDestinationType(target.type) === "FRONTDESK" ? target.title || "" : "",
    frontdeskHref: normalizeDestinationType(target.type) === "FRONTDESK" ? normalizedHref : "",
  };
}

const DAYNIGHT_TIME_CONTROL_PREFIX = "TN ";

function gatewayNameForDid(did = {}, index = 0) {
  return `${DAYNIGHT_TIME_CONTROL_PREFIX}${String(did.name || did.id || index + 1).replace(/\s+/g, " ").slice(0, 42)}`;
}

function ownedDaynightTimeControl(timeControl) {
  return isManagedDaynightTimeControl(timeControl) && (cache.managedTimeControls || []).some(item => sameApiHref(item.href, timeControl.href) && sameGatewayName(item.name, timeControl.name));
}

function isManagedDaynightTimeControl(timeControl = {}) {
  return /^TN (?:\+|00)[\d ().-]+$/i.test(String(timeControl.name || "").trim());
}

function sameGatewayName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function findExistingDaynightGateway(gatewayName, inventory = {}) {
  return (inventory.timeControls || []).find((item) => sameGatewayName(item.name, gatewayName)) || null;
}

function sameApiHref(left, right) {
  return canonicalResourceHref(left) === canonicalResourceHref(right);
}

function canonicalResourceHref(value) {
  return apiPathFromHref(value).replace(/\/+$/, "");
}

function gatewayHrefFromServiceNumber(serviceNumber) {
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  return `/api/customers/${customer}/targets/time-control-services/${encodeURIComponent(serviceNumber)}`;
}

function daynightSnapshotPayload(plan, result = {}) {
  return {
    schemaVersion: 2,
    routingActive: false,
    type: "daynight-gateway-migration",
    customer: config.customerAccount || "",
    createdAt: new Date().toISOString(),
    planCreatedAt: plan?.createdAt || "",
    nightTarget: plan?.nightTarget || null,
    summary: plan?.summary || null,
    result,
    entries: (plan?.entries || []).map((entry) => ({
      did: entry.did,
      currentTarget: entry.currentTarget,
      gateway: entry.gateway,
      gatewayExists: entry.gatewayExists,
      routeOperations: entry.routeOperations,
      restorePlan: entry.restorePlan,
      behaviorNote: entry.behaviorNote,
    })),
  };
}

async function saveDaynightSnapshot(plan, result = {}) {
  const previous = await readDaynightSnapshot();
  const snapshot = daynightSnapshotPayload(plan, result);
  snapshot.routingActive = result.routingActive ?? previous?.routingActive ?? false;
  if (previous?.routingActive) {
    snapshot.entries = previous.entries;
    snapshot.nightTarget = previous.nightTarget;
    snapshot.createdAt = previous.createdAt;
  }
  const owned = new Map((previous?.ownedTimeControls || []).map(item => [item.href, item]));
  for (const entry of plan?.entries || []) {
    const creation = result.results?.find(item => item.ok && item.action === "create-daynight-gateway" && item.gateway === entry.gateway?.name);
    if (creation?.href) owned.set(creation.href, { href: creation.href, name: entry.gateway.name });
  }
  snapshot.ownedTimeControls = [...owned.values()];
  await writePrivateJson(daynightSnapshotFile(snapshot.customer), snapshot);
  cache.managedTimeControls = snapshot.ownedTimeControls;
  return snapshot;
}

async function forgetManagedTimeControl(href) {
  const snapshot = await readDaynightSnapshot();
  if (!snapshot) return;
  snapshot.ownedTimeControls = (snapshot.ownedTimeControls || []).filter(item => !sameApiHref(item.href, href));
  cache.managedTimeControls = snapshot.ownedTimeControls;
  await writePrivateJson(daynightSnapshotFile(snapshot.customer), snapshot);
}

function daynightSnapshotFile(account = config.customerAccount) {
  return path.join(DATA_DIR, "daynight-" + crypto.createHash("sha256").update(account).digest("hex") + ".json");
}

async function readDaynightSnapshot(account = config.customerAccount) {
  try {
    const snapshot = JSON.parse(await fsp.readFile(daynightSnapshotFile(account), "utf8"));
    return snapshot.customer === account ? snapshot : null;
  } catch (error) {
    if (error.code !== "ENOENT") return null;
    // Read the previous single-account format without migrating on a GET.
    // An explicit mutation writes the account-bound file afterwards.
    try {
      const legacy = JSON.parse(await fsp.readFile(path.join(DATA_DIR, "daynight-snapshot.json"), "utf8"));
      return legacy.customer === account ? legacy : null;
    } catch {
      return null;
    }
  }
}

function buildDaynightGatewayPreview(payload = {}) {
  const overview = cache.overview || null;
  if (config.configured) requireCompleteInventory(overview);
  const inventory = overview?.inventory || {};
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const nightTarget = nightTargetFromPayload(payload);
  const dids = inventory.dids || [];
  const allocatedServiceNumbers = new Set();
  const allocatedExtensions = new Set();
  const expectedGatewayNames = new Set(dids.map((did, index) => gatewayNameForDid(did, index).toLowerCase()));
  const entries = dids.map((did, index) => {
    const portalCurrentTarget = targetPreviewFromDid(did, inventory);
    const blockers = [];
    if (!did.href && !did.name) blockers.push("Rufnummer hat keinen stabilen DID-Identifier.");
    if (!nightTarget.href) blockers.push("Nachtziel fehlt oder kann nicht eindeutig gebildet werden.");

    const gatewayName = gatewayNameForDid(did, index);
    const existingGateway = findExistingDaynightGateway(gatewayName, inventory);
    if (existingGateway && !ownedDaynightTimeControl(existingGateway)) blockers.push(serverMessage("portal.timeControlNotOwned"));
    const didAlreadyUsesGateway = Boolean(existingGateway && didTargetsTimeControl(did, existingGateway));
    const gatewayDayTargetHref = apiPathFromHref(existingGateway?.dayTargetHref || "");
    const currentTarget = didAlreadyUsesGateway
      ? targetPreviewFromHref(gatewayDayTargetHref, inventory)
      : portalCurrentTarget;
    if (!currentTarget.isUnassigned && !currentTarget.type) blockers.push("Aktueller Zieltyp fehlt.");
    if (!currentTarget.isUnassigned && !currentTarget.routeNumber) blockers.push("Aktuelle Zielroute fehlt.");
    if (!currentTarget.isUnassigned && !currentTarget.href) blockers.push("Aktueller Ziel-Href kann nicht gebildet werden.");
    if (!currentTarget.isUnassigned && !["IVR", "TIMECONTROL", "QUEUE", "SKILL", "GROUP", "PHONEEXTENSION", "FRONTDESK", "VOICEMAIL", "HANGUP"].includes(currentTarget.type)) {
      blockers.push(serverMessage("portal.server.targetTypeValueHasNotYetBeenEvaluatedFor", {p0: currentTarget.type || "-"}));
    }
    const serviceNumber = existingGateway?.serviceNumber || nextServiceNumber(overview, "TIMECONTROL", allocatedServiceNumbers);
    const extensionNumber = existingGateway?.extensionNumber || nextServiceExtension(overview, allocatedExtensions, 7300 + index);
    const serviceCode = `*740${String(serviceNumber).padStart(3, "0")}`;
    const gatewayEndpoint = `/api/customers/${customer}/targets/time-control-services`;
    const gatewayHref = existingGateway?.href || gatewayHrefFromServiceNumber(serviceNumber);
    const dayTargetHref = didAlreadyUsesGateway && gatewayDayTargetHref
      ? gatewayDayTargetHref
      : currentTarget.href || (currentTarget.isUnassigned ? targetHrefForRoute("HANGUP", "HANGUP") : "");
    const gatewayMatchesDayTarget = currentTarget.isUnassigned
      ? existingGateway?.dayTargetHref
        ? sameApiHref(existingGateway.dayTargetHref, dayTargetHref)
        : Boolean(existingGateway && !dayTargetHref)
      : existingGateway?.dayTargetHref
        ? sameApiHref(existingGateway.dayTargetHref, currentTarget.href)
        : Boolean(existingGateway);
    const gatewayMatchesNightTarget = existingGateway?.nightTargetHref
      ? sameApiHref(existingGateway.nightTargetHref, nightTarget.href)
      : Boolean(existingGateway && !nightTarget.href);
    const gatewayNeedsUpdate = Boolean(existingGateway && (!gatewayMatchesDayTarget || !gatewayMatchesNightTarget));
    const gatewayBody = {
      links: [
        dayTargetHref ? { rel: "destinationIfAllowed", href: dayTargetHref } : null,
        { rel: "destinationIfDenied", href: nightTarget.href || "{night-target}" },
        { rel: "timezone", href: timeZoneHref(existingGateway?.timezoneHref) },
      ].filter(Boolean),
      data: [
        { name: "name", value: gatewayName },
        { name: "displayName", value: gatewayName },
        { name: "serviceNumber", value: nfonInteger(serviceNumber) },
        { name: "serviceCode", value: serviceCode },
        { name: "extensionNumber", value: extensionNumber },
        { name: "evaluationStrategy", value: "AUTO" },
        { name: "fromDay", value: nfonDay("MONDAY") },
        { name: "fromTimeOfDay", value: nfonTime("09:00") },
        { name: "toDay", value: nfonDay("FRIDAY") },
        { name: "toTimeOfDay", value: nfonTime("18:00") },
      ],
    };
    const didRouteEndpoint = `${gatewayHref}/inbound-trunk-numbers`;
    const gatewayCreateOperation = existingGateway
      ? null
      : { action: "create-daynight-gateway", method: "POST", endpoint: gatewayEndpoint, body: gatewayBody, note: "Zeitsteuerung anlegen: Tag = Originalziel, Nacht = Nachtziel." };
    const gatewayUpdateOperation = existingGateway && gatewayNeedsUpdate
      ? { action: "update-daynight-gateway", method: "PUT", endpoint: gatewayHref, body: gatewayBody, note: "Zeitsteuerung aktualisieren: Tag = Originalziel, Nacht = Wunschziel." }
      : null;
    const forceNightGatewayOperation = existingGateway
      ? {
        action: "force-night-daynight-gateway",
        method: "PUT",
        endpoint: gatewayHref,
        body: {
          ...gatewayBody,
          links: [
            { rel: "destinationIfAllowed", href: nightTarget.href || "{night-target}" },
            { rel: "destinationIfDenied", href: nightTarget.href || "{night-target}" },
            { rel: "timezone", href: timeZoneHref(existingGateway?.timezoneHref) },
          ],
        },
        note: "Nachtmodus erzwingen: innerhalb und ausserhalb des Zeitfensters auf Nachtziel routen.",
      }
      : null;
    const routeOperations = didAlreadyUsesGateway ? [] : [didDestinationOperation(did, gatewayHref, "route-did-to-gateway")];
    return {
      ok: blockers.length === 0,
      did: {
        id: did.id,
        name: did.name,
        trunkNumber: did.trunkNumber,
        didExtension: did.didExtension,
      },
      currentTarget,
      gateway: {
        strategy: "time-control-service",
        name: gatewayName,
        serviceNumber,
        extensionNumber,
        href: gatewayHref,
        dayTargetHref,
        nightTargetHref: nightTarget.href || "",
      },
      gatewayExists: Boolean(existingGateway),
      routingActive: didAlreadyUsesGateway,
      gatewayNeedsUpdate,
      gatewayMatchesDayTarget,
      gatewayMatchesNightTarget,
      gatewayCreateOperation,
      gatewayUpdateOperation,
      forceNightGatewayOperation,
      restoreGatewayOperation: existingGateway ? {action:"restore-time-control",method:"PUT",endpoint:existingGateway.href,body:existingGateway.routingBody} : null,
      routeOperations,
      plannedOperations: [
        gatewayCreateOperation,
        gatewayUpdateOperation,
        ...routeOperations,
      ].filter(Boolean),
      restorePlan: didDestinationOperation(did, currentTarget.isUnassigned ? "" : currentTarget.href, "restore-original-routing"),
      behaviorNote: currentTarget.isUnassigned
        ? "Rufnummer ist tagsueber unbelegt. Im Zeitsteuerungsfenster wird das als Auflegen abgebildet; nach der Wiederherstellung bleibt sie wieder ohne Ziel."
        : currentTarget.isFrontdesk
          ? "Frontdesk/Nia bleibt Tagesziel hinter der Zeitsteuerung. Die KI-Loesung wird nicht veraendert; nur die Rufnummer wuerde initial vor den Frontdesk auf die Zeitsteuerung zeigen."
          : "Originalziel bleibt als Tagesziel hinter der Zeitsteuerung erhalten.",
      blockers: blockers.map(message => ({ message, ...(messageDescriptor(message) ? { messageKey: messageDescriptor(message).key, messageParams: messageDescriptor(message).params } : {}) })),
    };
  });
  const staleTimeControls = (inventory.timeControls || [])
    .filter((timeControl) => ownedDaynightTimeControl(timeControl))
    .filter((timeControl) => !timeControlReferenced(timeControl, inventory))
    .filter((timeControl) => !expectedGatewayNames.has(String(timeControl.name || "").trim().toLowerCase()))
    .map((timeControl) => ({
      id: timeControl.serviceNumber || timeControl.id || timeControl.value || "",
      name: timeControl.name || "",
      extensionNumber: timeControl.extensionNumber || timeControl.value || "",
      href: timeControl.href || gatewayHrefFromServiceNumber(timeControl.serviceNumber || timeControl.id || timeControl.value || ""),
    }))
    .filter((timeControl) => timeControl.href);
  const blockers = entries.flatMap(entry => entry.blockers.map(blocker => ({ ...blocker, label: entry.did.name || entry.did.id })));
  return {
    ok: blockers.length === 0 && dids.length > 0,
    readOnly: true,
    type: "daynight-gateway-preview",
    title: "Zeitsteuerungs-Check",
    message: dids.length
      ? serverMessage("portal.server.valueOfValueNumbersCanBeEvaluatedUnambiguouslyFor", {p0: entries.filter((entry) => entry.ok).length, p1: dids.length})
      : "Keine Rufnummern gefunden.",
    capabilities: {
      dids: publicEndpoint(overview?.endpoints?.dids),
      timeControls: publicEndpoint(overview?.endpoints?.timeControls),
      ivrs: publicEndpoint(overview?.endpoints?.ivrs),
      announcements: publicEndpoint(overview?.endpoints?.announcements),
      frontdesks: publicEndpoint(overview?.endpoints?.frontdesks),
    },
    summary: {
      total: entries.length,
      ready: entries.filter((entry) => entry.ok).length,
      blocked: entries.filter((entry) => !entry.ok).length,
      gatewaysExisting: entries.filter((entry) => entry.gatewayExists).length,
      gatewaysToCreate: entries.filter((entry) => entry.ok && !entry.gatewayExists).length,
      gatewaysToUpdate: entries.filter((entry) => entry.ok && entry.gatewayNeedsUpdate).length,
      gatewaysReady: entries.filter((entry) => entry.ok && entry.gatewayExists && !entry.gatewayNeedsUpdate).length,
      frontdesk: entries.filter((entry) => entry.currentTarget.isFrontdesk).length,
      announcements: inventory.announcements?.length || 0,
      ivrs: inventory.ivrs?.length || 0,
      timeControls: inventory.timeControls?.length || 0,
      cleanupCandidates: staleTimeControls.length,
    },
    nightTarget,
    nightOptions: {
      existingIvrs: (inventory.ivrs || []).map((ivr) => ({ name: ivr.name, extensionNumber: ivr.extensionNumber || ivr.value, serviceNumber: ivr.serviceNumber || ivr.id, href: ivr.href })),
      announcements: (inventory.announcements || []).map((announcement) => ({ name: announcement.name, value: announcement.value, href: announcement.href })),
    },
    entries,
    staleTimeControls,
    namingConvention: `${DAYNIGHT_TIME_CONTROL_PREFIX}<Rufnummer>`,
    blockers,
    createdAt: new Date().toISOString(),
  };
}

async function previewDaynightGateway(payload = {}) {
  if (!cache.overview) await loadOverview();
  return buildDaynightGatewayPreview(payload);
}

async function applyDaynightGateways(payload = {}) {
  assertLiveWritesEnabled();
  await loadOverview();
  if (cache.overview.daynight?.active) throw httpError(409, "Restore day mode before changing night routing.");
  const plan = buildDaynightGatewayPreview(payload);
  if (!plan.ok) return { ...plan, dryRun: false, applied: false, status: 400 };

  const attempts = [];
  const results = [];
  for (const entry of plan.entries.filter((item) => item.ok)) {
    const operation = entry.gatewayCreateOperation || entry.gatewayUpdateOperation;
    if (!operation) {
      results.push({
        ok: true,
        skipped: true,
        did: entry.did?.name || entry.did?.id || "",
        gateway: entry.gateway?.name || "",
        message: "Zeitsteuerung existiert bereits und hat das gewuenschte Ziel.",
      });
      continue;
    }

    try {
      const result = await runPortalOperation(operation, attempts, {
        did: entry.did?.name || entry.did?.id || "",
        gateway: entry.gateway?.name || "",
      });
      let createdHref = "";
      if (operation.action === "create-daynight-gateway") {
        const resourcePrefix = canonicalResourceHref(operation.endpoint) + "/";
        // Only the create response can establish ownership. A newly visible,
        // same-named resource in a later inventory read may belong to another client.
        const identities = new Set([result.location, ...extractItems(result.body).map(item => item.href)].flatMap(value => {
          if (typeof value !== "string" || !value.trim()) return [];
          try {
            const url = new URL(value, config.baseUrl);
            if (url.search || url.hash) return [];
            const href = canonicalResourceHref(assertCustomerPath(value));
            return href.startsWith(resourcePrefix) && /^\d+$/.test(href.slice(resourcePrefix.length)) ? [href] : [];
          } catch {
            return [];
          }
        }));
        if (identities.size !== 1) throw httpError(502, "Created resource could not be identified. Reload before continuing.");
        createdHref = [...identities][0];
        entry.gateway.href = createdHref;
      }
      results.push({
        ok: true,
        href: createdHref,
        action: operation.action,
        did: entry.did?.name || entry.did?.id || "",
        gateway: entry.gateway?.name || "",
        status: result.status,
        location: result.location || "",
      });
    } catch (error) {
      const detail = portalErrorDetail(error);
      attempts.push({
        did: entry.did?.name || entry.did?.id || "",
        gateway: entry.gateway?.name || "",
        action: "failed",
        method: error.method || operation.method,
        status: error.status || 0,
        endpoint: error.endpoint || operation.endpoint,
        message: error.message,
        detail,
        body: error.body || null,
      });
      results.push({
        ok: false,
        did: entry.did?.name || entry.did?.id || "",
        gateway: entry.gateway?.name || "",
        status: error.status || 0,
        error: [portalErrorMessage(error), detail].filter(Boolean).join(" · "),
        body: error.body || null,
      });
      break;
    }
  }

  const failed = results.filter((result) => !result.ok);
  const applied = failed.length === 0;
  const response = {
    ...plan,
    ok: applied,
    dryRun: false,
    applied,
    status: applied ? 200 : 502,
    title: applied ? "Zeitsteuerungen angelegt" : "Zeitsteuerungs-Anlage fehlgeschlagen",
    message: applied
      ? serverMessage("portal.server.valueTimeControlsCreatedValueUpdatedValueUnchangedNumbers", {p0: results.filter((result) => result.action === "create-daynight-gateway").length, p1: results.filter((result) => result.action === "create-daynight-gateway").length === 1 ? "" : "en", p2: results.filter((result) => result.action === "update-daynight-gateway").length, p3: results.filter((result) => result.skipped).length})
      : serverMessage("portal.server.valueTimeControlsCouldNotBeCreatedOrUpdated", {p0: failed.length, p1: failed.length === 1 ? "" : "en"}),
    results,
    attempts,
    appliedAt: new Date().toISOString(),
  };
  if (applied || results.some(result => result.ok && result.action === "create-daynight-gateway")) {
    response.snapshot = await saveDaynightSnapshot(plan, {
      ok: response.ok,
      title: response.title,
      message: response.message,
      results: response.results,
      attempts: response.attempts,
      appliedAt: response.appliedAt,
    });
  }
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  return response;
}

async function applyDaynightGatewayRouting(payload = {}) {
  assertLiveWritesEnabled();
  await loadOverview();
  if (cache.overview.daynight?.active) {
    const snapshot = await readDaynightSnapshot();
    const selected = nightTargetFromPayload(payload);
    const unchanged = sameApiHref(selected.href, snapshot?.nightTarget?.href) && (cache.overview.inventory.dids || []).every(did => cache.overview.inventory.timeControls.some(tc => ownedDaynightTimeControl(tc) && didTargetsTimeControl(did, tc)));
    if (unchanged) return {ok:true,applied:true,status:200,unchanged:true,message:"Night mode is already active.",attempts:[]};
    throw httpError(409, "Restore day mode before changing night routing.");
  }
  const plan = buildDaynightGatewayPreview(payload);
  const missingGateway = plan.entries.filter((entry) => entry.ok && !entry.gatewayExists);
  const outdatedGateway = plan.entries.filter((entry) => entry.ok && entry.gatewayNeedsUpdate);
  if (!plan.ok || missingGateway.length) {
    return {
      ...plan,
      ok: false,
      dryRun: false,
      applied: false,
      status: 400,
      title: "Rufnummern noch nicht bereit",
      message: missingGateway.length
        ? serverMessage("portal.server.valueTimeControlsAreStillMissingCreateTheTime", {p0: missingGateway.length, p1: missingGateway.length === 1 ? "" : "en"})
        : plan.message,
    };
  }

  const attempts = [];
  const appliedEntries = [];
  await saveDaynightSnapshot(plan, {
    ok: true,
    routingActive: true,
    title: "Nachtmodus vorbereitet",
    message: "Tagesziele vor der Aktivierung gesichert.",
    appliedAt: new Date().toISOString(),
  });
  for (const entry of plan.entries.filter((item) => item.ok)) {
    const completed = [];
    try {
      if (entry.forceNightGatewayOperation) {
        await runPortalOperation(entry.forceNightGatewayOperation, attempts, { did: entry.did?.name || entry.did?.id || "", gateway: entry.gateway?.name || "" });
        completed.push(entry.forceNightGatewayOperation.action);
      }
      for (const operation of entry.routeOperations || []) {
        await runPortalOperation(operation, attempts, { did: entry.did?.name || entry.did?.id || "", gateway: entry.gateway?.name || "" });
        completed.push(operation.action);
      }
      appliedEntries.push(entry);
    } catch (error) {
      attempts.push({
        did: entry.did?.name || entry.did?.id || "",
        gateway: entry.gateway?.name || "",
        action: "failed",
        method: error.method || "-",
        status: error.status || 0,
        endpoint: error.endpoint || "",
        message: error.message,
      });

      if (completed.includes("force-night-daynight-gateway") && entry.restoreGatewayOperation) await runRollbackOperations([entry.restoreGatewayOperation], attempts, {gateway:entry.gateway?.name || ""});
      if (completed.includes("route-did-to-gateway") && entry.restorePlan?.endpoint) {
        await runRollbackOperations([entry.restorePlan], attempts, { did: entry.did?.name || entry.did?.id || "", gateway: entry.gateway?.name || "" });
      }
      for (const applied of appliedEntries.reverse()) {
        await runRollbackOperations([applied.restorePlan, applied.restoreGatewayOperation].filter(Boolean), attempts, {
          did: applied.did?.name || applied.did?.id || "",
          gateway: applied.gateway?.name || "",
        });
      }

      const snapshot = await readDaynightSnapshot();
      if (snapshot && !attempts.some(item => item.action === "rollback-failed")) {snapshot.routingActive=false; await writePrivateJson(daynightSnapshotFile(snapshot.customer), snapshot);}
      return {
        ...plan,
        ok: false,
        dryRun: false,
        applied: false,
        status: 502,
        title: "Rufnummern-Migration fehlgeschlagen",
        message: portalErrorMessage(error),
        attempts,
        rolledBack: !attempts.some(item => item.action === "rollback-failed"),
      };
    }
  }

  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  return {
    ...plan,
    ok: true,
    dryRun: false,
    applied: true,
    status: 200,
    title: "Rufnummern auf Zeitsteuerungen umgehängt",
    message: serverMessage("portal.server.valueNumbersWereRoutedToThePreparedDayNight", {p0: appliedEntries.length, p1: appliedEntries.length === 1 ? "" : "n"}),
    attempts,
    appliedAt: new Date().toISOString(),
  };
}

async function cleanupDaynightTimeControls(payload = {}) {
  assertLiveWritesEnabled();
  await loadOverview();
  requireCompleteInventory(cache.overview);
  const plan = buildDaynightGatewayPreview(payload);
  await loadDeletionReferences(cache.overview.inventory);
  const staleTimeControls = (plan.staleTimeControls || []).filter(item=>!timeControlReferenced(item,cache.overview.inventory));
  if (!staleTimeControls.length) {
    return {
      ...plan,
      ok: true,
      dryRun: false,
      applied: true,
      status: 200,
      title: "Keine Zeitsteuerungen zu löschen",
      message: "Alle Zeitsteuerungen nach Namenskonvention passen zur aktuellen Rufnummernliste.",
      attempts: [],
    };
  }

  const attempts = [];
  for (const timeControl of staleTimeControls) {
    await runPortalOperation({
      action: "delete-stale-daynight-time-control",
      method: "DELETE",
      endpoint: timeControl.href,
    }, attempts, { timeControl: timeControl.name });
    await forgetManagedTimeControl(timeControl.href);
  }

  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  return {
    ...plan,
    ok: true,
    dryRun: false,
    applied: true,
    status: 200,
    title: "Zeitsteuerungen bereinigt",
    message: serverMessage("portal.server.valueObsoleteTimeControlsMatchingTheNamingConventionDeleted", {p0: staleTimeControls.length, p1: staleTimeControls.length === 1 ? "" : "en"}),
    attempts,
    deleted: staleTimeControls,
    appliedAt: new Date().toISOString(),
  };
}

function managedDaynightTimeControls(inventory = {}) {
  return (inventory.timeControls || [])
    .filter((timeControl) => ownedDaynightTimeControl(timeControl))
    .map((timeControl) => ({
      id: timeControl.serviceNumber || timeControl.id || timeControl.value || "",
      name: timeControl.name || "",
      extensionNumber: timeControl.extensionNumber || timeControl.value || "",
      serviceNumber: timeControl.serviceNumber || timeControl.id || timeControl.value || "",
      href: timeControl.href || gatewayHrefFromServiceNumber(timeControl.serviceNumber || timeControl.id || timeControl.value || ""),
      dayTargetHref: apiPathFromHref(timeControl.dayTargetHref || ""),
      nightTargetHref: apiPathFromHref(timeControl.nightTargetHref || ""),
    }))
    .filter((timeControl) => timeControl.href);
}

function containsTargetReference(value, href) {
  if (typeof value === "string") return /(?:^|\/)targets\//.test(value) && sameApiHref(value, href);
  if (Array.isArray(value)) return value.some(item => containsTargetReference(item, href));
  if (!value || typeof value !== "object") return false;
  return Object.entries(value).some(([key,item]) => !["name","title","displayName","routingBody"].includes(key) && containsTargetReference(item, href));
}

async function loadDeletionReferences(inventory) {
  for (const [kind, suffixes] of [["queues",["timeout","destination-on-rejection"]],["skills",["timeout","destination-on-rejection"]],["groups",["timeout"]]]) {
    if (cache.overview?.endpoints?.[kind]?.ok === false) throw httpError(409, serverMessage("portal.deletionReferencesUnavailable"));
    for (const item of inventory[kind] || []) {
      item.routingReferences=[];
      for (const suffix of suffixes) {
        const response=await safePortalCall("delete-reference-"+kind+"-"+item.href+suffix, item.href+"/"+suffix, { collection: false });
        if (!response.ok) throw httpError(409, serverMessage("portal.deletionReferencesUnavailable"));
        item.routingReferences.push(response.items?.length ? response.items : response.item);
      }
    }
  }
}

function timeControlReferenced(timeControl, inventory = {}) {
  if ((inventory.dids || []).some(did => didTargetsTimeControl(did, timeControl))) return true;
  const href = apiPathFromHref(timeControl.href || gatewayHrefFromServiceNumber(timeControl.serviceNumber));
  for (const item of [...(inventory.timeControls || []), ...(inventory.ivrs || []), ...(inventory.queues || []), ...(inventory.skills || []), ...(inventory.groups || [])]) {
    if (sameApiHref(item.href, href)) continue;
    if (containsTargetReference(item, href)) return true;
  }
  return false;
}

function didTargetsTimeControl(did = {}, timeControl = {}) {
  if (normalizeDestinationType(did.destinationType) !== "TIMECONTROL") return false;
  const route = String(didDestinationRoute(did) || "");
  return Boolean(route) && (
    route === String(timeControl.serviceNumber || "")
    || route === String(timeControl.extensionNumber || "")
    || sameApiHref(targetHrefForRoute("TIMECONTROL", route), timeControl.href)
  );
}

async function resetDaynightTimeControls(options = {}) {
  assertLiveWritesEnabled();
  const deleteTimeControls = options.deleteTimeControls !== false;
  await loadOverview();
  const overview = cache.overview || {};
  requireCompleteInventory(overview);
  const inventory = overview.inventory || {};
  if (deleteTimeControls) await loadDeletionReferences(inventory);
  const timeControls = managedDaynightTimeControls(inventory);
  const snapshot = await readDaynightSnapshot();
  const snapshotEntries = snapshot?.entries || [];
  const attempts = [];
  const restoreOperations = [];
  const blockers = [];

  for (const did of inventory.dids || []) {
    const timeControl = timeControls.find((item) => didTargetsTimeControl(did, item));
    if (!timeControl) continue;
    const didName = did.name || did.id || "";
    const snapshotEntry = snapshotEntries.find((entry) => entry.did?.name === didName || entry.did?.id === didName);
    const snapshotRestore = snapshotEntry?.restorePlan?.method === "PUT" ? snapshotEntry.restorePlan : null;
    if (!snapshotRestore) {
      blockers.push({ label: didName, message: serverMessage("portal.originalRoutingMissing") });
      continue;
    }
    restoreOperations.push({ context: { did: didName, gateway: timeControl.name }, operations: [snapshotRestore] });
  }

  if (deleteTimeControls) for (const control of timeControls) {
    if (timeControlReferenced(control,{...inventory,dids:[]})) blockers.push({ label: control.name, message: serverMessage("portal.routingReferenceRemains") });
  }
  if (blockers.length) {
    return {
      ok: false,
      dryRun: false,
      applied: false,
      status: 409,
      title: "Reset blockiert",
      message: serverMessage("portal.resetBlockedReason"),
      blockers,
      attempts,
    };
  }

  for (const group of restoreOperations) {
    for (const operation of group.operations) {
      await runPortalOperation(operation, attempts, group.context);
    }
  }

  if (snapshot) {snapshot.routingActive = false; await writePrivateJson(daynightSnapshotFile(snapshot.customer), snapshot);}
  if (deleteTimeControls) {
    await loadOverview();
    requireCompleteInventory(cache.overview);
    await loadDeletionReferences(cache.overview.inventory);
    for (const timeControl of timeControls) {
      if (timeControlReferenced(timeControl, cache.overview.inventory)) throw httpError(409, "Time control remains referenced; deletion blocked.");
      await runPortalOperation({
        action: "delete-managed-daynight-time-control",
        method: "DELETE",
        endpoint: timeControl.href,
      }, attempts, { timeControl: timeControl.name });
      await forgetManagedTimeControl(timeControl.href);
    }
  }

  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  return {
    ok: true,
    dryRun: false,
    applied: true,
    status: 200,
    title: deleteTimeControls ? "Nachtschaltung zurückgesetzt" : "Tagmodus aktiviert",
    message: deleteTimeControls
      ? serverMessage("portal.server.valueNumbersRestoredValueManagedTimeControlsDeleted", {p0: restoreOperations.length, p1: restoreOperations.length === 1 ? "" : "n", p2: timeControls.length, p3: timeControls.length === 1 ? "" : "en"})
      : serverMessage("portal.server.valueNumbersRestoredPreparedTimeControlsRemainAvailableFor", {p0: restoreOperations.length, p1: restoreOperations.length === 1 ? "" : "n"}),
    restoredRoutings: restoreOperations.length,
    deletedTimeControls: deleteTimeControls ? timeControls.length : 0,
    keptTimeControls: deleteTimeControls ? 0 : timeControls.length,
    attempts,
    appliedAt: new Date().toISOString(),
  };
}

async function handleApi(req, res, url) {
  assertAllowedOrigin(req);
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    requireCsrf(req);
    if (!["/api/settings/customer", "/api/settings/browser-login"].includes(url.pathname)
      && req.headers["x-portal-context"] !== writeContext) {
      throw httpError(409, "Account changed. Reload before continuing.");
    }
  }

  if (url.pathname === "/api/status" && req.method === "GET") {
    sendJson(req, res, 200, getStatusPayload());
    return;
  }

  if (url.pathname === "/api/customers" && req.method === "GET") {
    sendJson(req, res, 200, await listPortalCustomers());
    return;
  }

  if (url.pathname === "/api/settings/customer" && req.method === "POST") {
    try {
      const body = await readRequestJson(req);
      sendJson(req, res, 200, await switchCustomerAccount(body?.account || body?.customerAccount));
    } catch (error) {
      sendError(req, res, error.status || 500, error.message);
    }
    return;
  }

  if (url.pathname === "/api/settings/browser-login" && req.method === "POST") {
    try {
      sendJson(req, res, 200, await applyBrowserLogin(await readRequestJson(req)));
    } catch (error) {
      sendError(req, res, error.status || 500, error.message);
    }
    return;
  }

  if (url.pathname === "/api/settings/live-writes" && req.method === "POST") {
    const body = await readRequestJson(req);
    if (typeof body.enabled !== "boolean") throw httpError(400, serverMessage("portal.error.invalidJson"));
    const enabled = body?.enabled === true;
    if (enabled && !config.configured) {
      sendError(req, res, 400, "Portal API ist nicht vollständig konfiguriert.");
      return;
    }
    if (enabled && (!config.liveWritesPermitted || config.liveWritesLocked)) {
      const error = liveWritesDisabledError();
      sendError(req, res, error.status, error.message, { code: error.code });
      return;
    }
    runtimeSettings.liveWritesEnabled = enabled;
    runtimeSettings.liveWritesChangedAt = new Date().toISOString();
    sendJson(req, res, 200, {
      ok: true,
      settings: publicSettingsPayload(),
      message: enabled ? "Live-Schreiben ist fuer diese Sitzung aktiviert." : "Live-Schreiben ist fuer diese Sitzung deaktiviert.",
    });
    return;
  }

  if (url.pathname === "/api/phonebook-sync/mapping" && req.method === "GET") {
    sendJson(req, res, 200, {
      ok: true,
      mapping: runtimeSettings.phonebookMapping,
      settings: publicSettingsPayload(),
    });
    return;
  }

  if (url.pathname === "/api/phonebook-sync/mapping" && req.method === "POST") {
    try {
      const body = await readRequestJson(req);
      runtimeSettings.phonebookMapping = sanitizePhonebookMapping(body?.mapping || body);
      sendJson(req, res, 200, {
        ok: true,
        mapping: runtimeSettings.phonebookMapping,
        settings: publicSettingsPayload(),
      });
    } catch (error) {
      sendError(req, res, error.status || 400, error.message);
    }
    return;
  }

  if (url.pathname === "/api/phonebook-sync/upload" && req.method === "POST") {
    try {
      const result = await saveUploadedGoogleContacts(await readRequestJson(req, { limit: UPLOAD_JSON_LIMIT }));
      sendJson(req, res, 200, result);
    } catch (error) {
      sendError(req, res, error.status || 400, error.message);
    }
    return;
  }

  if (url.pathname === "/api/version" && req.method === "GET") {
    try {
      const result = await portalFetch("/api/version");
      const data = objectFromBody(result.body);
      sendJson(req, res, 200, { appId: "portal", version: config.appVersion, upstreamVersion: String(data.version || data.name || "").slice(0, 80), ok: true });
    } catch (error) {
      sendError(req, res, error.status || 500, error.message);
    }
    return;
  }

  if (url.pathname === "/api/overview" && req.method === "GET") {
    const overview = await loadOverview();
    sendJson(req, res, 200, overview);
    return;
  }

  if (url.pathname === "/api/callflow" && req.method === "GET") {
    const overview = cache.overview || await loadOverview();
    sendJson(req, res, 200, overview.callflow || buildCallflow(overview));
    return;
  }

  if (url.pathname === "/api/callflow/apply" && req.method === "POST") {
    const result = await applyCallflowChange(await readRequestJson(req));
    sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    return;
  }

  if (url.pathname === "/api/callflow/bulk-apply" && req.method === "POST") {
    const result = await applyBulkCallflowChange(await readRequestJson(req));
    sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    return;
  }

  if (url.pathname === "/api/daynight/gateway-preview" && req.method === "POST") {
    const result = await previewDaynightGateway(await readRequestJson(req));
    sendJson(req, res, 200, result);
    return;
  }

  if (url.pathname === "/api/daynight/gateways/apply" && req.method === "POST") {
    try {
      const result = await applyDaynightGateways(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/gateway-routing/apply" && req.method === "POST") {
    try {
      const result = await applyDaynightGatewayRouting(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/time-controls/cleanup" && req.method === "POST") {
    try {
      const result = await cleanupDaynightTimeControls(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/reset" && req.method === "POST") {
    try {
      await readRequestJson(req);
      const result = await resetDaynightTimeControls();
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/restore" && req.method === "POST") {
    try {
      await readRequestJson(req);
      const result = await resetDaynightTimeControls({ deleteTimeControls: false });
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/announcement-target/plan" && req.method === "POST") {
    try {
      const result = await planAnnouncementTarget(await readRequestJson(req));
      sendJson(req, res, 200, result);
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/announcement-target/apply" && req.method === "POST") {
    try {
      const result = await applyAnnouncementTarget(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/phonebook-sync/preview" && (req.method === "GET" || req.method === "POST")) {
    const result = await buildPhonebookSyncPreview();
    sendJson(req, res, 200, result);
    return;
  }

  if (url.pathname === "/api/phonebook-sync/apply" && req.method === "POST") {
    try {
      const result = await applyPhonebookSync();
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  const resourceDeleteMatch = url.pathname.match(/^\/api\/resources\/([^/]+)\/([^/]+)$/);
  if (resourceDeleteMatch && req.method === "DELETE") {
    try {
      const [, kind, id] = resourceDeleteMatch.map(decodeURIComponent);
      sendJson(req, res, 200, await deletePortalResource(kind, id));
    } catch (error) {
      sendError(req, res, error.status || 500, error.message, { code: error.code || undefined });
    }
    return;
  }

  const resourceCreateMatch = url.pathname.match(/^\/api\/resources\/([^/]+)$/);
  if (resourceCreateMatch && req.method === "POST") {
    try {
      const [, kind] = resourceCreateMatch.map(decodeURIComponent);
      const result = await createPortalResource(kind, await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 502, result);
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { body: error.body || null, code: error.code || undefined });
    }
    return;
  }

  if (url.pathname === "/api/service-groups" && req.method === "GET") {
    const result = await loadServiceGroups();
    sendJson(req, res, 200, result);
    return;
  }

  if (url.pathname === "/api/service-groups/apply" && req.method === "POST") {
    const result = await applyServiceGroupChanges(await readRequestJson(req));
    sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    return;
  }

  if (url.pathname === "/api/extensions/batch/plan" && req.method === "POST") {
    const result = await planExtensionBatch(await readRequestJson(req));
    sendJson(req, res, 200, result);
    return;
  }

  if (url.pathname === "/api/extensions/batch/apply" && req.method === "POST") {
    try {
      const result = await applyExtensionBatch(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.error || result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { body: error.body || null, code: error.code || undefined });
    }
    return;
  }

  if (url.pathname === "/api/demo/clone-extension" && req.method === "POST") {
    sendJson(req, res, 200, actionPlan("clone-extension", await readRequestJson(req)));
    return;
  }

  if (url.pathname === "/api/demo/create-extension" && req.method === "POST") {
    sendJson(req, res, 200, actionPlan("create-extension", await readRequestJson(req)));
    return;
  }

  sendError(req, res, 404, "API route not found");
}

async function serveStatic(req, res, url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw httpError(400, "Malformed URL"); }
  if (pathname === "/") pathname = "/index.html";
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(req, res, 403, "Forbidden");
    return;
  }

  let data;
  try { data = await readPublicFile(PUBLIC_DIR, filePath); }
  catch (error) {
    if (error.code === "EACCES") return sendError(req,res,403,"Forbidden");
    if (error.code === "ENAMETOOLONG") return sendError(req,res,404,"File not found");
    if (!["ENOENT","EISDIR","ENOTDIR"].includes(error.code)) throw error;
    if (path.extname(filePath) && path.extname(filePath) !== ".html") return sendError(req,res,404,"File not found");
    filePath=path.join(PUBLIC_DIR,"index.html");
    try {data=await readPublicFile(PUBLIC_DIR,filePath);} catch (fallbackError) {return sendError(req,res,fallbackError.code==="EACCES"?403:404,"File not found");}
  }
  const ext = path.extname(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": staticCacheControl(req.url),
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!guardRequest(req, res)) return;
    if (req.method === "OPTIONS") {
      assertAllowedOrigin(req);
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    const url = requestUrl(req);
    if (url.pathname.startsWith("/api/")) {
      const mutating = !["GET", "HEAD", "OPTIONS"].includes(req.method);
      if (mutating && mutationInFlight) throw httpError(409, "Another change is in progress. Wait for it to finish.");
      if (mutating) mutationInFlight = true;
      try {
        await requestContext.run({ generation: accountGeneration, changesAccount: ["/api/settings/customer", "/api/settings/browser-login"].includes(url.pathname) }, () => handleApi(req, res, url));
      } finally { if (mutating) mutationInFlight = false; }
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      sendError(req, res, 405, "Method not allowed");
      return;
    }
    await serveStatic(req, res, url);
  } catch (error) {
    sendError(req, res, error.status || 500, portalErrorMessage(error) || "Unexpected server error", { code: error.code || undefined });
  }
});

repairRuntimeFileModes()
  .then(() => {
    server.listen(config.port, config.host, () => {
      console.log(`Portal API Showcase listening at http://${config.host}:${config.port}`);
      console.log(`Portal API configured: ${config.configured ? "yes" : "no"}; account: ${config.customerAccount || "missing"}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
