const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const { URL } = require("url");

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

function loadLocalEnv(appName) {
  const configDir = configuredLocalConfigDir();
  const candidates = [
    resolveMaybeRelative(process.env[`${appName}_ENV_FILE`] || ""),
    path.join(ROOT, ".env"),
    configDir ? path.join(configDir, "env", `${appName}.env`) : "",
  ];
  candidates.find(loadEnvFile);
}

function dataDirForApp(appName, envName) {
  const explicit = resolveMaybeRelative(process.env[envName] || "");
  if (explicit) return explicit;
  const configDir = configuredLocalConfigDir();
  return configDir ? path.join(configDir, "data", appName) : path.join(ROOT, "data");
}

loadLocalEnv(APP_CONFIG_NAME);

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
  const value = process.env[name];
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
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
    appName: process.env.APP_NAME || "cti-dashboard",
    appVersion: process.env.APP_VERSION || "0.1",
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

  return config;
}

const config = readConfig();
const allowedOrigins = new Set([
  ...localhostOriginVariants(`http://localhost:${config.port}`),
  ...localhostOriginVariants(`http://127.0.0.1:${config.port}`),
  ...splitOrigins(config.allowedOrigin).flatMap(localhostOriginVariants),
]);
const userAgent = `${config.appName}/${config.appVersion} (${config.kAccount || "unknown"})`;
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
  constructor() {
    this.accessToken = "";
    this.refreshToken = "";
    this.accessExpiresAt = 0;
    this.refreshPromise = null;
  }

  async getAccessToken() {
    const now = Date.now();
    if (this.accessToken && this.accessExpiresAt - now > 45_000) {
      return this.accessToken;
    }
    if (this.refreshToken) {
      await this.refresh();
      return this.accessToken;
    }
    await this.login();
    return this.accessToken;
  }

  async login() {
    if (!config.username || !config.password) {
      throw new Error("NFON credentials are missing");
    }
    const response = await fetch(`${config.baseUrl}/login`, {
      method: "POST",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json",
        "User-Agent": userAgent,
      },
      body: JSON.stringify({
        username: config.username,
        password: config.password,
      }),
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(`NFON login failed with HTTP ${response.status}${formatApiError(body)}`);
    }
    this.setTokens(body);
  }

  async refresh() {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = (async () => {
      const response = await fetch(`${config.baseUrl}/login`, {
        method: "PUT",
        headers: {
          "Accept": "application/json",
          "Authorization": `Bearer ${this.refreshToken}`,
          "User-Agent": userAgent,
        },
      });
      const body = await readResponseBody(response);
      if (!response.ok) {
        this.accessToken = "";
        this.refreshToken = "";
        this.accessExpiresAt = 0;
        await this.login();
        return;
      }
      this.setTokens(body);
    })();

    try {
      await this.refreshPromise;
    } finally {
      this.refreshPromise = null;
    }
  }

  setTokens(body) {
    this.accessToken = body?.["access-token"] || "";
    this.refreshToken = body?.["refresh-token"] || "";
    this.accessExpiresAt = decodeJwtExp(this.accessToken) || Date.now() + 4 * 60_000;
    if (!this.accessToken) {
      throw new Error("NFON login did not return an access token");
    }
  }

  reset() {
    this.accessToken = "";
    this.refreshToken = "";
    this.accessExpiresAt = 0;
    this.refreshPromise = null;
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

async function nfonFetch(apiPath, options = {}, retry = true) {
  const accessToken = await tokens.getAccessToken();
  const response = await fetch(`${config.baseUrl}${apiPath}`, {
    ...options,
    headers: {
      "Accept": "application/json",
      "Authorization": `Bearer ${accessToken}`,
      "User-Agent": userAgent,
      ...(options.headers || {}),
    },
  });

  if (response.status === 401 && retry) {
    await tokens.refresh();
    return nfonFetch(apiPath, options, false);
  }

  return response;
}

function sendJson(req, res, status, body) {
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
    app: config.appName,
    appVersion: config.appVersion,
    credentialsConfigured: Boolean(config.username && config.password),
    extensions: appState.extensions.length,
    states: appState.states.size,
    activeCalls: appState.activeCalls.size,
    history: appState.history.length,
    google: googlePublicStatus(),
    streams: appState.streams,
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

function applyBrowserLoginSettings(payload) {
  const next = {
    kAccount: String(payload.kAccount || "").trim(),
    username: String(payload.username || "").trim(),
    password: String(payload.password || ""),
    googleClientId: String(payload.googleClientId || "").trim(),
    googleClientSecret: String(payload.googleClientSecret || ""),
    googleRedirectUri: String(payload.googleRedirectUri || "").trim(),
  };
  if (!next.kAccount || !next.username || !next.password) {
    const error = new Error("K-Account, API Username und API Password sind erforderlich");
    error.statusCode = 400;
    throw error;
  }
  config.kAccount = next.kAccount;
  config.username = next.username;
  config.password = next.password;
  if (next.googleClientId || next.googleClientSecret || next.googleRedirectUri) {
    config.googleClientId = next.googleClientId;
    config.googleClientSecret = next.googleClientSecret;
    config.googleRedirectUri = next.googleRedirectUri || config.googleRedirectUri;
  }
  tokens.reset();
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
  const response = await nfonFetch("/extensions/phone/data");
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`Extension request failed with HTTP ${response.status}${formatApiError(body)}`);
  }
  appState.extensions = sortExtensions(Array.isArray(body) ? body : []);
  broadcast("extensions", { extensions: appState.extensions });
  return appState.extensions;
}

async function fetchStateSnapshot() {
  const response = await nfonFetch("/extensions/phone/states", {
    headers: { "Accept": "application/json" },
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`State request failed with HTTP ${response.status}${formatApiError(body)}`);
  }
  if (Array.isArray(body)) {
    for (const state of body) {
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
  appState.streams.states.lastEventAt = enriched.receivedAt;
  if (shouldBroadcast) {
    broadcast("state", { state: enriched, states: serializeStates() });
  }
}

async function appendHistory(event) {
  await appendPrivateFile(HISTORY_FILE, `${JSON.stringify(event)}\n`);
}

function handleCallEvent(call, source = "stream") {
  if (!call || !call.uuid) return;
  const event = {
    ...call,
    source,
    receivedAt: new Date().toISOString(),
  };

  appState.history.unshift(event);
  appState.history = appState.history.slice(0, 1000);
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
    history: appState.history.slice(0, 1000),
  });
}

async function loadHistory() {
  try {
    const text = await fsp.readFile(HISTORY_FILE, "utf8");
    appState.history = text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .reverse()
      .slice(0, 1000);
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not load history:", error.message);
    }
  }
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
  try {
    const text = await fsp.readFile(HISTORY_FILE, "utf8");
    return text
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === "ENOENT") return [];
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
    retention: "Call events are kept in memory up to 1000 entries and appended to data/call-events.jsonl.",
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
  const callEvents = await readHistoryFile();
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
  return `${event.uuid || ""}:${event.state || ""}:${event.updated || event.receivedAt || ""}`;
}

function normalizeBackupEvents(body) {
  const events = Array.isArray(body?.data?.callEvents)
    ? body.data.callEvents
    : Array.isArray(body?.callEvents) ? body.callEvents : [];
  return events.filter((event) => event && typeof event === "object" && event.uuid);
}

async function importBackup(body) {
  const incoming = normalizeBackupEvents(body);
  if (!incoming.length) {
    throw new Error("Backup enthaelt keine Call-Events");
  }

  const current = await readHistoryFile();
  const seen = new Set(current.map(eventKey));
  const added = [];

  for (const event of incoming) {
    const key = eventKey(event);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    added.push(event);
  }

  if (added.length) {
    await appendPrivateFile(HISTORY_FILE, `${added.map((event) => JSON.stringify(event)).join("\n")}\n`);
    await loadHistory();
    broadcast("call", {
      activeCalls: serializeActiveCalls(),
      history: appState.history.slice(0, 1000),
    });
  }

  return {
    imported: added.length,
    duplicates: incoming.length - added.length,
    total: current.length + added.length,
  };
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
      appState.google.lastError = "Google Token konnte nicht gelesen werden";
    }
  }

  try {
    const cache = JSON.parse(await fsp.readFile(GOOGLE_CONTACTS_FILE, "utf8"));
    appState.google.contacts = Array.isArray(cache.contacts) ? cache.contacts : [];
    appState.google.lastSyncAt = cache.syncedAt || null;
  } catch (error) {
    if (error.code !== "ENOENT") {
      appState.google.lastError = "Google Kontakte konnten nicht gelesen werden";
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
      appState.google.lastError = "Lokale Kontakte konnten nicht gelesen werden";
    }
  }
}

async function saveLocalContacts() {
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
  const photoData = String(contact.photoData || "");
  const photoMime = String(contact.photoMime || "image/jpeg");
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
  const contact = normalizeLocalContact({
    id: `local-${crypto.randomUUID()}`,
    name: payload.name,
    organization: payload.organization,
    phones: [{ value: payload.phone }],
    photoData: payload.photoData,
    photoMime: payload.photoMime,
  });
  if (!contact) {
    const error = new Error("Name und Telefonnummer sind erforderlich");
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
    const error = new Error("Lokaler Kontakt wurde nicht gefunden");
    error.statusCode = 404;
    throw error;
  }
  await saveLocalContacts();
}

async function saveGoogleToken(token) {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  const next = {
    access_token: token.access_token || appState.google.accessToken,
    refresh_token: token.refresh_token || appState.google.refreshToken,
    expires_at: Date.now() + Math.max(30, Number(token.expires_in || 3600) - 60) * 1000,
  };
  appState.google.accessToken = next.access_token;
  appState.google.refreshToken = next.refresh_token;
  appState.google.expiresAt = next.expires_at;
  appState.google.connected = Boolean(next.refresh_token);
  await writePrivateJson(GOOGLE_TOKEN_FILE, next);
}

async function disconnectGoogle() {
  appState.google.accessToken = "";
  appState.google.refreshToken = "";
  appState.google.expiresAt = 0;
  appState.google.connected = false;
  appState.google.contacts = [];
  appState.google.lastSyncAt = null;
  appState.google.lastError = null;
  await Promise.allSettled([
    fsp.rm(GOOGLE_TOKEN_FILE, { force: true }),
    fsp.rm(GOOGLE_CONTACTS_FILE, { force: true }),
  ]);
  broadcast("status", { status: publicStatus() });
}

async function getGoogleAccessToken() {
  if (!appState.google.refreshToken) {
    throw new Error("Google Contacts ist noch nicht verbunden");
  }
  if (appState.google.accessToken && appState.google.expiresAt - Date.now() > 45_000) {
    return appState.google.accessToken;
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      refresh_token: appState.google.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await readResponseBody(response);
  if (!response.ok) {
    throw new Error(`Google Token konnte nicht erneuert werden${formatApiError(body)}`);
  }
  await saveGoogleToken({ ...body, refresh_token: appState.google.refreshToken });
  return appState.google.accessToken;
}

async function googleAuthUrl() {
  if (!config.googleClientId || !config.googleClientSecret) {
    throw new Error("Google OAuth Zugangsdaten fehlen");
  }
  const state = crypto.randomBytes(18).toString("base64url");
  await writePrivateJson(GOOGLE_OAUTH_STATE_FILE, {
    state,
    createdAt: new Date().toISOString(),
  });
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
  const code = url.searchParams.get("code");
  if (!code) {
    throw new Error(url.searchParams.get("error") || "Google Login ohne Code");
  }
  const storedState = safeReadJson(GOOGLE_OAUTH_STATE_FILE, null);
  const returnedState = url.searchParams.get("state");
  if (!storedState?.state || !returnedState || storedState.state !== returnedState) {
    throw new Error("Google OAuth State ist ungueltig oder abgelaufen");
  }
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
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
    throw new Error(`Google Login fehlgeschlagen${formatApiError(body)}`);
  }
  await saveGoogleToken(body);
  await fsp.rm(GOOGLE_OAUTH_STATE_FILE, { force: true });
  await syncGoogleContacts();
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  return digits;
}

function contactDisplayName(person) {
  return person.names?.[0]?.displayName || person.emailAddresses?.[0]?.value || "Unbekannter Kontakt";
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

async function syncGoogleContacts() {
  const accessToken = await getGoogleAccessToken();
  const contacts = [];
  let pageToken = "";
  do {
    const url = new URL("https://people.googleapis.com/v1/people/me/connections");
    url.searchParams.set("pageSize", "1000");
    url.searchParams.set("personFields", "names,phoneNumbers,photos,organizations,emailAddresses");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: {
        "Accept": "application/json",
        "Authorization": `Bearer ${accessToken}`,
      },
    });
    const body = await readResponseBody(response);
    if (!response.ok) {
      throw new Error(`Google Kontakte konnten nicht gelesen werden${formatApiError(body)}`);
    }
    contacts.push(...(body.connections || []).map((person, index) => serializeGoogleContact(person, contacts.length + index)));
    pageToken = body.nextPageToken || "";
  } while (pageToken);

  appState.google.contacts = contacts.filter((contact) => contact.phones.length);
  appState.google.lastSyncAt = new Date().toISOString();
  appState.google.lastError = null;
  await writePrivateJson(GOOGLE_CONTACTS_FILE, {
    syncedAt: appState.google.lastSyncAt,
    contacts: appState.google.contacts,
  });
  broadcast("status", { status: publicStatus() });
  return appState.google.contacts;
}

function findContactByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return allContacts().find((contact) => (
    contact.phones.some((entry) => entry.normalized === normalized || entry.normalized.endsWith(normalized) || normalized.endsWith(entry.normalized))
  )) || null;
}

async function sendContactPhoto(req, res, contactId) {
  const localContact = appState.localContacts.find((item) => item.id === contactId);
  if (localContact?.photoData) {
    const match = localContact.photoData.match(/^data:([^;,]+);base64,(.+)$/);
    if (!match) {
      sendError(req, res, 404, "Contact photo not found");
      return;
    }
    const buffer = Buffer.from(match[2], "base64");
    res.writeHead(200, corsHeaders(req, {
      "Content-Type": match[1] || localContact.photoMime || "image/jpeg",
      "Cache-Control": "private, max-age=3600",
      "Content-Length": buffer.length,
    }));
    res.end(buffer);
    return;
  }

  const contact = appState.google.contacts.find((item) => item.id === contactId);
  if (!contact?.photoUrl) {
    sendError(req, res, 404, "Contact photo not found");
    return;
  }
  // Only proxy Google-hosted photo URLs. The cached photoUrl is treated as
  // untrusted: without this gate a manipulated contact cache could redirect the
  // request to a foreign host and leak the attached Google access token (SSRF).
  let photoTarget;
  try {
    photoTarget = new URL(contact.photoUrl);
  } catch {
    sendError(req, res, 502, "Contact photo could not be loaded");
    return;
  }
  const photoHost = photoTarget.hostname.toLowerCase();
  const isGoogleHost = photoHost === "google.com"
    || photoHost.endsWith(".google.com")
    || photoHost === "googleusercontent.com"
    || photoHost.endsWith(".googleusercontent.com");
  if (photoTarget.protocol !== "https:" || !isGoogleHost) {
    sendError(req, res, 502, "Contact photo could not be loaded");
    return;
  }
  const accessToken = appState.google.refreshToken ? await getGoogleAccessToken() : "";
  const response = await fetch(photoTarget, {
    headers: accessToken ? { "Authorization": `Bearer ${accessToken}` } : {},
  });
  if (!response.ok) {
    sendError(req, res, 502, "Contact photo could not be loaded");
    return;
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  res.writeHead(200, corsHeaders(req, {
    "Content-Type": response.headers.get("content-type") || "image/jpeg",
    "Cache-Control": "private, max-age=3600",
    "Content-Length": buffer.length,
  }));
  res.end(buffer);
}

function broadcast(type, payload = {}) {
  const message = `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
  for (const client of clients) {
    client.write(message);
  }
}

function sendInitialEvents(res) {
  const snapshot = {
    type: "snapshot",
    status: publicStatus(),
    extensions: appState.extensions,
    states: serializeStates(),
    activeCalls: serializeActiveCalls(),
    history: appState.history.slice(0, 1000),
  };
  res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
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

  async function connect() {
    if (stopped) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4 * 60_000);

    try {
      const response = await nfonFetch(apiPath, {
        signal: controller.signal,
        headers: { "Accept": "text/event-stream" },
      });
      if (!response.ok) {
        const body = await readResponseBody(response);
        throw new Error(`HTTP ${response.status}${formatApiError(body)}`);
      }
      appState.streams[name].connected = true;
      appState.streams[name].lastError = null;
      broadcast("status", { status: publicStatus() });
      await readEventStream(response, handler);
    } catch (error) {
      appState.streams[name].connected = false;
      appState.streams[name].lastError = error.name === "AbortError" ? null : error.message;
      broadcast("status", { status: publicStatus() });
    } finally {
      clearTimeout(timeout);
      appState.streams[name].connected = false;
      if (!stopped) {
        setTimeout(connect, 1500);
      }
    }
  }

  connect();
  return () => {
    stopped = true;
  };
}

function normalizeDialTarget(value, context) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (context === "global") {
    let digits = raw.replace(/[^\d]/g, "");
    if (digits.startsWith("00")) digits = digits.slice(2);
    return digits;
  }
  return raw.replace(/\s+/g, "");
}

function chooseCalleeContext(value) {
  const raw = String(value || "").trim();
  const digits = raw.replace(/[^\d]/g, "");
  if (/^\d{2,6}$/.test(raw) && appState.extensions.some((extension) => extension.extension_number === raw)) {
    return config.kAccount;
  }
  if (digits.length <= 6 && !raw.startsWith("+") && !raw.startsWith("00")) {
    return config.kAccount;
  }
  return "global";
}

async function startCall(payload) {
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

  if (payload.timeout) {
    body.timeout = Math.max(1, Math.min(120, Number(payload.timeout)));
  }

  const response = await nfonFetch("/extensions/phone/calls", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const result = await readResponseBody(response);
  if (!response.ok && response.status !== 202) {
    throw new Error(`Call request failed with HTTP ${response.status}${formatApiError(result)}`);
  }
  if (result?.uuid) {
    handleCallEvent(result, "click-to-dial");
  }
  return result;
}

async function cancelCall(uuid) {
  const response = await nfonFetch(`/extensions/phone/calls/${encodeURIComponent(uuid)}`, {
    method: "DELETE",
  });
  if (![204, 404].includes(response.status) && !response.ok) {
    const body = await readResponseBody(response);
    throw new Error(`Cancel request failed with HTTP ${response.status}${formatApiError(body)}`);
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
      applyBrowserLoginSettings(await readJsonRequest(req));
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
      sendJson(req, res, 200, appState.history.slice(0, 1000));
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
    if (req.method === "GET" && url.pathname === "/api/events") {
      requirePrivateReadAccess(req);
      res.writeHead(200, corsHeaders(req, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      }));
      clients.add(res);
      sendInitialEvents(res);
      req.on("close", () => clients.delete(res));
      return;
    }
    sendError(req, res, 404, "API route not found");
  } catch (error) {
    appState.google.lastError = url.pathname.includes("google") || url.pathname.includes("contacts") ? error.message : appState.google.lastError;
    sendError(req, res, error.statusCode || 500, error.message);
  }
}

async function handleAuth(req, res, url) {
  try {
    if (req.method === "GET" && url.pathname === "/auth/google/start") {
      assertAllowedOrigin(req);
      const site = req.headers["sec-fetch-site"];
      if (site && !["same-origin", "same-site", "none"].includes(String(site))) {
        throw httpError(403, "Cross-site OAuth start is blocked");
      }
      res.writeHead(302, { "Location": await googleAuthUrl() });
      res.end();
      return true;
    }
    if (req.method === "GET" && url.pathname === "/auth/google/callback") {
      await handleGoogleCallback(url);
      res.writeHead(302, { "Location": "/?google=connected" });
      res.end();
      return true;
    }
    return false;
  } catch (error) {
    if (error.statusCode) {
      sendError(req, res, error.statusCode, error.message);
      return true;
    }
    appState.google.lastError = error.message;
    const fallback = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[".html"],
      "Set-Cookie": `cti_google_error=${encodeURIComponent(error.message)}; Path=/; Max-Age=60; SameSite=Lax`,
    });
    res.end(fallback);
    return true;
  }
}

async function serveStatic(req, res, url) {
  const requestedPath = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, requestedPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(req, res, 403, "Forbidden");
    return;
  }
  try {
    const data = await fsp.readFile(filePath);
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[path.extname(filePath)] || "application/octet-stream",
    });
    res.end(data);
  } catch (error) {
    if (error.code === "ENOENT") {
      const fallback = await fsp.readFile(path.join(PUBLIC_DIR, "index.html"));
      res.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
      res.end(fallback);
      return;
    }
    sendError(req, res, 500, error.message);
  }
}

async function bootstrap() {
  await repairRuntimeFileModes();
  await loadHistory();
  await loadGoogleState();
  await loadLocalContacts();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
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

  server.listen(config.port, config.host, async () => {
    console.log(`CTI dashboard running at http://${config.host}:${config.port}`);
    console.log(`NFON account: ${config.kAccount ? "configured" : "not configured"}`);
    try {
      await fetchExtensions();
      await fetchStateSnapshot();
      startNfonStream("states", "/extensions/phone/states", handleStateEvent);
      startNfonStream("calls", "/extensions/phone/calls", handleCallEvent);
    } catch (error) {
      console.error(`NFON bootstrap failed: ${error.message}`);
    }
  });
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
