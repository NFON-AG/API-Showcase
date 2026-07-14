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
  serverMissing: false,
  lastPopupKey: "",
  popupVersion: 0,
  linePopoverToken: 0,
  demoEnabled: localStorage.getItem("cti-demo-enabled") === "1",
  demoHistory: readJsonStorage("cti-demo-history", []),
  popupMinimized: false,
  authLoginMode: localStorage.getItem("cti-auth-login-mode") || "env",
  contactsMode: localStorage.getItem("cti-contacts-mode") || "google",
  authLoginMessage: "",
  authLoginError: "",
  contactMessage: "",
  contactError: "",
  csrfToken: "",
};

const labels = {
  presence: {
    available: "Verfügbar",
    offline: "Offline",
    dnd: "Bitte nicht stören",
    busy: "Beschäftigt",
    unknown: "Keine Info",
  },
  line: {
    idle: "Frei",
    "in-use": "Im Gespräch",
    ringing: "Klingelt",
    busy: "Besetzt",
    unknown: "Keine Info",
  },
  call: {
    start: "Anruf wird vorbereitet",
    "caller-dial": "Nebenstelle wird angerufen",
    "caller-ring": "Nebenstelle klingelt",
    "caller-answer": "Nebenstelle hat angenommen",
    dial: "Ziel wird angerufen",
    ring: "Ziel klingelt",
    answer: "Gespräch verbunden",
    hangup: "Gespräch beendet",
    end: "Anfrage abgeschlossen",
    reject: "Abgelehnt",
  },
  direction: {
    inbound: "Eingehend",
    outbound: "Ausgehend",
    unknown: "Unbekannt",
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
  demoToggle: document.getElementById("demo-toggle"),
};

const serverOrigin = localStorage.getItem("cti-server-origin") || "http://127.0.0.1:3002";
const fileMode = window.location.protocol === "file:";
const apiOrigin = fileMode ? serverOrigin : "";

if (els.refresh) {
  els.refresh.title = "Nebenstellen, Status und Verlauf neu laden";
}

if (els.contactsSync) els.contactsSync.title = "Optionales Google-Kontaktmodul neu laden";
if (els.contactsDisconnect) els.contactsDisconnect.title = "Lokale Verbindung und Kontaktcache entfernen";
if (els.backupDownload) els.backupDownload.title = "Call-Verlauf als lokale JSON-Datei sichern";
if (els.backupImport) els.backupImport.title = "Backup-Datei laden und neue Call-Events zusammenfuehren";

function apiPath(path) {
  return `${apiOrigin}${path}`;
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

async function api(path, options = {}) {
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
    throw new Error(body?.error || `HTTP ${response.status}`);
  }
  return body;
}

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function extensionStateMap() {
  return new Map(state.states.map((item) => [String(item.extension), item]));
}

function extensionName(extensionNumber) {
  const found = state.extensions.find((extension) => String(extension.extension_number) === String(extensionNumber));
  return found?.name || extensionNumber || "Unbekannt";
}

function formatTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function dayKey(value = new Date()) {
  return new Date(value).toLocaleDateString("sv-SE");
}

function label(value, group) {
  if (value === undefined || value === null || value === "") return labels[group]?.unknown || "Keine Info";
  return labels[group]?.[value] || String(value);
}

function rawLabel(value) {
  if (value === undefined || value === null || value === "") return "unknown";
  return String(value);
}

function render() {
  const analytics = buildAnalytics();
  renderStatus();
  renderDemoControls();
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
}

function renderDemoControls() {
  if (els.demoToggle) {
    els.demoToggle.checked = state.demoEnabled;
  }
}

function renderStatus() {
  const status = state.status;
  els.account.textContent = status?.account || "Bitte einloggen";

  if (state.serverMissing) {
    els.connection.className = "connection is-warning";
    els.connection.textContent = "SERVER";
    els.connection.title = `Lokalen Server starten und die App ueber ${serverOrigin} oeffnen`;
    return;
  }

  const callsConnected = Boolean(status?.streams?.calls?.connected);
  const statesConnected = Boolean(status?.streams?.states?.connected);
  els.connection.className = "connection";
  els.connection.removeAttribute("title");

  if (callsConnected || statesConnected) {
    els.connection.textContent = "LIVE";
    els.connection.classList.add("is-online");
  } else if (status?.credentialsConfigured) {
    els.connection.textContent = "API bereit";
    els.connection.classList.add("is-warning");
  } else {
    els.connection.textContent = "Setup";
  }
}

function renderGoogleStatus() {
  if (!els.googleConnect) return;
  const google = state.google || state.status?.google;
  if (!google?.configured) {
    els.googleConnect.textContent = "Google Kontakte";
    els.googleConnect.title = "Optionales Google-Kontaktmodul: Zugangsdaten fehlen";
    els.googleConnect.classList.remove("is-connected");
    return;
  }
  if (google.connected) {
    els.googleConnect.textContent = `Google Kontakte ${google.contacts || 0}`;
    els.googleConnect.title = "Optionales Google-Kontaktmodul ist verbunden";
    els.googleConnect.classList.add("is-connected");
    return;
  }
  els.googleConnect.textContent = "Google Kontakte";
  els.googleConnect.title = "Optionales Google-Kontaktmodul verbinden";
  els.googleConnect.classList.remove("is-connected");
}

function renderMetrics(analytics) {
  const available = state.states.filter((item) => item.presence === "available" && item.line !== "in-use").length;
  if (els.metricExtensions) els.metricExtensions.textContent = state.extensions.length;
  if (els.metricAvailable) els.metricAvailable.textContent = available;
  if (els.metricActive) els.metricActive.textContent = state.activeCalls.length;
  if (els.metricEvents) els.metricEvents.textContent = analytics.today.total;
  if (els.metricAnswered) els.metricAnswered.textContent = analytics.today.answered;
  if (els.metricTalkTime) els.metricTalkTime.textContent = formatDuration(analytics.today.talkMs, true);
  renderMetricComparison(els.metricEvents, "Vortag", analytics.yesterday.total, analytics.today.total);
  renderMetricDetail(els.metricAnswered, `Verpasst ${analytics.today.missed}`, "mixed");
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
  const percent = previous === 0 ? (current === 0 ? 0 : 100) : Math.round((delta / previous) * 100);
  const trendClass = percent > 0 ? "positive" : percent < 0 ? "negative" : "neutral";
  const trendText = `${percent > 0 ? "+" : ""}${percent}%`;
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
  const startHour = Math.max(0, endHour - 11);
  const visibleHours = analytics.hourly.slice(startHour, endHour + 1);
  const max = Math.max(1, ...visibleHours.flatMap((item) => [item.inboundAnswered, item.missed, item.outbound]));
  const width = 520;
  const height = 174;
  const points = chartPoints(visibleHours, max, width, height);
  if (els.timelineKicker) els.timelineKicker.textContent = `${analytics.today.inboundAnswered} angenommen · ${analytics.today.missed} verpasst · ${analytics.today.outbound} ausgehend`;
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
    <svg viewBox="0 0 ${width} ${height}" aria-hidden="true">
      <defs>${gradients}</defs>
      <path d="M28 126H500" stroke="#d8e0df"></path>
      <path d="M28 78H500" stroke="#edf1f0"></path>
      <path d="${areaPath(points.inboundAnswered, points.baseline)}" fill="url(#answeredFill)"></path>
      <path d="${areaPath(points.missed, points.baseline)}" fill="url(#missedFill)"></path>
      <path d="${areaPath(points.outbound, points.baseline)}" fill="url(#outboundFill)"></path>
      <path d="${smoothPath(points.inboundAnswered)}" fill="none" stroke="#00d981" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${smoothPath(points.missed)}" fill="none" stroke="#f36b5b" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      <path d="${smoothPath(points.outbound)}" fill="none" stroke="#3513cf" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"></path>
      ${visibleHours.map((item, index) => `<text x="${points.x(index)}" y="156" text-anchor="middle">${escapeHtml(String(item.hour).padStart(2, "0"))}</text>`).join("")}
    </svg>
    <div class="chart-legend">
      <span><i class="legend-dot green"></i>Angenommen</span>
      <span><i class="legend-dot coral"></i>Verpasst</span>
      <span><i class="legend-dot blue"></i>Ausgehend</span>
    </div>
  `;
}

function renderTrend(analytics) {
  if (!els.trendChart) return;
  const max = Math.max(1, ...analytics.daily.map((item) => item.total));
  const total = analytics.daily.reduce((sum, item) => sum + item.total, 0);
  if (els.trendKicker) els.trendKicker.textContent = `${total} Calls`;
  els.trendChart.innerHTML = `
    <div class="daily-bars">
      ${analytics.daily.map((item) => {
        const answeredHeight = Math.max(0, Math.round((item.inboundAnswered / max) * 128));
        const missedHeight = Math.max(0, Math.round((item.missed / max) * 128));
        const outboundHeight = Math.max(0, Math.round((item.outbound / max) * 128));
        return `
          <div class="daily-slot" title="${escapeHtml(item.label)} · ${item.total} Calls">
            <strong>${item.total || ""}</strong>
            <div class="daily-stack">
              <span class="bar-segment answered" style="height:${answeredHeight}px"></span>
              <span class="bar-segment missed" style="height:${missedHeight}px"></span>
              <span class="bar-segment outbound" style="height:${outboundHeight}px"></span>
            </div>
            <span>${escapeHtml(item.label)}</span>
          </div>
        `;
      }).join("")}
    </div>
    <div class="chart-legend">
      <span><i class="legend-dot green"></i>Angenommen</span>
      <span><i class="legend-dot coral"></i>Verpasst</span>
      <span><i class="legend-dot blue"></i>Ausgehend</span>
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
  const hoverDetails = [
    `Eingehend: ${inbound} (${signedCount(inbound - yesterdayInbound)} vs Vortag)`,
    `Ausgehend: ${outbound} (${signedCount(outbound - yesterdayOutbound)} vs Vortag)`,
    `Unklar: ${other}`,
  ].join("\n");
  const total = Math.max(1, inbound + outbound + other);
  const inboundDeg = Math.round((inbound / total) * 360);
  const outboundDeg = Math.round((outbound / total) * 360);
  const otherDeg = Math.max(0, 360 - inboundDeg - outboundDeg);
  if (els.directionKicker) els.directionKicker.textContent = `${inbound} / ${outbound}`;
  els.directionChart.innerHTML = `
    <div class="donut" title="${escapeHtml(hoverDetails)}" aria-label="${escapeHtml(hoverDetails)}" style="background: conic-gradient(var(--accent) 0 ${inboundDeg}deg, var(--nfon-blue) ${inboundDeg}deg ${inboundDeg + outboundDeg}deg, var(--purple-soft) ${inboundDeg + outboundDeg}deg ${inboundDeg + outboundDeg + otherDeg}deg)"></div>
    <div class="donut-legend">
      <span><i class="legend-dot green"></i>Eingehend <b>${inbound}</b></span>
      <span><i class="legend-dot blue"></i>Ausgehend <b>${outbound}</b></span>
      <span><i class="legend-dot soft"></i>Unklar <b>${other}</b></span>
    </div>
  `;
}

function renderTeamRanking(analytics) {
  if (!els.teamRanking) return;
  const rows = analytics.team.slice(0, 8);
  const max = Math.max(1, ...rows.map((item) => item.total));
  if (els.teamKicker) els.teamKicker.textContent = rows.length ? `${rows.length} aktiv` : "Noch keine Calls";
  if (!rows.length) {
    els.teamRanking.className = "empty-list";
    els.teamRanking.textContent = "Noch keine Anrufe im heutigen Verlauf";
    return;
  }

  els.teamRanking.className = "ranking-list";
  els.teamRanking.innerHTML = rows.map((item) => {
    const inboundWidth = Math.round((item.inbound / max) * 100);
    const outboundWidth = Math.round((item.outbound / max) * 100);
    return `
      <div class="ranking-row" title="${escapeHtml(item.extension)} · ${item.inbound} eingehend · ${item.outbound} ausgehend · ${item.missed} verpasst">
        <div class="ranking-main">
          <strong>${escapeHtml(extensionName(item.extension))}</strong>
          <span>${escapeHtml(item.extension)} · ${item.total} Calls</span>
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
  if (els.qualityKicker) els.qualityKicker.textContent = "Heute";
  els.qualityPanel.innerHTML = `
    <div class="quality-item">
      <span>Annahmequote</span>
      <strong>${quote}%</strong>
    </div>
    <div class="quality-item">
      <span>Durchschnitt</span>
      <strong>${formatDuration(analytics.today.avgTalkMs, true)}</strong>
    </div>
    <div class="quality-item">
      <span>Verpasst</span>
      <strong class="value-missed">${analytics.today.missed}</strong>
    </div>
    <div class="quality-item">
      <span>Top-Zeit</span>
      <strong>${escapeHtml(analytics.peakHour)}</strong>
    </div>
    <div class="quality-item wide">
      <span>Eingehend / Ausgehend</span>
      <strong><span class="value-inbound">${analytics.today.inbound}</span><span class="value-separator"> / </span><span class="value-outbound">${analytics.today.outbound}</span></strong>
    </div>
    <div class="quality-item wide top-users">
      <span>Top 3 User</span>
      <div class="quality-users">
        ${topUsers.length ? topUsers.map((item, index) => `
          <div class="quality-user-row">
            <b>${index + 1}</b>
            <strong>${escapeHtml(extensionName(item.extension))}</strong>
            <small><span class="quality-count inbound">${item.inbound}</span> eingehend · <span class="quality-count outbound">${item.outbound}</span> ausgehend</small>
          </div>
        `).join("") : `<div class="empty-list compact">Noch keine Userdaten</div>`}
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
        <td class="extension-name" data-extension="${escapeHtml(number)}">${escapeHtml(extension.name || "")}</td>
        <td>${escapeHtml(number)}</td>
        <td><span class="status-chip ${escapeHtml(presence)}" title="Technisch: presence=${escapeHtml(presence)}">${escapeHtml(label(presence, "presence"))}</span></td>
        <td><span class="status-chip ${escapeHtml(line)}" data-line-status data-extension="${escapeHtml(number)}" data-line="${escapeHtml(line)}" data-since="${escapeHtml(current.lineSince || current.receivedAt || "")}" title="Technisch: line=${escapeHtml(line)}">${escapeHtml(label(line, "line"))}</span></td>
        <td>
          <button class="direction-chip outbound direction-button" data-caller="${escapeHtml(number)}" title="Von dieser Nebenstelle anrufen · ${escapeHtml(extensionAnalytics.total)} Calls heute" aria-label="Von ${escapeHtml(extension.name || number)} anrufen">↗</button>
        </td>
      </tr>
    `;
  }).join("");

  els.extensionsBody.querySelectorAll("[data-caller]").forEach((button) => {
    button.addEventListener("click", () => {
      showDialPanel();
      els.callerSelect.value = button.dataset.caller;
      localStorage.setItem("cti-selected-caller", button.dataset.caller);
      els.calleeInput.focus();
    });
  });
}

function showDialPanel() {
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
}

function ensureDialModalControls() {
  if (els.dialStack && !els.dialStack.querySelector(".dial-modal-backdrop")) {
    const backdrop = document.createElement("button");
    backdrop.type = "button";
    backdrop.className = "dial-modal-backdrop";
    backdrop.setAttribute("aria-label", "Click-to-Dial schliessen");
    backdrop.addEventListener("click", hideDialPanel);
    els.dialStack.prepend(backdrop);
  }

  if (els.dialForm && !els.dialForm.querySelector("[data-dial-close]")) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "modal-close";
    closeButton.dataset.dialClose = "";
    closeButton.setAttribute("aria-label", "Click-to-Dial schliessen");
    closeButton.innerHTML = "&times;";
    closeButton.addEventListener("click", hideDialPanel);
    els.dialForm.append(closeButton);
  }
}

function renderCallerSelect() {
  if (!els.callerSelect) return;
  const selected = els.callerSelect.value || localStorage.getItem("cti-selected-caller") || "100";
  const options = state.extensions.map((extension) => {
    const value = extension.extension_number;
    const text = `${extension.extension_number} - ${extension.name}`;
    return `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`;
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
    els.activeCalls.textContent = "Keine aktiven Calls";
    return;
  }

  els.activeCalls.className = "";
  els.activeCalls.innerHTML = state.activeCalls.map((call) => `
    <div class="active-call" title="Technisch: ${escapeHtml(call.uuid || "")} · ${escapeHtml(rawLabel(call.state))}">
      <strong>${escapeHtml(label(call.state, "call"))} · ${escapeHtml(extensionName(call.extension))}</strong>
      <span class="muted">${escapeHtml(rawLabel(call.caller))} -> ${escapeHtml(rawLabel(call.callee))}</span>
      <div class="active-call-footer">
        <span class="event-time">${escapeHtml(formatTime(call.receivedAt || call.updated))}</span>
        <button class="secondary-button" data-cancel="${escapeHtml(call.uuid)}">Abbrechen</button>
      </div>
    </div>
  `).join("");

  els.activeCalls.querySelectorAll("[data-cancel]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        await api(`/api/calls/${encodeURIComponent(button.dataset.cancel)}`, { method: "DELETE" });
      } catch (error) {
        showDialMessage(error.message, true);
      }
    });
  });
}

function renderEvents() {
  if (!els.eventsList) return;
  els.eventsList.innerHTML = state.events.slice(0, 40).map((event) => `
    <li class="event-item" title="${escapeHtml(event.tech || "")}">
      <span class="event-time">${escapeHtml(formatTime(event.receivedAt || event.updated))}</span>
      <span class="event-title">${escapeHtml(event.title)}</span>
      <span class="event-detail">${escapeHtml(event.detail || "")}</span>
    </li>
  `).join("");
}

function renderHistory() {
  if (!els.historyBody) return;
  const sessions = buildCallSessions(historySource()).slice(0, 80);
  els.historyBody.innerHTML = sessions.map((session) => `
    <tr class="history-group-row" data-session-id="${escapeHtml(session.uuid || "")}" title="Technisch: ${escapeHtml(session.uuid || "")} · ${session.eventCount} Events">
      <td>
        <div class="history-time">
          <strong>${escapeHtml(formatDate(session.startedAt))}</strong>
          <span>${escapeHtml(formatDuration(session.durationMs))}</span>
        </div>
      </td>
      <td>
        <div class="history-state-stack">
          <span class="status-chip ${escapeHtml(sessionStatusClass(session))}">${escapeHtml(sessionStatusLabel(session))}</span>
          <small>${escapeHtml(session.eventCount)} Events</small>
        </div>
      </td>
      <td>${directionCell(session.direction)}</td>
      ${historyPartyCells(session)}
    </tr>
  `).join("");
  hydrateContactCells();
}

function sessionStatusLabel(session) {
  if (session.missed) return "Verpasst";
  if (session.answered) return "Angenommen";
  if (session.direction === "outbound") return "Ausgehend";
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
        <div class="history-avatar agent-avatar">${escapeHtml(initials(name))}</div>
        <div>
          <strong>${escapeHtml(name)}</strong>
          <span>Nebenstelle ${escapeHtml(extension)}</span>
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
    downloadBlob(`nfon-api-demo-calls-${stamp}.xls`, `\ufeff${table}`, "application/vnd.ms-excel;charset=utf-8");
    return;
  }
  downloadBlob(`nfon-api-demo-calls-${stamp}.csv`, `\ufeff${rowsToCsv(rows)}`, "text/csv;charset=utf-8");
}

async function exportRows() {
  const sessions = buildCallSessions(historySource());
  const rows = [];
  for (const session of sessions) {
    const parties = await exportParties(session);
    rows.push({
      "Datum": formatDate(session.startedAt),
      "Status": sessionStatusLabel(session),
      "Richtung": label(session.direction, "direction"),
      "Von": parties.from,
      "Zu": parties.to,
      "Nebenstelle": `${extensionName(session.extension)} (${session.extension})`,
      "Dauer": formatDuration(session.durationMs),
      "Events": session.eventCount,
      "Call-ID": session.uuid || "",
    });
  }
  return rows;
}

async function exportParties(session) {
  const internal = `${extensionName(session.extension)} · Nebenstelle ${session.extension}`;
  const externalPhone = externalPartyPhone(session);
  let external = formatPhone(externalPhone);
  try {
    const contact = await lookupContact(externalPhone);
    if (contact?.name) {
      external = contact.organization
        ? `${contact.name} · ${contact.organization} · ${formatPhone(externalPhone)}`
        : `${contact.name} · ${formatPhone(externalPhone)}`;
    }
  } catch {
    // Keep the phone number when Google lookup is currently unavailable.
  }
  return isOutboundCall(session)
    ? { from: internal, to: external }
    : { from: external, to: internal };
}

function rowsToCsv(rows) {
  const headers = rows[0] ? Object.keys(rows[0]) : ["Datum", "Status", "Richtung", "Von", "Zu", "Nebenstelle", "Dauer", "Events", "Call-ID"];
  return [
    headers.join(";"),
    ...rows.map((row) => headers.map((header) => csvCell(row[header])).join(";")),
  ].join("\n");
}

function csvCell(value) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

function rowsToHtmlTable(rows) {
  const headers = rows[0] ? Object.keys(rows[0]) : ["Datum", "Status", "Richtung", "Von", "Zu", "Nebenstelle", "Dauer", "Events", "Call-ID"];
  return `
    <html>
      <head><meta charset="utf-8"></head>
      <body>
        <table>
          <thead><tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
          <tbody>
            ${rows.map((row) => `<tr>${headers.map((header) => `<td>${escapeHtml(row[header] ?? "")}</td>`).join("")}</tr>`).join("")}
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
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ensureDemoHistory() {
  if (!state.demoEnabled) return;
  const demoCalls = buildCallSessions(state.demoHistory).length;
  if (demoCalls >= 1000) return;
  state.demoHistory = generateDemoHistory();
  localStorage.setItem("cti-demo-history", JSON.stringify(state.demoHistory));
}

function historySource() {
  ensureDemoHistory();
  return state.demoEnabled ? [...state.history, ...state.demoHistory] : state.history;
}

function generateDemoHistory() {
  const extensionPool = state.extensions.length
    ? state.extensions.map((item) => String(item.extension_number))
    : ["100", "101", "102", "103", "104", "105", "106", "199", "1000"];
  const externalNumbers = [
    "490000010001",
    "490000010002",
    "490000010003",
    "490000010004",
    "490000010005",
    "490000010006",
    "490000010007",
    "490000010008",
    "490000010009",
    "490000010010",
    "490000010011",
    "490000010012",
  ];
  const callsPerDay = [62, 78, 69, 81, 74, 58, 71, 85, 76, 64, 82, 88, 73, 87];
  const events = [];
  const now = new Date();
  callsPerDay.forEach((count, dayIndex) => {
    const date = new Date(now);
    date.setDate(now.getDate() - (13 - dayIndex));
    for (let index = 0; index < count; index += 1) {
      const extension = extensionPool[(index + dayIndex) % extensionPool.length];
      const external = externalNumbers[(index * 3 + dayIndex) % externalNumbers.length];
      const direction = seededPick(index + dayIndex * 7, 100) < 68 ? "inbound" : "outbound";
      const answered = direction === "outbound" || seededPick(index * 11 + dayIndex, 100) < 74;
      const startedAt = new Date(date);
      startedAt.setHours(8 + seededPick(index * 5 + dayIndex, 10), seededPick(index * 13 + dayIndex, 60), seededPick(index * 17 + dayIndex, 60), 0);
      const durationSeconds = answered ? 25 + seededPick(index * 19 + dayIndex, 420) : 0;
      const uuid = `demo-${dayKey(startedAt)}-${String(index).padStart(3, "0")}`;
      const caller = direction === "outbound" ? extension : external;
      const callee = direction === "outbound" ? external : "490000010000";
      const sequence = direction === "outbound"
        ? ["caller-dial", "dial", "answer", "hangup"]
        : answered ? ["caller-ring", "ring", "answer", "hangup"] : ["caller-ring", "ring", "hangup"];
      sequence.forEach((stateName, stateIndex) => {
        const eventDate = new Date(startedAt);
        const offset = stateName === "hangup" ? Math.max(8, durationSeconds) : stateIndex * 3;
        eventDate.setSeconds(startedAt.getSeconds() + offset);
        events.push({
          uuid,
          demo: true,
          account: state.status?.account || "Demo",
          extension,
          caller,
          callee,
          direction,
          state: stateName,
          updated: eventDate.toISOString(),
          receivedAt: eventDate.toISOString(),
        });
      });
    }
  });
  return events.sort((a, b) => new Date(b.receivedAt) - new Date(a.receivedAt));
}

function seededPick(seed, max) {
  const x = Math.sin(seed + 1) * 10000;
  return Math.floor((x - Math.floor(x)) * max);
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

function mergeSnapshot(snapshot) {
  state.status = snapshot.status || state.status;
  rememberCsrfToken(snapshot.status);
  state.google = snapshot.status?.google || state.google;
  state.extensions = snapshot.extensions || state.extensions;
  state.states = snapshot.states || state.states;
  state.activeCalls = snapshot.activeCalls || state.activeCalls;
  state.history = snapshot.history || state.history;
}

function handleEvent(payload) {
  if (payload.type === "snapshot") {
    mergeSnapshot(payload);
  }
  if (payload.type === "status") {
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
    addEvent(
      `${extensionName(payload.state.extension)} ist ${label(payload.state.line, "line").toLowerCase()}`,
      `${label(payload.state.presence, "presence")} · Nebenstelle ${payload.state.extension}`,
      payload.state,
    );
  }
  if (payload.type === "call") {
    state.activeCalls = payload.activeCalls || state.activeCalls;
    state.history = payload.history || state.history;
    const call = payload.call;
    addEvent(
      label(call.state, "call"),
      `${extensionName(call.extension)} · ${rawLabel(call.caller)} -> ${rawLabel(call.callee)}`,
      call,
    );
    maybeShowCallPopup(call);
  }
  if (payload.type === "call-cancelled") {
    state.activeCalls = payload.activeCalls || [];
    addEvent("Anruf abgebrochen", "Der laufende Verbindungsaufbau wurde beendet", { uuid: payload.uuid });
  }
  render();
}

async function refreshAll() {
  if (state.serverMissing) {
    addEvent("Server fehlt", "Bitte lokalen CTI-Server starten", { tech: "node src/server.js" });
    render();
    return;
  }
  if (els.refresh) els.refresh.disabled = true;
  try {
    const [status, extensions, states, history, activeCalls] = await Promise.all([
      api("/api/status"),
      api("/api/extensions"),
      api("/api/states"),
      api("/api/history"),
      api("/api/active-calls"),
    ]);
    state.status = status;
    rememberCsrfToken(status);
    state.google = status.google || state.google;
    state.extensions = extensions;
    state.states = states;
    state.history = history;
    state.activeCalls = activeCalls;
    addEvent("Daten aktualisiert", "Nebenstellen, Status und Verlauf wurden neu geladen", { tech: "manual refresh" });
    render();
  } catch (error) {
    addEvent("API Fehler", error.message, { tech: error.message });
    render();
  } finally {
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
      <div class="empty-list compact">${escapeHtml(error || "Speicherstatus wird geladen")}</div>
    `;
    return;
  }

  const files = Object.entries(storage.files || {});
  const totalBytes = files.reduce((sum, [, file]) => sum + Number(file.bytes || 0), 0);
  els.storageSummary.innerHTML = `
    <div class="status-tile">
      <span>Lokale Daten</span>
      <strong>${escapeHtml(formatBytes(totalBytes))}</strong>
    </div>
    <div class="status-tile">
      <span>Call-Events</span>
      <strong>${files.reduce((sum, [, file]) => sum + Number(file.records || 0), 0)}</strong>
    </div>
  `;

}

function renderContactsPage(error = "") {
  if (!els.contactsList) return;
  const google = state.google || {};
  const mode = state.contactsMode === "local" ? "local" : "google";
  const sourceContacts = (state.contacts || []).filter((contact) => (
    mode === "local" ? contact.source === "local" : contact.source !== "local"
  ));
  if (els.contactsListTitle) {
    els.contactsListTitle.textContent = mode === "local" ? "Lokale Kontakte" : "Google Kontakte";
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
      ? `${google.contacts || 0} Kontakte verbunden`
      : google.configured ? "Bereit zum Verbinden" : "Google Zugangsdaten fehlen";
    els.contactsStatus.innerHTML = `
      <div class="auth-mode-switch contacts-mode-switch" role="tablist" aria-label="Kontaktquelle">
        <button class="${googleActive ? "is-active" : ""}" type="button" data-contact-mode="google">Google Login</button>
        <button class="${localActive ? "is-active" : ""}" type="button" data-contact-mode="local">Lokale Kontakte</button>
      </div>
      ${googleActive ? `
        <div class="status-tile">
          <span>Status</span>
          <strong>${escapeHtml(statusText)}</strong>
        </div>
        <div class="status-tile">
          <span>Letzter Sync</span>
          <strong>${escapeHtml(google.lastSyncAt ? formatDate(google.lastSyncAt) : "Noch nicht")}</strong>
        </div>
        <div class="contacts-actions inline-actions">
          <a class="primary-button link-button" href="/auth/google/start" ${google.connected ? "hidden" : ""}>Verbinden</a>
          <button class="secondary-button" data-contact-action="sync" type="button" ${google.connected ? "" : "disabled"}>Synchronisieren</button>
          <button class="secondary-button danger-button" data-contact-action="disconnect" type="button" ${google.connected ? "" : "disabled"}>Trennen</button>
        </div>
      ` : `
        <div class="status-tile">
          <span>Lokale Kontakte</span>
          <strong>${sourceContacts.length}</strong>
        </div>
        <form class="local-contact-form" id="local-contact-form">
          <div class="local-contact-name-grid">
            <label>Vorname<input name="firstName" required autocomplete="given-name" placeholder="Max"></label>
            <label>Nachname<input name="lastName" required autocomplete="family-name" placeholder="Mustermann"></label>
          </div>
          <label>Telefon<input name="phone" required inputmode="tel" placeholder="+49..."></label>
          <label>Firma<input name="organization" placeholder="NFON AG"></label>
          <label>Bild
            <span class="upload-control">
              <input name="photo" type="file" accept="image/png,image/jpeg,image/webp">
              <span class="upload-button">Bild auswählen</span>
              <span class="upload-file-name" data-upload-file-name>Keine Datei</span>
            </span>
          </label>
          <button class="primary-button" type="submit">Kontakt anlegen</button>
        </form>
      `}
      ${state.contactMessage ? `<p class="form-message success">${escapeHtml(state.contactMessage)}</p>` : ""}
      ${state.contactError || error ? `<p class="form-message error">${escapeHtml(state.contactError || error)}</p>` : ""}
    `;
  }
  if (!contacts.length) {
    els.contactsList.className = "empty-list";
    els.contactsList.textContent = state.contactsMode === "local"
      ? "Noch keine lokalen Testkontakte angelegt."
      : "Keine Kontakte gefunden.";
    return;
  }

  els.contactsList.className = "contacts-list";
  els.contactsList.innerHTML = contacts.map((contact) => {
    const phone = contact.phones?.[0]?.value || "";
    const avatar = contact.hasPhoto
      ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">`
      : initialsAvatar(contact.name);
    return `
      <article class="contact-row">
        <div class="contact-avatar">${avatar}</div>
        <div class="contact-main">
          <strong>${escapeHtml(contact.name)}</strong>
          <span>${escapeHtml(phone || "Keine Telefonnummer")}</span>
          <small>${escapeHtml(contact.organization || "Google Contact")}</small>
        </div>
        <div class="contact-actions">
          ${contact.source === "local" ? `<button class="ghost-button" type="button" data-delete-local-contact="${escapeAttr(contact.id)}">Löschen</button>` : ""}
        </div>
      </article>
    `;
  }).join("");
}

function connectEvents() {
  if (state.serverMissing) return;
  const events = new EventSource(apiPath("/api/events"));
  events.onmessage = (message) => handleEvent(JSON.parse(message.data));
  ["snapshot", "status", "extensions", "states", "state", "call", "call-cancelled"].forEach((name) => {
    events.addEventListener(name, (message) => handleEvent(JSON.parse(message.data)));
  });
  events.onerror = () => {
    els.connection.textContent = "SYNC";
    els.connection.className = "connection is-warning";
  };
}

function showDialMessage(message, isError = false, tech = "") {
  if (!els.dialMessage) return;
  els.dialMessage.textContent = message;
  els.dialMessage.title = tech;
  els.dialMessage.className = `form-message${isError ? " error" : ""}`;
}

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
      localStorage.setItem("cti-contacts-mode", state.contactsMode);
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
    const fileName = event.target.files?.[0]?.name || "Keine Datei";
    const label = event.target.closest(".upload-control")?.querySelector("[data-upload-file-name]");
    if (label) label.textContent = fileName;
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
      state.contactMessage = "Lokaler Kontakt gelöscht.";
      state.contactError = "";
      renderContactsPage();
    } catch (error) {
      state.contactError = error.message;
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
    localStorage.setItem("cti-auth-login-mode", state.authLoginMode);
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
    setBackupMessage("Backup wird geprüft");
    try {
      const text = await file.text();
      const body = JSON.parse(text);
      const result = await api("/api/storage/restore", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setBackupMessage(`${result.imported} neue Events importiert, ${result.duplicates} Duplikate übersprungen`, false);
      await refreshStoragePage();
      await refreshAll();
    } catch (error) {
      setBackupMessage(error.message, true);
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
if (els.demoToggle) {
  els.demoToggle.addEventListener("change", () => {
    state.demoEnabled = els.demoToggle.checked;
    if (state.demoEnabled) {
      state.demoHistory = generateDemoHistory();
      localStorage.setItem("cti-demo-history", JSON.stringify(state.demoHistory));
      localStorage.setItem("cti-demo-enabled", "1");
    } else {
      state.demoHistory = [];
      localStorage.removeItem("cti-demo-history");
      localStorage.setItem("cti-demo-enabled", "0");
    }
    render();
  });
}
if (els.callerSelect) {
  els.callerSelect.addEventListener("change", () => {
    localStorage.setItem("cti-selected-caller", els.callerSelect.value);
  });
}
if (els.dialForm) {
  els.dialForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    showDialMessage("Anruf wird gestartet");
    try {
      const result = await api("/api/calls", {
        method: "POST",
        body: JSON.stringify({
          caller: els.callerSelect.value,
          callee: els.calleeInput.value,
        }),
      });
      const tech = result?.uuid ? `Call-ID: ${result.uuid}` : "";
      showDialMessage("Anruf wurde gestartet", false, tech);
      els.calleeInput.select();
    } catch (error) {
      showDialMessage("Anruf konnte nicht gestartet werden", true, error.message);
    }
  });
}

document.addEventListener("mousemove", (event) => {
  const statusChip = event.target.closest?.("[data-line-status]");
  if (statusChip) {
    showLineStatusPopover(statusChip, event);
    return;
  }
  const sessionRow = event.target.closest?.("[data-session-id]");
  if (sessionRow) {
    showSessionPopover(sessionRow.dataset.sessionId, event);
    return;
  }
  const row = event.target.closest?.("[data-extension-row]");
  if (!row) {
    hidePopover();
    return;
  }
  showExtensionPopover(row.dataset.extensionRow, event);
});

document.addEventListener("mouseleave", hidePopover);

function buildAnalytics() {
  const sessions = buildCallSessions(historySource());
  const today = dayKey();
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
  return {
    sessions,
    today: totals,
    yesterday,
    daily,
    hourly,
    team,
    byExtension,
    peakHour: peak?.total ? `${String(peak.hour).padStart(2, "0")}:00` : "-",
  };
}

function buildDailySessions(sessions) {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - (6 - index));
    const key = dayKey(date);
    const daySessions = sessions.filter((session) => dayKey(session.startedAt) === key);
    return {
      key,
      label: new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(date),
      total: daySessions.length,
      answered: daySessions.filter((session) => session.answered).length,
      inboundAnswered: daySessions.filter((session) => session.direction === "inbound" && session.answered).length,
      missed: daySessions.filter((session) => session.missed).length,
      outbound: daySessions.filter((session) => session.direction === "outbound").length,
    };
  });
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
    const sorted = [...items].sort((a, b) => new Date(a.updated || a.receivedAt) - new Date(b.updated || b.receivedAt));
    const first = sorted[0] || {};
    const last = sorted[sorted.length - 1] || first;
    const answeredEvent = sorted.find((item) => item.state === "answer" || item.state === "caller-answer");
    const endEvent = [...sorted].reverse().find((item) => item.state === "hangup" || item.state === "end") || last;
    const startedAt = first.updated || first.receivedAt || new Date().toISOString();
    const answerAt = answeredEvent?.updated || answeredEvent?.receivedAt;
    const endedAt = endEvent.updated || endEvent.receivedAt || startedAt;
    const direction = last.direction || first.direction || "unknown";
    const durationMs = answerAt ? Math.max(0, new Date(endedAt) - new Date(answerAt)) : 0;
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
  }).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
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
    <strong>${escapeHtml(extensionName(extension))}</strong>
    <span class="popover-subline">Nebenstelle ${escapeHtml(extension)}</span>
    <div class="popover-metrics">
      <span><b>${item.total}</b> Calls</span>
      <span><b>${item.answered}</b> angenommen</span>
      <span><b>${item.missed}</b> verpasst</span>
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

  if (token !== state.linePopoverToken || !element.matches(":hover")) return;

  if (["in-use", "ringing"].includes(line) && activeCall) {
    els.popover.innerHTML = lineContactPopover(extension, line, activeCall, contact);
  } else {
    const headline = line === "idle" ? "Frei" : label(line, "line");
    els.popover.innerHTML = `
      <strong>${escapeHtml(headline)} seit ${escapeHtml(minutesSince(since))}</strong>
      <span class="popover-subline">${escapeHtml(extensionName(extension))} · Nebenstelle ${escapeHtml(extension)}</span>
    `;
  }

  els.popover.hidden = false;
  positionPopover(event);
}

function lineContactPopover(extension, line, call, contact) {
  const phone = externalPartyPhone(call);
  const name = contact?.name || formatPhone(phone);
  const org = contact?.organization || "Kontakt / CRM Lookup";
  const since = callStatusSince(call, line);
  const avatar = contact?.id
    ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">`
    : initialsAvatar(name);
  return `
    <div class="line-popover-contact">
      <div class="contact-avatar">${avatar}</div>
      <div>
        <strong>${escapeHtml(name)}</strong>
        <span>${escapeHtml(org)}</span>
        <small>${escapeHtml(label(line, "line"))} seit ${escapeHtml(minutesSince(since))}</small>
      </div>
    </div>
    <span class="popover-subline">${escapeHtml(extensionName(extension))} · ${escapeHtml(formatPhone(phone))}</span>
  `;
}

function showSessionPopover(sessionId, event) {
  if (!els.popover) return;
  const session = buildCallSessions(historySource()).find((item) => item.uuid === sessionId);
  if (!session) {
    hidePopover();
    return;
  }
  const externalPhone = externalPartyPhone(session);
  const external = formatPhone(externalPhone);
  const internal = `${extensionName(session.extension)} · Nebenstelle ${session.extension}`;
  const from = isOutboundCall(session) ? internal : external;
  const to = isOutboundCall(session) ? external : internal;
  els.popover.classList.add("session-popover");
  els.popover.innerHTML = `
    <strong>${escapeHtml(sessionStatusLabel(session))}</strong>
    <span class="popover-subline">${escapeHtml(label(session.direction, "direction"))} · ${escapeHtml(formatDate(session.startedAt))} · ${escapeHtml(formatDuration(session.durationMs))}${session.uuid?.startsWith("demo-") ? " · Demo" : ""}</span>
    <div class="session-detail-grid">
      <span>Von</span><b>${escapeHtml(from)}</b>
      <span>Zu</span><b>${escapeHtml(to)}</b>
      <span>Call-ID</span><b>${escapeHtml(session.uuid || "-")}</b>
    </div>
    <ol class="session-event-list">
      ${session.events.map((item) => `
        <li>
          <time>${escapeHtml(formatTime(item.receivedAt || item.updated))}</time>
          <strong>${escapeHtml(label(item.state, "call"))}</strong>
          <small>${escapeHtml(rawLabel(item.caller))} -> ${escapeHtml(rawLabel(item.callee))}</small>
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
  els.popover.classList.remove("session-popover");
  els.popover.hidden = true;
}

function miniLineChart(item) {
  const hourly = item.hourly || {};
  const activeHours = Object.entries(hourly)
    .filter(([, value]) => value > 0)
    .map(([hour]) => Number(hour));
  const endHour = Math.min(23, Math.max(new Date().getHours(), ...activeHours, 17));
  const startHour = Math.max(0, endHour - 11);
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
      <span><i class="legend-dot green"></i>Angenommen</span>
      <span><i class="legend-dot coral"></i>Verpasst</span>
      <span><i class="legend-dot blue"></i>Ausgehend</span>
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
  const popupVersion = ++state.popupVersion;
  const phone = externalPartyPhone(call);
  const key = `${call.uuid || ""}:${call.state || ""}:${phone || ""}:${call.extension || ""}`;
  if (state.lastPopupKey === key) return;
  state.lastPopupKey = key;

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
  state.popupMinimized = false;
  const extension = rawLabel(call.extension);
  const agentName = extensionName(extension);
  const contactPhone = phone || externalPartyPhone(call);
  const callerName = contact?.name || formatPhone(contactPhone);
  const organization = contact?.organization || "Kontakt aus Google / CRM Lookup";
  const photo = contact?.id ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">` : initialsAvatar(callerName);
  const contactPerson = `
    <div class="call-person">
      <div class="call-avatar">${photo}</div>
      <strong>${escapeHtml(callerName)}</strong>
      <span>${escapeHtml(formatPhone(contactPhone))}</span>
      <small>${escapeHtml(organization)}</small>
    </div>
  `;
  const agentPerson = `
    <div class="call-person">
      <div class="call-avatar agent-avatar">${initials(agentName)}</div>
      <strong>${escapeHtml(agentName)}</strong>
      <span>Nebenstelle ${escapeHtml(extension)}</span>
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
      <button class="call-popup-minimize" type="button" data-popup-minimize aria-label="Popup minimieren">-</button>
      <button class="call-popup-close" type="button" aria-label="Schliessen">&times;</button>
    </div>
    <div class="call-popup-kicker">${escapeHtml(label(call.state, "call"))}</div>
    <strong class="call-popup-summary">${escapeHtml(summary)}</strong>
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
    button.setAttribute("aria-label", state.popupMinimized ? "Popup vergrössern" : "Popup minimieren");
  }
}

function hideCallPopup() {
  if (!els.callPopup) return;
  state.popupMinimized = false;
  els.callPopup.classList.remove("is-minimized");
  els.callPopup.hidden = true;
}

function hideCallPopupSoon(uuid) {
  if (!els.callPopup) return;
  setTimeout(() => {
    if (!uuid || state.lastPopupKey.includes(uuid)) hideCallPopup();
  }, 2400);
}

function initialsAvatar(name) {
  return `<span>${escapeHtml(initials(name))}</span>`;
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
  const result = await api(`/api/contacts/lookup?phone=${encodeURIComponent(phone || "")}`);
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
  const avatar = contact.id
    ? `<img src="/api/contacts/photo/${encodeURIComponent(contact.id)}" alt="">`
    : initialsAvatar(contact.name);
  return `
    <div class="history-contact">
      <div class="history-avatar">${avatar}</div>
      <div>
        <strong>${escapeHtml(contact.name)}</strong>
        <span>${escapeHtml(contact.organization || formatPhone(phone))}</span>
      </div>
    </div>
  `;
}

function normalizeLocalPhone(value) {
  let digits = String(value || "").replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  return digits;
}

function minutesSince(value) {
  if (!value) return "gerade eben";
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "unter 1 Minute";
  if (minutes === 1) return "1 Minute";
  return `${minutes} Minuten`;
}

function formatPhone(value) {
  const raw = rawLabel(value);
  if (!/^\d+$/.test(raw)) return raw;
  if (raw.startsWith("49") && raw.length > 4) return `+${raw}`;
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
    const cp1y = current.y + (next.y - previous.y) * tension;
    const cp2x = next.x - (afterNext.x - current.x) * tension;
    const cp2y = next.y - (afterNext.y - current.y) * tension;
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
  if (!ms) return compact ? "0 Min" : "00:00";
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (compact) {
    if (minutes >= 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest ? `${hours}h ${rest}m` : `${hours}h`;
    }
    return seconds && minutes < 10 ? `${minutes}:${String(seconds).padStart(2, "0")} Min` : `${minutes} Min`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function setBackupMessage(message, isError = false) {
  if (!els.backupMessage) return;
  els.backupMessage.textContent = message;
  els.backupMessage.className = `backup-message form-message${isError ? " error" : " success"}`;
}

function renderAuthLoginPanel() {
  if (!els.authLoginPanel) return;
  const status = state.status || {};
  const mode = state.authLoginMode === "browser" ? "browser" : "env";
  const envActive = mode === "env";
  const browserActive = mode === "browser";
  const loginConfigured = Boolean(status.credentialsConfigured);
  const envExample = [
    "NFON_K_ACCOUNT=<K_ACCOUNT>",
    "NFON_API_USERNAME=<API_USERNAME>",
    "NFON_API_PASSWORD=<API_PASSWORD>",
  ].join("\n");
  els.authLoginPanel.innerHTML = `
    <div class="panel-header auth-login-head">
      <div>
        <h2>Anmeldung</h2>
        <p>CTI-Zugang per lokaler Datei oder Browser-Formular setzen.</p>
      </div>
      <span class="auth-login-state ${loginConfigured ? "is-configured" : "is-required"}">${loginConfigured ? "Zugang konfiguriert" : "Login erforderlich"}</span>
    </div>
    <div class="auth-login-body">
      <div class="auth-mode-switch" role="tablist" aria-label="Anmeldeart">
        <button class="${envActive ? "is-active" : ""}" type="button" data-auth-mode="env">Login via .env</button>
        <button class="${browserActive ? "is-active" : ""}" type="button" data-auth-mode="browser">Login via Browser</button>
      </div>
      ${envActive ? `
        <section class="auth-login-card is-active">
          <span>Lokale Konfiguration</span>
          <h3>CTI Secret-Datei aktiv</h3>
          <p>Lege im Ordner <strong>CTI_API</strong> eine Datei <strong>.env</strong> an. Der Server liest sie beim Start automatisch.</p>
          <pre>${escapeHtml(envExample)}</pre>
          <p>Alternatively, <strong>NFON_SECRET_FILE</strong> can point to a local secret file. Google is only required for the contacts module.</p>
        </section>
      ` : `
        <form class="auth-login-card browser-login-form" id="cti-browser-login-form">
          <span>Browser-Konfiguration</span>
          <h3>Daten für diese Sitzung setzen</h3>
          <div class="auth-form-grid">
            <label>K-Account<input name="kAccount" type="text" required autocomplete="username"></label>
            <label>API Username<input name="username" type="text" required autocomplete="username"></label>
            <label>API Password<input name="password" type="password" required autocomplete="current-password"></label>
          </div>
          <div class="auth-form-actions">
            <button class="primary-button" type="submit">Zugang setzen</button>
            <span>Secrets bleiben lokal im laufenden Serverprozess.</span>
          </div>
        </form>
      `}
      ${state.authLoginMessage ? `<p class="form-message success">${escapeHtml(state.authLoginMessage)}</p>` : ""}
      ${state.authLoginError ? `<p class="form-message error">${escapeHtml(state.authLoginError)}</p>` : ""}
    </div>
  `;
}

async function submitCtiBrowserLogin(form) {
  state.authLoginMessage = "Zugang wird gesetzt";
  state.authLoginError = "";
  renderAuthLoginPanel();
  const data = new FormData(form);
  try {
    const result = await api("/api/settings/browser-login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data.entries())),
    });
    state.status = result.status;
    state.google = result.status?.google || state.google;
    state.authLoginMessage = "Browser-Zugang wurde für diese Sitzung gesetzt.";
    await refreshAll();
  } catch (error) {
    state.authLoginMessage = "";
    state.authLoginError = error.message;
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
    reader.onerror = () => reject(new Error("Bild konnte nicht gelesen werden"));
    reader.readAsDataURL(file);
  });
}

async function submitLocalContact(form) {
  state.contactMessage = "Kontakt wird angelegt";
  state.contactError = "";
  renderContactsPage();
  const data = new FormData(form);
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
    state.contactMessage = "Lokaler Kontakt angelegt.";
    state.contactError = "";
    localStorage.setItem("cti-contacts-mode", state.contactsMode);
    renderContactsPage();
  } catch (error) {
    state.contactMessage = "";
    state.contactError = error.message;
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
  if (!fileMode) return false;
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
  addEvent("Server fehlt", `Bitte lokalen CTI-Server starten und danach ${serverOrigin} oeffnen`, {
    tech: "node src/server.js",
  });
  render();
  return true;
}

async function startApp() {
  if (await redirectFileModeToServer()) return;
  connectEvents();
  refreshAll();
  refreshContactsPage();
  refreshStoragePage();
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && els.dialForm && !els.dialForm.hidden) {
    hideDialPanel();
  }
});

startApp();
