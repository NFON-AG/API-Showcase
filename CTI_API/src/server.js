const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");
const { loadEnvFile, parseEnvFlag, guardRequest, requestUrl, staticCacheControl, readPublicFile } = require("./server-safety.cjs");

const phoneNumbers = require("../public/phone-number.js");
const { version: packageVersion } = require("../package.json");
const ROOT = process.cwd();
const PUBLIC_DIR = path.join(ROOT, "public");
const APP_CONFIG_NAME = "CTI_API";

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
  candidates.find((file) => loadEnvFile(file));
}

function dataDirForApp(appName, envName) {
  const explicit = resolveMaybeRelative(process.env[envName] || "");
  if (explicit) return explicit;
  const configDir = configuredLocalConfigDir();
  return configDir ? path.join(configDir, "data", appName) : path.join(ROOT, "data");
}

try { loadLocalEnv(APP_CONFIG_NAME); } catch (error) {
  console.error("CTI configuration error: " + error.message);
  process.exit(1);
}

const DATA_DIR = dataDirForApp(APP_CONFIG_NAME, "CTI_DATA_DIR");
const HISTORY_FILE = path.join(DATA_DIR, "call-events.jsonl");
const GOOGLE_TOKEN_FILE = path.join(DATA_DIR, "google-token.json");
const GOOGLE_CONTACTS_FILE = path.join(DATA_DIR, "google-contacts.json");
const GOOGLE_OAUTH_STATE_FILE = path.join(DATA_DIR, "google-oauth-state.json");
const LOCAL_CONTACTS_FILE = path.join(DATA_DIR, "local-contacts.json");
const GOOGLE_SCOPE = "https://www.googleapis.com/auth/contacts.readonly";
const DEFAULT_PORT = 3002;
const DEFAULT_JSON_LIMIT = 1024 * 1024;
const RESTORE_JSON_LIMIT = 5 * 1024 * 1024;
const csrfToken = crypto.randomBytes(32).toString("base64url");

const MIME_TYPES = {
  ".woff2": "font/woff2",
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
};

function firstExistingFile(files) {
  return files.find((file) => file && fs.existsSync(file)) || "";
}

function findLocalFile(dirs, pattern) {
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const entry = fs
      .readdirSync(dir, { withFileTypes: true })
      .find((item) => item.isFile() && pattern.test(item.name));
    if (entry) return path.join(dir, entry.name);
  }
  return "";
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
    if (["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname)) {
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) variants.add(`${parsed.protocol}//${host}${parsed.port ? `:${parsed.port}` : ""}`);
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

function readConfig() {
  const configDir = configuredLocalConfigDir();
  const externalSecretsDir = configDir ? path.join(configDir, "secrets", APP_CONFIG_NAME) : "";
  const nfonSecretFile = process.env.NFON_SECRET_FILE
    ? path.resolve(ROOT, process.env.NFON_SECRET_FILE)
    : firstExistingFile([
      path.join(externalSecretsDir, "CTI_secret.txt"),
      path.join(externalSecretsDir, "secret.txt"),
    ]);
  const googleSecretFile = process.env.GOOGLE_CLIENT_SECRET_FILE
    ? path.resolve(ROOT, process.env.GOOGLE_CLIENT_SECRET_FILE)
    : findLocalFile([externalSecretsDir], /^client_secret_.*\.json$/);
  const config = {
    baseUrl: process.env.NFON_BASE_URL || "https://providersupportdata.cloud-cfg.com/v1",
    kAccount: process.env.NFON_K_ACCOUNT || "",
    username: process.env.NFON_API_USERNAME || "",
    password: process.env.NFON_API_PASSWORD || "",
    phoneCountryCode: process.env.NFON_PHONE_COUNTRY_CODE || "",
    phoneNationalPrefix: process.env.NFON_PHONE_NATIONAL_PREFIX,
    appName: process.env.APP_NAME || "cti-dashboard",
    appVersion: process.env.APP_VERSION || packageVersion,
    port: Number(process.env.PORT || DEFAULT_PORT),
    host: process.env.HOST || "127.0.0.1",
    googleClientId: process.env.GOOGLE_CLIENT_ID || "",
    googleClientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    googleRedirectUri: process.env.GOOGLE_REDIRECT_URI || `http://localhost:${process.env.PORT || DEFAULT_PORT}/auth/google/callback`,
    googleClientSecretFile: googleSecretFile,
    allowedOrigin: process.env.CTI_ALLOWED_ORIGIN || process.env.ALLOWED_ORIGIN || `http://localhost:${process.env.PORT || DEFAULT_PORT}`,
    allowRemoteControl: envFlag("CTI_ALLOW_REMOTE_CONTROL", false),
    allowRemoteRead: envFlag("CTI_ALLOW_REMOTE_READ", false),
  };

  if ((!config.username || !config.password) && nfonSecretFile) {
    if (!fs.existsSync(nfonSecretFile)) throw new Error("NFON_SECRET_FILE does not exist; update or remove the configured file path");
    const [account, secret] = fs
      .readFileSync(nfonSecretFile, "utf8")
      .trim()
      .split(/\s+/, 2);
    config.kAccount ||= account;
    config.username ||= account;
    config.password ||= secret;
  }

  if (!config.kAccount && config.username) {
    config.kAccount = config.username;
  }

  if ((!config.googleClientId || !config.googleClientSecret) && config.googleClientSecretFile && fs.existsSync(config.googleClientSecretFile)) {
    const secretConfig = JSON.parse(fs.readFileSync(config.googleClientSecretFile, "utf8"));
    const client = secretConfig.web || secretConfig.installed || {};
    config.googleClientId ||= client.client_id || "";
    config.googleClientSecret ||= client.client_secret || "";
    if (!process.env.GOOGLE_REDIRECT_URI) {
      config.googleRedirectUri = client.redirect_uris?.[0] || config.googleRedirectUri;
    }
  }

  if (config.phoneCountryCode && !/^[1-9]\d{0,2}$/.test(config.phoneCountryCode)) throw new Error("NFON_PHONE_COUNTRY_CODE must contain 1–3 digits");
  if (config.phoneNationalPrefix !== undefined && !/^\d{0,4}$/.test(config.phoneNationalPrefix)) throw new Error("NFON_PHONE_NATIONAL_PREFIX must contain up to 4 digits");
  return config;
}

let config;
try { config = readConfig(); } catch (error) {
  console.error("CTI configuration error: " + error.message);
  process.exit(1);
}
const allowedOrigins = new Set([
  ...localhostOriginVariants(`http://localhost:${config.port}`),
  ...localhostOriginVariants(`http://127.0.0.1:${config.port}`),
  ...splitOrigins(config.allowedOrigin).flatMap(localhostOriginVariants),
]);
const userAgent = () => `${config.appName}/${config.appVersion} (${config.kAccount || "unknown"})`;
const initialHistoryAccount = config.kAccount;
let accountGeneration = 0;
let stopStreams = () => {};
let historyInvalidLines = 0;
let historyWrites = Promise.resolve();
const pendingDials = new Map();
const consumedGoogleStates = new Set();
let googleGeneration = 0;
let googleWrites = Promise.resolve();
let googleRefresh = null;

function assertGoogleGeneration(generation) {
  if (generation !== googleGeneration) throw httpError(409, "Google connection changed; retry the request");
}

function writeGoogleState(generation, operation) {
  const write = googleWrites.catch(() => {}).then(async () => {
    assertGoogleGeneration(generation);
    await operation();
  });
  googleWrites = write;
  return write;
}
let historyKeys = new Set();
let persistedHistoryKeys = new Set();
const pendingHistoryEvents = new Map();
let contactsRevision = 0;
const contactsRevisionEpoch = crypto.randomBytes(8).toString("hex");
const runtimeSettings = {
  authMode: "env",
  browserCredentialsActive: false,
  browserCredentialsUpdatedAt: "",
};

const appState = {
  extensions: [],
  states: new Map(),
  activeCalls: new Map(),
  history: [],
  google: {
    accessToken: "",
    refreshToken: "",
    expiresAt: 0,
    contacts: [],
    connected: false,
    lastSyncAt: null,
    lastError: null,
  },
  localContacts: [],
  streams: {
    calls: { connected: false, lastError: null, lastEventAt: null },
    states: { connected: false, lastError: null, lastEventAt: null },
  },
};

const clients = new Set();

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

function assertAllowedOrigin(req) {
  const origin = requestOrigin(req);
  if (originAllowed(origin)) return;
  throw httpError(403, "Origin is not allowed for this local CTI API");
}

function decodeJwtExp(token) {
  try {
    const payload = token.split(".")[1];
    const json = Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    const parsed = JSON.parse(json);
    return typeof parsed.exp === "number" ? parsed.exp * 1000 : 0;
  } catch {
    return 0;
  }
}

class TokenManager {
  constructor() { this.reset(); }

  async getAccessToken() {
    if (Date.now() < this.nextAttemptAt) throw httpError(429, "NFON sign-in is temporarily delayed after a failed attempt");
    if (this.accessToken && this.accessExpiresAt - Date.now() > 45_000) return this.accessToken;
    return this.authenticate();
  }

  async authenticate() {
    if (this.authPromise) return this.authPromise;
    if (!config.username || !config.password) throw httpError(401, "NFON credentials are missing");
    if (Date.now() < this.nextAttemptAt) throw httpError(429, "NFON sign-in is temporarily delayed after a failed attempt");
    const generation = accountGeneration;
    this.authPromise = (async () => {
      try {
        let response;
        if (this.refreshToken) {
          response = await fetch(config.baseUrl + "/login", {
            method: "PUT", signal: AbortSignal.timeout(15000),
            headers: { Accept: "application/json", Authorization: "Bearer " + this.refreshToken, "User-Agent": userAgent() },
          });
        }
        if (!response?.ok) {
          if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
          response = await fetch(config.baseUrl + "/login", {
            method: "POST", signal: AbortSignal.timeout(15000),
            headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": userAgent() },
            body: JSON.stringify({ username: config.username, password: config.password }),
          });
        }
        const body = await readResponseBody(response);
        if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
        if (!response.ok) throw httpError(response.status === 401 ? 401 : 502, "NFON sign-in failed");
        this.setTokens(body);
        this.rejectedToken = null;
        // A successful login is not proof that protected resources accept this token.
        return this.accessToken;
      } catch (error) {
        if (generation === accountGeneration) {
          this.accessToken = "";
          this.refreshToken = "";
          this.accessExpiresAt = 0;
          this.failures += 1;
          this.nextAttemptAt = Date.now() + Math.min(300000, 30000 * 2 ** (this.failures - 1));
          this.lastError = error.message;
        }
        throw error;
      } finally {
        if (generation === accountGeneration) this.authPromise = null;
      }
    })();
    return this.authPromise;
  }

  rejectResource(token) {
    if (token !== this.accessToken || this.rejectedToken === token) return false;
    this.rejectedToken = token;
    this.accessToken = "";
    this.accessExpiresAt = 0;
    this.failures += 1;
    this.nextAttemptAt = Date.now() + Math.min(300000, 30000 * 2 ** (this.failures - 1));
    this.lastError = "NFON sign-in failed";
    return true;
  }

  acceptResource(token) {
    if (token !== this.accessToken || token === this.rejectedToken) return false;
    const changed = Boolean(this.failures || this.nextAttemptAt || this.lastError);
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.lastError = null;
    return changed;
  }

  login() { return this.authenticate(); }
  refresh() { return this.authenticate(); }

  setTokens(body) {
    this.accessToken = body?.["access-token"] || "";
    this.refreshToken = body?.["refresh-token"] || "";
    this.accessExpiresAt = decodeJwtExp(this.accessToken) || Date.now() + 4 * 60_000;
    if (!this.accessToken) throw new Error("NFON login did not return an access token");
  }

  reset() {
    this.accessToken = "";
    this.refreshToken = "";
    this.accessExpiresAt = 0;
    this.authPromise = null;
    this.rejectedToken = null;
    this.failures = 0;
    this.nextAttemptAt = 0;
    this.lastError = null;
  }
}

const tokens = new TokenManager();

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
  if (typeof body === "string") return `: ${body}`;
  if (body.error) return `: ${body.error}`;
  return `: ${JSON.stringify(body)}`;
}

async function nfonFetch(apiPath, options = {}) {
  const generation = accountGeneration;
  const accessToken = await tokens.getAccessToken();
  if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    signal: AbortSignal.timeout(15000),
    ...options,
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": userAgent(),
      ...(options.headers || {}),
    },
  });

  if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
  const authChanged = response.status === 401
    ? tokens.rejectResource(accessToken)
    : response.ok && tokens.acceptResource(accessToken);
  if (authChanged) broadcast("status", { status: publicStatus() });

  return response;
}

function sendJson(req, res, status, body) {
  if (status === 413) res.shouldKeepAlive = false;
  const payload = JSON.stringify(body);
  res.writeHead(status, corsHeaders(req, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
    "Cache-Control": "no-store",
  }));
  res.end(payload);
}

function sendJsonDownload(req, res, filename, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(200, corsHeaders(req, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(payload),
  }));
  res.end(payload);
}

function sendError(req, res, status, message) {
  sendJson(req, res, status, { error: message });
}

async function readJsonRequest(req, options = {}) {
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
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
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
  await fsp.writeFile(file, JSON.stringify(body, null, 2), { encoding: "utf8", mode: 0o600 });
  await repairPrivateFileMode(file);
}

async function appendPrivateFile(file, text) {
  await ensureDataDir();
  await fsp.appendFile(file, text, { encoding: "utf8", mode: 0o600 });
  await repairPrivateFileMode(file);
}

async function repairRuntimeFileModes() {
  await ensureDataDir();
  await Promise.all([
    HISTORY_FILE,
    GOOGLE_TOKEN_FILE,
    GOOGLE_CONTACTS_FILE,
    GOOGLE_OAUTH_STATE_FILE,
    LOCAL_CONTACTS_FILE,
  ].map(repairPrivateFileMode));
}

function safeReadJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function isLoopbackRequest(req) {
  const address = req.socket?.remoteAddress || "";
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(address);
}

function requireControlAccess(req) {
  assertAllowedOrigin(req);
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "same-site", "none"].includes(String(site))) {
    throw httpError(403, "Cross-site CTI control actions are blocked");
  }
  if (!config.allowRemoteControl && !isLoopbackRequest(req)) {
    throw httpError(403, "CTI control actions are restricted to local requests");
  }
  if (req.headers["x-csrf-token"] !== csrfToken) {
    throw httpError(403, "Missing or invalid CSRF token");
  }
}

function requirePrivateReadAccess(req) {
  assertAllowedOrigin(req);
  if (config.allowRemoteRead || isLoopbackRequest(req)) return;
  throw httpError(403, "CTI private data reads are restricted to local requests");
}

function canReadPrivate(req) {
  return !req || config.allowRemoteRead || isLoopbackRequest(req);
}

function publicStatus(options = {}) {
  const includePrivate = options.includePrivate !== false;
  return {
    account: includePrivate ? config.kAccount : (config.kAccount ? "configured" : ""),
    appId: "cti",
    app: config.appName,
    appVersion: config.appVersion,
    credentialsConfigured: Boolean(config.username && config.password),
    extensions: appState.extensions.length,
    states: appState.states.size,
    activeCalls: appState.activeCalls.size,
    history: appState.history.length,
    google: googlePublicStatus(),
    streams: appState.streams,
    lastError: tokens.lastError,
    authRetryAt: tokens.nextAttemptAt || null,
    historyInvalidLines,
    contactsRevision: `${contactsRevisionEpoch}:${contactsRevision}`,
    phoneNumberContext: { countryCode: config.phoneCountryCode, nationalPrefix: config.phoneNationalPrefix },
    csrfToken,
    settings: {
      authMode: runtimeSettings.authMode,
      browserCredentialsActive: runtimeSettings.browserCredentialsActive,
      browserCredentialsUpdatedAt: runtimeSettings.browserCredentialsUpdatedAt,
      envFileSupported: true,
      required: ["NFON_K_ACCOUNT", "NFON_API_USERNAME", "NFON_API_PASSWORD"],
      optional: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"],
    },
  };
}

function googlePublicStatus() {
  return {
    configured: Boolean(config.googleClientId && config.googleClientSecret),
    connected: Boolean(appState.google.connected && appState.google.refreshToken),
    contacts: appState.google.contacts.length,
    localContacts: appState.localContacts.length,
    lastSyncAt: appState.google.lastSyncAt,
    lastError: appState.google.lastError,
  };
}

async function applyBrowserLoginSettings(payload) {
  const next = {
    kAccount: String(payload.kAccount || "").trim(),
    username: String(payload.username || "").trim(),
    password: String(payload.password || ""),
    googleClientId: String(payload.googleClientId || "").trim(),
    googleClientSecret: String(payload.googleClientSecret || ""),
    googleRedirectUri: String(payload.googleRedirectUri || "").trim(),
  };
  if (!next.kAccount || !next.username || !next.password) {
    const error = new Error("K-Account, API username and API password are required");
    error.statusCode = 400;
    throw error;
  }
  accountGeneration += 1;
  stopStreams();
  config.kAccount = next.kAccount;
  config.username = next.username;
  config.password = next.password;
  if (next.googleClientId || next.googleClientSecret || next.googleRedirectUri) {
    config.googleClientId = next.googleClientId;
    config.googleClientSecret = next.googleClientSecret;
    config.googleRedirectUri = next.googleRedirectUri || config.googleRedirectUri;
  }
  tokens.reset();
  appState.extensions = [];
  appState.states.clear();
  appState.activeCalls.clear();
  appState.history = [];
  pendingDials.clear();
  await loadHistory();
  restartStreams();
  broadcast("snapshot", { status: publicStatus(), extensions: [], states: [], activeCalls: [], history: appState.history });
  runtimeSettings.authMode = "browser";
  runtimeSettings.browserCredentialsActive = true;
  runtimeSettings.browserCredentialsUpdatedAt = new Date().toISOString();
}

function publicGoogleContacts() {
  return allContacts().map((contact) => ({
    id: contact.id,
    name: contact.name,
    organization: contact.organization,
    phones: contact.phones,
    hasPhoto: Boolean(contact.photoUrl || contact.photoData),
    source: contact.source || "google",
  })).sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function allContacts() {
  return [
    ...appState.localContacts.map((contact) => ({ ...contact, source: "local" })),
    ...appState.google.contacts.map((contact) => ({ ...contact, source: "google" })),
  ];
}

function sortExtensions(extensions) {
  return [...extensions].sort((a, b) => {
    const aNum = Number(a.extension_number);
    const bNum = Number(b.extension_number);
    if (Number.isFinite(aNum) && Number.isFinite(bNum) && aNum !== bNum) {
      return aNum - bNum;
    }
    return String(a.extension_number).localeCompare(String(b.extension_number), "de");
  });
}

async function fetchExtensions() {
  const generation = accountGeneration;
  const response = await nfonFetch("/extensions/phone/data");
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`Extension request failed with HTTP ${response.status}${formatApiError(body)}`);
  }
  if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
  if (!Array.isArray(body)) throw httpError(502, "NFON extension response is invalid");
  appState.extensions = sortExtensions(body);
  broadcast("extensions", { extensions: appState.extensions });
  return appState.extensions;
}

async function fetchStateSnapshot() {
  const generation = accountGeneration;
  const startedAt = Date.now();
  const response = await nfonFetch("/extensions/phone/states", {
    headers: { "Accept": "application/json" },
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`State request failed with HTTP ${response.status}${formatApiError(body)}`);
  }
  if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
  if (!Array.isArray(body)) throw httpError(502, "NFON state response is invalid");
  {
    for (const state of body) {
      if (Date.parse(appState.states.get(String(state.extension))?.receivedAt || "") > startedAt) continue;
      handleStateEvent(state, false);
    }
  }
  broadcast("states", { states: serializeStates() });
  return serializeStates();
}

function serializeStates() {
  return [...appState.states.values()].sort((a, b) => String(a.extension).localeCompare(String(b.extension), "de"));
}

function serializeActiveCalls() {
  return [...appState.activeCalls.values()].sort((a, b) => String(b.receivedAt).localeCompare(String(a.receivedAt)));
}

function handleStateEvent(state, shouldBroadcast = true) {
  if (!state || !state.extension) return;
  const key = String(state.extension);
  const previous = appState.states.get(key) || {};
  const receivedAt = new Date().toISOString();
  const lineChanged = previous.line !== state.line;
  const presenceChanged = previous.presence !== state.presence;
  const enriched = {
    ...previous,
    ...state,
    receivedAt,
    lineSince: lineChanged ? receivedAt : previous.lineSince || previous.receivedAt || receivedAt,
    presenceSince: presenceChanged ? receivedAt : previous.presenceSince || previous.receivedAt || receivedAt,
  };
  appState.states.set(key, enriched);
  if (["idle", "offline"].includes(state.line)) {
    for (const [uuid, call] of appState.activeCalls) {
      if (String(call.extension) === key && call.source !== "click-to-dial") appState.activeCalls.delete(uuid);
    }
  }
  appState.streams.states.lastEventAt = enriched.receivedAt;
  if (shouldBroadcast) {
    broadcast("state", { state: enriched, activeCalls: serializeActiveCalls() });
  }
}

function queueHistoryWrite(operation) {
  const result = historyWrites.then(operation);
  // Callers still receive the error; later operations must be able to retry.
  historyWrites = result.catch(() => {});
  return result;
}

async function appendHistory(event) {
  const key = eventKey(event);
  try {
    await queueHistoryWrite(() => persistHistoryEventsUnlocked([event], key));
  } catch (error) {
    pendingHistoryEvents.delete(key);
    if (!persistedHistoryKeys.has(key)) {
      historyKeys.delete(key);
      appState.history = appState.history.filter((entry) => eventKey(entry) !== key);
    }
    throw error;
  }
}

function handleCallEvent(call, source = "stream") {
  if (!call || !call.uuid) return;
  const event = {
    ...call,
    account: config.kAccount,
    source,
    receivedAt: new Date().toISOString(),
  };

  if (historyKeys.has(eventKey(event))) return;
  historyKeys.add(eventKey(event));
  pendingHistoryEvents.set(eventKey(event), event);
  appendHistory(event).catch((error) => {
    console.error("Could not persist call event:", error.message);
  });

  if (["hangup", "end"].includes(call.state)) {
    appState.activeCalls.delete(call.uuid);
  } else {
    appState.activeCalls.set(call.uuid, {
      ...(appState.activeCalls.get(call.uuid) || {}),
      ...event,
    });
  }

  appState.streams.calls.lastEventAt = event.receivedAt;
  broadcast("call", {
    call: event,
    activeCalls: serializeActiveCalls(),
    historyPending: true,
  });
}

function historyTime(event) {
  for (const value of [event.updated, event.receivedAt]) {
    const parsed = Date.parse(value || "");
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function belongsToAccount(event) {
  return event.account ? event.account === config.kAccount : config.kAccount === initialHistoryAccount;
}

async function loadHistory() {
  await queueHistoryWrite(async () => updateHistory(await readHistoryFileUnlocked()));
}

function updateHistory(events) {
  const previousKeys = new Set(appState.history.map(eventKey));
  persistedHistoryKeys = new Set(events.map(eventKey));
  const visible = events.filter(belongsToAccount);
  // History reads, snapshots and exports contain only verified disk records.
  // Pending identities still reserve their place so a redelivery cannot enqueue
  // another append while the first is waiting behind a restore or disk write.
  appState.history = visible.sort((a, b) => historyTime(b) - historyTime(a));
  historyKeys = new Set([...persistedHistoryKeys, ...pendingHistoryEvents.keys()]);
  const committed = appState.history.filter(event => !previousKeys.has(eventKey(event)));
  if (committed.length) broadcast("history", { account: config.kAccount, events: committed });
}

async function fileInfo(file) {
  try {
    const stat = await fsp.stat(file);
    return {
      exists: true,
      bytes: stat.size,
      updatedAt: stat.mtime.toISOString(),
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      return { exists: false, bytes: 0, updatedAt: null };
    }
    throw error;
  }
}

async function readHistoryFile() {
  await historyWrites;
  return readHistoryFileUnlocked();
}

async function readHistoryFileUnlocked() {
  try {
    const text = await fsp.readFile(HISTORY_FILE, "utf8");
    const records = [];
    historyInvalidLines = 0;
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        records.push(parseHistoryEvent(line));
      } catch { historyInvalidLines += 1; }
    }
    return records;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

function parseHistoryEvent(line) {
  const event = JSON.parse(line);
  if (!event || typeof event !== "object" || typeof event.uuid !== "string" || !event.uuid) throw new Error("Invalid event");
  return event;
}

async function prepareHistoryAppendUnlocked() {
  let bytes;
  try { bytes = await fsp.readFile(HISTORY_FILE); } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (!bytes.length || bytes[bytes.length - 1] === 10) return;
  const tailStart = bytes.lastIndexOf(10) + 1;
  try {
    parseHistoryEvent(bytes.subarray(tailStart).toString("utf8"));
  } catch {
    // Only an unterminated invalid suffix is discarded. Earlier lines, including
    // already committed events, keep their original bytes and byte offsets.
    await fsp.truncate(HISTORY_FILE, tailStart);
    return;
  }
  // A complete final JSON record is valid even without LF. Preserve it and add
  // its separator independently, so another partial append cannot join records.
  await appendPrivateFile(HISTORY_FILE, "\n");
}

async function persistHistoryEventsUnlocked(incoming, pendingKey = null) {
  try {
    // The file is authoritative even after an earlier append committed bytes
    // before throwing. All reads, recovery and writes share the history queue.
    const current = await readHistoryFileUnlocked();
    const seen = new Set(current.map(eventKey));
    const added = [];
    for (const event of incoming) {
      const key = eventKey(event);
      if (seen.has(key)) continue;
      seen.add(key);
      added.push(event);
    }
    if (added.length) {
      await prepareHistoryAppendUnlocked();
      await appendPrivateFile(HISTORY_FILE, `${added.map((event) => JSON.stringify(event)).join("\n")}\n`);
    }
    if (pendingKey !== null) pendingHistoryEvents.delete(pendingKey);
    const persisted = await readHistoryFileUnlocked();
    updateHistory(persisted);
    if (added.some((event) => !persistedHistoryKeys.has(eventKey(event)))) {
      throw new Error("Call history append could not be verified");
    }
    return { imported: added.length, duplicates: incoming.length - added.length, total: persisted.length };
  } catch (error) {
    if (pendingKey !== null) pendingHistoryEvents.delete(pendingKey);
    // ENOSPC and other errors can follow a successful prefix (or even a full
    // record). Keep that prefix visible and deduplicate a later retry from disk.
    try { updateHistory(await readHistoryFileUnlocked()); } catch { /* Preserve the original I/O error; the next operation reads disk again. */ }
    throw error;
  }
}

async function storageStatus() {
  const [history, historyRecords] = await Promise.all([
    fileInfo(HISTORY_FILE),
    readHistoryFile(),
  ]);
  return {
    dataDir: "data/",
    retention: "All valid call events are retained in data/call-events.jsonl.",
    skippedInvalidLines: historyInvalidLines,
    files: {
      "call-events.jsonl": {
        ...history,
        records: historyRecords.length,
        sensitive: false,
      },
    },
  };
}

async function createBackup() {
  const callEvents = (await readHistoryFile()).filter(belongsToAccount);
  return {
    schema: "nfon-cti-local-backup-v1",
    exportedAt: new Date().toISOString(),
    app: {
      name: config.appName,
      version: config.appVersion,
      account: config.kAccount,
    },
    storage: await storageStatus(),
    data: {
      callEvents,
    },
  };
}

function eventKey(event) {
  return `${event.account || initialHistoryAccount}:${event.uuid || ""}:${event.state || ""}:${event.updated || event.receivedAt || ""}`;
}

function normalizeBackupEvents(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpError(400, "Invalid backup format");
  }
  if (Object.hasOwn(body, "schema") && body.schema !== "nfon-cti-local-backup-v1") {
    throw httpError(400, "Unsupported backup schema");
  }
  const events = Object.hasOwn(body, "data") ? body.data?.callEvents : body.callEvents;
  if (events === undefined && !Object.hasOwn(body, "data") && !Object.hasOwn(body, "callEvents")) return [];
  if (!Array.isArray(events)) throw httpError(400, "Invalid backup format");
  // Validate every record before appending anything; keep legacy schema-free backups valid.
  if (events.some((event) => !event || typeof event !== "object" || Array.isArray(event) ||
      typeof event.uuid !== "string" || !event.uuid.trim())) {
    throw httpError(400, "Backup contains an invalid call event");
  }
  return events;
}

async function importBackup(body) {
  if (body?.app?.account && body.app.account !== config.kAccount) throw httpError(409, "Backup belongs to a different NFON account");
  const incoming = normalizeBackupEvents(body).map((event) => config.kAccount && !event.account ? { ...event, account: config.kAccount } : event);
  if (incoming.some((event) => event.account && event.account !== config.kAccount)) throw httpError(409, "Backup belongs to a different NFON account");
  if (!incoming.length) {
    throw httpError(400, "Backup contains no call events");
  }

  const result = await queueHistoryWrite(() => persistHistoryEventsUnlocked(incoming));

  if (result.imported) {
    broadcast("snapshot", {
      status: publicStatus(),
      activeCalls: serializeActiveCalls(),
      history: appState.history,
    });
  }

  return result;
}

async function loadGoogleState() {
  await ensureDataDir();
  try {
    const token = JSON.parse(await fsp.readFile(GOOGLE_TOKEN_FILE, "utf8"));
    appState.google.accessToken = token.access_token || "";
    appState.google.refreshToken = token.refresh_token || "";
    appState.google.expiresAt = token.expires_at || 0;
    appState.google.connected = Boolean(appState.google.refreshToken);
  } catch (error) {
    if (error.code !== "ENOENT") {
      appState.google.lastError = "Could not read Google token";
    }
  }

  try {
    const cache = JSON.parse(await fsp.readFile(GOOGLE_CONTACTS_FILE, "utf8"));
    appState.google.contacts = Array.isArray(cache.contacts) ? cache.contacts : [];
    appState.google.lastSyncAt = cache.syncedAt || null;
  } catch (error) {
    if (error.code !== "ENOENT") {
      appState.google.lastError = "Could not read Google contacts";
    }
  }
}

async function loadLocalContacts() {
  await ensureDataDir();
  try {
    const cache = JSON.parse(await fsp.readFile(LOCAL_CONTACTS_FILE, "utf8"));
    appState.localContacts = Array.isArray(cache.contacts) ? cache.contacts.map(normalizeLocalContact).filter(Boolean) : [];
  } catch (error) {
    if (error.code !== "ENOENT") {
      appState.google.lastError = "Could not read local contacts";
    }
  }
}

async function saveLocalContacts() {
  contactsRevision += 1;
  await writePrivateJson(LOCAL_CONTACTS_FILE, {
    updatedAt: new Date().toISOString(),
    contacts: appState.localContacts,
  });
  broadcast("status", { status: publicStatus() });
}

function normalizeLocalContact(contact) {
  const phones = (contact.phones || [{ value: contact.phone || "" }]).map((phone) => ({
    value: phone.value || "",
    canonical: phone.canonical || phone.value || "",
    normalized: normalizePhone(phone.canonical || phone.value),
  })).filter((phone) => phone.normalized);
  const image = decodePhotoData(String(contact.photoData || ""));
  const photoData = image ? `data:${image.mime};base64,${image.buffer.toString("base64")}` : "";
  const photoMime = image?.mime || "";
  if (!String(contact.name || "").trim() || !phones.length) return null;
  return {
    id: String(contact.id || `local-${crypto.randomUUID()}`),
    source: "local",
    name: String(contact.name || "").trim(),
    organization: String(contact.organization || "").trim(),
    phones,
    photoData: photoData.startsWith("data:") ? photoData : "",
    photoMime,
  };
}

async function createLocalContact(payload) {
  if (payload.photoData && !decodePhotoData(String(payload.photoData))) throw httpError(400, "Contact photo must be a PNG, JPEG or WebP image");
  const contact = normalizeLocalContact({
    id: `local-${crypto.randomUUID()}`,
    name: payload.name,
    organization: payload.organization,
    phones: [{ value: payload.phone }],
    photoData: payload.photoData,
    photoMime: payload.photoMime,
  });
  if (!contact) {
    const error = new Error("Name and phone number are required");
    error.statusCode = 400;
    throw error;
  }
  appState.localContacts = [contact, ...appState.localContacts];
  await saveLocalContacts();
  return contact;
}

async function deleteLocalContact(contactId) {
  const before = appState.localContacts.length;
  appState.localContacts = appState.localContacts.filter((contact) => contact.id !== contactId);
  if (appState.localContacts.length === before) {
    const error = new Error("Local contact not found");
    error.statusCode = 404;
    throw error;
  }
  await saveLocalContacts();
}

async function saveGoogleToken(token, generation = googleGeneration) {
  await writeGoogleState(generation, async () => {
    const next = {
      access_token: token.access_token || appState.google.accessToken,
      refresh_token: token.refresh_token || appState.google.refreshToken,
      expires_at: Date.now() + Math.max(30, Number(token.expires_in || 3600) - 60) * 1000,
    };
    await writePrivateJson(GOOGLE_TOKEN_FILE, next);
    assertGoogleGeneration(generation);
    appState.google.accessToken = next.access_token;
    appState.google.refreshToken = next.refresh_token;
    appState.google.expiresAt = next.expires_at;
    appState.google.connected = Boolean(next.refresh_token);
  });
}

async function disconnectGoogle() {
  const generation = ++googleGeneration;
  googleRefresh = null;
  contactsRevision += 1;
  const token = appState.google.refreshToken || appState.google.accessToken;
  Object.assign(appState.google, { accessToken: "", refreshToken: "", expiresAt: 0,
    connected: false, contacts: [], lastSyncAt: null, lastError: null });
  // Serialize removal after any already-started write; stale pending operations cannot recreate it.
  await writeGoogleState(generation, () => Promise.all([
    fsp.rm(GOOGLE_TOKEN_FILE, { force: true }),
    fsp.rm(GOOGLE_CONTACTS_FILE, { force: true }),
    fsp.rm(GOOGLE_OAUTH_STATE_FILE, { force: true }),
  ]));
  broadcast("status", { status: publicStatus() });
  let revocationFailed = false;
  try { if (token) {
    const response = await fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST", signal: AbortSignal.timeout(10000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
    });
    if (!response.ok && response.status !== 400) revocationFailed = true;
  } } catch { revocationFailed = true; }
  if (generation === googleGeneration) {
    appState.google.lastError = revocationFailed ? "Google token revocation failed" : null;
    broadcast("status", { status: publicStatus() });
  }
}

async function getGoogleAccessToken(generation = googleGeneration) {
  assertGoogleGeneration(generation);
  if (!appState.google.refreshToken) throw new Error("Google Contacts is not connected");
  if (appState.google.accessToken && appState.google.expiresAt - Date.now() > 45_000) return appState.google.accessToken;
  if (googleRefresh) return googleRefresh;
  const refreshToken = appState.google.refreshToken;
  const pending = (async () => {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: config.googleClientId, client_secret: config.googleClientSecret,
        refresh_token: refreshToken, grant_type: "refresh_token" }),
    });
    const body = await readResponseBody(response);
    assertGoogleGeneration(generation);
    if (!response.ok) throw new Error(`Could not refresh Google token${formatApiError(body)}`);
    await saveGoogleToken({ ...body, refresh_token: refreshToken }, generation);
    assertGoogleGeneration(generation);
    return appState.google.accessToken;
  })();
  googleRefresh = pending;
  try { return await pending; }
  finally { if (googleRefresh === pending) googleRefresh = null; }
}

function googlePresentation(values, origin = config.googleRedirectUri) {
  const theme = values.get("theme");
  const lang = values.get("lang");
  let cockpit = "";
  try {
    const target = new URL(values.get("cockpit"));
    const current = new URL(origin);
    const loopback = (host) => ["localhost", "127.0.0.1", "[::1]"].includes(host);
    if (["http:", "https:"].includes(target.protocol) && !target.username && !target.password &&
        (target.origin === current.origin || (loopback(target.hostname) && loopback(current.hostname)))) {
      target.hash = "";
      cockpit = target.href;
    }
  } catch { /* Invalid or unrelated cockpit links are not carried through OAuth. */ }
  return {
    ...(cockpit ? { cockpit } : {}),
    ...(["classic", "admin-portal"].includes(theme) ? { theme } : {}),
    ...(["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "cs"].includes(lang) ? { lang } : {}),
  };
}

function googleReturnPath(preferences, outcome) {
  return "/?" + new URLSearchParams({ google: outcome, ...googlePresentation(new URLSearchParams(preferences)) });
}

async function googleAuthUrl(preferences = new URLSearchParams(), origin = config.googleRedirectUri) {
  const generation = googleGeneration;
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error("Google OAuth credentials are missing");
  }
  const state = crypto.randomBytes(18).toString("base64url");
  await writeGoogleState(generation, () => writePrivateJson(GOOGLE_OAUTH_STATE_FILE, {
    state,
    ...googlePresentation(preferences, origin),
    createdAt: new Date().toISOString(),
  }));
  assertGoogleGeneration(generation);
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.searchParams.set("client_id", config.googleClientId);
  url.searchParams.set("redirect_uri", config.googleRedirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GOOGLE_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("include_granted_scopes", "true");
  return url.toString();
}

async function handleGoogleCallback(url) {
  const generation = googleGeneration;
  const code = url.searchParams.get("code");
  const storedState = safeReadJson(GOOGLE_OAUTH_STATE_FILE, null);
  const returnedState = url.searchParams.get("state");
  const age = Date.now() - Date.parse(storedState?.createdAt || "");
  if (!storedState?.state || !returnedState || consumedGoogleStates.has(returnedState) || storedState.state !== returnedState || !Number.isFinite(age) || age < 0 || age > 10 * 60_000) {
    throw new Error("Google OAuth state is invalid or expired");
  }
  consumedGoogleStates.add(returnedState);
  setTimeout(() => consumedGoogleStates.delete(returnedState), 10 * 60_000).unref();
  // Consume state before network access, including denied consent. A callback is one use.
  await fsp.rm(GOOGLE_OAUTH_STATE_FILE, { force: true });
  const preferences = googlePresentation(new URLSearchParams(storedState));
  try {
    if (!code) throw new Error("Google sign-in returned no code");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: config.googleClientId,
        client_secret: config.googleClientSecret,
        redirect_uri: config.googleRedirectUri,
        grant_type: "authorization_code",
      }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(`Google sign-in failed${formatApiError(body)}`);
    }
    assertGoogleGeneration(generation);
    await saveGoogleToken(body, generation);
    await syncGoogleContacts(generation);
    return preferences;
  } catch (error) { error.presentation = preferences; throw error; }
}

function normalizePhone(value) {
  return phoneNumbers.lookup(value, { countryCode: config.phoneCountryCode, nationalPrefix: config.phoneNationalPrefix });
}

function contactDisplayName(person) {
  return person.names?.[0]?.displayName || person.emailAddresses?.[0]?.value || "Unknown contact";
}

function serializeGoogleContact(person, index) {
  const phones = (person.phoneNumbers || []).map((phone) => ({
    value: phone.value || "",
    canonical: phone.canonicalForm || "",
    normalized: normalizePhone(phone.canonicalForm || phone.value),
  })).filter((phone) => phone.normalized);
  const organization = person.organizations?.[0]?.name || "";
  const photoUrl = person.photos?.find((photo) => photo.url)?.url || "";
  return {
    id: Buffer.from(person.resourceName || String(index)).toString("base64url"),
    resourceName: person.resourceName || "",
    name: contactDisplayName(person),
    organization,
    phones,
    photoUrl,
  };
}

async function syncGoogleContacts(generation = googleGeneration) {
  try {
    const accessToken = await getGoogleAccessToken(generation);
    const contacts = [];
    let pageToken = "";
    do {
      const url = new URL("https://people.googleapis.com/v1/people/me/connections");
      url.searchParams.set("pageSize", "1000");
      url.searchParams.set("personFields", "names,phoneNumbers,photos,organizations,emailAddresses");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await fetch(url, {
        signal: AbortSignal.timeout(15000),
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${accessToken}`,
        },
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        throw new Error(`Could not read Google contacts${formatApiError(body)}`);
      }
      assertGoogleGeneration(generation);
      contacts.push(...(body.connections || []).map((person, index) => serializeGoogleContact(person, contacts.length + index)));
      pageToken = body.nextPageToken || "";
    } while (pageToken);

    await writeGoogleState(generation, async () => {
      const syncedAt = new Date().toISOString();
      const nextContacts = contacts.filter((contact) => contact.phones.length);
      await writePrivateJson(GOOGLE_CONTACTS_FILE, { syncedAt, contacts: nextContacts });
      assertGoogleGeneration(generation);
      contactsRevision += 1;
      appState.google.contacts = nextContacts;
      appState.google.lastSyncAt = syncedAt;
      appState.google.lastError = null;
    });
    broadcast("status", { status: publicStatus() });
    return appState.google.contacts;
  } catch (error) {
    if (generation === googleGeneration) appState.google.lastError = error.message;
    throw error;
  }
}

function findContactByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  const contact = allContacts().find((item) => item.phones.some((entry) => normalizePhone(entry.canonical || entry.value || entry.normalized) === normalized));
  if (!contact) return null;
  return { id: contact.id, name: contact.name, organization: contact.organization, phones: contact.phones, source: contact.source, hasPhoto: Boolean(contact.photoUrl || contact.photoData) };
}

function imageMime(buffer) {
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return "image/png";
  if (buffer.length > 3 && buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255) return "image/jpeg";
  if (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return "";
}

function decodePhotoData(data) {
  const match = data.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!match || data.length > 900000) return null;
  const buffer = Buffer.from(match[2], "base64");
  const mime = imageMime(buffer);
  return mime === match[1] ? { buffer, mime } : null;
}

async function sendContactPhoto(req, res, contactId) {
  const local = appState.localContacts.find((item) => item.id === contactId);
  let image = local ? decodePhotoData(local.photoData) : null;
  if (!local) {
    const contact = appState.google.contacts.find((item) => item.id === contactId);
    if (!contact?.photoUrl) throw httpError(404, "Contact photo not found");
    let target;
    try { target = new URL(contact.photoUrl); } catch { throw httpError(502, "Contact photo could not be loaded"); }
    if (target.protocol !== "https:" || !/^(?:lh[0-9]+\.googleusercontent\.com|people-pa\.googleapis\.com)$/.test(target.hostname) || target.username || target.password) {
      throw httpError(502, "Contact photo could not be loaded");
    }
    // Google photo URLs are public URLs. Never forward OAuth bearer tokens to image hosts.
    const response = await fetch(target, { redirect: "error", signal: AbortSignal.timeout(10000) });
    if (!response.ok || Number(response.headers.get("content-length")) > 1024 * 1024) throw httpError(502, "Contact photo could not be loaded");
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 1024 * 1024) throw httpError(502, "Contact photo could not be loaded");
      chunks.push(Buffer.from(chunk));
    }
    const buffer = Buffer.concat(chunks);
    const mime = imageMime(buffer);
    if (mime) image = { buffer, mime };
  }
  if (!image) throw httpError(404, "Contact photo not found");
  res.writeHead(200, corsHeaders(req, {
    "Content-Type": image.mime, "X-Content-Type-Options": "nosniff",
    "Cache-Control": "private, max-age=3600", "Content-Length": image.buffer.length,
  }));
  res.end(image.buffer);
}

function broadcast(type, payload = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

function eventSnapshot() {
  return {
    type: "snapshot",
    status: publicStatus(),
    extensions: appState.extensions,
    states: serializeStates(),
    activeCalls: serializeActiveCalls(),
    history: appState.history,
  };
}

function sendInitialEvents(res) {
  res.write(`event: snapshot\ndata: ${JSON.stringify(eventSnapshot())}\n\n`);
}

function parseStreamPayload(payload, handler) {
  const trimmed = payload.trim();
  if (!trimmed) return;
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      parsed.forEach(handler);
    } else {
      handler(parsed);
    }
  } catch {
    const matches = trimmed.match(/\{[^]*?\}(?=\s*\{|\s*$)/g) || [];
    for (const item of matches) {
      try {
        handler(JSON.parse(item));
      } catch {
        // Ignore malformed partial stream chunks.
      }
    }
  }
}

async function readEventStream(response, handler) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventLines = [];

  function emit(lines) {
    if (!lines.length) return;
    const data = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (data) {
      parseStreamPayload(data, handler);
      return;
    }
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
        parseStreamPayload(trimmed, handler);
      }
    }
  }

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) {
        emit(eventLines);
        eventLines = [];
      } else if (!line.startsWith(":")) {
        eventLines.push(line);
      }
    }
  }
  if (buffer.trim()) {
    eventLines.push(buffer);
  }
  emit(eventLines);
}

function startNfonStream(name, apiPath, handler) {
  let stopped = false;
  let controller;
  let timer;
  let failures = 0;
  const generation = accountGeneration;
  async function connect() {
    if (stopped || generation !== accountGeneration) return;
    controller = new AbortController();
    let connectedAt = 0;
    // Only time out the initial connection. Interrupting healthy streams periodically loses hangups.
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await nfonFetch(apiPath, { signal: controller.signal, headers: { Accept: "text/event-stream" } });
      clearTimeout(timeout);
      if (!response.ok) throw new Error("NFON event stream failed with HTTP " + response.status);
      if (stopped || generation !== accountGeneration) return;
      appState.streams[name].connected = true;
      connectedAt = Date.now();
      appState.streams[name].lastError = null;
      broadcast("status", { status: publicStatus() });
      await readEventStream(response, (event) => {
        if (!stopped && generation === accountGeneration) {
          failures = 0;
          handler(event);
        }
      });
    } catch (error) {
      if (!stopped && generation === accountGeneration) appState.streams[name].lastError = error.message;
    } finally {
      clearTimeout(timeout);
      if (!stopped && generation === accountGeneration) {
        appState.streams[name].connected = false;
        // Calls cannot remain authoritative across a gap in the event stream.
        if (name === "calls") {
          appState.activeCalls.clear();
          broadcast("call-cancelled", { activeCalls: [] });
        }
        broadcast("status", { status: publicStatus() });
        if (connectedAt && Date.now() - connectedAt >= 30000) failures = 0;
        failures = Math.min(failures + 1, 6);
        const retryDelay = Math.min(30000, 1500 * 2 ** (failures - 1));
        timer = setTimeout(connect, Math.max(retryDelay, tokens.nextAttemptAt - Date.now()));
      }
    }
  }
  connect();
  return () => { stopped = true; clearTimeout(timer); controller?.abort(); };
}

function restartStreams() {
  stopStreams();
  for (const name of ["calls", "states"]) appState.streams[name] = { connected: false, lastError: null, lastEventAt: null };
  if (!config.username || !config.password) return;
  const generation = accountGeneration;
  let stopped = false;
  let timer;
  const pending = new Set([fetchExtensions, fetchStateSnapshot]);
  async function bootstrapSnapshot() {
    if (stopped || generation !== accountGeneration) return;
    await Promise.all([...pending].map(async (fetchPart) => {
      try { await fetchPart(); pending.delete(fetchPart); } catch { /* Retried below. */ }
    }));
    if (!stopped && generation === accountGeneration && pending.size) {
      timer = setTimeout(bootstrapSnapshot, Math.max(3000, tokens.nextAttemptAt - Date.now()));
    }
  }
  const stops = [
    startNfonStream("states", "/extensions/phone/states", handleStateEvent),
    startNfonStream("calls", "/extensions/phone/calls", handleCallEvent),
  ];
  stopStreams = () => { stopped = true; clearTimeout(timer); stops.forEach((stop) => stop()); };
  bootstrapSnapshot();
}

function normalizeDialTarget(value, context) {
  const target = phoneNumbers.target(value, { context: context === "global" ? "global" : "internal" });
  if (!target) throw httpError(400, "Use a valid international number (+ or 00) or an extension of 1–6 digits");
  return target.number;
}

function chooseCalleeContext(value) {
  return phoneNumbers.target(value)?.context === "internal" ? config.kAccount : "global";
}

async function startCall(payload) {
  const generation = accountGeneration;
  const caller = String(payload.caller || payload.extension || "").trim();
  const calleeContext = payload.callee_context || chooseCalleeContext(payload.callee);
  const callee = normalizeDialTarget(payload.callee, calleeContext);
  if (!caller || !callee) {
    throw new Error("Caller and callee are required");
  }

  const body = {
    caller,
    caller_context: payload.caller_context || config.kAccount,
    callee,
    callee_context: calleeContext,
    extension: payload.extension || caller,
  };

  if (payload.timeout !== undefined && payload.timeout !== "") {
    const timeout = ["string", "number"].includes(typeof payload.timeout) ? Number(payload.timeout) : NaN;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) throw httpError(400, "Call timeout must be a whole number between 1 and 120 seconds");
    body.timeout = timeout;
  }

  for (const [key, startedAt] of pendingDials) if (Date.now() - startedAt > 2000) pendingDials.delete(key);
  const dialKey = JSON.stringify(body);
  const recent = pendingDials.get(dialKey);
  if (recent && Date.now() - recent < 2000) throw httpError(409, "A call to this number is already being started");
  pendingDials.set(dialKey, Infinity);
  let response;
  try { response = await nfonFetch("/extensions/phone/calls", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  } catch (error) { if (generation === accountGeneration) pendingDials.delete(dialKey); throw error; }
  let result;
  try { result = await readResponseBody(response); } finally { if (generation === accountGeneration) pendingDials.set(dialKey, Date.now()); }
  if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
  if (!response.ok && response.status !== 202) {
    pendingDials.delete(dialKey);
    throw httpError(response.status === 403 ? 403 : 502, `Call request failed with HTTP ${response.status}${formatApiError(result)}`);
  }
  if (result?.uuid) {
    handleCallEvent(result, "click-to-dial");
    setTimeout(() => {
      if (generation !== accountGeneration) return;
      const call = appState.activeCalls.get(result.uuid);
      if (call?.source === "click-to-dial") {
        appState.activeCalls.delete(result.uuid);
        broadcast("call-cancelled", { activeCalls: serializeActiveCalls() });
      }
    }, (Number(body.timeout) || 120) * 1000).unref();
  }
  return result;
}

async function cancelCall(uuid) {
  const generation = accountGeneration;
  if (!appState.activeCalls.has(uuid)) throw httpError(404, "Call is no longer active");
  const response = await nfonFetch(`/extensions/phone/calls/${encodeURIComponent(uuid)}`, {
    method: "DELETE",
  });
  if (generation !== accountGeneration) throw httpError(409, "NFON account changed; retry the request");
  if (response.status === 404) {
    appState.activeCalls.delete(uuid);
    broadcast("call-cancelled", { activeCalls: serializeActiveCalls() });
    throw httpError(404, "Call is no longer active");
  }
  if (response.status !== 204 && !response.ok) {
    const body = await readResponseBody(response);
    throw httpError(response.status === 403 ? 403 : 502, `Cancel request failed with HTTP ${response.status}${formatApiError(body)}`);
  }
  appState.activeCalls.delete(uuid);
  broadcast("call-cancelled", { uuid, activeCalls: serializeActiveCalls() });
}

async function handleApi(req, res, url) {
  try {
    if (req.method === "OPTIONS") {
      assertAllowedOrigin(req);
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    assertAllowedOrigin(req);
    if (req.method === "GET" && url.pathname === "/api/status") {
      sendJson(req, res, 200, publicStatus({ includePrivate: canReadPrivate(req) }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/settings/browser-login") {
      requireControlAccess(req);
      await applyBrowserLoginSettings(await readJsonRequest(req));
      broadcast("status", { status: publicStatus() });
      sendJson(req, res, 200, { ok: true, status: publicStatus() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/storage") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, await storageStatus());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/storage/backup") {
      requirePrivateReadAccess(req);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      sendJsonDownload(req, res, `nfon-cti-backup-${stamp}.json`, await createBackup());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/storage/restore") {
      requireControlAccess(req);
      sendJson(req, res, 200, await importBackup(await readJsonRequest(req, { limit: RESTORE_JSON_LIMIT })));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/google/status") {
      sendJson(req, res, 200, googlePublicStatus());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/google/contacts") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, { status: googlePublicStatus(), contacts: publicGoogleContacts() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/local-contacts") {
      requireControlAccess(req);
      sendJson(req, res, 201, { contact: await createLocalContact(await readJsonRequest(req)), status: googlePublicStatus(), contacts: publicGoogleContacts() });
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/local-contacts/")) {
      requireControlAccess(req);
      await deleteLocalContact(decodeURIComponent(url.pathname.replace("/api/local-contacts/", "")));
      sendJson(req, res, 200, { status: googlePublicStatus(), contacts: publicGoogleContacts() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/google/sync") {
      requireControlAccess(req);
      sendJson(req, res, 200, { contacts: (await syncGoogleContacts()).length, status: googlePublicStatus() });
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/google/disconnect") {
      requireControlAccess(req);
      await disconnectGoogle();
      sendJson(req, res, 200, { status: googlePublicStatus() });
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/contacts/lookup") {
      requirePrivateReadAccess(req);
      const contact = findContactByPhone(url.searchParams.get("phone"));
      sendJson(req, res, 200, { contact });
      return;
    }
    if (req.method === "GET" && url.pathname.startsWith("/api/contacts/photo/")) {
      requirePrivateReadAccess(req);
      await sendContactPhoto(req, res, decodeURIComponent(url.pathname.replace("/api/contacts/photo/", "")));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/extensions") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, await fetchExtensions());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/states") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, await fetchStateSnapshot());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/history") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, appState.history);
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/active-calls") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, serializeActiveCalls());
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/calls") {
      requireControlAccess(req);
      sendJson(req, res, 202, await startCall(await readJsonRequest(req)));
      return;
    }
    if (req.method === "DELETE" && url.pathname.startsWith("/api/calls/")) {
      requireControlAccess(req);
      await cancelCall(decodeURIComponent(url.pathname.replace("/api/calls/", "")));
      sendJson(req, res, 204, {});
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/snapshot") {
      requirePrivateReadAccess(req);
      sendJson(req, res, 200, eventSnapshot());
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      requirePrivateReadAccess(req);
      res.writeHead(200, corsHeaders(req, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      }));
      // HTTP/1.1 browsers reserve six connections per origin. Keep two free for UI/API requests.
      if (clients.size >= 4) {
        res.end(`event: polling\ndata: {}\n\n`);
        return;
      }
      clients.add(res);
      sendInitialEvents(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    sendError(req, res, 404, "API route not found");
  } catch (error) {
    sendError(req, res, error.statusCode || 500, error.message);
  }
}

async function handleAuth(req, res, url) {
  try {
    if (!isLoopbackRequest(req)) throw httpError(403, "OAuth requires a local request");
    if (req.method === "GET" && url.pathname === "/auth/google/start") {
      assertAllowedOrigin(req);
      const site = req.headers["sec-fetch-site"];
      if (site && !["same-origin", "same-site", "none"].includes(String(site))) {
        throw httpError(403, "Cross-site OAuth start is blocked");
      }
      res.writeHead(302, { "Location": await googleAuthUrl(url.searchParams, url.origin) });
      res.end();
      return true;
    }
    if (req.method === "GET" && url.pathname === "/auth/google/callback") {
      const preferences = await handleGoogleCallback(url);
      res.writeHead(302, { "Location": googleReturnPath(preferences, "connected") });
      res.end();
      return true;
    }
    return false;
  } catch (error) {
    if (error.statusCode) {
      sendError(req, res, error.statusCode, error.message);
      return true;
    }
    if (error.presentation) {
      res.writeHead(302, { "Location": googleReturnPath(error.presentation, "error"), "Set-Cookie": `cti_google_error=${encodeURIComponent(error.message)}; Path=/; Max-Age=60; SameSite=Lax` });
      res.end();
      return true;
    }
    // Invalid or unsolicited callbacks must not alter the account status.
    const fallback = await readPublicFile(PUBLIC_DIR, path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[".html"],
      "Set-Cookie": `cti_google_error=${encodeURIComponent(error.message)}; Path=/; Max-Age=60; SameSite=Lax`,
    });
    res.end(fallback);
    return true;
  }
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname);
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR + path.sep)) {
    sendError(req, res, 403, "Forbidden");
    return;
  }
  try {
    const data = await readPublicFile(PUBLIC_DIR, filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": staticCacheControl(req.url),
    });
    res.end(req.method === "HEAD" ? undefined : data);
  } catch (error) {
    if (["ENOENT", "EISDIR", "ENOTDIR", "ENAMETOOLONG"].includes(error.code)) {
      sendError(req, res, 404, "Not found");
      return;
    }
    sendError(req, res, error.code === "EACCES" ? 403 : 500, error.code === "EACCES" ? "Forbidden" : "Could not serve the requested file");
  }
}

async function bootstrap() {
  await repairRuntimeFileModes();
  await loadHistory();
  await loadGoogleState();
  await loadLocalContacts();

  const server = http.createServer(async (req, res) => {
    try {
      if (!guardRequest(req, res)) return;
      const url = requestUrl(req);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url);
        return;
      }
      if (url.pathname.startsWith("/auth/") && await handleAuth(req, res, url)) {
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

  server.listen(config.port, config.host, () => {
    console.log(`CTI dashboard running at http://${config.host}:${config.port}`);
    console.log(`NFON account: ${config.kAccount ? "configured" : "not configured"}`);
    restartStreams();
  });

}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
