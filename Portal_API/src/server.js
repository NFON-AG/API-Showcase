const http = require("http");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const { URL } = require("url");

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

const DATA_DIR = dataDirForApp(APP_CONFIG_NAME, "PORTAL_DATA_DIR");
const DAYNIGHT_GATEWAY_SNAPSHOT = path.join(DATA_DIR, "daynight-gateway-migration.json");
const DEFAULT_PORT = 3001;
const DEFAULT_JSON_LIMIT = 1024 * 1024;
const UPLOAD_JSON_LIMIT = 5 * 1024 * 1024;
const csrfToken = crypto.randomBytes(32).toString("base64url");

const MIME_TYPES = {
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

function httpError(status, message) {
  const error = new Error(message);
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
  const liveWritesEnabled = envFlag("PORTAL_ENABLE_LIVE_WRITES", false)
    && !envFlag("PORTAL_DISABLE_LIVE_WRITES", false);
  const config = {
    baseUrl: process.env.PORTAL_BASE_URL || "https://portal-api.nfon.net:8090",
    apiKeyId: process.env.PORTAL_API_KEY_ID || portalSecret.apiKeyId,
    apiKeySecret: process.env.PORTAL_API_KEY_SECRET || portalSecret.apiKeySecret,
    customerAccount: process.env.PORTAL_CUSTOMER_ACCOUNT || portalSecret.customerAccount || customerFromCti,
    appName: process.env.APP_NAME || "nfon-portal-api-showcase",
    appVersion: process.env.APP_VERSION || "0.1.0",
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
  };

  config.configured = Boolean(config.apiKeyId && config.apiKeySecret && config.customerAccount);
  return config;
}

const config = readConfig();
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
  return "Live-Schreiben ist fuer diese Sitzung deaktiviert. Aktiviere es bewusst im Setup, wenn Confirmations, Audit-Log und Rollback fuer die Aktion freigegeben sind.";
}

function liveWritesDisabledError() {
  const error = new Error(liveWritesDisabledMessage());
  error.status = 423;
  error.code = "LIVE_WRITES_DISABLED";
  return error;
}

function assertLiveWritesEnabled() {
  if (runtimeSettings.liveWritesEnabled) return;
  throw liveWritesDisabledError();
}

function clearPortalCache() {
  cache.overview = null;
  cache.callflow = null;
  cache.syncedAt = null;
  cache.errors = {};
}

function liveWritesDisabledResult(base = {}) {
  return {
    ...base,
    ok: false,
    status: 423,
    dryRun: false,
    applied: false,
    blocked: true,
    code: "LIVE_WRITES_DISABLED",
    title: "Live-Schreiben deaktiviert",
    message: liveWritesDisabledMessage(),
    liveWritesEnabled: runtimeSettings.liveWritesEnabled,
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
  res.end(JSON.stringify(body, null, 2));
}

function sendError(req, res, status, message, details = {}) {
  sendJson(req, res, status, { ok: false, error: message, ...details });
}

function portalErrorMessage(error) {
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
    return JSON.parse(text);
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

function makePortalHeaders(method, requestPath, bodyText = "") {
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
    .createHmac("sha1", config.apiKeySecret)
    .update(stringToSign, "utf8")
    .digest("base64");

  headers.Authorization = `NFON-API ${config.apiKeyId}:${signature}`;
  return headers;
}

class PortalApiError extends Error {
  constructor(message, response, body) {
    super(message);
    this.name = "PortalApiError";
    this.status = response?.status || 0;
    this.body = body;
  }
}

async function portalFetch(apiPath, options = {}) {
  if (!config.configured) {
    throw new Error("Portal API credentials or customer account are missing");
  }

  const method = (options.method || "GET").toUpperCase();
  const bodyText = options.body ? JSON.stringify(options.body) : "";
  const url = new URL(apiPath, config.baseUrl);
  const requestPath = `${url.pathname}${url.search}`;
  const response = await fetch(url, {
    method,
    headers: makePortalHeaders(method, requestPath, bodyText),
    body: bodyText || undefined,
  });
  const body = await readResponseBody(response);

  if (!response.ok) {
    const hint = typeof body === "string" ? body : body?.message || body?.error || "";
    throw new PortalApiError(`HTTP ${response.status}${hint ? `: ${hint}` : ""}`, response, body);
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
  const links = {};
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

function summarizeEndpoint(result) {
  if (!result.ok) return result;
  const items = extractItems(result.body);
  return {
    ok: true,
    status: result.status,
    path: result.path,
    count: items.length,
    item: items[0] || objectFromBody(result.body),
    items: items.slice(0, 250),
    data: objectFromBody(result.body),
  };
}

async function safePortalCall(key, apiPath) {
  try {
    return summarizeEndpoint(await portalFetch(apiPath));
  } catch (error) {
    return {
      ok: false,
      path: apiPath,
      status: error.status || 0,
      error: error.message,
    };
  }
}

async function firstAvailablePortalCall(key, apiPaths) {
  const attempts = [];

  for (const apiPath of apiPaths) {
    const result = await safePortalCall(key, apiPath);
    attempts.push(result);
    if (result.ok) return result;
  }

  return {
    ok: false,
    optional: true,
    path: apiPaths.join(" | "),
    status: attempts.find((attempt) => attempt.status)?.status || 0,
    error: attempts.map((attempt) => `${attempt.path}: ${attempt.status || attempt.error}`).join("; "),
    count: 0,
    items: [],
    data: {},
  };
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
  const name = normalizeDisplayName(value);
  if (!name || name.length > 50) {
    throw new Error(`${label} muss 1 bis 50 Zeichen lang sein.`);
  }
  if (/[&$!?=|"{}]/.test(name)) {
    throw new Error(`${label} enthaelt nicht erlaubte Zeichen: & $ ! ? = | " { }`);
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
    value: destinationName || destinationExtension || "kein Ziel erkannt",
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
      title: queue?.name || `Warteschlange ${routeNumber}`,
      subtitle: queue?.extensionNumber ? `Warteschlange ${queue.extensionNumber}` : "Warteschlange",
      targetNumber: queue?.extensionNumber || "",
      routeNumber: queue?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.includes("/phone-extensions/")) {
    const extension = (inventory.extensions || []).find((item) => item.id === routeNumber || item.number === routeNumber);
    return {
      type: "PHONEEXTENSION",
      title: extension?.name || `Nebenstelle ${routeNumber}`,
      subtitle: `Nebenstelle ${extension?.number || routeNumber}`,
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
      title: voicemail?.name || extension?.name || `AB ${routeNumber}`,
      subtitle: extension?.number ? `Anrufbeantworter ${extension.number}` : "Anrufbeantworter",
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
      title: ivr?.name || `Sprachdialog ${routeNumber}`,
      subtitle: ivr?.extensionNumber ? `Sprachdialog ${ivr.extensionNumber}` : "Sprachdialog",
      targetNumber: ivr?.extensionNumber || "",
      routeNumber: ivr?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.includes("/time-control-services/")) {
    const timeControl = matchByHrefOrRoute(inventory.timeControls);
    return {
      type: "TIMECONTROL",
      title: timeControl?.name || `Zeitsteuerung ${routeNumber}`,
      subtitle: timeControl?.extensionNumber ? `Zeitsteuerung ${timeControl.extensionNumber}` : "Zeitsteuerung",
      targetNumber: timeControl?.extensionNumber || "",
      routeNumber: timeControl?.serviceNumber || routeNumber,
      href: value,
    };
  }
  if (value.toUpperCase().includes("HANGUP")) {
    return { type: "HANGUP", title: "Auflegen", subtitle: "Anruf beenden", targetNumber: "HANGUP", routeNumber: "HANGUP", href: value };
  }
  return null;
}

async function hydrateIvrDetails(ivrs, inventory) {
  return Promise.all((ivrs || []).map(async (ivr) => {
    if (!ivr.href) return ivr;
    const [detail, keys, timeout] = await Promise.all([
      safePortalCall(`ivr-detail-${ivr.serviceNumber || ivr.value}`, ivr.href),
      safePortalCall(`ivr-keys-${ivr.serviceNumber || ivr.value}`, `${ivr.href}/key-assignments`),
      safePortalCall(`ivr-timeout-${ivr.serviceNumber || ivr.value}`, `${ivr.href}/timeout`),
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
      name: detailName || ivr.name,
      extensionNumber: detailExtension || ivr.extensionNumber,
      announcement: announcement?.name || pickField(detailItem, ["announcementName", "announcement"], ""),
      timeoutSeconds: pickField(timeoutItem, ["timeoutDelay", "delay"], ""),
      timeoutTarget,
      keyRoutes,
    };
  }));
}

async function hydrateTimeControlDetails(timeControls) {
  return Promise.all((timeControls || []).map(async (timeControl) => {
    if (!timeControl.href) return timeControl;
    const detail = await safePortalCall(`time-control-detail-${timeControl.serviceNumber || timeControl.value}`, timeControl.href);
    const detailItem = detail.item || {};
    return {
      ...timeControl,
      dayTargetHref: apiPathFromHref(linkHref(detailItem, ["destinationIfAllowed", "allowedDestination", "targetIfAllowed"])),
      nightTargetHref: apiPathFromHref(linkHref(detailItem, ["destinationIfDenied", "deniedDestination", "targetIfDenied"])),
      timezoneHref: apiPathFromHref(linkHref(detailItem, ["timezone", "timeZone"])) || "/api/time-zones/Europe.Berlin",
      evaluationStrategy: pickField(detailItem, ["evaluationStrategy"], ""),
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

function trunkHrefForDid(did) {
  if (did.trunkHref) return did.trunkHref;
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const didId = lastPathSegment(did.href);
  const trunkId = didId.includes("-") ? didId.replace(/-\d+$/, ".0-9") : "";
  return trunkId ? `/api/customers/${customer}/trunks/${encodeURIComponent(trunkId)}` : "";
}

function inboundNumberIdForDid(did) {
  return lastPathSegment(did.href) || String(did.name || did.id || "").replace(/^\+/, "00").replace(/[ ()]/g, "").replace(/-/g, "-");
}

function buildInboundAssignmentBody(did) {
  const trunkHref = trunkHrefForDid(did);
  return {
    links: trunkHref ? [{ rel: "trunk", href: trunkHref }] : [],
    data: [{ name: "didExtension", value: String(did.didExtension || numberFromText(did.name)) }],
  };
}

function buildCallflowUpdate(payload) {
  const did = payload.did || {};
  const target = payload.target || {};
  const destinationType = normalizeDestinationType(target.type);
  const destinationExtensionNumber = target.number || numberFromText(target.subtitle);
  const explicitTargetHref = apiPathFromHref(target.href || "");
  const explicitTargetBase = explicitTargetHref
    ? explicitTargetHref.replace(/\/inbound-trunk-numbers(?:\/.*)?$/, "").replace(/\/+$/, "")
    : "";
  const destinationRouteNumber = target.routeNumber || target.serviceNumber || lastPathSegment(explicitTargetBase) || destinationExtensionNumber;
  const sourceRouteNumber = normalizeDestinationType(did.destinationType) === "QUEUE"
    ? did.destinationServiceNumber || did.destinationExtension
    : did.destinationExtension;
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const oldTargetPath = inboundTargetPath(did.destinationType);
  const newTargetPath = inboundTargetPath(destinationType);
  const inboundNumberId = inboundNumberIdForDid(did);
  const oldEndpoint = oldTargetPath && sourceRouteNumber && inboundNumberId
    ? `/api/customers/${customer}/targets/${oldTargetPath}/${encodeURIComponent(sourceRouteNumber)}/inbound-trunk-numbers/${encodeURIComponent(inboundNumberId)}`
    : "";
  const newEndpoint = explicitTargetBase
    ? `${explicitTargetBase}/inbound-trunk-numbers`
    : newTargetPath && destinationRouteNumber
      ? `/api/customers/${customer}/targets/${newTargetPath}/${encodeURIComponent(destinationRouteNumber)}/inbound-trunk-numbers`
      : "";
  const newDeleteEndpoint = newEndpoint && inboundNumberId
    ? `${newEndpoint}/${encodeURIComponent(inboundNumberId)}`
    : "";
  const newBody = buildInboundAssignmentBody(did);
  const oldBody = buildInboundAssignmentBody({
    ...did,
    didExtension: did.didExtension || numberFromText(did.name),
  });
  const fields = {
    destinationType,
    destinationExtensionNumber,
    destinationDisplayName: target.title || "",
    destinationRouteNumber,
  };

  return {
    endpoint: newEndpoint,
    method: "DELETE+POST",
    fields,
    body: newBody,
    operations: [
      oldEndpoint ? { action: "delete-old-routing", method: "DELETE", endpoint: oldEndpoint } : null,
      newEndpoint ? { action: "create-new-routing", method: "POST", endpoint: newEndpoint, body: newBody } : null,
    ].filter(Boolean),
    rollback: oldEndpoint
      ? {
        action: "restore-old-routing",
        method: "POST",
        endpoint: oldEndpoint.replace(/\/inbound-trunk-numbers\/[^/]+$/, "/inbound-trunk-numbers"),
        body: oldBody,
      }
      : null,
    rollbackOperations: [
      newDeleteEndpoint ? { action: "delete-new-routing", method: "DELETE", endpoint: newDeleteEndpoint } : null,
      oldEndpoint ? {
        action: "restore-old-routing",
        method: "POST",
        endpoint: oldEndpoint.replace(/\/inbound-trunk-numbers\/[^/]+$/, "/inbound-trunk-numbers"),
        body: oldBody,
      } : null,
    ].filter(Boolean),
  };
}

function validateCallflowUpdate(payload, update) {
  const didName = payload.did?.name || payload.did?.id || "";

  if (!didName) {
    throw new Error("Keine Rufnummer für die Übernahme gefunden.");
  }
  if (!update.fields.destinationType) {
    throw new Error("Kein Zieltyp für die Übernahme gefunden.");
  }
  if (!update.fields.destinationRouteNumber) {
    throw new Error("Keine Zielroute gefunden. Bitte ein bestehendes Ziel aus der Liste wählen.");
  }
  if (!update.operations.length || update.operations.some((operation) => !operation.endpoint)) {
    throw new Error("Die Portal-API-Zielroute konnte nicht eindeutig gebildet werden.");
  }
}

function flowHasComplexPayload(payload = {}) {
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
  const href = apiPathFromHref(result.location || item.href || "");
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
  }) || announcements.find((announcement) => announcement.href);
  return match?.href || "";
}

function targetSignature(target) {
  if (!target) return "";
  const type = normalizeDestinationType(target.type);
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
  if (normalizeDestinationType(node?.type) !== "IVR") return null;
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
  if (!announcementHref) throw new Error(`Sprachdialog "${displayName}" braucht eine vorhandene Ansage.`);
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
  const map = {
    MO: "MONDAY",
    MON: "MONDAY",
    MONDAY: "MONDAY",
    MONTAG: "MONDAY",
    DI: "TUESDAY",
    TU: "TUESDAY",
    TUE: "TUESDAY",
    TUESDAY: "TUESDAY",
    DIENSTAG: "TUESDAY",
    MI: "WEDNESDAY",
    WE: "WEDNESDAY",
    WED: "WEDNESDAY",
    WEDNESDAY: "WEDNESDAY",
    MITTWOCH: "WEDNESDAY",
    DO: "THURSDAY",
    TH: "THURSDAY",
    THU: "THURSDAY",
    THURSDAY: "THURSDAY",
    DONNERSTAG: "THURSDAY",
    FR: "FRIDAY",
    FRI: "FRIDAY",
    FRIDAY: "FRIDAY",
    FREITAG: "FRIDAY",
    SA: "SATURDAY",
    SAT: "SATURDAY",
    SATURDAY: "SATURDAY",
    SAMSTAG: "SATURDAY",
    SO: "SUNDAY",
    SU: "SUNDAY",
    SUN: "SUNDAY",
    SUNDAY: "SUNDAY",
    SONNTAG: "SUNDAY",
  };
  return map[String(day || "").trim().toUpperCase()] || "MONDAY";
}

function nfonTime(value) {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})/);
  if (!match) return "09:00 AM";
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
  const text = String(value || "Mo-Fr 08:00-17:00");
  const match = text.match(/([A-Za-zÄÖÜäöü]{2,})(?:\s*-\s*([A-Za-zÄÖÜäöü]{2,}))?.*?(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
  return {
    fromDay: nfonDay(match?.[1] || "MO"),
    toDay: nfonDay(match?.[2] || match?.[1] || "FR"),
    fromTimeOfDay: nfonTime(match?.[3] || "08:00"),
    toTimeOfDay: nfonTime(match?.[4] || "17:00"),
  };
}

function targetSummary(target) {
  if (!target) return "-";
  return `${target.title || target.type || "Ziel"}${target.number ? ` ${target.number}` : ""}`.trim();
}

async function applyComplexCallflowChange(payload) {
  const overview = cache.overview || await loadOverview();
  const flow = payload.flow || {};
  const didName = payload.did?.name || payload.did?.id || "";
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  const attempts = [];
  const createdTargets = [];
  const allocatedExtensions = new Set();
  const allocatedServiceNumbers = new Set();
  const root = getTargetNode(flow, "trunk") || (flow.nodes || []).find((node) => !node.locked);

  if (!didName) throw new Error("Keine Rufnummer fuer die Uebernahme gefunden.");
  if (!root) throw new Error("Der Callflow hat keinen Start nach der Leitung.");

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

  if (payload.commit && !config.liveWritesEnabled) return liveWritesDisabledResult(basePlan);

  const ensurePortalTarget = async (node) => {
    if (!node) throw new Error("Ein Flow-Pfad hat kein Ziel.");
    const type = normalizeDestinationType(node.type);

    if (type === "PLACEHOLDER") {
      throw new Error(`Der Pfad "${node.title || "Neuer Schritt"}" ist noch leer.`);
    }
    if (type === "HANGUP") {
      return { type, title: "Auflegen", routeNumber: "HANGUP", href: targetHrefForRoute("HANGUP", "HANGUP") };
    }
    if (type === "ANNOUNCEMENT") {
      throw new Error("Ansagen sind in der Portal API Medien, aber keine eigenstaendigen Routing-Ziele. Nutze sie in Sprachdialog oder Queue.");
    }

    const existingRoute = targetRouteFromNode(node);
    const existingHref = targetHrefForRoute(type, existingRoute);

    if (type === "QUEUE") {
      if (node.config?.portalMode === "new" && !existingRoute) {
        const displayName = validatePortalDisplayName(node.title || "Neue Warteschlange", "Warteschlangen-Name");
        if (!payload.commit) {
          const routeNumber = nextResourceNumber(overview, "queues");
          return { ...nodeToPortalTarget(node), routeNumber, href: targetHrefForRoute("QUEUE", routeNumber) };
        }
        const created = await createPortalResource("queues", { displayName });
        attempts.push({ action: `create-queue-${displayName}`, method: "POST", status: created.status, endpoint: created.endpoint });
        return {
          ...nodeToPortalTarget(node),
          type: "QUEUE",
          routeNumber: created.resource.routeNumber,
          href: created.resource.href,
          extensionNumber: created.resource.extensionNumber,
        };
      }
      if (!existingRoute) throw new Error(`Warteschlange "${node.title}" hat keine Portal-Nummer.`);
      if (payload.commit && node.config?.timeoutSeconds) {
        const timeoutTargetNode = getTargetNode(flow, node.id, "timeoutTarget");
        const timeoutTarget = await ensurePortalTarget(timeoutTargetNode);
        const endpoint = `/api/customers/${customer}/targets/queue-services/${encodeURIComponent(existingRoute)}/timeout`;
        const body = {
          links: [{ rel: "destinationOnTimeout", href: timeoutTarget.href }],
          data: [{ name: "timeoutDelay", value: Number(node.config.timeoutSeconds) || 120 }],
        };
        const result = await runPortalOperation({ action: `queue-timeout-${node.title}`, method: "PUT", endpoint, body }, attempts);
        attempts.push({ action: "queue-timeout-written", method: "PUT", status: result.status, endpoint });
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
      if (!existingRoute) throw new Error(`Ziel "${node.title}" hat keine Portal-Route.`);
      return { ...nodeToPortalTarget(node), href: existingHref };
    }

    if (type === "IVR") {
      if (node.config?.portalMode === "existing") {
        if (!existingRoute) throw new Error(`Vorhandener Sprachdialog "${node.title}" hat keine Portal-Route.`);
        return { ...nodeToPortalTarget(node), href: existingHref };
      }
      const displayName = validatePortalDisplayName(node.title || "API Demo Sprachdialog", "Sprachdialog-Name");
      const keys = Array.isArray(node.config?.ivrKeys) && node.config.ivrKeys.length ? node.config.ivrKeys : ["1", "2"];
      const reusable = findReusableIvrForNode(node, overview, flow);

      if (reusable?.ambiguous) {
        throw new Error(`Mehrere passende Sprachdialoge mit Name "${displayName}" gefunden. Bitte im Adminportal aufräumen oder den bestehenden Sprachdialog über seine Nebenstelle eindeutig auswählen.`);
      }
      if (reusable?.conflict) {
        throw new Error(`Sprachdialog "${displayName}" existiert bereits${reusable.count > 1 ? ` ${reusable.count}x` : ""}, aber Ansage, Tasten oder Timeout passen nicht zu diesem Entwurf. Ich lege keinen weiteren Sprachdialog mit gleichem Namen an.`);
      }
      if (reusable?.ivr) {
        const existingTarget = targetFromLiveIvr(node, reusable.ivr);
        if (!payload.commit) return existingTarget;

        if (reusable.reason === "number" && !ivrTopologyMatchesLive(node, reusable.ivr, flow)) {
          throw new Error(`Sprachdialog "${displayName}" existiert bereits (${existingTarget.extensionNumber || existingTarget.routeNumber}), aber Tasten, Ansage oder Timeout weichen ab. Ich lege ihn nicht automatisch neu an, damit keine Duplikate entstehen.`);
        }

        const nameChanged = normalizeDisplayName(displayName) !== normalizeDisplayName(reusable.ivr.name);
        if (nameChanged) {
          await runPortalOperation({
            action: `update-ivr-name-${displayName}`,
            method: "PUT",
            endpoint: existingTarget.href,
            body: ivrBaseBody(node, reusable.ivr, overview),
          }, attempts);
        }
        return existingTarget;
      }

      const announcementHref = existingAnnouncementHref(node.config?.announcement, overview);
      if (!announcementHref) throw new Error(`Sprachdialog "${node.title}" braucht eine vorhandene Ansage.`);
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
      if (!payload.commit) return { ...nodeToPortalTarget(node), number: extensionNumber, href: targetHrefForRoute("IVR", extensionNumber), routeNumber: extensionNumber, extensionNumber };

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
        if (!existingRoute) throw new Error(`Vorhandene Zeitregel "${node.title}" hat keine Portal-Route.`);
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
          { rel: "timezone", href: "/api/time-zones/Europe.Berlin" },
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

    throw new Error(`Zieltyp ${type || "-"} wird noch nicht live geschrieben.`);
  };

  const updateExistingIvrName = async (node) => {
    if (normalizeDestinationType(node?.type) !== "IVR") return false;
    const liveIvr = findInventoryIvrForNode(node, overview);
    if (!liveIvr) return false;
    const displayName = validatePortalDisplayName(node.title || liveIvr.name || "Sprachdialog", "Sprachdialog-Name");
    if (normalizeDisplayName(displayName) === normalizeDisplayName(liveIvr.name)) return false;

    const duplicateName = findIvrNameConflict(displayName, liveIvr, overview);
    if (duplicateName) {
      throw new Error(`Es gibt bereits einen anderen Sprachdialog mit dem Namen "${displayName}". Bitte waehle einen eindeutigen Namen, damit keine Duplikate entstehen.`);
    }

    const endpoint = liveIvr.href || targetHrefForRoute("IVR", liveIvr.serviceNumber || node.routeNumber);
    await runPortalOperation({
      action: `rename-ivr-${liveIvr.serviceNumber || node.routeNumber || displayName}`,
      method: "PUT",
      endpoint,
      body: ivrBaseBody(node, liveIvr, overview),
    }, attempts);
    return true;
  };

  const liveIvrForRoot = findInventoryIvrForNode(root, overview);
  const rootIsExistingLiveIvr = normalizeDestinationType(root?.type) === "IVR" && liveIvrForRoot;
  const rootIvrNameChanged = rootIsExistingLiveIvr
    && normalizeDisplayName(root.title) !== normalizeDisplayName(liveIvrForRoot.name);

  if (rootIvrNameChanged) {
    const duplicateName = findIvrNameConflict(root.title, liveIvrForRoot, overview);
    if (duplicateName) {
      return {
        ...basePlan,
        ok: false,
        dryRun: !payload.commit,
        applied: false,
        title: "Sprachdialog-Name nicht eindeutig",
        message: `Es gibt bereits einen anderen Sprachdialog mit dem Namen "${root.title}". Bitte waehle einen eindeutigen Namen, damit keine Duplikate entstehen.`,
        attempts,
      };
    }
    const endpoint = liveIvrForRoot.href || targetHrefForRoute("IVR", liveIvrForRoot.serviceNumber || root.routeNumber);
    const body = ivrBaseBody(root, liveIvrForRoot, overview);
    const target = {
      ...nodeToPortalTarget(root),
      href: endpoint,
      routeNumber: liveIvrForRoot.serviceNumber || root.routeNumber,
      extensionNumber: liveIvrForRoot.extensionNumber || root.targetNumber,
    };

    if (!payload.commit) {
      return {
        ...basePlan,
        dryRun: true,
        title: "Sprachdialog-Name geprueft",
        message: `Der bestehende Sprachdialog wird per PUT in "${body.data.find((field) => field.name === "displayName")?.value}" umbenannt.`,
        after: `${didName} → ${targetSummary(target)}`,
        target,
        method: "PUT",
      };
    }

    try {
      const result = await runPortalOperation({
        action: `rename-ivr-${liveIvrForRoot.serviceNumber || root.routeNumber}`,
        method: "PUT",
        endpoint,
        body,
      }, attempts);
      attempts.push({ action: "rename-ivr-done", method: "PUT", status: result.status, endpoint });
    } catch (error) {
      attempts.push({
        action: "failed",
        method: error.method || "PUT",
        status: error.status || 0,
        endpoint: error.endpoint || endpoint,
        message: error.message,
        body: error.body,
      });
      return {
        ...basePlan,
        ok: false,
        dryRun: false,
        applied: false,
        title: "Sprachdialog-Name konnte nicht uebernommen werden",
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
      title: "Sprachdialog-Name uebernommen",
      message: "Die Portal API hat den Namen des bestehenden Sprachdialogs aktualisiert.",
      after: `${didName} → ${targetSummary(target)}`,
      target,
      response: attempts,
      appliedAt: new Date().toISOString(),
    };
  }

  if (!payload.commit) {
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
      if (node.id !== root.id) await updateExistingIvrName(node);
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
        title: attempts.length ? "IVR aktualisiert" : "Keine Routing-Aenderung noetig",
        message: attempts.length
          ? "Der bestehende Sprachdialog wurde aktualisiert. Die Rufnummer war bereits korrekt verbunden."
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
    title: "Komplexer Callflow uebernommen",
    message: "Die Portal API hat die Zielobjekte angelegt und die Rufnummer auf den neuen Flow geroutet.",
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
    name: extension?.name || pickField(item, ["displayName", "name"], `Nebenstelle ${extensionNumber}`),
    type: extension?.type || "PHONE",
    penalty: Number(pickField(item, ["penalty"], kind === "queue" ? 0 : "")) || 0,
    skillLevel: Number(pickField(item, ["skillLevel"], kind === "skill" ? 1 : "")) || 1,
    enabled: pickField(item, ["enabled"], true) !== false,
    href: item.href || href,
  };
}

async function hydrateServiceMembers(kind, services, overview) {
  return Promise.all((services || []).map(async (service) => {
    const serviceNumber = service.serviceNumber || service.extensionNumber || service.value || service.id;
    if (!serviceNumber) return { ...service, kind, members: [], memberError: "Keine Service-Nummer gefunden." };
    try {
      const endpoint = await portalFetch(`${serviceEndpoint(kind, serviceNumber)}/members`);
      const members = extractItems(endpoint.body || endpoint.data || endpoint).map((item) => compactServiceMember(item, overview, kind));
      return { ...service, kind, serviceNumber, members };
    } catch (error) {
      return { ...service, kind, serviceNumber, members: [], memberError: error.message };
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
  if (!config.configured) return { ok: false, message: "Portal API ist nicht konfiguriert." };
  if (!config.liveWritesEnabled) {
    return liveWritesDisabledResult({
      type: "service-groups",
      title: "Mitgliedschaften nicht übernommen",
    });
  }

  const serviceGroups = await loadServiceGroups();
  const attempts = [];
  const services = Array.isArray(payload?.services) ? payload.services : [];

  for (const service of services) {
    const kind = service.kind === "skill" ? "skill" : "queue";
    const source = (kind === "skill" ? serviceGroups.skills : serviceGroups.queues)
      .find((item) => String(item.serviceNumber || item.id) === String(service.serviceNumber || service.id));
    const serviceNumber = source?.serviceNumber || service.serviceNumber || service.id;
    if (!serviceNumber) continue;

    const desired = new Map((service.members || [])
      .map((member) => normalizeDesiredMember(kind, member))
      .filter(Boolean)
      .map((member) => [member.extensionNumber, member]));
    const current = new Map((source?.members || []).map((member) => [member.extensionNumber, member]));

    for (const [extensionNumber] of current.entries()) {
      if (!desired.has(extensionNumber)) {
        await runPortalOperation({
          action: `${kind}-member-delete-${extensionNumber}`,
          method: "DELETE",
          endpoint: `${serviceEndpoint(kind, serviceNumber, "/members")}/${encodeURIComponent(extensionNumber)}`,
        }, attempts, { kind, serviceNumber, extensionNumber });
      }
    }

    for (const [extensionNumber, member] of desired.entries()) {
      const existing = current.get(extensionNumber);
      const body = {
        links: [{ rel: "phoneExtension", href: phoneExtensionHref(extensionNumber) }],
        data: serviceMemberData(kind, member),
      };
      if (!existing) {
        await runPortalOperation({
          action: `${kind}-member-add-${extensionNumber}`,
          method: "POST",
          endpoint: serviceEndpoint(kind, serviceNumber, "/members"),
          body,
        }, attempts, { kind, serviceNumber, extensionNumber });
        continue;
      }
      const changed = kind === "skill"
        ? Number(existing.skillLevel || 1) !== Number(member.skillLevel || 1) || (existing.enabled !== false) !== (member.enabled !== false)
        : Number(existing.penalty || 0) !== Number(member.penalty || 0);
      if (changed) {
        await runPortalOperation({
          action: `${kind}-member-update-${extensionNumber}`,
          method: "PUT",
          endpoint: `${serviceEndpoint(kind, serviceNumber, "/members")}/${encodeURIComponent(extensionNumber)}`,
          body: { data: serviceMemberData(kind, member, { includeEnabled: true }) },
        }, attempts, { kind, serviceNumber, extensionNumber });
      }
    }
  }

  cache.overview = null;
  cache.callflow = null;
  const overview = await loadOverview();
  const updatedGroups = await loadServiceGroups();
  return {
    ok: true,
    title: "Mitgliedschaften übernommen",
    message: "Warteschlangen und Skillgruppen wurden über die Portal API aktualisiert.",
    attempts,
    overview,
    serviceGroups: updatedGroups,
    appliedAt: new Date().toISOString(),
  };
}

async function applyCallflowChange(payload) {
  if (flowHasComplexPayload(payload)) {
    return applyComplexCallflowChange(payload);
  }

  const update = buildCallflowUpdate(payload);
  const didName = payload.did?.name || payload.did?.id || "";
  const target = payload.target || {};

  if (!didName) {
    throw new Error("Keine Rufnummer für die Übernahme gefunden.");
  }
  if (!update.fields.destinationType) {
    throw new Error("Kein Zieltyp für die Übernahme gefunden.");
  }
  if (!update.fields.destinationRouteNumber) {
    throw new Error("Keine Zielroute gefunden. Bitte ein bestehendes Ziel aus der Liste wählen.");
  }
  if (!update.operations.length || update.operations.some((operation) => !operation.endpoint)) {
    throw new Error("Die Portal-API-Zielroute konnte nicht eindeutig gebildet werden.");
  }

  const basePlan = {
    ok: true,
    type: "callflow",
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
  if (!config.liveWritesEnabled) return liveWritesDisabledResult(basePlan);

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
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
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
    const didName = change.did?.name || change.did?.id || `Rufnummer ${index + 1}`;
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
    title: `${profileName} zur Übernahme bereit`,
    message: `${plans.length} Routing-Änderung${plans.length === 1 ? "" : "en"} technisch vorbereitet.`,
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
  if (!config.liveWritesEnabled) return liveWritesDisabledResult(basePlan);

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
        rolledBack: true,
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
    title: `${profileName} übernommen`,
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
    error: endpoint.ok ? "" : endpoint.error || "Unknown error",
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
  const name = pickField(customer, ["name", "displayName", "company", "description"], account || `Anlage ${index + 1}`);
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
    const endpoint = summarizeEndpoint(await portalFetch("/api/customers/"));
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
    const error = new Error(`Anlage ${normalized} ist mit diesen API-Zugangsdaten nicht sichtbar.`);
    error.status = 403;
    throw error;
  }
  const validation = await safePortalCall("customerValidation", `/api/customers/${encodeURIComponent(normalized)}/basic-data`);
  if (!validation.ok) {
    const error = new Error(`Anlage ${normalized} konnte nicht gelesen werden: ${validation.error || `HTTP ${validation.status}`}`);
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
    const error = new Error(`Browser-Login unvollständig: ${missing.join(", ")} fehlt.`);
    error.status = 400;
    throw error;
  }

  try {
    const parsed = new URL(credentials.baseUrl);
    if (!["https:", "http:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
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

  const validation = await safePortalCall("customerValidation", `/api/customers/${encodeURIComponent(config.customerAccount)}/basic-data`);
  if (!validation.ok) {
    const error = new Error(`Browser-Login gespeichert, aber Anlage ${config.customerAccount} konnte nicht gelesen werden: ${validation.error || `HTTP ${validation.status}`}`);
    error.status = validation.status || 403;
    throw error;
  }

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
      devices: 4,
      trunks: 1,
      dids: 3,
    phoneBooks: 2,
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
  if (!config.configured) {
    cache.overview = demoOverview("Portal API ist noch nicht vollständig konfiguriert.");
    cache.syncedAt = cache.overview.syncedAt;
    return cache.overview;
  }

  const customer = encodeURIComponent(config.customerAccount);
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
    Object.entries(endpointDefs).map(async ([key, apiPath]) => [key, await safePortalCall(key, apiPath)])
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
  if (queuesEndpoint.ok) endpoints.queues = queuesEndpoint;
  if (skillsEndpoint.ok) endpoints.skills = skillsEndpoint;
  if (voicemailsEndpoint.ok) endpoints.voicemails = voicemailsEndpoint;
  if (frontdesksEndpoint.ok) endpoints.frontdesks = frontdesksEndpoint;

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
  inventory.timeControls = await hydrateTimeControlDetails(inventory.timeControls);

  const overview = {
    ok: Object.values(endpoints).some((endpoint) => endpoint.ok),
    demo: false,
    account: config.customerAccount,
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
  overview.callflow = buildCallflow(overview);

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
    liveWritesEnabled: runtimeSettings.liveWritesEnabled,
    liveWritesDefaultEnabled: config.liveWritesEnabled,
    liveWritesRuntimeOverride: runtimeSettings.liveWritesEnabled !== config.liveWritesEnabled,
    liveWritesChangedAt: runtimeSettings.liveWritesChangedAt,
    csrfToken,
    sources: {
      environment: Boolean(process.env.PORTAL_API_KEY_ID || process.env.PORTAL_API_KEY_SECRET || process.env.PORTAL_CUSTOMER_ACCOUNT),
      portalSecretFound: Boolean(config.portalSecretFile),
      ctiSecretFound: Boolean(config.ctiSecretFile),
      googleContactsCacheFound: Boolean(googleContactsFile),
    },
    googleContactsFile: googleContactsFile ? path.relative(ROOT, googleContactsFile) : "",
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
    ok: settings.configured,
    configured: settings.configured,
    account: settings.account,
    baseUrl: settings.baseUrl,
    secrets: settings.sources,
    settings,
    cache: {
      syncedAt: cache.syncedAt,
      counts: cache.overview?.counts || null,
      errors: cache.errors,
    },
  };
}

function normalizeSyncPhone(value) {
  let digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  return digits;
}

function displaySyncPhone(value) {
  const raw = String(value || "").trim();
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  if (!digits.startsWith("49") && digits.length >= 7 && digits.length <= 12) {
    digits = `49${digits}`;
  }
  return `+${digits}`;
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
      error: `Kontaktquelle konnte nicht gelesen werden: ${error.message}`,
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
  const displayName = normalizeDisplayName(
    stringFromMappedField(contact, mapping.displayName, ["displayName", "name", "fullName"])
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
        ? phone.normalized || phone.canonical || phone.canonicalForm || phone.value || phone.number || phone.phoneNumber
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
      { name: "firstName", value: contact.firstName },
      { name: "lastName", value: contact.lastName },
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
  const portal = await loadPhonebookEntries(overview);
  const syncBook = portal.books[0] || null;
  const portalByPhone = new Map();
  for (const entry of portal.entries) {
    for (const phone of entry.phones || []) {
      if (!portalByPhone.has(phone.normalized)) portalByPhone.set(phone.normalized, entry);
    }
  }

  const googleContacts = google.contacts.map(compactGoogleContactForSync).filter((contact) => contact.phones.length);
  const seenGooglePhones = new Set();
  const actions = [];
  const unchanged = [];
  const skipped = [];
  const googlePreview = [];
  for (const contact of googleContacts) {
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
          reason: `Name in NFON: ${existing.name}`,
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
        ? `${changeCount} Änderung${changeCount === 1 ? "" : "en"} gefunden. Es wurde noch nichts gespeichert.`
        : `${unchanged.length} Einträge sind bereits synchron. Es gibt nichts zu übernehmen.`,
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
        ? `${plan.summary?.unchanged || 0} Einträge sind bereits synchron. Es wurde nichts gespeichert.`
        : `${results.length} Telefonbuch-Aktion${results.length === 1 ? "" : "en"} wurden an die Portal API gesendet.`
      : `${failed.length} von ${results.length} Telefonbuch-Aktionen sind fehlgeschlagen.`,
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
  if (contacts.length > 5000) {
    const error = new Error("Upload ist zu gross. Maximal 5000 Kontakte pro Datei.");
    error.status = 413;
    throw error;
  }
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
    file: path.relative(ROOT, file),
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
  const explicitHref = apiPathFromHref(target.href || "");
  if (explicitHref) return explicitHref;
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

  const overview = cache.overview || await loadOverview();
  const item = (overview.inventory?.[kind] || []).find((entry) => resourceRouteNumber(entry) === String(id));
  if (!item) {
    const error = new Error("Ressource nicht gefunden.");
    error.status = 404;
    throw error;
  }

  const customer = encodeURIComponent(config.customerAccount || "");
  const endpoint = item.href || `/api/customers/${customer}/targets/${collection}/${encodeURIComponent(resourceRouteNumber(item))}`;
  const result = await portalFetch(endpoint, { method: "DELETE" });
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
  const serviceNumber = String(payload.serviceNumber || (kind === "queues" || kind === "skills" ? "" : nextResourceNumber(overview, kind))).trim();
  const preferredExtension = kind === "ivrs" ? 7100 : kind === "timeControls" ? 7200 : 10;
  const extensionNumber = String(payload.extensionNumber || (kind === "queues" || kind === "skills" ? "" : nextServiceExtension(overview, new Set(), preferredExtension))).trim();
  const endpoint = `/api/customers/${customer}/targets/${collection}`;
  let body;

  if (kind === "queues" || kind === "skills") {
    body = {
      data: [
        { name: "displayName", value: displayName },
        { name: "name", value: displayName },
        { name: "serviceNumber", value: serviceNumber },
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
        { rel: "timezone", href: "/api/time-zones/Europe.Berlin" },
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

  const result = await portalFetch(endpoint, { method: "POST", body });
  const created = createdTargetFromResult(kind === "ivrs" ? "IVR" : kind === "timeControls" ? "TIMECONTROL" : kind === "skills" ? "SKILL" : "QUEUE", result, serviceNumber);

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
  const displayName = validatePortalDisplayName(payload.displayName || `Nachtansage ${announcementName || "Ansage"}`, "Ansage-Ziel");
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
      : `Sprachdialog "${displayName}" wuerde die Ansage abspielen und danach zu ${afterTarget.title || targetTypeLabel(afterTarget.type)} routen.`,
    displayName,
    announcementName,
    announcementHref,
    afterTarget,
    afterHref,
    target: {
      type: "IVR",
      title: displayName,
      subtitle: `Sprachdialog ${extensionNumber}`,
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
    message: `Sprachdialog "${plan.displayName}" wurde angelegt und kann als Nachtziel genutzt werden.`,
    target,
    option: {
      label: `${target.targetNumber || target.routeNumber} - (Sprachdialog | ${target.title})`,
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
  const rows = normalizeExtensionBatchRows(Array.isArray(payload.rows) ? payload.rows : []);
  const seen = new Set();
  const entries = rows.map((row) => {
    const errors = [];
    if (!row.extensionNumber) errors.push("Nummer fehlt");
    if (!/^\d{2,8}$/.test(row.extensionNumber)) errors.push("Nummer muss 2 bis 8 Ziffern enthalten");
    if (!row.displayName) errors.push("Name fehlt");
    if (!row.mailboxPin) errors.push("Mailbox-PIN fehlt");
    if (row.mailboxPin && !/^\d{4,12}$/.test(row.mailboxPin)) errors.push("Mailbox-PIN muss 4 bis 12 Ziffern enthalten");
    for (const field of EXTENSION_BATCH_FIELD_DEFS.filter((definition) => definition.type === "number")) {
      if (hasOwn(row, field.key) && !Number.isFinite(row[field.key])) errors.push(`${field.label} muss eine Zahl sein`);
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
      ? `${invalid.length} von ${entries.length} Zeile${entries.length === 1 ? "" : "n"} brauchen Korrektur.`
      : valid.length
        ? `${valid.length} Nebenstelle${valid.length === 1 ? "" : "n"} können angelegt werden.`
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
      ? `${results.length} Nebenstelle${results.length === 1 ? "" : "n"} wurden angelegt.`
      : `${failed.length} von ${results.length} Nebenstelle${results.length === 1 ? "" : "n"} konnten nicht vollständig angelegt werden.`,
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
      label: "kein Ziel erkannt",
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

function isManagedDaynightTimeControl(timeControl = {}) {
  return String(timeControl.name || "").trim().toLowerCase().startsWith(DAYNIGHT_TIME_CONTROL_PREFIX.trim().toLowerCase() + " ");
}

function sameGatewayName(left, right) {
  return String(left || "").trim().toLowerCase() === String(right || "").trim().toLowerCase();
}

function findExistingDaynightGateway(gatewayName, inventory = {}) {
  return (inventory.timeControls || []).find((item) => sameGatewayName(item.name, gatewayName)) || null;
}

function sameApiHref(left, right) {
  return apiPathFromHref(left) === apiPathFromHref(right);
}

function gatewayHrefFromServiceNumber(serviceNumber) {
  const customer = encodeURIComponent(config.customerAccount || "{customer}");
  return `/api/customers/${customer}/targets/time-control-services/${encodeURIComponent(serviceNumber)}`;
}

function daynightSnapshotPayload(plan, result = {}) {
  return {
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
  const snapshot = daynightSnapshotPayload(plan, result);
  await writePrivateJson(DAYNIGHT_GATEWAY_SNAPSHOT, snapshot);
  return snapshot;
}

async function readDaynightSnapshot() {
  try {
    return JSON.parse(await fsp.readFile(DAYNIGHT_GATEWAY_SNAPSHOT, "utf8"));
  } catch {
    return null;
  }
}

function buildDaynightGatewayPreview(payload = {}) {
  const overview = cache.overview || null;
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
    if (!did.trunkNumber && !trunkHrefForDid(did)) blockers.push("Trunk kann fuer Restore nicht eindeutig bestimmt werden.");
    if (!nightTarget.href) blockers.push("Nachtziel fehlt oder kann nicht eindeutig gebildet werden.");

    const gatewayName = gatewayNameForDid(did, index);
    const existingGateway = findExistingDaynightGateway(gatewayName, inventory);
    const didAlreadyUsesGateway = Boolean(existingGateway && didTargetsTimeControl(did, existingGateway));
    const gatewayDayTargetHref = apiPathFromHref(existingGateway?.dayTargetHref || "");
    const currentTarget = didAlreadyUsesGateway
      ? targetPreviewFromHref(gatewayDayTargetHref, inventory)
      : portalCurrentTarget;
    if (!currentTarget.isUnassigned && !currentTarget.type) blockers.push("Aktueller Zieltyp fehlt.");
    if (!currentTarget.isUnassigned && !currentTarget.routeNumber) blockers.push("Aktuelle Zielroute fehlt.");
    if (!currentTarget.isUnassigned && !currentTarget.href) blockers.push("Aktueller Ziel-Href kann nicht gebildet werden.");
    if (!currentTarget.isUnassigned && !["IVR", "TIMECONTROL", "QUEUE", "SKILL", "GROUP", "PHONEEXTENSION", "FRONTDESK", "VOICEMAIL", "HANGUP"].includes(currentTarget.type)) {
      blockers.push(`Zieltyp ${currentTarget.type || "-"} ist noch nicht fuer Zeitsteuerungs-Restore bewertet.`);
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
        { rel: "timezone", href: "/api/time-zones/Europe.Berlin" },
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
            { rel: "timezone", href: "/api/time-zones/Europe.Berlin" },
          ],
        },
        note: "Nachtmodus erzwingen: innerhalb und ausserhalb des Zeitfensters auf Nachtziel routen.",
      }
      : null;
    const routeOperations = didAlreadyUsesGateway
      ? []
      : [
        { action: "delete-old-routing", method: "DELETE", endpoint: portalCurrentTarget.href ? `${portalCurrentTarget.href}/inbound-trunk-numbers/${encodeURIComponent(inboundNumberIdForDid(did))}` : "", note: "Aktuelle Rufnummern-Zuordnung entfernen." },
        { action: "route-did-to-gateway", method: "POST", endpoint: didRouteEndpoint, body: buildInboundAssignmentBody(did), note: "Rufnummer auf Zeitsteuerung routen." },
      ].filter((operation) => operation.endpoint);
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
      gatewayNeedsUpdate,
      gatewayMatchesDayTarget,
      gatewayMatchesNightTarget,
      gatewayCreateOperation,
      gatewayUpdateOperation,
      forceNightGatewayOperation,
      routeOperations,
      plannedOperations: [
        gatewayCreateOperation,
        gatewayUpdateOperation,
        ...routeOperations,
      ].filter(Boolean),
      restorePlan: {
        action: currentTarget.isUnassigned ? "restore-unassigned-routing" : "restore-original-routing",
        method: currentTarget.isUnassigned ? "DELETE" : "POST",
        endpoint: currentTarget.isUnassigned
          ? `${gatewayHref}/inbound-trunk-numbers/${encodeURIComponent(inboundNumberIdForDid(did))}`
          : `${currentTarget.href}/inbound-trunk-numbers`,
        body: currentTarget.isUnassigned ? null : buildInboundAssignmentBody(did),
      },
      behaviorNote: currentTarget.isUnassigned
        ? "Rufnummer ist tagsueber unbelegt. Im Zeitsteuerungsfenster wird das als Auflegen abgebildet; nach der Wiederherstellung bleibt sie wieder ohne Ziel."
        : currentTarget.isFrontdesk
          ? "Frontdesk/Nia bleibt Tagesziel hinter der Zeitsteuerung. Die KI-Loesung wird nicht veraendert; nur die Rufnummer wuerde initial vor den Frontdesk auf die Zeitsteuerung zeigen."
          : "Originalziel bleibt als Tagesziel hinter der Zeitsteuerung erhalten.",
      blockers,
    };
  });
  const staleTimeControls = (inventory.timeControls || [])
    .filter((timeControl) => isManagedDaynightTimeControl(timeControl))
    .filter((timeControl) => !expectedGatewayNames.has(String(timeControl.name || "").trim().toLowerCase()))
    .map((timeControl) => ({
      id: timeControl.serviceNumber || timeControl.id || timeControl.value || "",
      name: timeControl.name || "",
      extensionNumber: timeControl.extensionNumber || timeControl.value || "",
      href: timeControl.href || gatewayHrefFromServiceNumber(timeControl.serviceNumber || timeControl.id || timeControl.value || ""),
    }))
    .filter((timeControl) => timeControl.href);
  const blockers = entries.flatMap((entry) => entry.blockers.map((message) => `${entry.did.name || entry.did.id}: ${message}`));
  return {
    ok: blockers.length === 0 && dids.length > 0,
    readOnly: true,
    type: "daynight-gateway-preview",
    title: "Tag/Nacht-Zeitsteuerungs-Check",
    message: dids.length
      ? `${entries.filter((entry) => entry.ok).length} von ${dids.length} Rufnummern sind fuer eine Zeitsteuerungs-Migration eindeutig bewertbar.`
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
  if (!cache.overview) await loadOverview();
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
      results.push({
        ok: true,
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
      ? `${results.filter((result) => result.action === "create-daynight-gateway").length} Zeitsteuerung${results.filter((result) => result.action === "create-daynight-gateway").length === 1 ? "" : "en"} angelegt, ${results.filter((result) => result.action === "update-daynight-gateway").length} aktualisiert, ${results.filter((result) => result.skipped).length} unveraendert. Rufnummern wurden nicht veraendert.`
      : `${failed.length} Zeitsteuerung${failed.length === 1 ? "" : "en"} konnten nicht angelegt oder aktualisiert werden. Rufnummern wurden nicht veraendert.`,
    results,
    attempts,
    appliedAt: new Date().toISOString(),
  };
  if (applied) {
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
  if (!cache.overview) await loadOverview();
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
        ? `${missingGateway.length} Zeitsteuerung${missingGateway.length === 1 ? "" : "en"} fehlen noch. Lege zuerst die Zeitsteuerungen an.`
        : plan.message,
    };
  }

  const attempts = [];
  const appliedEntries = [];
  await saveDaynightSnapshot(plan, {
    ok: true,
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

      if (completed.includes("delete-old-routing") && entry.restorePlan?.endpoint) {
        await runRollbackOperations([entry.restorePlan], attempts, { did: entry.did?.name || entry.did?.id || "", gateway: entry.gateway?.name || "" });
      }
      for (const applied of appliedEntries.reverse()) {
        const gatewayDelete = applied.gateway?.href
          ? {
            action: "delete-gateway-routing",
            method: "DELETE",
            endpoint: `${applied.gateway.href}/inbound-trunk-numbers/${encodeURIComponent(inboundNumberIdForDid(applied.did))}`,
          }
          : null;
        await runRollbackOperations([gatewayDelete, applied.restorePlan].filter(Boolean), attempts, {
          did: applied.did?.name || applied.did?.id || "",
          gateway: applied.gateway?.name || "",
        });
      }

      return {
        ...plan,
        ok: false,
        dryRun: false,
        applied: false,
        status: 502,
        title: "Rufnummern-Migration fehlgeschlagen",
        message: portalErrorMessage(error),
        attempts,
        rolledBack: true,
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
    message: `${appliedEntries.length} Rufnummer${appliedEntries.length === 1 ? "" : "n"} wurden auf die vorbereiteten Tag/Nacht-Zeitsteuerungen geroutet.`,
    attempts,
    appliedAt: new Date().toISOString(),
  };
}

async function cleanupDaynightTimeControls(payload = {}) {
  assertLiveWritesEnabled();
  if (!cache.overview) await loadOverview();
  const plan = buildDaynightGatewayPreview(payload);
  const staleTimeControls = plan.staleTimeControls || [];
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
    message: `${staleTimeControls.length} nicht mehr benötigte Zeitsteuerung${staleTimeControls.length === 1 ? "" : "en"} nach Namenskonvention gelöscht.`,
    attempts,
    deleted: staleTimeControls,
    appliedAt: new Date().toISOString(),
  };
}

function managedDaynightTimeControls(inventory = {}) {
  return (inventory.timeControls || [])
    .filter((timeControl) => isManagedDaynightTimeControl(timeControl))
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
  if (!cache.overview) await loadOverview();
  const overview = cache.overview || {};
  const inventory = overview.inventory || {};
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
    const fallbackDayTarget = targetPreviewFromHref(timeControl.dayTargetHref, inventory);
    const rawSnapshotRestore = snapshotEntry?.restorePlan?.method === "POST" && snapshotEntry.restorePlan?.endpoint
      ? snapshotEntry.restorePlan
      : null;
    const snapshotRestore = rawSnapshotRestore && !String(rawSnapshotRestore.endpoint || "").startsWith(`${timeControl.href}/inbound-trunk-numbers`)
      ? rawSnapshotRestore
      : null;
    const fallbackRestore = fallbackDayTarget.isUnassigned
      ? null
      : {
        action: "restore-original-routing-from-time-control",
        method: "POST",
        endpoint: `${fallbackDayTarget.href}/inbound-trunk-numbers`,
        body: buildInboundAssignmentBody(did),
        note: "Tagesziel aus destinationIfAllowed der verwalteten Zeitsteuerung wiederherstellen.",
      };
    if (!snapshotRestore && !fallbackRestore && !fallbackDayTarget.isUnassigned) {
      blockers.push(`${didName}: kein gespeicherter Restore-Plan und kein Tagesziel in der Zeitsteuerung gefunden.`);
      continue;
    }
    restoreOperations.push({
      context: { did: didName, gateway: timeControl.name },
      operations: [
        {
          action: "remove-daynight-routing",
          method: "DELETE",
          endpoint: `${timeControl.href}/inbound-trunk-numbers/${encodeURIComponent(inboundNumberIdForDid(did))}`,
        },
        snapshotRestore || fallbackRestore,
      ].filter(Boolean),
    });
  }

  if (blockers.length) {
    return {
      ok: false,
      dryRun: false,
      applied: false,
      status: 409,
      title: "Reset blockiert",
      message: "Mindestens eine Rufnummer zeigt auf eine verwaltete Zeitsteuerung, aber der gespeicherte Restore-Plan fehlt.",
      blockers,
      attempts,
    };
  }

  for (const group of restoreOperations) {
    for (const operation of group.operations) {
      await runPortalOperation(operation, attempts, group.context);
    }
  }

  if (deleteTimeControls) {
    for (const timeControl of timeControls) {
      await runPortalOperation({
        action: "delete-managed-daynight-time-control",
        method: "DELETE",
        endpoint: timeControl.href,
      }, attempts, { timeControl: timeControl.name });
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
      ? `${restoreOperations.length} Rufnummer${restoreOperations.length === 1 ? "" : "n"} wiederhergestellt, ${timeControls.length} verwaltete Zeitsteuerung${timeControls.length === 1 ? "" : "en"} gelöscht.`
      : `${restoreOperations.length} Rufnummer${restoreOperations.length === 1 ? "" : "n"} wiederhergestellt. Vorbereitete Zeitsteuerungen bleiben für den nächsten Nachtmodus erhalten.`,
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
    const enabled = body?.enabled === true;
    if (enabled && !config.configured) {
      sendError(req, res, 400, "Portal API ist nicht vollständig konfiguriert.");
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
      sendJson(req, res, 200, summarizeEndpoint(await portalFetch("/api/version")));
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
    sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
    return;
  }

  if (url.pathname === "/api/callflow/bulk-apply" && req.method === "POST") {
    const result = await applyBulkCallflowChange(await readRequestJson(req));
    sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
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
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/gateway-routing/apply" && req.method === "POST") {
    try {
      const result = await applyDaynightGatewayRouting(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/time-controls/cleanup" && req.method === "POST") {
    try {
      const result = await cleanupDaynightTimeControls(await readRequestJson(req));
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/reset" && req.method === "POST") {
    try {
      const result = await resetDaynightTimeControls();
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
    } catch (error) {
      sendError(req, res, error.status || 500, portalErrorMessage(error), { code: error.code || undefined, body: error.body || null });
    }
    return;
  }

  if (url.pathname === "/api/daynight/restore" && req.method === "POST") {
    try {
      const result = await resetDaynightTimeControls({ deleteTimeControls: false });
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
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
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
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
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
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
      sendJson(req, res, 200, await createPortalResource(kind, await readRequestJson(req)));
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
    sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
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
      sendJson(req, res, result.ok ? 200 : result.status || 400, result.ok ? result : { ...result, error: result.message });
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
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === "/") pathname = "/index.html";
  const normalized = path.normalize(pathname).replace(/^(\.\.[/\\])+/, "");
  let filePath = path.join(PUBLIC_DIR, normalized);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendError(req, res, 403, "Forbidden");
    return;
  }

  const exists = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  if (!exists) {
    const ext = path.extname(filePath);
    if (!ext || ext === ".html") {
      filePath = path.join(PUBLIC_DIR, "index.html");
    } else {
      sendError(req, res, 404, "File not found");
      return;
    }
  }

  const ext = path.extname(filePath);
  const data = await fsp.readFile(filePath);
  res.writeHead(200, {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    "Cache-Control": "no-store",
  });
  res.end(data);
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "OPTIONS") {
      assertAllowedOrigin(req);
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host || `${config.host}:${config.port}`}`);
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
    sendError(req, res, error.status || 500, error.message || "Unexpected server error", { code: error.code || undefined });
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
