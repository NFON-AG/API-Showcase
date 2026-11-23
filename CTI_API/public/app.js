const STATIC_DEMO_MODE = Boolean(window.NFON_WEB_ONLY_DEMO);

// Explicit message keys keep generated copy and exports independent of DOM translation.
function message(key, fallback, params = {}) {
  const translated = window.NFON_I18N?.message?.(key, params);
  if (translated && translated !== key) return translated;
  return fallback.replace(/\{(\w+)\}/g, (_, name) => String(params[name] ?? `{${name}}`));
}

function messageMarkup(key, fallback, params = {}) {
  return `<span data-i18n-key="${escapeAttr(key)}" data-i18n-params="${escapeAttr(JSON.stringify(params))}">${escapeHtml(message(key, fallback, params))}</span>`;
}

function messageAttribute(attribute, key, fallback, params = {}) {
  return `data-i18n-${attribute}="${escapeAttr(key)}" data-i18n-${attribute}-params="${escapeAttr(JSON.stringify(params))}" ${attribute}="${escapeAttr(message(key, fallback, params))}"`;
}

function currentLocale() {
  const language = window.NFON_I18N?.getLanguage?.() || document.documentElement.lang || "en";
  return language === "en" ? "en-GB" : language;
}

const state = {
  status: null,
  extensions: [],
  states: [],
  activeCalls: [],
  history: [],
  events: [],
  google: null,
  storage: null,
  contactCache: new Map(),
  contactCacheVersion: 0,
  historyLimit: 80,
  serverMissing: false,
  demoPaused: Boolean(window.NFON_DEMO_PAUSED),
  lastPopupKey: "",
  popupVersion: 0,
  linePopoverToken: 0,
  eventRevision: 0,
  dialPending: false,
  refreshPending: false,
  popupMinimized: false,
  authLoginMode: storageGet("cti-auth-login-mode") || "env",
  contactsMode: storageGet("cti-contacts-mode") || "google",
  authLoginMessage: "",
  authLoginError: "",
  contactMessage: "",
  contactError: "",
  csrfToken: "",
};

const labels = {
  presence: {
    available: ["cti.presence.available", "Available"],
    offline: ["cti.presence.offline", "Offline"],
    dnd: ["cti.presence.dnd", "Do not disturb"],
    busy: ["cti.presence.busy", "Busy"],
    away: ["cti.presence.away", "Away"],
    unknown: ["cti.unknownInfo", "No information"],
  },
  line: {
    idle: ["cti.line.idle", "Idle"],
    "in-use": ["cti.line.inUse", "In a call"],
    ringing: ["cti.line.ringing", "Ringing"],
    busy: ["cti.line.busy", "Busy"],
    offline: ["cti.presence.offline", "Offline"],
    unknown: ["cti.unknownInfo", "No information"],
  },
  call: {
    start: ["cti.call.start", "Preparing call"],
    "caller-wait": ["cti.call.callerWait", "Waiting for extension"],
    "caller-dial": ["cti.call.callerDial", "Calling extension"],
    "caller-ring": ["cti.call.callerRing", "Extension ringing"],
    "caller-answer": ["cti.call.callerAnswer", "Extension answered"],
    dial: ["cti.call.dial", "Calling destination"],
    ring: ["cti.call.ring", "Destination ringing"],
    answer: ["cti.call.answer", "Call connected"],
    hangup: ["cti.call.hangup", "Call ended"],
    end: ["cti.call.end", "Request completed"],
    reject: ["cti.call.reject", "Rejected"],
  },
  direction: {
    inbound: ["cti.direction.inbound", "Inbound"],
    outbound: ["cti.direction.outbound", "Outbound"],
    unknown: ["cti.unknown", "Unknown"],
  },
};

const els = {
  account: document.getElementById("account-label"),
  connection: document.getElementById("connection-state"),
  refresh: document.getElementById("refresh-button"),
  metricExtensions: document.getElementById("metric-extensions"),
  metricAvailable: document.getElementById("metric-available"),
  metricActive: document.getElementById("metric-active"),
  metricEvents: document.getElementById("metric-events"),
  metricAnswered: document.getElementById("metric-answered"),
  metricTalkTime: document.getElementById("metric-talk-time"),
  timelineKicker: document.getElementById("timeline-kicker"),
  timelineChart: document.getElementById("timeline-chart"),
  trendKicker: document.getElementById("trend-kicker"),
  trendChart: document.getElementById("trend-chart"),
  directionKicker: document.getElementById("direction-kicker"),
  directionChart: document.getElementById("direction-chart"),
  teamKicker: document.getElementById("team-kicker"),
  teamRanking: document.getElementById("team-ranking"),
  qualityKicker: document.getElementById("quality-kicker"),
  qualityPanel: document.getElementById("quality-panel"),
  extensionFilter: document.getElementById("extension-filter"),
  extensionsBody: document.getElementById("extensions-body"),
  dashboardWorkspace: document.getElementById("dashboard-workspace"),
  dialStack: document.getElementById("dial-stack"),
  callerSelect: document.getElementById("caller-select"),
  calleeInput: document.getElementById("callee-input"),
  dialForm: document.getElementById("dial-form"),
  dialMessage: document.getElementById("dial-message"),
  activeCalls: document.getElementById("active-calls"),
  eventsList: document.getElementById("events-list"),
  historyBody: document.getElementById("history-body"),
  popover: document.getElementById("insight-popover"),
  callPopup: document.getElementById("call-popup"),
  googleConnect: document.getElementById("google-connect"),
  contactsListTitle: document.getElementById("contacts-list-title"),
  contactFilter: document.getElementById("contact-filter"),
  contactsList: document.getElementById("contacts-list"),
  contactsStatus: document.getElementById("contacts-status"),
  contactsLogin: document.getElementById("contacts-login"),
  contactsSync: document.getElementById("contacts-sync"),
  contactsDisconnect: document.getElementById("contacts-disconnect"),
  contactsModulePanel: document.getElementById("contacts-module-panel"),
  storageRefresh: document.getElementById("storage-refresh"),
  storageSummary: document.getElementById("storage-summary"),
  backupDownload: document.getElementById("backup-download"),
  backupImport: document.getElementById("backup-import"),
  backupMessage: document.getElementById("backup-message"),
  authLoginPanel: document.getElementById("auth-login-panel"),
  exportCsv: document.getElementById("export-csv"),
  exportExcel: document.getElementById("export-excel"),
};

const serverOrigin = storageGet("cti-server-origin") || "http://127.0.0.1:3002";
const fileMode = window.location.protocol === "file:";
const apiOrigin = fileMode && !STATIC_DEMO_MODE ? serverOrigin : "";

if (els.refresh) {
  els.refresh.title = message("cti.refresh.title", "Reload extensions, status and history");
}

if (els.contactsSync) els.contactsSync.title = message("cti.contacts.refresh", "Reload optional Google Contacts module");
if (els.contactsDisconnect) els.contactsDisconnect.title = message("cti.contacts.disconnectTitle", "Remove local connection and contact cache");
if (els.backupDownload) els.backupDownload.title = message("cti.backup.downloadTitle", "Save call history as a local JSON file");
if (els.backupImport) els.backupImport.title = message("cti.backup.importTitle", "Load backup and merge new call events");

function apiPath(path) {
  return `${apiOrigin}${path}`;
}

function googleLoginPath() {
  const query = new URLSearchParams();
  const theme = window.NFON_APPEARANCE?.getTheme?.() || document.documentElement.dataset?.nfonTheme;
  const language = window.NFON_I18N?.getLanguage?.() || document.documentElement.lang;
  if (["classic", "admin-portal"].includes(theme)) query.set("theme", theme);
  if (["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "cs"].includes(language)) query.set("lang", language);
  const cockpit = window.NFON_APPEARANCE?.getCockpitUrl?.();
  if (cockpit) query.set("cockpit", cockpit);
  return "/auth/google/start?" + query;
}

function requestMethod(options = {}) {
  return String(options.method || "GET").toUpperCase();
}

function isUnsafeRequest(options = {}) {
  return !["GET", "HEAD", "OPTIONS"].includes(requestMethod(options));
}

function rememberCsrfToken(body) {
  const token = body?.csrfToken || body?.status?.csrfToken;
  if (token) state.csrfToken = token;
}

async function ensureCsrfToken() {
  if (state.csrfToken) return;
  const response = await fetch(apiPath("/api/status"), {
    headers: { "Accept": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  rememberCsrfToken(body);
}

async function api(path, options = {}, retryCsrf = true) {
  if (isUnsafeRequest(options)) await ensureCsrfToken();
  const response = await fetch(apiPath(path), {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(isUnsafeRequest(options) ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  rememberCsrfToken(body);
  if (!response.ok) {
    if (retryCsrf && isUnsafeRequest(options) && response.status === 403 && body?.error === "Missing or invalid CSRF token") {
      state.csrfToken = "";
      return api(path, options, false);
    }
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  if (isUnsafeRequest(options) && /^\/api\/(?:local-contacts(?:\/|$)|google\/(?:sync|disconnect)$)/.test(path)) resetContactCache();
  return body;
}

function storageGet(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storageSet(key, value) { try { localStorage.setItem(key, value); } catch {} }
function extensionStateMap() {
  return new Map(state.states.map((item) => [String(item.extension), item]));
}

function extensionName(extensionNumber) {
  const found = state.extensions.find((extension) => String(extension.extension_number) === String(extensionNumber));
  return found?.name || extensionNumber || message("cti.unknown", "Unknown");
}

function formatTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return "";
  return new Intl.DateTimeFormat(currentLocale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dayKey(value = new Date()) {
  return new Date(value).toLocaleDateString("sv-SE");
}

function label(value, group) {
  if (value === undefined || value === null || value === "") return (labels[group]?.unknown ? message(...labels[group].unknown) : "") || message("cti.unknownInfo", "No information");
  return labels[group]?.[value] ? message(...labels[group][value]) : message("cti.unknownInfo", "No information");
}

function labelMarkup(value, group) {
  const entry = labels[group]?.[value] || labels[group]?.unknown || ["cti.unknownInfo", "No information"];
  return entry ? messageMarkup(...entry) : `<span data-i18n-ignore>${escapeHtml(value ?? "")}</span>`;
}

function rawLabel(value) {
  if (value === undefined || value === null || value === "") return "unknown";
  return String(value);
}

function rememberFocus(element = document.activeElement) {
  if (!element || element === document.body) return null;
  const keys = ["data-caller", "data-cancel", "data-session-id", "data-extension-detail", "data-line-status"];
  for (const key of keys) {
    if (element.hasAttribute?.(key)) {
      const selector = key === "data-line-status" ? '[data-line-status][data-extension="' + CSS.escape(element.dataset.extension || "") + '"]' : '[' + key + '="' + CSS.escape(element.getAttribute(key)) + '"]';
      return { element, selector };
    }
  }
  return { element, selector: element.id ? '#' + CSS.escape(element.id) : '' };
}

function restoreFocus(saved, fallback = false) {
  if (!saved) return;
  const element = saved.element?.isConnected ? saved.element : saved.selector ? document.querySelector(saved.selector) : null;
  if (element) element.focus?.({ preventScroll: true });
  else if (fallback) (els.extensionFilter || els.exportCsv || document.querySelector('.nav-button[aria-current="page"]'))?.focus();
}

function render() {
  const focus = rememberFocus();
  const analytics = buildAnalytics();
  renderStatus();
  renderGoogleStatus();
  renderMetrics(analytics);
  renderAnalytics(analytics);
  renderExtensions(analytics);
  renderCallerSelect();
  renderActiveCalls();
  renderEvents();
  renderHistory();
  renderAuthLoginPanel();
  renderStoragePage();
  restoreFocus(focus);
}



function renderStatus() {
  const status = state.status;
  els.connection.removeAttribute("data-status-mode");
  els.account.setAttribute("data-i18n-ignore", "");
  els.account.textContent = status?.account || message("shared.authRequired", "Sign in required");

  if (STATIC_DEMO_MODE) {
    els.connection.className = "connection";
    els.connection.setAttribute("data-status-mode", "demo");
    els.connection.setAttribute("data-i18n-ignore", "");
    els.connection.textContent = state.demoPaused ? message("demo.landing.paused", "Demo paused") : "Demo";
    els.connection.removeAttribute("title");
    return;
  }
  if (state.serverMissing) {
    els.connection.className = "connection is-warning";
    els.connection.textContent = message("cti.server.missing", "Server unavailable");
    els.connection.title = message("cti.server.open", "Start the local server and open {origin}", { origin: serverOrigin });
    return;
  }

  const callsConnected = Boolean(status?.streams?.calls?.connected);
  const statesConnected = Boolean(status?.streams?.states?.connected);
  els.connection.setAttribute("data-i18n-ignore", "");
  els.connection.className = "connection";
  els.connection.removeAttribute("title");

  const connectionError = status?.lastError || status?.streams?.calls?.lastError || status?.streams?.states?.lastError;
  if (connectionError) {
    els.connection.textContent = message("cti.api.error", "API error");
    els.connection.classList.add("is-warning");
    els.connection.title = message("cti.connection.retry", "Connection interrupted; retrying automatically");
  } else if (callsConnected && statesConnected) {
    els.connection.textContent = message("cti.connection.live", "Live");
    els.connection.classList.add("is-online");
  } else if (status?.credentialsConfigured) {
    els.connection.textContent = message("cti.api.ready", "API ready");
    els.connection.classList.add("is-warning");
  } else {
    els.connection.textContent = message("shared.authRequired", "Sign in required");
  }
}

function renderGoogleStatus() {
  if (!els.googleConnect) return;
  const google = state.google || state.status?.google;
  if (!google?.configured) {
    els.googleConnect.textContent = message("cti.contacts.google", "Google Contacts");
    els.googleConnect.title = message("cti.contacts.missing", "Optional Google Contacts module: credentials missing");
    els.googleConnect.classList.remove("is-connected");
    return;
  }
  if (google.connected) {
    els.googleConnect.textContent = message("cti.contacts.count", "Google Contacts {count}", { count: google.contacts || 0 });
    els.googleConnect.title = message("cti.contacts.connectedTitle", "Optional Google Contacts module connected");
    els.googleConnect.classList.add("is-connected");
    return;
  }
  els.googleConnect.textContent = message("cti.contacts.google", "Google Contacts");
  els.googleConnect.title = message("cti.contacts.connectTitle", "Connect optional Google Contacts module");
  els.googleConnect.classList.remove("is-connected");
}

function renderMetrics(analytics) {
  const available = state.states.filter((item) => item.presence === "available" && item.line === "idle").length;
  if (els.metricExtensions) els.metricExtensions.textContent = state.extensions.length;
  if (els.metricAvailable) els.metricAvailable.textContent = available;
  if (els.metricActive) els.metricActive.textContent = state.activeCalls.length;
  if (els.metricEvents) els.metricEvents.textContent = analytics.today.total;
  if (els.metricAnswered) els.metricAnswered.textContent = analytics.today.answered;
  if (els.metricTalkTime) els.metricTalkTime.textContent = formatDuration(analytics.today.talkMs, true);
  renderMetricComparison(els.metricEvents, message("cti.analytics.previousDay", "Previous day"), analytics.yesterday.total, analytics.today.total);
  renderMetricDetail(els.metricAnswered, message("cti.analytics.missed", "Missed {count}", { count: analytics.today.missed }), "mixed");
}

function renderMetricDetail(valueElement, text, variant = "") {
  const metric = valueElement?.closest?.(".metric");
  if (!metric) return;
  let detail = metric.querySelector(".metric-detail");
  if (!detail) {
    detail = document.createElement("span");
    detail.className = "metric-detail";
    valueElement.after(detail);
  }
  detail.className = `metric-detail ${variant}`.trim();
  detail.textContent = text;
}

function renderMetricComparison(valueElement, label, previous, current) {
  const metric = valueElement?.closest?.(".metric");
  if (!metric) return;
  let detail = metric.querySelector(".metric-detail");
  if (!detail) {
    detail = document.createElement("span");
    valueElement.after(detail);
  }
  const delta = current - previous;
  const percent = previous === 0 ? null : Math.round((delta / previous) * 100);
  const trendClass = percent > 0 ? "positive" : percent < 0 ? "negative" : "neutral";
  const trendText = percent === null ? "—" : `${percent > 0 ? "+" : ""}${percent}%`;
  const trend = document.createElement("span");
  trend.className = `metric-change ${trendClass}`;
  trend.textContent = trendText;
  detail.className = "metric-detail comparison";
  detail.replaceChildren(
    createTextSpan("metric-previous", `${label} ${previous}`),
    trend,
  );
}

function createTextSpan(className, text) {
  const span = document.createElement("span");
  span.className = className;
  span.textContent = text;
  return span;
}

function signedCount(value) {
  if (value === 0) return "+/-0";
  return `${value > 0 ? "+" : ""}${value}`;
}

function renderAnalytics(analytics) {
  renderTimeline(analytics);
  renderTrend(analytics);
  renderDirection(analytics);
  renderTeamRanking(analytics);
  renderQuality(analytics);
}

function renderTimeline(analytics) {
  if (!els.timelineChart) return;
  const activeHours = analytics.hourly.filter((item) => item.total > 0).map((item) => item.hour);
  const endHour = Math.min(23, Math.max(new Date().getHours(), ...activeHours, 17));
  const startHour = Math.min(Math.max(0, endHour - 11), ...activeHours);
  const visibleHours = analytics.hourly.slice(startHour, endHour + 1);
  const max = Math.max(1, ...visibleHours.flatMap((item) => [item.inboundAnswered, item.missed, item.outbound]));
  const width = 520;
  const height = 174;
  const points = chartPoints(visibleHours, max, width, height);
  if (els.timelineKicker) els.timelineKicker.textContent = message("cti.analytics.summary", "{answered} answered · {missed} missed · {outbound} outbound", { answered: analytics.today.inboundAnswered, missed: analytics.today.missed, outbound: analytics.today.outbound });
  const gradients = [
    ["answeredFill", "#00d981"],
    ["missedFill", "#f36b5b"],
    ["outboundFill", "#3513cf"],
  ].map(([id, color]) => `
    <linearGradient id="${id}" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.18"></stop>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"></stop>
    </linearGradient>
  `).join("");
  els.timelineChart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height - 30}" preserveAspectRatio="none" aria-hidden="true">
      <defs>${gradients}</defs>
      <path d="M28 126H500" stroke="#d8e0df"></path>
      <path d="M28 78H500" stroke="#edf1f0"></path>
      <path d="${areaPath(points.inboundAnswered, points.baseline)}" fill="url(#answeredFill)"></path>
      <path d="${areaPath(points.missed, points.baseline)}" fill="url(#missedFill)"></path>
      <path d="${areaPath(points.outbound, points.baseline)}" fill="url(#outboundFill)"></path>
      <path d="${smoothPath(points.inboundAnswered)}" fill="none" stroke="#00d981" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${smoothPath(points.missed)}" fill="none" stroke="#f36b5b" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${smoothPath(points.outbound)}" fill="none" stroke="#3513cf" stroke-width="4" vector-effect="non-scaling-stroke" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <div class="timeline-axis" aria-hidden="true">
      ${visibleHours.map((item, index) => `<span style="left:${points.x(index) / width * 100}%">${escapeHtml(String(item.hour).padStart(2, "0"))}</span>`).join("")}
    </div>
    <div class="chart-legend">
      <span><i class="legend-dot green"></i><span data-i18n-key="cti.calls.answered">Answered</span></span>
      <span><i class="legend-dot coral"></i><span data-i18n-key="cti.calls.missed">Missed</span></span>
      <span><i class="legend-dot blue"></i><span data-i18n-key="cti.direction.outbound">Outbound</span></span>
    </div>
  `;
}

function renderTrend(analytics) {
  if (!els.trendChart) return;
  const max = Math.max(1, ...analytics.daily.map((item) => item.total));
  const total = analytics.daily.reduce((sum, item) => sum + item.total, 0);
  if (els.trendKicker) els.trendKicker.textContent = message("cti.calls.count", "{count} calls", { count: total });
  els.trendChart.innerHTML = `
    <div class="daily-bars">
      ${analytics.daily.map((item) => {
        const answeredHeight = Math.max(0, Math.round((item.inboundAnswered / max) * 128));
        const missedHeight = Math.max(0, Math.round((item.missed / max) * 128));
        const outboundHeight = Math.max(0, Math.round((item.outbound / max) * 128));
        return `
          <div class="daily-slot" ${messageAttribute("title", "cti.calls.dayCount", "{day} · {count} calls", { day: item.label, count: item.total })}>
            <strong>${item.total || ""}</strong>
            <div class="daily-stack">
              <span class="bar-segment answered" style="height:${answeredHeight}px"></span>
              <span class="bar-segment missed" style="height:${missedHeight}px"></span>
              <span class="bar-segment outbound" style="height:${outboundHeight}px"></span>
            </div>
            <span data-i18n-ignore>${escapeHtml(item.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
    <div class="chart-legend">
      <span><i class="legend-dot green"></i><span data-i18n-key="cti.calls.answered">Answered</span></span>
      <span><i class="legend-dot coral"></i><span data-i18n-key="cti.calls.missed">Missed</span></span>
      <span><i class="legend-dot blue"></i><span data-i18n-key="cti.direction.outbound">Outbound</span></span>
    </div>
  `;
}

function renderDirection(analytics) {
  if (!els.directionChart) return;
  const inbound = analytics.today.inbound;
  const outbound = analytics.today.outbound;
  const other = Math.max(0, analytics.today.total - inbound - outbound);
  const yesterdayInbound = analytics.yesterday?.inbound || 0;
  const yesterdayOutbound = analytics.yesterday?.outbound || 0;
  const hoverDetailsSource = [
    message("cti.analytics.inboundComparison", "Inbound: {count} ({delta} vs previous day)", { count: inbound, delta: signedCount(inbound - yesterdayInbound) }),
    message("cti.analytics.outboundComparison", "Outbound: {count} ({delta} vs previous day)", { count: outbound, delta: signedCount(outbound - yesterdayOutbound) }),
    message("cti.analytics.other", "Unknown: {count}", { count: other }),
  ].join("\n");
  const hoverDetails = hoverDetailsSource;
  const callTotal = inbound + outbound + other;
  const total = Math.max(1, callTotal);
  const inboundDeg = Math.round((inbound / total) * 360);
  const outboundDeg = Math.round((outbound / total) * 360);
  const otherDeg = inbound + outbound + other ? Math.max(0, 360 - inboundDeg - outboundDeg) : 0;
  if (els.directionKicker) els.directionKicker.textContent = `${inbound} / ${outbound}`;
  els.directionChart.innerHTML = `
    <div class="donut" title="${escapeHtml(hoverDetails)}" aria-label="${escapeHtml(hoverDetails)}" style="background: ${callTotal ? `conic-gradient(var(--accent) 0 ${inboundDeg}deg, var(--nfon-blue) ${inboundDeg}deg ${inboundDeg + outboundDeg}deg, var(--purple-soft) ${inboundDeg + outboundDeg}deg ${inboundDeg + outboundDeg + otherDeg}deg)` : "var(--line)"}"></div>
    <div class="donut-legend">
      <span><i class="legend-dot green"></i><span data-i18n-key="cti.direction.inbound">Inbound</span><b>${inbound}</b></span>
      <span><i class="legend-dot blue"></i><span data-i18n-key="cti.direction.outbound">Outbound</span><b>${outbound}</b></span>
      <span><i class="legend-dot soft"></i><span data-i18n-key="cti.analytics.unclear">Unknown</span><b>${other}</b></span>
    </div>
  `;
}

function renderTeamRanking(analytics) {
  if (!els.teamRanking) return;
  const rows = analytics.team.slice(0, 8);
  const max = Math.max(1, ...rows.map((item) => item.total));
  if (els.teamKicker) els.teamKicker.textContent = rows.length ? message("cti.analytics.active", "{count} active", { count: rows.length }) : message("cti.analytics.noCalls", "No calls yet");
  if (!rows.length) {
    els.teamRanking.className = "empty-list";
    els.teamRanking.textContent = message("cti.analytics.noTodayCalls", "No calls in today’s history");
    return;
  }

  els.teamRanking.className = "ranking-list";
  els.teamRanking.innerHTML = rows.map((item) => {
    const inboundWidth = Math.round((item.inbound / max) * 100);
    const outboundWidth = Math.round((item.outbound / max) * 100);
    return `
      <div class="ranking-row" ${messageAttribute("title", "cti.analytics.extensionSummary", "{extension} · {inbound} inbound · {outbound} outbound · {missed} missed", { extension: item.extension, inbound: item.inbound, outbound: item.outbound, missed: item.missed })}>
        <div class="ranking-main">
          <strong data-i18n-ignore>${escapeHtml(extensionName(item.extension))}</strong>
          ${messageMarkup("cti.calls.extensionCount", "{extension} · {count} calls", { extension: item.extension, count: item.total })}
        </div>
        <strong class="ranking-side-value inbound">${item.inbound}</strong>
        <div class="ranking-bar split">
          <span class="ranking-inbound" style="width:${Math.max(item.inbound ? 4 : 0, inboundWidth)}%"></span>
          <span class="ranking-outbound" style="width:${Math.max(item.outbound ? 4 : 0, outboundWidth)}%"></span>
        </div>
        <strong class="ranking-side-value outbound">${item.outbound}</strong>
      </div>
    `;
  }).join("");
}

function renderQuality(analytics) {
  if (!els.qualityPanel) return;
  const quote = analytics.today.total ? Math.round((analytics.today.answered / analytics.today.total) * 100) : 0;
  const topUsers = analytics.team.slice(0, 3);
  if (els.qualityKicker) els.qualityKicker.textContent = message("cti.today", "Today");
  els.qualityPanel.innerHTML = `
    <div class="quality-item">
      <span data-i18n-key="cti.analytics.answerRate">Answer rate</span>
      <strong>${quote}%</strong>
    </div>
    <div class="quality-item">
      <span data-i18n-key="cti.analytics.average">Average</span>
      <strong>${formatDuration(analytics.today.avgTalkMs, true)}</strong>
    </div>
    <div class="quality-item">
      <span data-i18n-key="cti.calls.missed">Missed</span>
      <strong class="value-missed">${analytics.today.missed}</strong>
    </div>
    <div class="quality-item">
      <span data-i18n-key="cti.analytics.peak">Peak hour</span>
      <strong>${escapeHtml(analytics.peakHour)}</strong>
    </div>
    <div class="quality-item wide">
      <span data-i18n-key="cti.analytics.directions">Inbound / Outbound</span>
      <strong><span class="value-inbound">${analytics.today.inbound}</span><span class="value-separator"> / </span><span class="value-outbound">${analytics.today.outbound}</span></strong>
    </div>
    <div class="quality-item wide top-users">
      <span data-i18n-key="cti.analytics.topUsers">Top 3 users</span>
      <div class="quality-users">
        ${topUsers.length ? topUsers.map((item, index) => `
          <div class="quality-user-row">
            <b>${index + 1}</b>
            <strong data-i18n-ignore>${escapeHtml(extensionName(item.extension))}</strong>
            <small>${messageMarkup("cti.analytics.userSummary", "{inbound} inbound · {outbound} outbound", { inbound: item.inbound, outbound: item.outbound })}</small>
          </div>
        `).join("") : `<div class="empty-list compact" data-i18n-key="cti.analytics.noUsers">No user data yet</div>`}
      </div>
    </div>
  `;
}

function renderExtensions(analytics) {
  if (!els.extensionsBody) return;
  const filter = els.extensionFilter ? els.extensionFilter.value.trim().toLowerCase() : "";
  const statesByExtension = extensionStateMap();
  const rows = state.extensions.filter((extension) => {
    const haystack = `${extension.name || ""} ${extension.extension_number || ""}`.toLowerCase();
    return !filter || haystack.includes(filter);
  });

  els.extensionsBody.innerHTML = rows.map((extension) => {
    const number = String(extension.extension_number || "");
    const current = statesByExtension.get(number) || {};
    const presence = rawLabel(current.presence);
    const line = rawLabel(current.line);
    const extensionAnalytics = analytics.byExtension.get(number) || emptyExtensionAnalytics(number);
    return `
      <tr data-extension-row="${escapeHtml(number)}">
        <td class="extension-name" tabindex="0" data-extension-detail="${escapeHtml(number)}" data-extension="${escapeHtml(number)}" data-i18n-ignore>${escapeHtml(extension.name || "")}</td>
        <td>${escapeHtml(number)}</td>
        <td><span class="status-chip ${escapeHtml(presence)}" ${messageAttribute("title", "cti.technical", "Technical: {detail}", { detail: `presence=${presence}` })}>${labelMarkup(presence, "presence")}</span></td>
        <td><span tabindex="0" class="status-chip ${escapeHtml(line)}" data-line-status data-extension="${escapeHtml(number)}" data-line="${escapeHtml(line)}" data-since="${escapeHtml(current.lineSince || current.receivedAt || "")}" ${messageAttribute("title", "cti.technical", "Technical: {detail}", { detail: `line=${line}` })}>${labelMarkup(line, "line")}</span></td>
        <td>
          <button class="direction-chip outbound direction-button" data-caller="${escapeHtml(number)}" ${messageAttribute("title", "cti.dial.extensionTitle", "Call from this extension · {count} calls today", { count: extensionAnalytics.total })} ${messageAttribute("aria-label", "cti.dial.extensionLabel", "Call from {name}", { name: extension.name || number })}>↗</button>
        </td>
      </tr>
    `;
  }).join("");

  els.extensionsBody.querySelectorAll("[data-caller]").forEach((button) => {
    button.addEventListener("click", () => {
      showDialPanel();
      els.callerSelect.value = button.dataset.caller;
      storageSet("cti-selected-caller", button.dataset.caller);
      els.calleeInput.focus();
    });
  });
}

function showDialPanel() {
  hidePopover();
  state.dialReturnFocus = document.activeElement;
  state.dialReturnExtension = document.activeElement?.dataset?.caller || "";
  ensureDialModalControls();
  if (els.dialForm) els.dialForm.hidden = false;
  if (els.dialStack) {
    els.dialStack.classList.remove("is-hidden");
    els.dialStack.classList.add("is-modal");
  }
  if (els.dashboardWorkspace) els.dashboardWorkspace.classList.add("no-dial");
  document.body.classList.add("dial-modal-open");
}

function hideDialPanel() {
  if (els.dialForm) els.dialForm.hidden = true;
  if (els.dialStack) {
    els.dialStack.classList.add("is-hidden");
    els.dialStack.classList.remove("is-modal");
  }
  document.body.classList.remove("dial-modal-open");
  if (state.dialReturnFocus?.isConnected) state.dialReturnFocus.focus();
  else if (state.dialReturnExtension) els.extensionsBody?.querySelector(`[data-caller="${CSS.escape(state.dialReturnExtension)}"]`)?.focus();
  else els.refresh?.focus();
}

function ensureDialModalControls() {
  if (els.dialStack && !els.dialStack.querySelector(".dial-modal-backdrop")) {
    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "dial-modal-backdrop";
    backdrop.setAttribute("data-i18n-aria-label", "cti.dial.close");
    backdrop.setAttribute("aria-label", message("cti.dial.close", "Close Click-to-Dial"));
    backdrop.addEventListener("click", hideDialPanel);
    els.dialStack.prepend(backdrop);
  }

  if (els.dialForm && !els.dialForm.querySelector("[data-dial-close]")) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "modal-close";
    closeButton.dataset.dialClose = "";
    closeButton.setAttribute("data-i18n-aria-label", "cti.dial.close");
    closeButton.setAttribute("aria-label", message("cti.dial.close", "Close Click-to-Dial"));
    closeButton.innerHTML = "&times;";
    closeButton.addEventListener("click", hideDialPanel);
    els.dialForm.append(closeButton);
  }
}

function renderCallerSelect() {
  if (!els.callerSelect) return;
  const selected = els.callerSelect.value || storageGet("cti-selected-caller") || "100";
  const options = state.extensions.map((extension) => {
    const value = extension.extension_number;
    const text = `${extension.extension_number} - ${extension.name}`;
    return `<option value="${escapeHtml(value)}" data-i18n-ignore>${escapeHtml(text)}</option>`;
  }).join("");
  els.callerSelect.innerHTML = options;
  if (state.extensions.some((extension) => extension.extension_number === selected)) {
    els.callerSelect.value = selected;
  }
}

function renderActiveCalls() {
  if (!els.activeCalls) return;
  if (!state.activeCalls.length) {
    els.activeCalls.className = "empty-list";
    els.activeCalls.textContent = message("cti.calls.none", "No active calls");
    return;
  }

  els.activeCalls.className = "";
  els.activeCalls.innerHTML = state.activeCalls.map((call) => `
    <div class="active-call" ${messageAttribute("title", "cti.technical", "Technical: {detail}", { detail: `${call.uuid || ""} · ${rawLabel(call.state)}` })}>
      <strong>${labelMarkup(call.state, "call")} · <span data-i18n-ignore>${escapeHtml(extensionName(call.extension))}</span></strong>
      <span class="muted">${escapeHtml(formatPhone(call.caller))} -> ${escapeHtml(formatPhone(call.callee))}</span>
      <div class="active-call-footer">
        <span class="event-time">${escapeHtml(formatTime(call.receivedAt || call.updated))}</span>
        <button class="secondary-button" data-cancel="${escapeHtml(call.uuid)}" data-i18n-key="cti.cancel">Cancel</button>
      </div>
    </div>
  `).join("");

  els.activeCalls.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/calls/${encodeURIComponent(button.dataset.cancel)}`, { method: "DELETE" });
        state.activeCalls = state.activeCalls.filter((call) => call.uuid !== button.dataset.cancel);
        renderActiveCalls();
        (els.activeCalls.querySelector("[data-cancel]") || els.extensionFilter || els.exportCsv || document.querySelector('.nav-button[aria-current="page"]'))?.focus();
      } catch (error) {
        showDialMessage(error.message, true);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderEvents() {
  if (!els.eventsList) return;
  els.eventsList.innerHTML = state.events.slice(0, 40).map((event) => `
    <li class="event-item" title="${escapeHtml(event.tech || "")}">
      <span class="event-time">${escapeHtml(formatTime(event.receivedAt || event.updated))}</span>
      <span class="event-title">${copyMarkup(resolveCopy(event.title))}</span>
      <span class="event-detail">${copyMarkup(resolveCopy(event.detail))}</span>
    </li>
  `).join("");
}

function renderHistory() {
  if (!els.historyBody) return;
  const allSessions = buildAnalytics().sessions;
  const sessions = allSessions.slice(0, state.historyLimit);
  const summary = document.getElementById("history-count");
  if (summary) summary.textContent = message("cti.history.visible", "{shown} of {total} calls", { shown: sessions.length, total: allSessions.length });
  const more = document.getElementById("history-more");
  if (more) more.hidden = sessions.length >= allSessions.length;
  els.historyBody.innerHTML = sessions.map((session) => `
    <tr tabindex="0" class="history-group-row" data-session-id="${escapeHtml(session.uuid || "")}" ${messageAttribute("title", "cti.technical", "Technical: {detail}", { detail: `${session.uuid || ""} · ${message("cti.events.count", "Events: {count}", { count: session.eventCount })}` })}>
      <td>
        <div class="history-time">
          <strong>${escapeHtml(formatDate(session.startedAt))}</strong>
          <span>${escapeHtml(formatDuration(session.durationMs))}</span>
        </div>
      </td>
      <td>
        <div class="history-state-stack">
          <span class="status-chip ${escapeHtml(sessionStatusClass(session))}">${escapeHtml(sessionStatusLabel(session))}</span>
          <small>${messageMarkup("cti.events.count", "Events: {count}", { count: session.eventCount })}</small>
        </div>
      </td>
      <td>${directionCell(session.direction)}</td>
      ${historyPartyCells(session)}
    </tr>
  `).join("");
  hydrateContactCells();
}

function sessionStatusLabel(session) {
  if (session.missed) return message("cti.call.missed", "Missed");
  if (session.answered) return message("cti.call.answered", "Answered");
  if (session.direction === "outbound") return message("cti.direction.outbound", "Outbound");
  const lastState = session.states[session.states.length - 1];
  return label(lastState, "call");
}

function sessionStatusClass(session) {
  if (session.missed) return "missed";
  if (session.answered) return "answer";
  if (session.direction === "outbound") return "outbound";
  return rawLabel(session.states[session.states.length - 1]);
}

function directionCell(direction) {
  const value = rawLabel(direction);
  const symbol = value === "inbound" ? "↙" : value === "outbound" ? "↗" : "?";
  return `<span class="direction-chip ${escapeHtml(value)}" title="${escapeHtml(label(value, "direction"))}" aria-label="${escapeHtml(label(value, "direction"))}">${symbol}</span>`;
}

function historyPartyCells(call) {
  const extension = rawLabel(call.extension);
  const externalPhone = externalPartyPhone(call);
  const internal = internalContactCell(extension);
  const external = `<td data-contact-phone="${escapeHtml(externalPhone)}">${escapeHtml(formatPhone(externalPhone))}</td>`;
  return isOutboundCall(call)
    ? `${internal}${external}`
    : `${external}${internal}`;
}

function internalContactCell(extension) {
  const name = extensionName(extension);
  return `
    <td>
      <div class="history-contact">
        <div class="history-avatar agent-avatar" data-i18n-ignore>${escapeHtml(initials(name))}</div>
        <div>
          <strong data-i18n-ignore>${escapeHtml(name)}</strong>
          <span>${messageMarkup("cti.extension.number", "Extension {extension}", { extension })}</span>
        </div>
      </div>
    </td>
  `;
}

async function exportHistory(format) {
  const rows = await exportRows();
  const stamp = new Date().toISOString().slice(0, 10);
  if (format === "excel") {
    const table = rowsToHtmlTable(rows);
    downloadBlob(`nfon-cti-${STATIC_DEMO_MODE ? "demo" : "calls"}-${stamp}.xls`, `\ufeff${table}`, "application/vnd.ms-excel;charset=utf-8");
    return;
  }
  downloadBlob(`nfon-cti-${STATIC_DEMO_MODE ? "demo" : "calls"}-${stamp}.csv`, `\ufeff${rowsToCsv(rows)}`, "text/csv;charset=utf-8");
}

async function exportRows() {
  const sessions = buildCallSessions(historySource());
  // Capture every generated label before the first asynchronous contact lookup.
  // A language change must not change this export's columns or row contents.
  const headers = exportHeaders();
  const keys = ["date", "status", "direction", "from", "to", "extension", "duration", "events", "callId"];
  const columns = Object.fromEntries(keys.map((key, index) => [key, headers[index]]));
  const prepared = sessions.map((session) => ({
    session,
    internal: message("cti.extension.named", "{name} · Extension {extension}", { name: extensionName(session.extension), extension: session.extension }),
    external: formatPhone(externalPartyPhone(session)),
    row: {
      [columns.date]: session.startedAt,
      [columns.status]: sessionStatusLabel(session),
      [columns.direction]: label(session.direction, "direction"),
      [columns.from]: "",
      [columns.to]: "",
      [columns.extension]: `${extensionName(session.extension)} (${session.extension})`,
      [columns.duration]: formatDuration(session.durationMs),
      [columns.events]: session.eventCount,
      [columns.callId]: session.uuid || "",
    },
  }));
  for (const { session, internal, external, row } of prepared) {
    const parties = await exportParties(session, internal, external);
    row[columns.from] = parties.from;
    row[columns.to] = parties.to;
  }
  return prepared.map(({ row }) => row);
}

async function exportParties(session, internal = message("cti.extension.named", "{name} · Extension {extension}", { name: extensionName(session.extension), extension: session.extension }), externalLabel = formatPhone(externalPartyPhone(session))) {
  const externalPhone = externalPartyPhone(session);
  let external = externalLabel;
  try {
    const contact = await lookupContact(externalPhone);
    if (contact?.name) {
      external = contact.organization
        ? `${contact.name} · ${contact.organization} · ${externalLabel}`
        : `${contact.name} · ${externalLabel}`;
    }
  } catch {
    // Keep the phone number when contact lookup is currently unavailable.
  }
  return isOutboundCall(session)
    ? { from: internal, to: external }
    : { from: external, to: internal };
}

function exportHeaders() {
  return [message("cti.export.date", "Date"), message("cti.export.status", "Status"), message("cti.export.direction", "Direction"), message("cti.export.from", "From"), message("cti.export.to", "To"), message("cti.export.extension", "Extension"), message("cti.export.duration", "Duration"), message("cti.export.events", "Events"), message("cti.export.callId", "Call ID")];
}

function rowsToCsv(rows) {
  const headers = rows[0] ? Object.keys(rows[0]) : exportHeaders();
  return [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";")),
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  // A plus-prefixed phone number is numeric data. Other formula prefixes and
  // control characters must never become executable spreadsheet content.
  const safePhone = text.startsWith("+") && Boolean(window.NFON_PHONE?.dial(text));
  const safe = !safePhone && /^(?:[\t\r\n]|\s*[=+\-@])/.test(text) ? "'" + text : text;
  return '"' + safe.replaceAll('"', '""') + '"';
}

function rowsToHtmlTable(rows) {
  const headers = rows[0] ? Object.keys(rows[0]) : exportHeaders();
  return `
    <html>
      <head><meta charset="utf-8"></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${headers.map((header) => `<td style="mso-number-format: &quot;\\@&quot;" x:str>${escapeHtml(String(row[header] ?? "").replace(/[\t\r\n]/g, " "))}</td>`).join("")}</tr>`).join("")}
          </tbody>
        </table>
      </body>
    </html>
  `;
}

function downloadBlob(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  try {
    document.body.append(link);
    link.click();
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  } finally {
    link.remove();
  }
  // Embedded browsers may consume the file after the click handler returns.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function historySource() { return state.history; }

const localErrorMessages = [
  { key: "cti.error.nfonCredentials", en: "NFON credentials are missing" },
  { key: "cti.error.nfonLogin", en: "NFON sign-in failed" },
  { key: "cti.error.nfonRetry", en: "NFON sign-in is temporarily delayed after a failed attempt" },
  { key: "cti.error.backupFormat", en: "Invalid backup format" },
  { key: "cti.error.backupSchema", en: "Unsupported backup schema" },
  { key: "cti.error.backupEvent", en: "Backup contains an invalid call event" },
  { key: "cti.error.backupAccount", en: "Backup belongs to a different NFON account" },
  { key: "cti.error.photo", en: "Contact photo must be a PNG, JPEG or WebP image" },
  { key: "cti.error.international", en: "Use an international number beginning with + or 00" },
  { key: "cti.error.dialTarget", en: "Use a valid international number (+ or 00) or an extension of 1–6 digits" },
  { key: "cti.error.dialTimeout", en: "Call timeout must be a whole number between 1 and 120 seconds" },
  { key: "cti.error.googleChanged", en: "Google connection changed; retry the request" },
  { key: "cti.error.dialPending", en: "A call to this number is already being started" },
  { key: "cti.error.callEnded", en: "Call is no longer active" },
  {
    "key": "cti.error.credentialsRequired",
    "en": "K-Account, API username and API password are required",
    "de": "K-Account, API Username und API Password sind erforderlich"
  },
  {
    "key": "cti.error.emptyBackup",
    "en": "Backup contains no call events",
    "de": "Backup enthaelt keine Call-Events"
  },
  {
    "key": "cti.error.googleTokenRead",
    "en": "Could not read Google token",
    "de": "Google Token konnte nicht gelesen werden"
  },
  {
    "key": "cti.error.googleContactsRead",
    "en": "Could not read Google contacts",
    "de": "Google Kontakte konnten nicht gelesen werden"
  },
  {
    "key": "cti.error.localContactsRead",
    "en": "Could not read local contacts",
    "de": "Lokale Kontakte konnten nicht gelesen werden"
  },
  {
    "key": "cti.error.contactRequired",
    "en": "Name and phone number are required",
    "de": "Name und Telefonnummer sind erforderlich"
  },
  {
    "key": "cti.error.contactNotFound",
    "en": "Local contact not found",
    "de": "Lokaler Kontakt wurde nicht gefunden"
  },
  {
    "key": "cti.error.googleDisconnected",
    "en": "Google Contacts is not connected",
    "de": "Google Contacts ist noch nicht verbunden"
  },
  {
    "key": "cti.error.googleTokenRefresh",
    "en": "Could not refresh Google token",
    "de": "Google Token konnte nicht erneuert werden"
  },
  {
    "key": "cti.error.googleCredentials",
    "en": "Google OAuth credentials are missing",
    "de": "Google OAuth Zugangsdaten fehlen"
  },
  {
    "key": "cti.error.googleCode",
    "en": "Google sign-in returned no code",
    "de": "Google Login ohne Code"
  },
  {
    "key": "cti.error.googleState",
    "en": "Google OAuth state is invalid or expired",
    "de": "Google OAuth State ist ungueltig oder abgelaufen"
  },
  {
    "key": "cti.error.googleLogin",
    "en": "Google sign-in failed",
    "de": "Google Login fehlgeschlagen"
  }
];

function errorCopy(value) {
  if (typeof value !== "string") return value;
  if (value === "Google token revocation failed") return copy("cti.contacts.revocationWarning", "Disconnected locally. Google permission could not be revoked.");
  for (const entry of localErrorMessages) {
    for (const source of [entry.en, entry.de].filter(Boolean)) {
      if (value === source || value.startsWith(`${source}:`)) {
        return copy(entry.key, `${entry.en}{detail}`, { detail: value.slice(source.length) });
      }
    }
  }
  if (/^(?:Call request|Cancel request) failed with HTTP 403/.test(value)) return copy("cti.error.notAllowed", "This action is not permitted for this account");
  if (/^(?:Call request|Cancel request) failed with HTTP 401/.test(value)) return copy("cti.error.nfonRetry", "NFON sign-in is temporarily delayed after a failed attempt");
  if (/^(?:fetch failed|Failed to fetch|NetworkError|NFON login did not return|Google token revocation failed|NFON event stream|Extension request|State request|Call request|Cancel request|NFON account changed|NFON extension response|NFON state response)/.test(value)) return copy("cti.error.request", "Request failed");
  return value;
}

function copy(key, fallback, params = {}) { return { key, fallback, params }; }

function copyMarkup(value) {
  return value && typeof value === "object" && value.key
    ? messageMarkup(value.key, value.fallback, value.params)
    : `<span data-i18n-ignore>${escapeHtml(value || "")}</span>`;
}

function resolveCopy(value) {
  return typeof value === "function" ? value() : value;
}

function addEvent(title, detail, source = {}) {
  state.events.unshift({
    title,
    detail,
    receivedAt: new Date().toISOString(),
    tech: source.tech || technicalSummary(source),
    ...source,
  });
  state.events = state.events.slice(0, 100);
}

function resetContactCache() {
  state.contactCache.clear();
  state.contactCacheVersion += 1;
}

function invalidateContacts(status) {
  const revision = status?.contactsRevision;
  if (revision === undefined || revision === state.contactsRevision) return;
  state.contactsRevision = revision;
  resetContactCache();
}

function mergeSnapshot(snapshot) {
  invalidateContacts(snapshot.status);
  state.status = snapshot.status || state.status;
  rememberCsrfToken(snapshot.status);
  state.google = snapshot.status?.google || state.google;
  state.extensions = snapshot.extensions || state.extensions;
  state.states = snapshot.states || state.states;
  state.activeCalls = snapshot.activeCalls || state.activeCalls;
  state.history = snapshot.history || state.history;
}

function handleEvent(payload) {
  state.eventRevision += 1;
  if (payload.type === "snapshot") {
    if (payload.status?.account !== state.status?.account) { resetContactCache(); state.events = []; hideCallPopup(); }
    mergeSnapshot(payload);
  }
  if (payload.type === "status") {
    invalidateContacts(payload.status);
    state.status = payload.status;
    rememberCsrfToken(payload.status);
    state.google = payload.status?.google || state.google;
  }
  if (payload.type === "extensions") {
    state.extensions = payload.extensions || [];
  }
  if (payload.type === "states") {
    state.states = payload.states || [];
  }
  if (payload.type === "state") {
    const others = state.states.filter((item) => String(item.extension) !== String(payload.state.extension));
    state.states = [...others, payload.state];
    state.activeCalls = payload.activeCalls || state.activeCalls;
    addEvent(
      () => copy("cti.event.line", "{name} is {status}", { name: extensionName(payload.state.extension), status: label(payload.state.line, "line") }),
      () => copy("cti.event.presence", "{presence} · Extension {extension}", { presence: label(payload.state.presence, "presence"), extension: payload.state.extension }),
      payload.state,
    );
  }
  if (payload.type === "call") {
    state.activeCalls = payload.activeCalls || state.activeCalls;
    const call = payload.call;
    state.history = payload.history || (call && !payload.historyPending ? [call, ...state.history.filter((item) => `${item.uuid}:${item.state}:${item.updated || item.receivedAt}` !== `${call.uuid}:${call.state}:${call.updated || call.receivedAt}`)] : state.history);
    if (call) addEvent(
      () => labels.call[call.state] ? copy(...labels.call[call.state]) : rawLabel(call.state),
      `${extensionName(call.extension)} · ${formatPhone(call.caller)} -> ${formatPhone(call.callee)}`,
      call,
    );
    if (call) maybeShowCallPopup(call);
  }
  if (payload.type === "history" && payload.account === state.status?.account) {
    const committed = payload.events || [];
    const key = (event) => `${event.uuid}:${event.state}:${event.updated || event.receivedAt}`;
    const keys = new Set(committed.map(key));
    state.history = [...committed, ...state.history.filter(event => !keys.has(key(event)))];
  }
  if (payload.type === "call-cancelled") {
    state.activeCalls = payload.activeCalls || [];
    if (payload.uuid) addEvent(copy("cti.event.cancelled", "Call cancelled"), copy("cti.event.cancelledDetail", "The pending call setup was cancelled"), { uuid: payload.uuid });
  }
  render();
}

async function refreshAll() {
  if (state.refreshPending) return;
  state.refreshPending = true;
  const revision = state.eventRevision;
  if (state.serverMissing) {
    addEvent(copy("cti.server.missing", "Server unavailable"), copy("cti.server.start", "Start the local CTI server"), { tech: "node src/server.js" });
    render();
    state.refreshPending = false;
    return;
  }
  if (els.refresh) els.refresh.disabled = true;
  try {
    const status = await api("/api/status");
    const unconfigured = !STATIC_DEMO_MODE && status.credentialsConfigured === false;
    const [extensions, states, history, activeCalls] = await Promise.all([
      unconfigured ? [] : api("/api/extensions"),
      unconfigured ? [] : api("/api/states"),
      api("/api/history"),
      api("/api/active-calls"),
    ]);
    if (state.eventRevision !== revision) return;
    state.status = status;
    rememberCsrfToken(status);
    state.google = status.google || state.google;
    state.extensions = extensions;
    state.states = states;
    state.history = history;
    state.activeCalls = activeCalls;
    if (!unconfigured) addEvent(copy("cti.event.refreshed", "Data refreshed"), copy("cti.event.refreshedDetail", "Extensions, status and history reloaded"), { tech: "manual refresh" });
    render();
  } catch (error) {
    addEvent(copy("cti.api.error", "API error"), errorCopy(error.message), { tech: error.message });
    render();
  } finally {
    state.refreshPending = false;
    if (els.refresh) els.refresh.disabled = false;
  }
}

async function refreshContactsPage() {
  if (!els.contactsList) return;
  try {
    const result = await api("/api/google/contacts");
    state.google = result.status;
    state.contacts = result.contacts || [];
    renderContactsPage();
    renderGoogleStatus();
  } catch (error) {
    state.contacts = [];
    renderContactsPage(error.message);
  }
}

async function refreshStoragePage() {
  if (!els.storageSummary) return;
  if (els.storageRefresh) els.storageRefresh.disabled = true;
  try {
    state.storage = await api("/api/storage");
    renderStoragePage();
  } catch (error) {
    renderStoragePage(error.message);
  } finally {
    if (els.storageRefresh) els.storageRefresh.disabled = false;
  }
}

function renderStoragePage(error = "") {
  if (!els.storageSummary) return;
  const storage = state.storage;
  if (!storage) {
    els.storageSummary.innerHTML = `
      <div class="empty-list compact">${error ? copyMarkup(errorCopy(error)) : messageMarkup("cti.storage.loading", "Loading storage status")}</div>
    `;
    return;
  }

  const files = Object.entries(storage.files || {});
  const totalBytes = files.reduce((sum, [, file]) => sum + Number(file.bytes || 0), 0);
  els.storageSummary.innerHTML = `
    <div class="status-tile">
      <span data-i18n-key="cti.storage.local">Local data</span>
      <strong>${escapeHtml(formatBytes(totalBytes))}</strong>
    </div>
    <div class="status-tile">
      <span data-i18n-key="cti.storage.events">Call events</span>
      <strong>${files.filter(([name]) => ["call-events.jsonl", "history.json"].includes(name)).reduce((sum, [, file]) => sum + Number(file.records || 0), 0)}</strong>
    </div>
    ${storage.skippedInvalidLines ? `<p class="form-message error">${messageMarkup("cti.storage.skipped", "Unreadable records skipped: {count}", { count: storage.skippedInvalidLines })}</p>` : ""}
  `;

}

function contactContextMarkup(contact) {
  if (contact?.organization) return `<span data-i18n-ignore>${escapeHtml(contact.organization)}</span>`;
  if (contact?.source === "local") return messageMarkup("cti.contacts.localContact", "Local contact");
  if (contact?.source === "google") return messageMarkup("cti.contacts.googleContact", "Google contact");
  return "";
}

function renderContactsPage(error = "") {
  if (!els.contactsList) return;
  const google = state.google || {};
  const mode = state.contactsMode === "local" ? "local" : "google";
  const sourceContacts = (state.contacts || []).filter((contact) => (
    mode === "local" ? contact.source === "local" : contact.source !== "local"
  ));
  if (els.contactsListTitle) {
    els.contactsListTitle.textContent = mode === "local" ? message("cti.contacts.local", "Local contacts") : message("cti.contacts.google", "Google Contacts");
  }
  const contacts = sourceContacts.filter((contact) => {
    const query = (els.contactFilter?.value || "").trim().toLowerCase();
    if (!query) return true;
    return [
      contact.name,
      contact.organization,
      ...(contact.phones || []).map((phone) => phone.value),
    ].join(" ").toLowerCase().includes(query);
  });

  if (els.contactsStatus) {
    const googleActive = mode === "google";
    const localActive = mode === "local";
    const statusText = google.connected
      ? messageMarkup("cti.contacts.connectedCount", "Connected contacts: {count}", { count: google.contacts || 0 })
      : google.configured ? messageMarkup("cti.contacts.ready", "Ready to connect") : messageMarkup("cti.contacts.credentialsMissing", "Google credentials missing");
    replaceContentPreservingForm(els.contactsStatus, `
      <div class="auth-mode-switch contacts-mode-switch" role="group" aria-label="Contact source" data-i18n-aria-label="cti.contacts.source">
        <button class="${googleActive ? "is-active" : ""}" type="button" data-contact-mode="google" aria-pressed="${googleActive}" data-i18n-key="cti.contacts.googleLogin">Google login</button>
        <button class="${localActive ? "is-active" : ""}" type="button" data-contact-mode="local" aria-pressed="${localActive}" data-i18n-key="cti.contacts.local">Local contacts</button>
      </div>
      ${googleActive ? `
        <div class="status-tile">
          <span data-i18n-key="cti.export.status">Status</span>
          <strong>${statusText}</strong>
        </div>
        <div class="status-tile">
          <span data-i18n-key="cti.contacts.lastSync">Last sync</span>
          <strong>${google.lastSyncAt ? `<time datetime="${escapeAttr(google.lastSyncAt)}" data-cti-date>${escapeHtml(formatDate(google.lastSyncAt))}</time>` : messageMarkup("cti.contacts.notSynced", "Not yet")}</strong>
        </div>
        <div class="contacts-actions inline-actions">
          <a class="primary-button link-button" href="${STATIC_DEMO_MODE ? "#demo-google-login" : escapeAttr(googleLoginPath())}" ${google.connected ? "hidden" : ""} data-i18n-key="cti.contacts.connect">Connect</a>
          <button class="secondary-button" data-contact-action="sync" type="button" ${google.connected ? "" : "disabled"} data-i18n-key="cti.contacts.sync">Synchronize</button>
          <button class="secondary-button danger-button" data-contact-action="disconnect" type="button" ${google.connected ? "" : "disabled"} data-i18n-key="cti.contacts.disconnect">Disconnect</button>
        </div>
      ` : `
        <div class="status-tile">
          <span data-i18n-key="cti.contacts.local">Local contacts</span>
          <strong>${sourceContacts.length}</strong>
        </div>
        <form class="local-contact-form" id="local-contact-form">
          <div class="local-contact-name-grid">
            <label><span data-i18n-key="cti.contacts.firstName">First name</span><input name="firstName" required autocomplete="given-name" placeholder="Alex" data-i18n-placeholder="cti.contacts.exampleFirst"></label>
            <label><span data-i18n-key="cti.contacts.lastName">Last name</span><input name="lastName" required autocomplete="family-name" placeholder="Example" data-i18n-placeholder="cti.contacts.exampleLast"></label>
          </div>
          <label><span data-i18n-key="cti.contacts.phone">Phone</span><input name="phone" required inputmode="tel" placeholder="+49..."></label>
          <label><span data-i18n-key="cti.contacts.company">Company</span><input name="organization" placeholder="NFON AG"></label>
          <label><span data-i18n-key="cti.contacts.photo">Image</span><span class="upload-control">
              <input name="photo" type="file" accept="image/png,image/jpeg,image/webp">
              <span class="upload-button" data-i18n-key="cti.contacts.chooseImage">Choose image</span>
              <span class="upload-file-name" data-upload-file-name data-i18n-key="cti.contacts.noFile">No file selected</span>
            </span>
          </label>
          <button class="primary-button" type="submit" data-i18n-key="cti.contacts.create">Create contact</button>
        </form>
      `}
      ${state.contactMessage ? `<p class="form-message success">${copyMarkup(state.contactMessage)}</p>` : ""}
      ${state.contactError || error || google.lastError ? `<p class="form-message error">${copyMarkup(errorCopy(state.contactError || error || google.lastError))}</p>` : ""}
    `, "#local-contact-form");
  }
  if (!contacts.length) {
    els.contactsList.className = "empty-list";
    els.contactsList.innerHTML = state.contactsMode === "local"
      ? messageMarkup("cti.contacts.localEmpty", "No local test contacts created yet.")
      : messageMarkup("cti.contacts.empty", "No contacts found.");
    return;
  }

  els.contactsList.className = "contacts-list";
  els.contactsList.innerHTML = contacts.map((contact) => {
    const phone = contact.phones?.[0]?.value || "";
    const avatar = !STATIC_DEMO_MODE && contact.hasPhoto
      ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">`
      : initialsAvatar(contact.name);
    return `
      <article class="contact-row">
        <div class="contact-avatar">${avatar}</div>
        <div class="contact-main">
          <strong data-i18n-ignore>${escapeHtml(contact.name)}</strong>
          <span>${phone ? `<span data-i18n-ignore>${escapeHtml(phone)}</span>` : messageMarkup("cti.contacts.noPhone", "No phone number")}</span>
          <small>${contactContextMarkup(contact)}</small>
        </div>
        <div class="contact-actions">
          ${contact.source === "local" ? `<button class="ghost-button" type="button" data-delete-local-contact="${escapeAttr(contact.id)}" data-i18n-key="cti.contacts.delete">Delete</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

let eventSource = null;
let eventsPollTimer;
let eventsRetryTimer;
let eventsGeneration = 0;
function disconnectEvents() {
  eventsGeneration += 1;
  clearTimeout(eventsPollTimer);
  clearTimeout(eventsRetryTimer);
  eventSource?.close();
  eventSource = null;
}

function pollEvents() {
  disconnectEvents();
  const generation = eventsGeneration;
  let initialized = false;
  async function poll() {
    try {
      const snapshot = await api("/api/snapshot");
      if (generation !== eventsGeneration) return;
      const previousCalls = new Set(state.activeCalls.map((call) => `${call.uuid}:${call.state}`));
      const eventKey = (call) => `${call.uuid}:${call.state}:${call.updated || call.receivedAt}`;
      const previousEvents = new Set(state.history.map(eventKey));
      const sameAccount = state.status?.account === snapshot.status?.account;
      handleEvent(snapshot);
      if (initialized && sameAccount) {
        for (const call of [...(snapshot.history || [])].reverse()) {
          if (!previousEvents.has(eventKey(call))) handleEvent({ type: "call", call, activeCalls: snapshot.activeCalls });
        }
      }
      initialized = true;
      if (state.popupContents && !state.activeCalls.some((call) => call.uuid === state.popupContents.call.uuid && shouldShowCallPopup(call))) hideCallPopup();
      for (const call of state.activeCalls) {
        if (!previousCalls.has(`${call.uuid}:${call.state}`)) maybeShowCallPopup(call);
      }
    } catch {
      if (generation !== eventsGeneration) return;
      els.connection.textContent = message("cti.connection.syncing", "Synchronizing");
      els.connection.className = "connection is-warning";
    }
    if (generation === eventsGeneration) eventsPollTimer = setTimeout(poll, 3000);
  }
  poll();
  eventsRetryTimer = setTimeout(() => { disconnectEvents(); connectEvents(); }, 15000);
}

function connectEvents() {
  if (state.serverMissing || eventSource) return;
  const events = eventSource = new EventSource(apiPath("/api/events"));
  events.onmessage = (message) => handleEvent(JSON.parse(message.data));
  events.addEventListener("polling", () => { if (events === eventSource) pollEvents(); });
  ["snapshot", "status", "extensions", "states", "state", "call", "history", "call-cancelled"].forEach((name) => {
    events.addEventListener(name, (message) => handleEvent(JSON.parse(message.data)));
  });
  events.onerror = () => {
    els.connection.textContent = message("cti.connection.syncing", "Synchronizing");
    els.connection.className = "connection is-warning";
  };
}

window.addEventListener("pagehide", disconnectEvents);
window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  connectEvents();
  refreshAll();
});

function showDialMessage(message, isError = false, tech = "") {
  if (!els.dialMessage) return;
  els.dialMessage.innerHTML = copyMarkup(errorCopy(message));
  els.dialMessage.title = tech;
  els.dialMessage.className = `form-message${isError ? " error" : ""}`;
}

document.getElementById("history-more")?.addEventListener("click", () => { state.historyLimit += 80; renderHistory(); });

if (els.refresh) els.refresh.addEventListener("click", refreshAll);
if (els.extensionFilter) els.extensionFilter.addEventListener("input", () => renderExtensions(buildAnalytics()));
if (els.contactFilter) els.contactFilter.addEventListener("input", () => renderContactsPage());
if (els.contactsModulePanel) {
  els.contactsModulePanel.addEventListener("click", async (event) => {
    const modeButton = event.target.closest("[data-contact-mode]");
    if (modeButton) {
      state.contactsMode = modeButton.dataset.contactMode;
      state.contactMessage = "";
      state.contactError = "";
      storageSet("cti-contacts-mode", state.contactsMode);
      renderContactsPage();
      return;
    }

    const actionButton = event.target.closest("[data-contact-action]");
    if (!actionButton) return;
    actionButton.disabled = true;
    try {
      if (actionButton.dataset.contactAction === "sync") {
        const result = await api("/api/google/sync", { method: "POST" });
        state.google = result.status;
        await refreshContactsPage();
      }
      if (actionButton.dataset.contactAction === "disconnect") {
        const result = await api("/api/google/disconnect", { method: "POST" });
        resetContactCache();
        state.google = result.status;
        state.contacts = (state.contacts || []).filter((contact) => contact.source === "local");
        renderContactsPage();
        renderGoogleStatus();
      }
    } catch (error) {
      renderContactsPage(error.message);
    } finally {
      actionButton.disabled = false;
    }
  });

  els.contactsModulePanel.addEventListener("submit", async (event) => {
    if (!event.target.matches("#local-contact-form")) return;
    event.preventDefault();
    await submitLocalContact(event.target);
  });

  els.contactsModulePanel.addEventListener("change", (event) => {
    if (!event.target.matches('#local-contact-form input[type="file"]')) return;
    const fileName = event.target.files?.[0]?.name || message("cti.contacts.noFile", "No file selected");
    const label = event.target.closest(".upload-control")?.querySelector("[data-upload-file-name]");
    if (label) {
      label.textContent = fileName;
      if (event.target.files?.length) {
        label.removeAttribute("data-i18n-key");
        label.setAttribute("data-i18n-ignore", "");
      } else {
        label.removeAttribute("data-i18n-ignore");
        label.setAttribute("data-i18n-key", "cti.contacts.noFile");
      }
    }
  });
}
if (els.contactsList) {
  els.contactsList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-delete-local-contact]");
    if (!button) return;
    button.disabled = true;
    try {
      const result = await api(`/api/local-contacts/${encodeURIComponent(button.dataset.deleteLocalContact)}`, { method: "DELETE" });
      state.google = result.status;
      state.contacts = result.contacts || [];
      state.contactMessage = copy("cti.contacts.deleted", "Local contact deleted.");
      state.contactError = "";
      renderContactsPage();
    } catch (error) {
      state.contactError = errorCopy(error.message);
      renderContactsPage();
    }
  });
}
if (els.storageRefresh) els.storageRefresh.addEventListener("click", refreshStoragePage);
if (els.authLoginPanel) {
  els.authLoginPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-auth-mode]");
    if (!button) return;
    state.authLoginMode = button.dataset.authMode;
    state.authLoginMessage = "";
    state.authLoginError = "";
    storageSet("cti-auth-login-mode", state.authLoginMode);
    renderAuthLoginPanel();
  });
  els.authLoginPanel.addEventListener("submit", (event) => {
    if (!event.target.matches("#cti-browser-login-form")) return;
    event.preventDefault();
    submitCtiBrowserLogin(event.target);
  });
}
if (els.backupImport) {
  els.backupImport.addEventListener("change", async () => {
    const file = els.backupImport.files?.[0];
    if (!file) return;
    setBackupMessage(copy("cti.backup.checking", "Checking backup"));
    try {
      const text = await file.text();
      const body = JSON.parse(text);
      const result = await api("/api/storage/restore", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBackupMessage(copy("cti.backup.imported", "New events: {imported} · Duplicates skipped: {duplicates}", { imported: result.imported, duplicates: result.duplicates }), false);
      await refreshStoragePage();
      await refreshAll();
    } catch (error) {
      setBackupMessage(error instanceof SyntaxError ? copy("cti.error.backupFormat", "Invalid backup format") : error.message, true);
    } finally {
      els.backupImport.value = "";
    }
  });
}
if (els.exportCsv) {
  els.exportCsv.addEventListener("click", () => exportHistory("csv"));
}
if (els.exportExcel) {
  els.exportExcel.addEventListener("click", () => exportHistory("excel"));
}


if (els.callerSelect) {
  els.callerSelect.addEventListener("change", () => {
    storageSet("cti-selected-caller", els.callerSelect.value);
  });
}
if (els.dialForm) {
  els.dialForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.dialPending) return;
    state.dialPending = true;
    const submit = els.dialForm.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    showDialMessage(copy("cti.dial.starting", "Starting call"));
    try {
      const result = await api("/api/calls", {
        method: "POST",
        body: JSON.stringify({
          caller: els.callerSelect.value,
          callee: els.calleeInput.value,
        }),
      });
      if (STATIC_DEMO_MODE && result?.activeCalls && result?.history) {
        state.activeCalls = result.activeCalls;
        state.history = result.history;
        render();
      }
      const tech = result?.uuid ? `${message("cti.export.callId", "Call ID")}: ${result.uuid}` : "";
      showDialMessage(copy("cti.dial.started", "Call started"), false, tech);
      els.calleeInput.select();
    } catch (error) {
      showDialMessage(errorCopy(error.message), true);
    } finally {
      state.dialPending = false;
      if (submit) submit.disabled = false;
    }
  });
}

let popoverTarget = null;
function inspectTarget(target, event) {
  const element = target.closest?.("[data-line-status], [data-session-id], [data-extension-detail], [data-extension-row]");
  if (!element) { hidePopover(); popoverTarget = null; return; }
  if (popoverTarget === element && !els.popover?.hidden) { positionPopover(event); return; }
  if (popoverTarget !== element) hidePopover();
  popoverTarget = element;
  element.setAttribute("aria-describedby", "insight-popover");
  if (element.hasAttribute("data-line-status")) showLineStatusPopover(element, event);
  else if (element.dataset.sessionId) showSessionPopover(element.dataset.sessionId, event);
  else showExtensionPopover(element.dataset.extensionDetail || element.dataset.extensionRow, event);
}
document.addEventListener("mousemove", (event) => inspectTarget(event.target, event));
document.addEventListener("focusin", (event) => {
  // A row's hover details do not describe an action button inside that row.
  if (!event.target.matches?.("[data-line-status], [data-session-id], [data-extension-detail]")) {
    hidePopover();
    popoverTarget = null;
    return;
  }
  const bounds = event.target.getBoundingClientRect?.();
  if (bounds) inspectTarget(event.target, { clientX: bounds.left, clientY: bounds.bottom });
});
document.addEventListener("click", (event) => {
  const googleLink = event.target.closest?.('a[href^="/auth/google/start"]');
  if (googleLink && !STATIC_DEMO_MODE) googleLink.href = googleLoginPath();
  if (event.target.closest?.("button, a, input, select")) return;
  const bounds = event.target.getBoundingClientRect?.();
  if (bounds) inspectTarget(event.target, { clientX: bounds.left, clientY: bounds.bottom });
});
document.addEventListener("focusout", (event) => { if (!event.relatedTarget?.closest?.("[data-line-status], [data-session-id], [data-extension-detail], [data-extension-row]")) hidePopover(); });
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { hidePopover(); if (!els.callPopup?.hidden) hideCallPopup(); } });
document.addEventListener("mouseleave", hidePopover);
window.addEventListener("resize", hidePopover);
document.addEventListener("scroll", hidePopover, true);

let analyticsCache;

function buildAnalytics() {
  const source = historySource();
  const today = dayKey();
  const locale = currentLocale();
  if (analyticsCache?.source === source && analyticsCache.extensions === state.extensions && analyticsCache.day === today && analyticsCache.locale === locale) return analyticsCache.value;
  const sessions = buildCallSessions(source);
  const todaySessions = sessions.filter((session) => dayKey(session.startedAt) === today);
  const daily = buildDailySessions(sessions);
  const totals = summarizeSessions(todaySessions);
  const byExtension = new Map();

  for (const extension of state.extensions) {
    byExtension.set(String(extension.extension_number), emptyExtensionAnalytics(String(extension.extension_number)));
  }

  for (const session of todaySessions) {
    const current = byExtension.get(session.extension) || emptyExtensionAnalytics(session.extension);
    current.sessions.push(session);
    current.total += 1;
    current.answered += session.answered ? 1 : 0;
    current.missed += session.missed ? 1 : 0;
    current.inbound += session.direction === "inbound" ? 1 : 0;
    current.outbound += session.direction === "outbound" ? 1 : 0;
    current.talkMs += session.durationMs;
    current.hourly[session.hour] = (current.hourly[session.hour] || 0) + 1;
    current.hourlyAnswered[session.hour] = (current.hourlyAnswered[session.hour] || 0) + (session.answered ? 1 : 0);
    current.hourlyMissed[session.hour] = (current.hourlyMissed[session.hour] || 0) + (session.missed ? 1 : 0);
    current.hourlyOutbound[session.hour] = (current.hourlyOutbound[session.hour] || 0) + (session.direction === "outbound" ? 1 : 0);
    byExtension.set(session.extension, current);
  }

  const hourly = Array.from({ length: 24 }, (_, hour) => {
    const calls = todaySessions.filter((session) => session.hour === hour);
    return {
      hour,
      total: calls.length,
      answered: calls.filter((session) => session.answered).length,
      inboundAnswered: calls.filter((session) => session.direction === "inbound" && session.answered).length,
      missed: calls.filter((session) => session.missed).length,
      outbound: calls.filter((session) => session.direction === "outbound").length,
      other: calls.filter((session) => !session.answered && !session.missed).length,
    };
  });

  const team = [...byExtension.values()]
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total || b.answered - a.answered);

  const peak = [...hourly].sort((a, b) => b.total - a.total)[0];
  const yesterday = daily[daily.length - 2] || summarizeSessions([]);
  const result = {
    sessions,
    today: totals,
    yesterday,
    daily,
    hourly,
    team,
    byExtension,
    peakHour: peak?.total ? `${String(peak.hour).padStart(2, "0")}:00` : "-",
  };
  analyticsCache = { source, extensions: state.extensions, day: today, locale, value: result };
  return result;
}

function buildDailySessions(sessions) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dayKey(date);
    const daySessions = sessions.filter((session) => dayKey(session.startedAt) === key);
    return {
      key,
      label: new Intl.DateTimeFormat(currentLocale(), { weekday: "short" }).format(date),
      total: daySessions.length,
      answered: daySessions.filter((session) => session.answered).length,
      inboundAnswered: daySessions.filter((session) => session.direction === "inbound" && session.answered).length,
      missed: daySessions.filter((session) => session.missed).length,
      outbound: daySessions.filter((session) => session.direction === "outbound").length,
    };
  });
}

function eventTimestamp(event) {
  for (const value of [event.updated, event.receivedAt]) {
    const timestamp = Date.parse(value || "");
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return "";
}

function buildCallSessions(events) {
  const grouped = new Map();
  for (const event of events) {
    if (!event?.uuid) continue;
    const key = `${event.uuid}:${event.state}:${event.updated || event.receivedAt}`;
    const list = grouped.get(event.uuid) || [];
    if (!list.some((item) => `${item.uuid}:${item.state}:${item.updated || item.receivedAt}` === key)) {
      list.push(event);
    }
    grouped.set(event.uuid, list);
  }

  return [...grouped.values()].map((items) => {
    const sorted = [...items].sort((a, b) => (eventTimestamp(a) ? Date.parse(eventTimestamp(a)) : Infinity) - (eventTimestamp(b) ? Date.parse(eventTimestamp(b)) : Infinity));
    const first = sorted[0] || {};
    const last = sorted[sorted.length - 1] || first;
    const answeredEvent = sorted.find((item) => item.state === "answer");
    const endEvent = [...sorted].reverse().find((item) => item.state === "hangup" || item.state === "end") || last;
    const startedAt = eventTimestamp(first);
    const answerAt = answeredEvent ? eventTimestamp(answeredEvent) : "";
    const endedAt = eventTimestamp(endEvent) || startedAt;
    const direction = last.direction || first.direction || "unknown";
    const durationMs = answerAt && endedAt ? Math.max(0, new Date(endedAt) - new Date(answerAt)) : 0;
    const hour = new Date(startedAt).getHours();
    const answered = Boolean(answeredEvent);
    const missed = direction === "inbound" && !answered && sorted.some((item) => item.state === "hangup" || item.state === "end");
    return {
      uuid: first.uuid,
      extension: String(last.extension || first.extension || "unknown"),
      caller: last.caller || first.caller,
      callee: last.callee || first.callee,
      direction,
      states: sorted.map((item) => item.state).filter(Boolean),
      events: sorted,
      startedAt,
      endedAt,
      hour,
      answered,
      missed,
      durationMs,
      eventCount: sorted.length,
    };
  }).sort((a, b) => (Date.parse(b.startedAt) || 0) - (Date.parse(a.startedAt) || 0));
}

function summarizeSessions(sessions) {
  const answered = sessions.filter((session) => session.answered).length;
  const missed = sessions.filter((session) => session.missed).length;
  const talkMs = sessions.reduce((sum, session) => sum + session.durationMs, 0);
  return {
    total: sessions.length,
    answered,
    inboundAnswered: sessions.filter((session) => session.direction === "inbound" && session.answered).length,
    missed,
    talkMs,
    avgTalkMs: answered ? talkMs / answered : 0,
    inbound: sessions.filter((session) => session.direction === "inbound").length,
    outbound: sessions.filter((session) => session.direction === "outbound").length,
  };
}

function emptyExtensionAnalytics(extension) {
  return {
    extension,
    total: 0,
    answered: 0,
    missed: 0,
    inbound: 0,
    outbound: 0,
    talkMs: 0,
    sessions: [],
    hourly: {},
    hourlyAnswered: {},
    hourlyMissed: {},
    hourlyOutbound: {},
  };
}

function showExtensionPopover(extension, event) {
  if (!els.popover) return;
  els.popover.classList.remove("session-popover");
  const analytics = buildAnalytics();
  const item = analytics.byExtension.get(String(extension)) || emptyExtensionAnalytics(String(extension));
  els.popover.innerHTML = `
    <strong data-i18n-ignore>${escapeHtml(extensionName(extension))}</strong>
    <span class="popover-subline">${messageMarkup("cti.extension.number", "Extension {extension}", { extension })}</span>
    <div class="popover-metrics">
      <span><b>${item.total}</b><span data-i18n-key="cti.calls.label">Calls</span></span>
      <span>${messageMarkup("cti.analytics.answeredCount", "Answered: {count}", { count: item.answered })}</span>
      <span>${messageMarkup("cti.analytics.missedCount", "{count} missed", { count: item.missed })}</span>
    </div>
    ${miniLineChart(item)}
  `;
  els.popover.hidden = false;
  const offset = 18;
  const bounds = els.popover.getBoundingClientRect();
  const left = Math.min(window.innerWidth - bounds.width - 12, event.clientX + offset);
  const top = Math.min(window.innerHeight - bounds.height - 12, event.clientY + offset);
  els.popover.style.left = `${Math.max(12, left)}px`;
  els.popover.style.top = `${Math.max(12, top)}px`;
}

async function showLineStatusPopover(element, event) {
  if (!els.popover) return;
  els.popover.classList.remove("session-popover");
  const token = ++state.linePopoverToken;
  const extension = element.dataset.extension;
  const line = element.dataset.line || "unknown";
  const since = element.dataset.since;
  const activeCall = state.activeCalls.find((call) => String(call.extension) === String(extension));
  const contactPhone = activeCall ? externalPartyPhone(activeCall) : "";
  const contact = contactPhone ? await lookupContact(contactPhone) : null;

  if (token !== state.linePopoverToken || !element.matches(":hover, :focus")) return;

  if (["in-use", "ringing"].includes(line) && activeCall) {
    els.popover.innerHTML = lineContactPopover(extension, line, activeCall, contact);
  } else {
    const headline = line === "idle" ? message("cti.line.idle", "Idle") : label(line, "line");
    els.popover.innerHTML = `
      <strong>${messageMarkup("cti.status.since", "{status} for {duration}", { status: headline, duration: minutesSince(since) })}</strong>
      <span class="popover-subline">${messageMarkup("cti.extension.named", "{name} · Extension {extension}", { name: extensionName(extension), extension })}</span>
    `;
  }

  els.popover.hidden = false;
  positionPopover(event);
}

function lineContactPopover(extension, line, call, contact) {
  const phone = externalPartyPhone(call);
  const name = contact?.name || formatPhone(phone);
  const org = contact?.organization || message("cti.contacts.lookup", "Contact / CRM lookup");
  const since = callStatusSince(call, line);
  const avatar = !STATIC_DEMO_MODE && contact?.hasPhoto && contact?.id
    ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">`
    : initialsAvatar(name);
  return `
    <div class="line-popover-contact">
      <div class="contact-avatar">${avatar}</div>
      <div>
        <strong data-i18n-ignore>${escapeHtml(name)}</strong>
        <span data-i18n-ignore>${escapeHtml(org)}</span>
        <small>${messageMarkup("cti.status.since", "{status} for {duration}", { status: label(line, "line"), duration: minutesSince(since) })}</small>
      </div>
    </div>
    <span class="popover-subline" data-i18n-ignore>${escapeHtml(extensionName(extension))} · ${escapeHtml(formatPhone(phone))}</span>
  `;
}

function showSessionPopover(sessionId, event) {
  if (!els.popover) return;
  const session = buildAnalytics().sessions.find((item) => item.uuid === sessionId);
  if (!session) {
    hidePopover();
    return;
  }
  const externalPhone = externalPartyPhone(session);
  const external = formatPhone(externalPhone);
  const internal = message("cti.extension.named", "{name} · Extension {extension}", { name: extensionName(session.extension), extension: session.extension });
  const from = isOutboundCall(session) ? internal : external;
  const to = isOutboundCall(session) ? external : internal;
  els.popover.classList.add("session-popover");
  els.popover.innerHTML = `
    <strong>${escapeHtml(sessionStatusLabel(session))}</strong>
    <span class="popover-subline">${escapeHtml(label(session.direction, "direction"))} · ${escapeHtml(formatDate(session.startedAt))} · ${escapeHtml(formatDuration(session.durationMs))}${session.uuid?.startsWith("demo-") ? " · Demo" : ""}</span>
    <div class="session-detail-grid">
      <span data-i18n-key="cti.from">From</span><b data-i18n-ignore>${escapeHtml(from)}</b>
      <span data-i18n-key="cti.to">To</span><b data-i18n-ignore>${escapeHtml(to)}</b>
      <span data-i18n-key="cti.export.callId">Call ID</span><b>${escapeHtml(session.uuid || "-")}</b>
    </div>
    <ol class="session-event-list">
      ${session.events.map((item) => `
        <li>
          <time>${escapeHtml(formatTime(item.receivedAt || item.updated))}</time>
          <strong>${labelMarkup(item.state, "call")}</strong>
          <small>${escapeHtml(formatPhone(item.caller))} -> ${escapeHtml(formatPhone(item.callee))}</small>
        </li>
      `).join("")}
    </ol>
  `;
  els.popover.hidden = false;
  positionPopover(event);
}

function callStatusSince(call, line) {
  const events = state.history
    .filter((item) => item.uuid && item.uuid === call.uuid)
    .sort((a, b) => new Date(a.receivedAt || a.updated) - new Date(b.receivedAt || b.updated));
  if (line === "in-use") {
    const answered = events.find((item) => ["answer", "caller-answer"].includes(item.state));
    return answered?.receivedAt || answered?.updated || call.receivedAt || call.updated;
  }
  if (line === "ringing") {
    const ringing = events.find((item) => ["ring", "caller-ring", "dial", "caller-dial"].includes(item.state));
    return ringing?.receivedAt || ringing?.updated || call.receivedAt || call.updated;
  }
  return call.receivedAt || call.updated;
}

function positionPopover(event) {
  const offset = 18;
  const bounds = els.popover.getBoundingClientRect();
  const left = Math.min(window.innerWidth - bounds.width - 12, event.clientX + offset);
  const top = Math.min(window.innerHeight - bounds.height - 12, event.clientY + offset);
  els.popover.style.left = `${Math.max(12, left)}px`;
  els.popover.style.top = `${Math.max(12, top)}px`;
}

function hidePopover() {
  if (!els.popover) return;
  state.linePopoverToken += 1;
  popoverTarget?.removeAttribute("aria-describedby");
  els.popover.classList.remove("session-popover");
  els.popover.hidden = true;
}

function miniLineChart(item) {
  const hourly = item.hourly || {};
  const activeHours = Object.entries(hourly)
    .filter(([, value]) => value > 0)
    .map(([hour]) => Number(hour));
  const endHour = Math.min(23, Math.max(new Date().getHours(), ...activeHours, 17));
  const startHour = Math.min(Math.max(0, endHour - 11), ...activeHours);
  const hours = Array.from({ length: endHour - startHour + 1 }, (_, index) => startHour + index);
  const answered = hours.map((hour) => item.hourlyAnswered?.[hour] || 0);
  const missed = hours.map((hour) => item.hourlyMissed?.[hour] || 0);
  const outbound = hours.map((hour) => item.hourlyOutbound?.[hour] || 0);
  const max = Math.max(1, ...answered, ...missed, ...outbound);
  const step = hours.length > 1 ? 196 / (hours.length - 1) : 196;
  const answeredPoints = answered.map((value, index) => {
    const x = 12 + index * step;
    const y = 54 - (value / max) * 42;
    return { x, y };
  });
  const missedPoints = missed.map((value, index) => {
    const x = 12 + index * step;
    const y = 54 - (value / max) * 42;
    return { x, y };
  });
  const outboundPoints = outbound.map((value, index) => {
    const x = 12 + index * step;
    const y = 54 - (value / max) * 42;
    return { x, y };
  });
  return `
    <svg class="mini-line" viewBox="0 0 220 64" aria-hidden="true">
      <path d="${smoothPath(answeredPoints)}" fill="none" stroke="#00d981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${smoothPath(missedPoints)}" fill="none" stroke="#f36b5b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${smoothPath(outboundPoints)}" fill="none" stroke="#3513cf" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></path>
    </svg>
    <div class="mini-legend">
      <span><i class="legend-dot green"></i><span data-i18n-key="cti.calls.answered">Answered</span></span>
      <span><i class="legend-dot coral"></i><span data-i18n-key="cti.calls.missed">Missed</span></span>
      <span><i class="legend-dot blue"></i><span data-i18n-key="cti.direction.outbound">Outbound</span></span>
    </div>
  `;
}

function shouldShowCallPopup(call) {
  return ["ring", "caller-ring", "dial", "caller-dial"].includes(call.state);
}

async function maybeShowCallPopup(call) {
  if (["answer", "caller-answer"].includes(call.state)) {
    state.popupVersion += 1;
    state.lastPopupKey = "";
    hideCallPopup();
    return;
  }
  if (["hangup", "end"].includes(call.state)) {
    state.popupVersion += 1;
    hideCallPopupSoon(call.uuid);
    return;
  }
  if (!els.callPopup || !shouldShowCallPopup(call)) {
    return;
  }
  const phone = externalPartyPhone(call);
  const key = `${call.uuid || ""}:${call.state || ""}:${phone || ""}:${call.extension || ""}`;
  if (state.lastPopupKey === key) return;
  state.lastPopupKey = key;
  const popupVersion = ++state.popupVersion;

  let contact = null;
  try {
    contact = await lookupContact(phone);
  } catch {
    contact = null;
  }
  const stillRinging = state.activeCalls.some((activeCall) => (
    activeCall.uuid === call.uuid
    && shouldShowCallPopup(activeCall)
  ));
  if (popupVersion !== state.popupVersion || !stillRinging) return;
  showCallPopup(call, contact, phone);
}

function showCallPopup(call, contact, phone = "") {
  if (els.callPopup?.hidden) state.popupReturnFocus = rememberFocus();
  state.popupContents = { call, contact, phone };
  state.popupMinimized = false;
  const extension = rawLabel(call.extension);
  const agentName = extensionName(extension);
  const contactPhone = phone || externalPartyPhone(call);
  const callerName = contact?.name || formatPhone(contactPhone);
  const contextMarkup = contactContextMarkup(contact);
  const photo = !STATIC_DEMO_MODE && contact?.hasPhoto && contact?.id ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">` : initialsAvatar(callerName);
  const contactPerson = `
    <div class="call-person">
      <div class="call-avatar">${photo}</div>
      <strong data-i18n-ignore>${escapeHtml(callerName)}</strong>
      <span>${escapeHtml(formatPhone(contactPhone))}</span>
      ${contextMarkup ? `<small>${contextMarkup}</small>` : ""}
    </div>
  `;
  const agentPerson = `
    <div class="call-person">
      <div class="call-avatar agent-avatar" data-i18n-ignore>${escapeHtml(initials(agentName))}</div>
      <strong data-i18n-ignore>${escapeHtml(agentName)}</strong>
      <span>${messageMarkup("cti.extension.number", "Extension {extension}", { extension })}</span>
      <small>${escapeHtml(rawLabel(isOutboundCall(call) ? call.caller : call.callee))}</small>
    </div>
  `;
  const left = isOutboundCall(call) ? agentPerson : contactPerson;
  const right = isOutboundCall(call) ? contactPerson : agentPerson;
  const summary = isOutboundCall(call)
    ? `${agentName} -> ${callerName}`
    : `${callerName} -> ${agentName}`;
  els.callPopup.classList.toggle("is-minimized", state.popupMinimized);
  els.callPopup.innerHTML = `
    <div class="call-popup-actions">
      <button class="call-popup-minimize" type="button" data-popup-minimize aria-label="Minimize popup" data-i18n-aria-label="cti.popup.minimize">-</button>
      <button class="call-popup-close" type="button" aria-label="Close" data-i18n-aria-label="cti.close">&times;</button>
    </div>
    <div class="call-popup-kicker">${labelMarkup(call.state, "call")}</div>
    <strong class="call-popup-summary" data-i18n-ignore>${escapeHtml(summary)}</strong>
    <div class="call-flow">
      ${left}
      <div class="call-arrow" aria-hidden="true">&rarr;</div>
      ${right}
    </div>
  `;
  els.callPopup.hidden = false;
  els.callPopup.querySelector("[data-popup-minimize]")?.addEventListener("click", toggleCallPopupMinimized);
  els.callPopup.querySelector(".call-popup-close")?.addEventListener("click", hideCallPopup);
}

function toggleCallPopupMinimized() {
  if (!els.callPopup) return;
  state.popupMinimized = !state.popupMinimized;
  els.callPopup.classList.toggle("is-minimized", state.popupMinimized);
  const button = els.callPopup.querySelector("[data-popup-minimize]");
  if (button) {
    button.textContent = state.popupMinimized ? "+" : "-";
    button.setAttribute("data-i18n-aria-label", state.popupMinimized ? "cti.popup.expand" : "cti.popup.minimize");
    button.setAttribute("aria-label", state.popupMinimized ? message("cti.popup.expand", "Expand popup") : message("cti.popup.minimize", "Minimize popup"));
  }
}

function hideCallPopup() {
  if (!els.callPopup) return;
  state.popupMinimized = false;
  els.callPopup.classList.remove("is-minimized");
  const hadFocus = els.callPopup.contains?.(document.activeElement);
  els.callPopup.hidden = true;
  state.popupContents = null;
  els.callPopup.innerHTML = "";
  if (hadFocus) {
    restoreFocus(state.popupReturnFocus, true);
  }
}

function hideCallPopupSoon(uuid) {
  if (!els.callPopup) return;
  setTimeout(() => {
    if (!uuid || state.lastPopupKey.includes(uuid)) hideCallPopup();
  }, 2400);
}

function initialsAvatar(name) {
  return `<span data-i18n-ignore>${escapeHtml(initials(name))}</span>`;
}

function initials(name) {
  const parts = String(name || "?").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? `${parts[0][0]}${parts[1][0]}` : parts[0]?.slice(0, 2) || "?").toUpperCase();
}

async function lookupContact(phone) {
  const normalized = normalizeLocalPhone(phone);
  if (!normalized) return null;
  if (state.contactCache.has(normalized)) {
    return state.contactCache.get(normalized);
  }
  const revision = state.contactCacheVersion;
  const result = await api(`/api/contacts/lookup?phone=${encodeURIComponent(phone || "")}`);
  if (revision !== state.contactCacheVersion) return lookupContact(phone);
  const contact = result.contact || null;
  state.contactCache.set(normalized, contact);
  return contact;
}

function externalPartyPhone(call) {
  if (call.direction === "outbound") return rawLabel(call.callee);
  if (call.direction === "inbound") return rawLabel(call.caller);
  const candidates = [call.caller, call.callee].map(rawLabel);
  return candidates.find((value) => isExternalPhone(value, call.extension)) || rawLabel(call.caller);
}

function isOutboundCall(call) {
  if (call.direction === "outbound") return true;
  if (call.direction === "inbound") return false;
  return isExtensionPhone(call.caller, call.extension);
}

function isExternalPhone(value, extension) {
  const raw = rawLabel(value);
  const digits = normalizeLocalPhone(raw);
  if (!digits || digits.length <= 4) return false;
  return !isExtensionPhone(raw, extension);
}

function isExtensionPhone(value, extension) {
  const raw = rawLabel(value);
  if (raw === rawLabel(extension)) return true;
  return state.extensions.some((item) => String(item.extension_number) === raw);
}

async function hydrateContactCells() {
  if (!els.historyBody) return;
  const cells = [...els.historyBody.querySelectorAll("[data-contact-phone]")];
  for (const cell of cells) {
    const phone = cell.dataset.contactPhone;
    if (!phone || cell.dataset.hydrated || !isExternalPhone(phone)) continue;
    cell.dataset.hydrated = "1";
    lookupContact(phone).then((contact) => {
      if (!contact) return;
      cell.innerHTML = contactCell(contact, phone);
    }).catch(() => {});
  }
}

function contactCell(contact, phone) {
  const avatar = !STATIC_DEMO_MODE && contact.hasPhoto && contact.id
    ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">`
    : initialsAvatar(contact.name);
  return `
    <div class="history-contact">
      <div class="history-avatar">${avatar}</div>
      <div>
        <strong data-i18n-ignore>${escapeHtml(contact.name)}</strong>
        <span data-i18n-ignore>${escapeHtml(contact.organization || formatPhone(phone))}</span>
      </div>
    </div>
  `;
}

function normalizeLocalPhone(value) {
  return window.NFON_PHONE?.lookup(value, state.status?.phoneNumberContext) || "";
}

function minutesSince(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return message("cti.time.justNow", "Just now");
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return message("cti.time.lessMinute", "Less than 1 minute");
  return new Intl.NumberFormat(currentLocale(), { style: "unit", unit: "minute", unitDisplay: "long" }).format(minutes);
}

function formatPhone(value) {
  const raw = rawLabel(value);
  if (["unknown", "null", "anonymous", ""].includes(raw)) return message("cti.unknown", "Unknown");
  if (!/^\d+$/.test(raw)) return raw;
  return raw;
}

function chartPoints(items, max, width, height) {
  const plotLeft = 28;
  const plotRight = width - 20;
  const plotTop = 26;
  const plotBottom = height - 48;
  const step = items.length > 1 ? (plotRight - plotLeft) / (items.length - 1) : plotRight - plotLeft;
  const y = (value) => plotBottom - (value / max) * (plotBottom - plotTop);
  const x = (index) => plotLeft + index * step;
  return {
    x,
    baseline: plotBottom,
    inboundAnswered: items.map((item, index) => ({ x: x(index), y: y(item.inboundAnswered) })),
    missed: items.map((item, index) => ({ x: x(index), y: y(item.missed) })),
    outbound: items.map((item, index) => ({ x: x(index), y: y(item.outbound) })),
  };
}

function smoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const commands = [`M ${points[0].x} ${points[0].y}`];
  const tension = 0.18;
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[index - 1] || points[index];
    const current = points[index];
    const next = points[index + 1];
    const afterNext = points[index + 2] || next;
    const cp1x = current.x + (next.x - previous.x) * tension;
    const minY = Math.min(current.y, next.y);
    const maxY = Math.max(current.y, next.y);
    const cp1y = Math.min(maxY, Math.max(minY, current.y + (next.y - previous.y) * tension));
    const cp2x = next.x - (afterNext.x - current.x) * tension;
    const cp2y = Math.min(maxY, Math.max(minY, next.y - (afterNext.y - current.y) * tension));
    commands.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${next.x} ${next.y}`);
  }
  return commands.join(" ");
}

function areaPath(points, baseline) {
  if (!points.length) return "";
  const line = smoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

function formatDuration(ms, compact = false) {
  if (!ms) return compact ? message("cti.time.compactMinutes", "{duration} min", { duration: 0 }) : "00:00";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (compact) {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${hours}h ${rest}m` : `${hours}h`;
    }
    return message("cti.time.compactMinutes", "{duration} min", { duration: seconds && minutes < 10 ? `${minutes}:${String(seconds).padStart(2, "0")}` : minutes });
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  const unit = value < 1024 ? "B" : value < 1024 * 1024 ? "KB" : "MB";
  const amount = unit === "B" ? value : value / (unit === "KB" ? 1024 : 1024 * 1024);
  return new Intl.NumberFormat(currentLocale(), { maximumFractionDigits: 1 }).format(amount) + " " + unit;
}

function setBackupMessage(message, isError = false) {
  if (!els.backupMessage) return;
  els.backupMessage.innerHTML = copyMarkup(errorCopy(message));
  els.backupMessage.className = `backup-message form-message${isError ? " error" : " success"}`;
}

function replaceContentPreservingForm(container, markup, selector) {
  const form = container.querySelector(selector);
  const focused = form?.contains(document.activeElement) ? document.activeElement : null;
  const selection = focused && typeof focused.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd] : null;
  container.innerHTML = markup;
  const replacement = container.querySelector(selector);
  if (form && replacement) {
    replacement.replaceWith(form);
    if (focused) {
      focused.focus({ preventScroll: true });
      if (selection) focused.setSelectionRange(...selection);
    }
  }
}

function renderAuthLoginPanel() {
  if (!els.authLoginPanel) return;
  if (STATIC_DEMO_MODE) { els.authLoginPanel.hidden = true; return; }
  const status = state.status || {};
  const mode = state.authLoginMode === "browser" ? "browser" : "env";
  const envActive = mode === "env";
  const browserActive = mode === "browser";
  const loginConfigured = Boolean(status.credentialsConfigured) && !status.lastError;
  const envExample = [
    "NFON_K_ACCOUNT=<K_ACCOUNT>",
    "NFON_API_USERNAME=<API_USERNAME>",
    "NFON_API_PASSWORD=<API_PASSWORD>",
  ].join("\n");
  replaceContentPreservingForm(els.authLoginPanel, `
    <div class="panel-header auth-login-head">
      <div>
        <h2 data-i18n-key="cti.login">Sign in</h2>
        <p data-i18n-key="cti.login.description">Set CTI credentials using a local file or a browser form.</p>
      </div>
      <span class="auth-login-state ${loginConfigured ? "is-configured" : "is-required"}">${loginConfigured ? messageMarkup("cti.login.configured", "Credentials configured") : messageMarkup("shared.authRequired", "Sign in required")}</span>
    </div>
    <div class="auth-login-body">
      <div class="auth-mode-switch" role="group" aria-label="Sign-in method" data-i18n-aria-label="cti.login.method">
        <button class="${envActive ? "is-active" : ""}" type="button" data-auth-mode="env" aria-pressed="${envActive}" data-i18n-key="cti.login.fileTab">Login via .env</button>
        <button class="${browserActive ? "is-active" : ""}" type="button" data-auth-mode="browser" aria-pressed="${browserActive}" data-i18n-key="cti.login.browserTab">Login via browser</button>
      </div>
      ${envActive ? `
        <section class="auth-login-card is-active">
          <span data-i18n-key="cti.login.local">Local configuration</span>
          <h3 data-i18n-key="cti.login.secretFile">CTI secret file</h3>
          <p data-i18n-key="cti.login.envHelp">Create a .env file in CTI_API. The server reads it automatically at startup.</p>
          <pre>${escapeHtml(envExample)}</pre>
          <p data-i18n-key="cti.login.secretHelp">NFON_SECRET_FILE can point to a local secret file. Google is only required for the contacts module.</p>
        </section>
      ` : `
        <form class="auth-login-card browser-login-form" id="cti-browser-login-form">
          <span data-i18n-key="cti.login.browser">Browser configuration</span>
          <h3 data-i18n-key="cti.login.session">Set credentials for this session</h3>
          <div class="auth-form-grid">
            <label>K-Account<input name="kAccount" type="text" required autocomplete="username"></label>
            <label><span data-i18n-key="cti.api.username">API username</span><input name="username" type="text" required autocomplete="username"></label>
            <label><span data-i18n-key="cti.api.password">API password</span><input name="password" type="password" required autocomplete="current-password"></label>
          </div>
          <div class="auth-form-actions">
            <button class="primary-button" type="submit" data-i18n-key="cti.login.submit">Set credentials</button>
            <span data-i18n-key="cti.login.secretsLocal">Secrets remain local to the running server process.</span>
          </div>
        </form>
      `}
      ${status.lastError ? `<p class="form-message error">${copyMarkup(errorCopy(status.lastError))}</p>` : ""}
      ${state.authLoginMessage ? `<p class="form-message success">${copyMarkup(state.authLoginMessage)}</p>` : ""}
      ${state.authLoginError ? `<p class="form-message error">${copyMarkup(errorCopy(state.authLoginError))}</p>` : ""}
    </div>
  `, "#cti-browser-login-form");
}

async function submitCtiBrowserLogin(form) {
  const data = new FormData(form);
  state.authLoginMessage = copy("cti.login.setting", "Setting credentials");
  state.authLoginError = "";
  renderAuthLoginPanel();
  try {
    const result = await api("/api/settings/browser-login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data.entries())),
    });
    state.status = result.status;
    state.google = result.status?.google || state.google;
    form.querySelector('[name="password"]').value = "";
    state.authLoginMessage = copy("cti.login.set", "Browser credentials set for this session.");
    await refreshAll();
  } catch (error) {
    state.authLoginMessage = "";
    state.authLoginError = errorCopy(error.message);
    renderAuthLoginPanel();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(message("cti.contacts.photoError", "Could not read image")));
    reader.readAsDataURL(file);
  });
}

async function submitLocalContact(form) {
  const data = new FormData(form);
  state.contactMessage = copy("cti.contacts.creating", "Creating contact");
  state.contactError = "";
  renderContactsPage();
  const file = data.get("photo");
  try {
    const photoData = file && file.size ? await readFileAsDataUrl(file) : "";
    const name = [data.get("firstName"), data.get("lastName")]
      .map((part) => String(part || "").trim())
      .filter(Boolean)
      .join(" ");
    const result = await api("/api/local-contacts", {
      method: "POST",
      body: JSON.stringify({
        name,
        phone: data.get("phone"),
        organization: data.get("organization"),
        photoData,
        photoMime: file?.type || "",
      }),
    });
    state.google = result.status;
    state.contacts = result.contacts || [];
    state.contactsMode = "local";
    form.reset();
    const fileLabel = form.querySelector("[data-upload-file-name]");
    if (fileLabel) {
      fileLabel.removeAttribute("data-i18n-ignore");
      fileLabel.setAttribute("data-i18n-key", "cti.contacts.noFile");
      fileLabel.textContent = message("cti.contacts.noFile", "No file selected");
    }
    state.contactMessage = copy("cti.contacts.created", "Local contact created.");
    state.contactError = "";
    storageSet("cti-contacts-mode", state.contactsMode);
    renderContactsPage();
  } catch (error) {
    state.contactMessage = "";
    state.contactError = errorCopy(error.message);
    renderContactsPage();
  }
}

function technicalSummary(source) {
  const parts = [];
  if (source.uuid) parts.push(`uuid=${source.uuid}`);
  if (source.extension) parts.push(`extension=${source.extension}`);
  if (source.presence) parts.push(`presence=${source.presence}`);
  if (source.line) parts.push(`line=${source.line}`);
  if (source.state) parts.push(`state=${source.state}`);
  if (source.direction) parts.push(`direction=${source.direction}`);
  return parts.join(" · ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

function serverPagePath() {
  if (window.location.pathname.endsWith("analytics.html")) return "/analytics.html";
  if (window.location.pathname.endsWith("contacts.html")) return "/setup.html";
  if (window.location.pathname.endsWith("setup.html")) return "/setup.html";
  return "/";
}

async function redirectFileModeToServer() {
  if (!fileMode || STATIC_DEMO_MODE) return false;
  try {
    const response = await fetch(`${serverOrigin}/api/status`, {
      headers: { "Accept": "application/json" },
      cache: "no-store",
    });
    if (response.ok) {
      window.location.replace(`${serverOrigin}${serverPagePath()}`);
      return true;
    }
  } catch {
    // Keep the local file visible and show a clear server hint below.
  }

  state.serverMissing = true;
  addEvent(copy("cti.server.missing", "Server unavailable"), copy("cti.server.open", "Start the local server and open {origin}", { origin: serverOrigin }), {
    tech: "node src/server.js",
  });
  render();
  return true;
}

function installDemoMode() {
  const control = document.getElementById('demo-toggle');
  if (!control) return;
  const syncMode = () => { control.checked = Boolean(window.NFON_LOCAL_DEMO); };
  syncMode();
  window.addEventListener('pageshow', syncMode);
  control.addEventListener('change', () => {
    const url = new URL(window.location.href);
    if (control.checked) url.searchParams.set('demo', '1');
    else url.searchParams.delete('demo');
    window.location.assign(url.href);
  });
  const carryMode = link => {
    if (!window.NFON_LOCAL_DEMO || !link || link.hasAttribute('download')) return;
    const url = new URL(link.getAttribute('href'), window.location.href);
    if (url.origin !== new URL(window.location.href).origin || !['/', '/index.html', '/analytics.html', '/setup.html', '/contacts.html'].includes(url.pathname)) return;
    url.searchParams.set('demo', '1');
    link.setAttribute('href', url.href);
  };
  document.querySelectorAll('a.nav-button[href]').forEach(carryMode);
  document.addEventListener('click', event => carryMode(event.target.closest('a[href]')), true);
}

async function startApp() {
  installDemoMode();
  if (await redirectFileModeToServer()) return;
  connectEvents();
  refreshAll();
  refreshContactsPage();
  refreshStoragePage();
}

document.addEventListener("keydown", (event) => {
  if (!els.dialForm || els.dialForm.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    hideDialPanel();
  }
  if (event.key === "Tab") {
    const controls = [...els.dialForm.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled)')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault(); last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first?.focus();
    }
  }
});

document.addEventListener("nfon:demo-pause", (event) => {
  if (!STATIC_DEMO_MODE) return;
  state.demoPaused = Boolean(event.detail?.paused);
  renderStatus();
});

document.addEventListener("nfon:language-change", () => {
  const analytics = buildAnalytics();
  renderStatus();
  renderGoogleStatus();
  renderMetrics(analytics);
  renderAnalytics(analytics);
  renderExtensions(analytics);
  renderActiveCalls();
  renderEvents();
  renderHistory();
  renderStoragePage();
  if (els.contactsListTitle) {
    els.contactsListTitle.textContent = state.contactsMode === "local"
      ? message("cti.contacts.local", "Local contacts") : message("cti.contacts.google", "Google Contacts");
  }
  document.querySelectorAll("[data-cti-date]").forEach((element) => {
    element.textContent = formatDate(element.getAttribute("datetime"));
  });
  if (state.popupContents && els.callPopup && !els.callPopup.hidden) {
    const { call, contact, phone } = state.popupContents;
    const minimized = state.popupMinimized;
    showCallPopup(call, contact, phone);
    if (minimized) toggleCallPopupMinimized();
  }
});

startApp();
