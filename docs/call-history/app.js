const ANALYTICS_SERIES = ["transcripts", "answered", "missed", "outbound"];
const DEFAULT_FILTERS = {
  range: "7d",
  direction: "all",
  outcome: "all",
  party: "",
  transcript: "all",
  queue: "",
};

const state = {
  status: null,
  rawCalls: [],
  calls: [],
  source: "",
  reason: "",
  selectedCallId: "",
  selectedTranscriptCallId: "",
  crmAccountFilterKey: "",
  transcript: null,
  transcriptCache: new Map(),
  assignmentPreview: null,
  view: localStorage.getItem("callhistory-view") || "history",
  crmModalCallId: "",
  customerRecordsOpen: false,
  customerRecordImagePreview: "",
  analyticsSeries: readJsonStorage("callhistory-analytics-series", ANALYTICS_SERIES),
  demoMode: true,
  filters: { ...DEFAULT_FILTERS, ...readJsonStorage("callhistory-filters", DEFAULT_FILTERS) },
  customerEdits: readJsonStorage("callhistory-crm-customers", {}),
  customerRecords: readJsonStorage("callhistory-customer-records", []),
  authLoginMode: localStorage.getItem("callhistory-auth-login-mode") || "",
  authLoginMessage: "",
  authLoginError: "",
  csrfToken: "",
  loading: true,
  error: "",
};

const BILLING_RATE_EUR = 2.4;
const TRANSCRIPT_ADMIN_MINUTES = 5;
const MAX_CUSTOMER_IMAGE_BYTES = 1_200_000;
const HISTORY_RENDER_LIMIT = 80;
const CRM_RENDER_LIMIT = 80;
const TRANSCRIPT_RENDER_LIMIT = 60;

const $ = (selector) => document.querySelector(selector);

const els = {
  account: $("#account-label"),
  connection: $("#connection-state"),
  authLogin: $("#auth-login"),
  authLogout: $("#auth-logout"),
  refresh: $("#refresh-button"),
  demoToggle: $("#demo-toggle"),
  metrics: $("#metrics"),
  analyticsPanel: $("#analytics-panel"),
  statusNote: $("#status-note"),
  filterPanel: $(".filter-panel"),
  rangeFilter: $("#range-filter"),
  directionFilter: $("#direction-filter"),
  outcomeFilter: $("#outcome-filter"),
  transcriptFilter: $("#transcript-filter"),
  partyFilter: $("#party-filter"),
  queueFilter: $("#queue-filter"),
  filterFields: document.querySelectorAll("[data-filter-field]"),
  historySubtitle: $("#history-subtitle"),
  callsBody: $("#calls-body"),
  detailSubtitle: $("#detail-subtitle"),
  callDetail: $("#call-detail"),
  crmSummary: $("#crm-summary"),
  crmTicketList: $("#crm-ticket-list"),
  crmAccountDetail: $("#crm-account-detail"),
  customerRecordModal: $("#customer-record-modal"),
  transcriptGrid: $("#transcript-grid"),
  setupStatus: $("#setup-status"),
  redirectStatus: $("#redirect-status"),
  authLoginPanel: $("#auth-login-panel"),
};

function readJsonStorage(key, fallback) {
  try {
    const value = localStorage.getItem(key);
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

function persistCustomerEdits() {
  localStorage.setItem("callhistory-crm-customers", JSON.stringify(state.customerEdits));
}

function persistCustomerRecords() {
  localStorage.setItem("callhistory-customer-records", JSON.stringify(customerRecords()));
}

async function apiJson(path, options = {}) {
  if (isUnsafeRequest(options)) await ensureCsrfToken();
  const response = await fetch(path, {
    ...options,
    headers: {
      "Accept": "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(isUnsafeRequest(options) ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  rememberCsrfToken(body);
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  return body;
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
  const response = await fetch("/api/status", {
    headers: { "Accept": "application/json" },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
  rememberCsrfToken(body);
}

function queryForCalls() {
  const outcome = state.view === "crm" ? state.filters.outcome : "all";
  const params = new URLSearchParams({
    mode: state.demoMode ? "demo" : "live",
    range: state.filters.range,
    direction: state.filters.direction,
    outcome,
  });
  if (state.filters.party) params.set("party", state.filters.party);
  return params.toString();
}

function applyLocalFilters(calls) {
  if (state.view !== "history") return calls;

  const transcriptFilter = state.filters.transcript || "all";
  const queueFilter = normalizeLookup(state.filters.queue);

  return calls.filter((call) => {
    if (transcriptFilter === "with" && !call.transcriptId) return false;
    if (transcriptFilter === "without" && call.transcriptId) return false;
    if (queueFilter && !normalizeLookup(internalAssignment(call).queue).includes(queueFilter)) return false;
    return true;
  });
}

async function loadStatus() {
  state.status = await apiJson("/api/status");
  rememberCsrfToken(state.status);
}

function requestedCallSource() {
  return state.demoMode ? "demo" : "callhistory-live";
}

function clearCallData(source = requestedCallSource()) {
  state.rawCalls = [];
  state.calls = [];
  state.source = source;
  state.reason = "";
  state.selectedCallId = "";
  state.selectedTranscriptCallId = "";
  state.crmModalCallId = "";
  state.transcript = null;
  state.assignmentPreview = null;
}

async function loadCalls() {
  state.loading = true;
  state.error = "";
  if (state.source && state.source !== requestedCallSource()) {
    clearCallData();
  }
  render();
  try {
    const payload = await apiJson(`/api/calls?${queryForCalls()}`);
    state.rawCalls = payload.calls || [];
    state.calls = applyLocalFilters(state.rawCalls);
    state.source = payload.source || "";
    state.reason = payload.reason || "";
    if (!state.calls.some((call) => call.id === state.selectedCallId)) {
      state.selectedCallId = state.calls[0]?.id || "";
    }
    if (!state.calls.some((call) => call.id === state.selectedTranscriptCallId && call.transcriptId)) {
      state.selectedTranscriptCallId = "";
    }
    state.assignmentPreview = null;
    state.loading = false;
    render();
    await loadSelectedTranscript();
  } catch (error) {
    clearCallData();
    state.error = error.message;
    state.loading = false;
    render();
  }
}

async function loadAll() {
  try {
    await loadStatus();
  } catch (error) {
    state.error = error.message;
  }
  await loadCalls();
}

function selectedCall() {
  return state.calls.find((call) => call.id === state.selectedCallId) || null;
}

async function loadSelectedTranscript() {
  const call = selectedCall();
  state.transcript = null;
  if (!call?.transcriptId) {
    renderSelectedCallContent();
    return;
  }
  const cacheKey = transcriptCacheKey(call.transcriptId);
  if (state.transcriptCache.has(cacheKey)) {
    state.transcript = state.transcriptCache.get(cacheKey);
    renderSelectedCallContent();
    return;
  }
  try {
    const transcript = await apiJson(`/api/transcripts/${encodeURIComponent(call.transcriptId)}?mode=${state.demoMode ? "demo" : "live"}`);
    state.transcriptCache.set(cacheKey, transcript);
    state.transcript = transcript;
  } catch (error) {
    state.transcript = { ok: false, error: error.message };
  }
  renderSelectedCallContent();
}

function formatDateTime(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds, compact = false) {
  const total = Number(seconds || 0);
  if (!total) return compact ? "0m" : "0:00";
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (compact) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatCurrency(value) {
  return new Intl.NumberFormat("de-DE", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

function directionLabel(direction) {
  return {
    inbound: "Eingehend",
    outbound: "Ausgehend",
    unknown: "Unbekannt",
  }[direction] || direction;
}

function outcomeLabel(outcome) {
  return {
    answered: "Angenommen",
    missed: "Verpasst",
    cancelled: "Abgebrochen",
    busy: "Besetzt",
    failed: "Fehler",
    unknown: "Unbekannt",
  }[outcome] || outcome;
}

function directionBadge(call) {
  const direction = call.direction || "unknown";
  const symbol = direction === "inbound" ? "↙" : direction === "outbound" ? "↗" : "?";
  const label = directionLabel(direction);
  return `<span class="direction-chip ${escapeAttr(direction)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${escapeHtml(symbol)}</span>`;
}

function outcomeBadge(call) {
  const outcome = call.outcome || "unknown";
  return `<span class="status-chip call-status ${escapeAttr(outcome)}">${escapeHtml(outcomeLabel(outcome))}</span>`;
}

function transcriptCacheKey(transcriptId) {
  return `${state.demoMode ? "demo" : "live"}:${transcriptId}`;
}

function cachedTranscriptForCall(call) {
  if (!call?.transcriptId) return null;
  return state.transcriptCache.get(transcriptCacheKey(call.transcriptId)) || null;
}

function callTranscriptSummary(call) {
  const transcript = cachedTranscriptForCall(call);
  return cleanSummaryText(transcript?.summary || call?.summary || "Summary noch nicht geladen.");
}

function callTranscriptText(call) {
  const transcript = cachedTranscriptForCall(call);
  return transcript?.text || "";
}

function cleanSummaryText(value) {
  return String(value || "")
    .replace(/^#+\s*/g, "")
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/^Zusammenfassung\s*[-:]\s*/i, "")
    .trim();
}

function aiTranscriptBadge(call, modifier = "", showEmpty = true, forcePopover = false) {
  if (!call?.transcriptId) return showEmpty ? `<span class="transcript-empty">Keins</span>` : "";
  const hasPopover = forcePopover || !modifier.split(/\s+/).includes("is-corner");
  const summary = callTranscriptSummary(call);
  const className = `ai-transcript-badge${modifier ? ` ${modifier}` : ""}`;
  return `
    <span class="${className}" ${hasPopover ? `tabindex="0"` : ""} aria-label="Transcript verfügbar"${hasPopover ? "" : ` title="Transcript verfügbar"`}>
      <svg class="transcript-badge-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="4" y="3.5" width="12.5" height="17" rx="2.2" fill="#00d981"></rect>
        <rect x="6.6" y="7" width="7.3" height="1.6" rx="0.8" fill="#ffffff"></rect>
        <rect x="6.6" y="10" width="7.3" height="1.6" rx="0.8" fill="#ffffff"></rect>
        <rect x="6.6" y="13" width="5" height="1.6" rx="0.8" fill="#ffffff"></rect>
        <path d="M18.7 11l0.85 2.2 2.2 0.85-2.2 0.85-0.85 2.2-0.85-2.2-2.2-0.85 2.2-0.85z" fill="#202426"></path>
      </svg>
      ${hasPopover ? `<span class="transcript-summary-popover" role="tooltip">
        <strong>Transcript-Zusammenfassung</strong>
        <span>${escapeHtml(summary)}</span>
        <small>${escapeHtml(call.transcriptId)}</small>
      </span>` : ""}
    </span>
  `;
}

function transcriptCopyText(call) {
  return [
    `Transcript: ${call.transcriptId || "-"}`,
    `Call: ${formatDateTime(call.startedAt)}`,
    "",
    "Zusammenfassung",
    callTranscriptSummary(call),
    "",
    "Transkript",
    callTranscriptText(call) || "Transcript-Text noch nicht geladen.",
  ].join("\n");
}

function copyPayload(call, kind) {
  if (kind === "summary") return callTranscriptSummary(call);
  if (kind === "transcript") return callTranscriptText(call) || "Transcript-Text noch nicht geladen.";
  return transcriptCopyText(call);
}

function normalizeLookup(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9+]/g, "");
}

function customerParty(call) {
  return call.direction === "outbound" ? call.to || {} : call.from || {};
}

function internalParty(call) {
  return call.direction === "outbound" ? call.from || {} : call.to || {};
}

function isGenericPartyName(value) {
  return ["anrufer", "ziel", "unbekannt", "unknown"].includes(String(value || "").trim().toLowerCase());
}

function crmCustomer(call) {
  const party = customerParty(call);
  const contact = call.contact || {};
  const context = party.context && party.context !== "global" ? party.context : "";
  const fallbackName = party.name || party.number || "Unbekannter Kontakt";
  const hasKnownIdentity = Boolean(contact.company || contact.name || contact.email || (party.name && !isGenericPartyName(party.name)));
  const base = {
    key: normalizeLookup(contact.email || party.number || party.name || call.id),
    name: contact.name || fallbackName,
    company: contact.company || (context ? `Konto ${context}` : hasKnownIdentity ? "Direktkunde" : "Neukunde"),
    number: party.number || "",
    email: contact.email || party.email || "",
    context,
    rate: BILLING_RATE_EUR,
    imageData: "",
    visualColor: "#f0f4f3",
  };
  const edit = state.customerEdits[base.key] || {};
  const rate = Number(edit.rate ?? base.rate);
  return {
    ...base,
    ...edit,
    key: base.key,
    name: edit.name || base.name,
    company: edit.company || base.company,
    number: edit.number || base.number,
    email: edit.email || base.email,
    rate: Number.isFinite(rate) ? rate : BILLING_RATE_EUR,
    imageData: edit.imageData || "",
    visualColor: edit.visualColor || base.visualColor,
  };
}

function crmTicketStatus(call) {
  if (call.outcome === "answered") return "billable";
  if (call.direction === "inbound") return "callback";
  return "review";
}

function crmTicketStatusLabel(status) {
  return {
    billable: "Abrechenbar",
    callback: "Rückruf",
    review: "Prüfen",
  }[status] || "Prüfen";
}

function billableMinutes(call) {
  if (call.outcome !== "answered") return 0;
  return Math.max(1, Math.ceil(Number(call.durationSeconds || 0) / 60));
}

function crmSummaryText(call, customer = crmCustomer(call)) {
  const transcriptSummary = callTranscriptSummary(call);
  if (transcriptSummary && transcriptSummary !== "Summary noch nicht geladen.") return transcriptSummary;
  const direction = directionLabel(call.direction);
  const outcome = outcomeLabel(call.outcome).toLowerCase();
  const duration = Number(call.durationSeconds || 0)
    ? `Dauer ${formatDuration(call.durationSeconds, true)}`
    : "keine abrechenbare Gesprächsdauer";
  const owner = call.user?.name || internalParty(call).name || "Team";
  return `${direction}-Call mit ${customer.name || "Kontakt"} wurde als ${outcome} erkannt. ${duration}; Zuordnung zu ${owner} und Abrechnungsvorschlag automatisch vorbereitet.`;
}

function crmTicketTitle(call, customer) {
  if (call.ticket?.title) return call.ticket.title;
  if (call.outcome === "answered") return `Supportzeit ${customer.name || "Kunde"}`;
  if (call.direction === "inbound") return `Rückruf ${customer.name || "Kunde"}`;
  return `Call Review ${customer.name || "Kunde"}`;
}

function ticketDisplayId(value) {
  return String(value || "").replace(/^SUP-/i, "Ticket-");
}

function ticketSequenceMap() {
  return new Map([...state.calls]
    .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt) || String(a.id).localeCompare(String(b.id)))
    .map((call, index) => [call.id, index + 1]));
}

function buildCrmTickets() {
  const sequence = ticketSequenceMap();
  return state.calls.map((call) => {
    const customer = crmCustomer(call);
    const owner = call.user?.name || internalParty(call).name || "Unassigned";
    const minutes = billableMinutes(call);
    const status = crmTicketStatus(call);
    const ticketId = ticketDisplayId(call.ticket?.id || `Ticket-${String(sequence.get(call.id) || 0).padStart(5, "0")}`);
    return {
      call,
      id: ticketId,
      title: crmTicketTitle(call, customer),
      customer,
      owner,
      minutes,
      amount: minutes * customer.rate,
      status,
      summary: crmSummaryText(call, customer),
      automated: call.direction === "inbound" ? "Auto-Ticket aus eingehendem Call" : "Servicezeit aus Call History",
    };
  });
}

function crmTicketForCall(call) {
  if (!call) return null;
  return buildCrmTickets().find((ticket) => ticket.call.id === call.id) || null;
}

function crmAccounts(tickets = buildCrmTickets()) {
  const accounts = new Map();
  tickets.forEach((ticket) => {
    const key = ticket.customer.key || ticket.id;
    const current = accounts.get(key) || {
      ...ticket.customer,
      calls: 0,
      tickets: 0,
      billableMinutes: 0,
      amount: 0,
      open: 0,
      lastCall: ticket.call.startedAt,
    };
    current.calls += 1;
    current.tickets += 1;
    current.billableMinutes += ticket.minutes;
    current.amount += ticket.amount;
    if (ticket.status !== "billable") current.open += 1;
    if (new Date(ticket.call.startedAt) > new Date(current.lastCall)) current.lastCall = ticket.call.startedAt;
    accounts.set(key, current);
  });
  return [...accounts.values()].sort((a, b) => b.amount - a.amount || b.calls - a.calls);
}

function customerRecords() {
  if (!Array.isArray(state.customerRecords)) return [];
  return state.customerRecords
    .filter((record) => record && typeof record === "object")
    .map((record) => ({
      id: String(record.id || ""),
      company: String(record.company || "").trim(),
      name: String(record.name || "").trim(),
      email: String(record.email || "").trim(),
      number: String(record.number || "").trim(),
      rate: Number(record.rate || 0),
      note: String(record.note || "").trim(),
      imageData: String(record.imageData || ""),
      createdAt: String(record.createdAt || ""),
    }))
    .filter((record) => record.id && (record.company || record.name || record.email || record.number));
}

function createCustomerRecordId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `customer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function customerInitials(customer) {
  const source = customer.company || customer.name || customer.number || "K";
  return source
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function customerVisual(customer, sizeClass = "") {
  const classes = ["customer-visual", sizeClass].filter(Boolean).join(" ");
  if (customer.imageData) {
    return `<span class="${escapeAttr(classes)}"><img src="${escapeAttr(customer.imageData)}" alt=""></span>`;
  }
  return `<span class="${escapeAttr(classes)}" style="background:${escapeAttr(customer.visualColor || "#f0f4f3")}">${escapeHtml(customerInitials(customer))}</span>`;
}

function customerEditValue(customer, field) {
  const edit = state.customerEdits[customer.key] || {};
  return edit[field] ?? customer[field] ?? "";
}

function sourceLabel() {
  if (state.source === "callhistory-live") return "Live-Daten";
  if (state.source === "demo-fallback") return "Demo-Fallback";
  return "Demo-Daten";
}

function callMetrics() {
  const total = state.calls.length;
  const missed = state.calls.filter((call) => call.outcome === "missed").length;
  const answered = state.calls.filter((call) => call.outcome === "answered").length;
  const duration = state.calls.reduce((sum, call) => sum + Number(call.durationSeconds || 0), 0);
  const transcripts = state.calls.filter((call) => call.transcriptId).length;
  const crmTickets = buildCrmTickets();
  const autoCustomerRecords = crmAccounts(crmTickets).length;
  const manualCustomerRecords = customerRecords().length;
  const billableMinutesTotal = crmTickets.reduce((sum, ticket) => sum + ticket.minutes, 0);
  const billableAmount = crmTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  return {
    total,
    missed,
    answered,
    average: answered ? Math.round(duration / answered) : 0,
    transcripts,
    tickets: crmTickets.length,
    customerRecords: autoCustomerRecords + manualCustomerRecords,
    autoCustomerRecords,
    manualCustomerRecords,
    billableMinutesTotal,
    billableAmount,
  };
}

function localDateKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shortDateLabel(value) {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
  }).format(value);
}

function analyticsDays() {
  const latest = state.calls.reduce((max, call) => {
    const date = new Date(call.startedAt);
    return Number.isNaN(date.getTime()) || date <= max ? max : date;
  }, new Date());
  const end = new Date(latest.getFullYear(), latest.getMonth(), latest.getDate());
  const days = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(end);
    date.setDate(end.getDate() - offset);
    days.push({
      key: localDateKey(date),
      label: shortDateLabel(date),
      total: 0,
      answered: 0,
      missed: 0,
      outbound: 0,
      transcripts: 0,
      amount: 0,
    });
  }
  const byDay = new Map(days.map((day) => [day.key, day]));
  buildCrmTickets().forEach((ticket) => {
    const day = byDay.get(localDateKey(ticket.call.startedAt));
    if (!day) return;
    day.total += 1;
    if (ticket.call.outcome === "answered") day.answered += 1;
    if (["missed", "cancelled", "failed"].includes(ticket.call.outcome)) day.missed += 1;
    if (ticket.call.direction === "outbound") day.outbound += 1;
    if (ticket.call.transcriptId) day.transcripts += 1;
    day.amount += ticket.amount;
  });
  return days;
}

function linePoints(days, key, max, width = 520, height = 134) {
  const left = 18;
  const right = width - 12;
  const top = 16;
  const bottom = height - 28;
  const step = days.length > 1 ? (right - left) / (days.length - 1) : 0;
  return days.map((day, index) => {
    const value = Number(day[key] || 0);
    return {
      x: Math.round(left + step * index),
      y: Math.round(bottom - (value / max) * (bottom - top)),
      value,
    };
  });
}

function pointsAttr(points) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

function smoothLinePath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M${points[0].x} ${points[0].y}`;
  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const midX = (previous.x + point.x) / 2;
    return `${path} C ${midX} ${previous.y}, ${midX} ${point.y}, ${point.x} ${point.y}`;
  }, `M${points[0].x} ${points[0].y}`);
}

function areaLinePath(points, baseline = 106) {
  if (!points.length) return "";
  const first = points[0];
  const last = points[points.length - 1];
  return `${smoothLinePath(points)} L ${last.x} ${baseline} L ${first.x} ${baseline} Z`;
}

function render() {
  renderControls();
  renderHeader();
  renderMetrics();
  renderAnalytics();
  renderStatusNote();
  renderActiveViewContent();
  renderCustomerRecordsModal();
  renderView();
}

function renderActiveViewContent() {
  clearInactiveViewContent();
  if (state.view === "crm") {
    renderCrm();
  } else if (state.view === "transcripts") {
    renderTranscripts();
  } else if (state.view === "setup") {
    renderSetup();
    renderAuthLoginPanel();
  } else {
    renderCalls();
    renderDetail();
  }
}

function renderSelectedCallContent() {
  if (state.view === "crm") {
    renderCrm();
  } else if (state.view === "transcripts") {
    renderTranscripts();
  } else if (state.view === "history") {
    renderDetail();
  }
}

function clearInactiveViewContent() {
  if (state.view !== "history") {
    els.callsBody.innerHTML = "";
    els.callDetail.innerHTML = "";
  }
  if (state.view !== "crm") {
    els.crmSummary.innerHTML = "";
    els.crmTicketList.innerHTML = "";
    els.crmAccountDetail.innerHTML = "";
  }
  if (state.view !== "transcripts") {
    els.transcriptGrid.innerHTML = "";
  }
  if (state.view !== "setup") {
    if (els.setupStatus) els.setupStatus.innerHTML = "";
    if (els.redirectStatus) els.redirectStatus.innerHTML = "";
    if (els.authLoginPanel) els.authLoginPanel.innerHTML = "";
  }
}

function renderControls() {
  if (els.demoToggle) els.demoToggle.checked = state.demoMode;
  els.rangeFilter.value = state.filters.range;
  els.directionFilter.value = state.filters.direction;
  els.outcomeFilter.value = state.filters.outcome;
  els.transcriptFilter.value = state.filters.transcript || "all";
  els.partyFilter.value = state.filters.party;
  els.queueFilter.value = state.filters.queue || "";
  renderFilterContext();
}

function renderFilterContext() {
  if (!els.filterPanel) return;
  els.filterPanel.dataset.filterView = state.view;
  const visibleFieldsByView = {
    history: new Set(["range", "direction", "transcript", "party", "queue"]),
    transcripts: new Set(["range", "direction", "party"]),
    crm: new Set(["range", "direction", "outcome", "party"]),
    setup: new Set(),
  };
  const visibleFields = visibleFieldsByView[state.view] || visibleFieldsByView.history;
  els.filterFields.forEach((field) => {
    field.hidden = !visibleFields.has(field.dataset.filterField);
  });

  const partyLabel = els.filterPanel.querySelector('[data-filter-field="party"] .filter-label-text');
  const isNumberSearch = state.view === "history" || state.view === "transcripts";
  if (partyLabel) partyLabel.textContent = isNumberSearch ? "Rufnummer" : "Teilnehmer";
  els.partyFilter.placeholder = isNumberSearch ? "Rufnummer suchen" : "Name, Nummer, Ticket";
  els.queueFilter.placeholder = "Queue suchen";
}

function renderHeader() {
  const status = state.status;
  els.account.textContent = status
    ? `${status.account || "NFON User"} · ${sourceLabel()}`
    : "Call History wird geprüft";

  const authLogin = $("#auth-login");
  const authLogout = $("#auth-logout");
  if (authLogin) {
    authLogin.hidden = !status?.oauthConfigured || status?.authenticated;
    authLogin.classList.toggle("is-primary", Boolean(status?.oauthConfigured && !status?.authenticated));
  }
  if (authLogout) {
    authLogout.hidden = !status?.authenticated;
  }

  els.connection.className = "connection";
  els.connection.removeAttribute("title");
  if (state.error) {
    els.connection.textContent = "Fehler";
    els.connection.classList.add("is-error");
    els.connection.title = state.error;
  } else if (state.loading) {
    els.connection.textContent = "Prüft";
  } else if (state.source === "callhistory-live") {
    els.connection.textContent = "Bereit";
    els.connection.classList.add("is-online");
  } else if (state.source === "demo-fallback" || !status?.configured) {
    els.connection.textContent = "Setup";
    els.connection.classList.add("is-warning");
    els.connection.title = state.reason || "Call History API ist noch nicht vollständig konfiguriert.";
  } else {
    els.connection.textContent = "Demo";
    els.connection.classList.add("is-warning");
  }
}

function renderMetrics() {
  if (state.view === "setup") {
    els.metrics.hidden = true;
    els.metrics.innerHTML = "";
    return;
  }

  els.metrics.hidden = false;
  const metrics = callMetrics();
  const customerRecordDetail = `${metrics.autoCustomerRecords} autom. · ${metrics.manualCustomerRecords} manuell`;
  const items = [
    ["Calls", metrics.total, `${metrics.answered} angenommen`],
    ["Tickets", metrics.tickets, `${formatCurrency(metrics.billableAmount)} abrechenbar`],
    ["Kundensätze", metrics.customerRecords, customerRecordDetail, "customer-records"],
    ["Ø Dauer", formatDuration(metrics.average, true), `${metrics.answered} angenommene Calls`],
    ["Transcripts", metrics.transcripts, `${metrics.missed} verpasst`],
  ];
  if (state.view === "crm") {
    items.splice(2, 0, ["Abrechenbar", formatCurrency(metrics.billableAmount), `${metrics.billableMinutesTotal} Minuten`]);
  }
  els.metrics.innerHTML = items.map(([label, value, detail, action]) => {
    const tag = action ? "button" : "div";
    const actionAttrs = action ? ` type="button" data-metric-action="${escapeAttr(action)}" aria-label="${escapeAttr(`${label}: ${value}. Kundensatz anlegen`)}"` : "";
    return `
    <${tag} class="metric ${action ? "metric-button" : ""}"${actionAttrs}>
      <span class="metric-label">${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <span class="metric-detail">${escapeHtml(detail)}</span>
    </${tag}>
  `;
  }).join("");
}

function renderAnalytics() {
  if (!els.analyticsPanel) return;
  if (state.view !== "crm" || state.loading || !state.calls.length) {
    els.analyticsPanel.hidden = true;
    els.analyticsPanel.innerHTML = "";
    return;
  }

  const metrics = callMetrics();
  const days = analyticsDays();
  const maxCalls = Math.max(1, ...days.flatMap((day) => [day.answered, day.missed, day.outbound, day.transcripts]));
  const maxTotal = Math.max(1, ...days.map((day) => day.total));
  const answeredPoints = linePoints(days, "answered", maxCalls);
  const missedPoints = linePoints(days, "missed", maxCalls);
  const outboundPoints = linePoints(days, "outbound", maxCalls);
  const transcriptPoints = linePoints(days, "transcripts", maxCalls);
  const labelPoints = linePoints(days, "total", maxTotal);
  const automationMinutes = metrics.transcripts * TRANSCRIPT_ADMIN_MINUTES;
  const answerRate = metrics.total ? Math.round((metrics.answered / metrics.total) * 100) : 0;
  const activeSeries = Array.isArray(state.analyticsSeries)
    ? state.analyticsSeries.filter((key) => ANALYTICS_SERIES.includes(key))
    : [...ANALYTICS_SERIES];
  if (!activeSeries.length) activeSeries.push("transcripts");
  const series = [
    ["transcripts", "Transkription", transcriptPoints, "#7146f2", "purple"],
    ["answered", "Angenommen", answeredPoints, "#00d981", "green"],
    ["missed", "Nicht angenommen", missedPoints, "#f36b5b", "coral"],
    ["outbound", "Ausgehend", outboundPoints, "#3513cf", "blue"],
  ];
  const visibleSeries = series
    .filter(([key]) => activeSeries.includes(key))
    .map(([key, label, points, color, colorClass]) => ({
      key,
      label,
      points,
      color,
      colorClass,
      width: key === "transcripts" ? 4 : 3.5,
    }));

  els.analyticsPanel.hidden = false;
  els.analyticsPanel.innerHTML = `
    <div class="analytics-header">
      <div>
        <span class="panel-kicker">Auswertung</span>
      </div>
      <p>${escapeHtml(metrics.tickets)} Tickets · ${escapeHtml(formatCurrency(metrics.billableAmount))} abrechenbar · ${escapeHtml(automationMinutes)} Min. Nacharbeit vermieden</p>
    </div>
    <div class="analytics-showcase">
      <div class="analytics-chart wide-panel">
        <div class="panel-header">
          <h3>Call-Verlauf</h3>
          <span class="panel-kicker">${escapeHtml(answerRate)}% angenommen</span>
        </div>
        <div class="line-chart">
          <svg viewBox="0 0 520 134" aria-hidden="true">
            <defs>
              ${visibleSeries.map((item) => `
                <linearGradient id="callhistory-${escapeAttr(item.key)}-fill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stop-color="${escapeAttr(item.color)}" stop-opacity="0.16"></stop>
                  <stop offset="58%" stop-color="${escapeAttr(item.color)}" stop-opacity="0.07"></stop>
                  <stop offset="100%" stop-color="${escapeAttr(item.color)}" stop-opacity="0"></stop>
                </linearGradient>
              `).join("")}
            </defs>
            <path d="M18 106H508" stroke="#d8e0df"></path>
            <path d="M18 64H508" stroke="#edf1f0"></path>
            ${visibleSeries.map((item) => `
              <path d="${areaLinePath(item.points)}" fill="url(#callhistory-${escapeAttr(item.key)}-fill)"></path>
            `).join("")}
            ${visibleSeries.map((item) => `
              <path d="${smoothLinePath(item.points)}" fill="none" stroke="${escapeAttr(item.color)}" stroke-width="${item.width}" stroke-linecap="round" stroke-linejoin="round"></path>
            `).join("")}
            ${days.map((day, index) => `<text x="${labelPoints[index].x}" y="128" text-anchor="middle">${escapeHtml(day.label)}</text>`).join("")}
          </svg>
          <div class="chart-legend">
            ${series.map(([key, label, , , colorClass]) => `
              <button class="analytics-toggle ${activeSeries.includes(key) ? "is-active" : ""}" type="button" data-analytics-series="${escapeAttr(key)}" aria-pressed="${activeSeries.includes(key) ? "true" : "false"}">
                <i class="legend-dot ${escapeAttr(colorClass)}"></i>${escapeHtml(label)}
              </button>
            `).join("")}
            <button class="analytics-toggle ${activeSeries.length === ANALYTICS_SERIES.length ? "is-active" : ""}" type="button" data-analytics-series="all" aria-pressed="${activeSeries.length === ANALYTICS_SERIES.length ? "true" : "false"}">Alle</button>
          </div>
        </div>
      </div>
      <div class="analytics-chart">
        <div class="panel-header">
          <h3>Tickets</h3>
          <span class="panel-kicker">7 Tage</span>
        </div>
        <div class="daily-bars">
          ${days.map((day) => {
            const answeredHeight = Math.max(0, Math.round((day.answered / maxTotal) * 86));
            const missedHeight = Math.max(0, Math.round((day.missed / maxTotal) * 86));
            const outboundHeight = Math.max(0, Math.round((day.outbound / maxTotal) * 86));
            return `
              <div class="daily-slot" title="${escapeAttr(day.label)} · ${day.total} Tickets">
                <strong>${day.total || ""}</strong>
                <div class="daily-stack">
                  <span class="bar-segment answered" style="height:${answeredHeight}px"></span>
                  <span class="bar-segment missed" style="height:${missedHeight}px"></span>
                  <span class="bar-segment outbound" style="height:${outboundHeight}px"></span>
                </div>
                <span>${escapeHtml(day.label)}</span>
              </div>
            `;
          }).join("")}
        </div>
      </div>
      <div class="analytics-chart insight-panel">
        <div class="panel-header">
          <h3>Abrechnung</h3>
          <span class="panel-kicker">Showcase</span>
        </div>
        <div class="analytics-insights">
          <div><span>Umsatz</span><strong>${escapeHtml(formatCurrency(metrics.billableAmount))}</strong></div>
          <div><span>Minuten</span><strong>${escapeHtml(metrics.billableMinutesTotal)} abrechenbar</strong></div>
          <div><span>Nacharbeit</span><strong>${escapeHtml(automationMinutes)} Min. gespart</strong></div>
        </div>
      </div>
    </div>
  `;
}

function renderStatusNote() {
  els.statusNote.hidden = false;
  if (state.error) {
    els.statusNote.className = "status-note is-error";
    els.statusNote.innerHTML = `<strong>Fehler.</strong><span>${escapeHtml(state.error)}</span>`;
    return;
  }

  if (state.loading) {
    els.statusNote.className = "status-note";
    els.statusNote.innerHTML = "<strong>Call History wird geladen.</strong>";
    return;
  }

  if (state.source === "callhistory-live") {
    els.statusNote.hidden = true;
    els.statusNote.innerHTML = "";
    return;
  }

  els.statusNote.className = "status-note is-warning";
  const title = state.source === "demo-fallback" ? "Demo-Fallback aktiv." : "Demo-Daten aktiv.";
  const reason = state.reason || "Synthetische Call History mit Transcript- und Ticket-Beispielen.";
  els.statusNote.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(reason)}</span>`;
}

function partyCell(call) {
  const from = call.from || {};
  const to = call.to || {};
  return `
    <div class="party-stack">
      <strong>${escapeHtml(from.name || from.number || "Unbekannt")} → ${escapeHtml(to.name || to.number || "Unbekannt")}</strong>
      <span>${escapeHtml(from.number || "-")} → ${escapeHtml(to.number || "-")}</span>
    </div>
  `;
}

function internalAssignment(call) {
  const user = call?.user || {};
  return {
    queue: user.name || "Nicht erkannt",
    extension: user.number || user.email || "-",
  };
}

function transcriptListLine(call) {
  const contact = call?.contact?.name || call?.contact?.company || "";
  const route = `${call?.from?.number || "-"} → ${call?.to?.number || "-"}`;
  return contact ? `${contact} · ${route}` : route;
}

function renderLimitNote(total, visible, label) {
  if (total <= visible) return "";
  return `
    <div class="render-limit-note">
      <strong>${escapeHtml(label)}</strong>
      <span>${visible} von ${total} Einträgen</span>
    </div>
  `;
}

function renderCalls() {
  const visibleCalls = state.calls.slice(0, HISTORY_RENDER_LIMIT);
  els.historySubtitle.textContent = state.loading
    ? "Lade Calls"
    : `${state.calls.length} Calls · ${sourceLabel()} · Filter ${state.filters.range}`;

  if (!state.calls.length) {
    els.callsBody.innerHTML = `
      <div class="empty-state">Keine Calls im aktuellen Filter.</div>
    `;
    return;
  }

  els.callsBody.innerHTML = `
    ${renderLimitNote(state.calls.length, visibleCalls.length, "Listenansicht")}
    ${visibleCalls.map((call) => {
    const assignment = internalAssignment(call);
    return `
    <button class="history-row ${call.transcriptId ? "has-ai-badge" : ""} ${call.id === state.selectedCallId ? "is-selected" : ""}" type="button" data-call-id="${escapeAttr(call.id)}" role="row">
      ${aiTranscriptBadge(call, "is-corner", false, true)}
      <span class="history-cell" role="cell">
        <span class="time-cell">
          <strong>${escapeHtml(formatDateTime(call.startedAt))}</strong>
          <span>${escapeHtml(formatDuration(call.durationSeconds))}</span>
        </span>
      </span>
      <span class="history-cell" role="cell">
        <div class="call-state-cell">
          ${directionBadge(call)}
          ${outcomeBadge(call)}
        </div>
      </span>
      <span class="history-cell" role="cell">${partyCell(call)}</span>
      <span class="history-cell" role="cell">
        <div class="user-stack">
          <strong>${escapeHtml(assignment.queue)}</strong>
        </div>
      </span>
      <span class="history-cell" role="cell">
        <div class="user-stack">
          <strong>${escapeHtml(assignment.extension)}</strong>
        </div>
      </span>
    </button>
  `;
  }).join("")}
  `;
}

function renderDetail() {
  const call = selectedCall();
  if (!call) {
    els.detailSubtitle.textContent = "Kein Call ausgewählt";
    els.callDetail.innerHTML = `<div class="empty-state">Wähle einen Call aus der Rufliste.</div>`;
    return;
  }

  els.detailSubtitle.textContent = `${formatDateTime(call.startedAt)} · ${directionLabel(call.direction)} · ${outcomeLabel(call.outcome)}`;
  const transcript = state.transcript;
  const transcriptSummary = cleanSummaryText(transcript?.summary || call.summary || "");
  const transcriptText = transcript?.text || "";
  const preview = state.assignmentPreview;
  const assignee = preview?.assignee || transcript?.assignee || call.user;
  const assignment = internalAssignment({ ...call, user: assignee });
  const transcriptSection = transcriptSummary || transcriptText ? `
    <div class="detail-section">
      <h3>Summary</h3>
      ${transcriptSummary ? `<p>${escapeHtml(transcriptSummary)}</p>` : ""}
      ${transcriptText ? `<div class="transcript-text">${escapeHtml(transcriptText)}</div>` : ""}
      <div class="copy-actions">
        ${transcriptSummary ? `<button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(call.id)}" data-copy-kind="summary">Summary kopieren</button>` : ""}
        ${transcriptText ? `<button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(call.id)}" data-copy-kind="transcript">Transcript kopieren</button>` : ""}
      </div>
    </div>
  ` : "";

  els.callDetail.innerHTML = `
    <div class="call-route">
      <div class="party-card">
        <span>Von</span>
        <strong>${escapeHtml(call.from?.name || "Unbekannt")}</strong>
        <p>${escapeHtml(call.from?.number || "-")}</p>
      </div>
      <div class="route-arrow">→</div>
      <div class="party-card">
        <span>Zu</span>
        <strong>${escapeHtml(call.to?.name || "Unbekannt")}</strong>
        <p>${escapeHtml(call.to?.number || "-")}</p>
      </div>
    </div>

    ${transcriptSection}

    <div class="detail-section">
      <h3>Zuordnung</h3>
      <div class="assignment-grid">
        <div class="assignment-card">
          <span>Queue</span>
          <strong>${escapeHtml(assignment.queue || "Offen")}</strong>
          <p>interner Kontext</p>
        </div>
        <div class="assignment-card">
          <span>Nebenstelle</span>
          <strong>${escapeHtml(assignment.extension)}</strong>
          <p>User-Extension</p>
        </div>
      </div>
    </div>
  `;
}

function customerEditorMarkup(customer) {
  return `
    <details class="customer-editor">
      <summary>Kundensatz editieren</summary>
      <form id="customer-edit-form" data-customer-key="${escapeAttr(customer.key)}">
        <div class="panel-header">
          <div>
            <h3>Kundensatz editieren</h3>
            <p class="panel-subtitle">Lokale CRM-Anreicherung. API-Daten bleiben unverändert.</p>
          </div>
        </div>
        <div class="customer-form-grid">
          <label>
            Firma
            <input name="company" type="text" value="${escapeAttr(customerEditValue(customer, "company"))}">
          </label>
          <label>
            Kontakt
            <input name="name" type="text" value="${escapeAttr(customerEditValue(customer, "name"))}">
          </label>
          <label>
            E-Mail
            <input name="email" type="email" value="${escapeAttr(customerEditValue(customer, "email"))}">
          </label>
          <label>
            Rufnummer
            <input name="number" type="text" value="${escapeAttr(customerEditValue(customer, "number"))}">
          </label>
          <label>
            Satz EUR/Min.
            <input name="rate" type="number" min="0" step="0.1" value="${escapeAttr(customerEditValue(customer, "rate"))}">
          </label>
          <label>
            Fallback-Farbe
            <input name="visualColor" type="color" value="${escapeAttr(customerEditValue(customer, "visualColor") || "#f0f4f3")}">
            <span>Wird für Initialen und den Konto-Akzent genutzt, wenn kein Logo greift.</span>
          </label>
        </div>
        <label class="image-upload">
          Kundenbild / Logo
          <input id="customer-image-input" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
          <span>PNG, JPG, WebP oder GIF lokal im Browser speichern</span>
        </label>
        <div class="customer-editor-actions">
          <button class="primary-button" type="submit">Kundensatz speichern</button>
          <button class="secondary-button" id="remove-customer-image" type="button" ${customer.imageData ? "" : "disabled"}>Bild entfernen</button>
          <button class="secondary-button" id="reset-customer-record" type="button">Zurücksetzen</button>
        </div>
      </form>
    </details>
  `;
}

function renderCrm() {
  if (!els.crmSummary || !els.crmTicketList || !els.crmAccountDetail) return;

  const tickets = buildCrmTickets();
  const accounts = crmAccounts(tickets);
  const visibleTickets = state.crmAccountFilterKey
    ? tickets.filter((ticket) => ticket.customer.key === state.crmAccountFilterKey)
    : tickets;
  if (state.crmAccountFilterKey && !visibleTickets.length) {
    state.crmAccountFilterKey = "";
  }
  const listTickets = state.crmAccountFilterKey ? visibleTickets : tickets;
  const modalTicket = state.crmModalCallId
    ? tickets.find((ticket) => ticket.call.id === state.crmModalCallId) || null
    : null;
  if (state.crmModalCallId && !modalTicket) state.crmModalCallId = "";
  const selected = modalTicket
    || listTickets.find((ticket) => ticket.call.id === state.selectedCallId)
    || tickets.find((ticket) => ticket.call.id === state.selectedCallId)
    || listTickets[0]
    || tickets[0]
    || null;
  const selectedAccount = selected
    ? accounts.find((account) => account.key === selected.customer.key)
    : accounts[0] || null;
  const filterAccount = state.crmAccountFilterKey
    ? accounts.find((account) => account.key === state.crmAccountFilterKey)
    : null;

  if (state.loading) {
    els.crmSummary.innerHTML = `<div class="empty-state">CRM-Automation wird aus Call History gebaut.</div>`;
    els.crmTicketList.innerHTML = "";
    els.crmAccountDetail.innerHTML = "";
    return;
  }

  if (!tickets.length) {
    els.crmSummary.innerHTML = "";
    els.crmTicketList.innerHTML = `<div class="empty-state">Keine Calls für CRM-Tickets im aktuellen Filter.</div>`;
    els.crmAccountDetail.innerHTML = `<div class="empty-state">Keine Kundenkonten im aktuellen Filter.</div>`;
    return;
  }

  const summaryTickets = listTickets.length ? listTickets : tickets;
  const totalAmount = summaryTickets.reduce((sum, ticket) => sum + ticket.amount, 0);
  const billableMinutesTotal = summaryTickets.reduce((sum, ticket) => sum + ticket.minutes, 0);
  const inboundTickets = summaryTickets.filter((ticket) => ticket.call.direction === "inbound").length;
  const transcriptSavings = summaryTickets.filter((ticket) => ticket.call.transcriptId).length * TRANSCRIPT_ADMIN_MINUTES;

  const summaryItems = [
    ["Auto-Tickets", summaryTickets.length, `${inboundTickets} aus eingehenden Calls`],
    ["Kundenkonten", accounts.length, "automatisch gematcht"],
    ["Abrechenbar", formatCurrency(totalAmount), `${billableMinutesTotal} Minuten`],
    ["Nacharbeit gespart", `${transcriptSavings} Min.`, `${TRANSCRIPT_ADMIN_MINUTES} Min. je Transcript`],
  ];

  els.crmSummary.innerHTML = summaryItems.map(([label, value, detail]) => `
    <div class="crm-stat">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `).join("");

  const renderedTickets = summaryTickets.slice(0, CRM_RENDER_LIMIT);

  els.crmTicketList.innerHTML = `
    ${filterAccount ? `
      <button class="crm-filter-clear" id="clear-crm-filter" type="button">
        Kundenfilter: ${escapeHtml(filterAccount.company)} entfernen
      </button>
    ` : ""}
    ${renderLimitNote(summaryTickets.length, renderedTickets.length, "Ticketliste")}
    ${renderedTickets.map((ticket) => `
    <button class="crm-ticket-row ${ticket.call.id === (state.crmModalCallId || state.selectedCallId) ? "is-selected" : ""}" type="button" data-crm-open-call-id="${escapeAttr(ticket.call.id)}">
      ${aiTranscriptBadge(ticket.call, "is-corner", false)}
      <span class="crm-ticket-id">
        <strong>${escapeHtml(ticket.id)}</strong>
        <small>${escapeHtml(formatDateTime(ticket.call.startedAt))}</small>
      </span>
      <span class="crm-customer">
        ${customerVisual(ticket.customer)}
        <span>
          <strong>${escapeHtml(ticket.customer.company)}</strong>
          <small>${escapeHtml(ticket.customer.name)} · ${escapeHtml(ticket.customer.number || "keine Nummer")}</small>
        </span>
      </span>
      <span>
        <strong>${escapeHtml(ticket.owner)}</strong>
        <small>${escapeHtml(ticket.automated)}</small>
      </span>
      <span>
        <strong>${escapeHtml(formatCurrency(ticket.amount))}</strong>
        <small>${ticket.minutes ? `${ticket.minutes} Min. × ${formatCurrency(ticket.customer.rate)}` : "nicht abrechenbar"}</small>
      </span>
      <span>
        <span class="chip is-${escapeAttr(ticket.status)}">${escapeHtml(crmTicketStatusLabel(ticket.status))}</span>
      </span>
      ${ticket.call.transcriptId ? `<span class="ticket-summary-popover" role="tooltip">
        <strong>KI-Zusammenfassung</strong>
        <span>${escapeHtml(ticket.summary)}</span>
        <small>Transcript ${escapeHtml(ticket.call.transcriptId)} · Kunde, Ticket, Owner und Billing-Zeile wurden ohne manuelle Nacharbeit vorbereitet.</small>
      </span>` : ""}
    </button>
  `).join("")}`;

  if (!modalTicket || !selected || !selectedAccount) {
    els.crmAccountDetail.innerHTML = "";
    return;
  }

  const relatedTickets = tickets
    .filter((ticket) => ticket.customer.key === selected.customer.key)
    .sort((a, b) => new Date(b.call.startedAt) - new Date(a.call.startedAt));
  const previousTickets = relatedTickets.filter((ticket) => ticket.call.id !== selected.call.id);
  const selectedTranscriptText = callTranscriptText(selected.call);
  els.crmAccountDetail.innerHTML = `
    <div class="crm-modal-layer" data-crm-modal-close>
      <article class="crm-modal" role="dialog" aria-modal="true" aria-labelledby="crm-modal-title">
        <button class="modal-close-button" type="button" data-crm-modal-close aria-label="Ticket schließen">×</button>
        <div class="crm-modal-grid">
          <section class="crm-modal-main">
            <div class="account-hero" style="box-shadow: inset 4px 0 0 ${escapeAttr(selected.customer.visualColor || "#f0f4f3")}">
              ${customerVisual(selected.customer, "is-large")}
              <div>
                <span>Kunde</span>
                <strong>${escapeHtml(selectedAccount.company)}</strong>
                <p>${escapeHtml(selectedAccount.name)} · ${escapeHtml(selectedAccount.number || "keine Nummer")}</p>
              </div>
            </div>

            <div class="crm-ticket-detail">
              <div class="panel-header">
                <div>
                  <span class="panel-kicker">Aktuelles Ticket</span>
                  <h2 id="crm-modal-title">${escapeHtml(selected.id)}</h2>
                  <p class="panel-subtitle">${escapeHtml(selected.title)} · ${escapeHtml(formatDateTime(selected.call.startedAt))}</p>
                </div>
                <span class="chip is-${escapeAttr(selected.status)}">${escapeHtml(crmTicketStatusLabel(selected.status))}</span>
              </div>
              <p>${escapeHtml(selected.summary)}</p>
              ${selected.call.transcriptId ? `
                <details class="crm-transcript-block">
                  <summary>Komplette Transkription</summary>
                  <div class="transcript-text">${escapeHtml(selectedTranscriptText || "Transkript wird geladen.")}</div>
                  ${selectedTranscriptText ? `
                    <button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(selected.call.id)}" data-copy-kind="transcript">Transkript kopieren</button>
                  ` : ""}
                </details>
              ` : ""}
              <div class="crm-modal-kpis">
                <div>
                  <span>Owner</span>
                  <strong>${escapeHtml(selected.owner)}</strong>
                </div>
                <div>
                  <span>Abrechnung</span>
                  <strong>${escapeHtml(formatCurrency(selected.amount))}</strong>
                  <small>${selected.minutes ? `${selected.minutes} Min. × ${formatCurrency(selected.customer.rate)}` : "nicht abrechenbar"}</small>
                </div>
                <div>
                  <span>Call</span>
                  <strong>${escapeHtml(directionLabel(selected.call.direction))}</strong>
                  <small>${escapeHtml(outcomeLabel(selected.call.outcome))}</small>
                </div>
              </div>
            </div>

            ${customerEditorMarkup(selected.customer)}
          </section>

          <aside class="crm-modal-history">
            <div class="panel-header">
              <div>
                <span class="panel-kicker">Konto-Historie</span>
                <h3>${escapeHtml(relatedTickets.length)} Tickets</h3>
              </div>
            </div>
            <div class="account-kpis">
              <div>
                <span>Umsatz</span>
                <strong>${escapeHtml(formatCurrency(selectedAccount.amount))}</strong>
              </div>
              <div>
                <span>Letzter Call</span>
                <strong>${escapeHtml(formatDateTime(selectedAccount.lastCall))}</strong>
              </div>
            </div>
            <div class="related-ticket-list">
              ${previousTickets.length ? previousTickets.map((ticket) => `
                <button class="related-ticket-row" type="button" data-crm-modal-call-id="${escapeAttr(ticket.call.id)}">
                  <strong>${escapeHtml(ticket.id)}</strong>
                  <span>${escapeHtml(formatDateTime(ticket.call.startedAt))} · ${escapeHtml(crmTicketStatusLabel(ticket.status))}</span>
                  <small>${escapeHtml(formatCurrency(ticket.amount))} · ${ticket.minutes} Min.</small>
                </button>
              `).join("") : `<div class="empty-state">Noch keine vergangenen Tickets für dieses Konto.</div>`}
            </div>
          </aside>
        </div>
      </article>
    </div>
  `;
}

function renderTranscripts() {
  const transcriptCalls = state.calls.filter((call) => call.transcriptId);
  if (!transcriptCalls.length) {
    els.transcriptGrid.innerHTML = `<div class="empty-state">Keine Calls mit Transcript im aktuellen Filter.</div>`;
    return;
  }
  const visibleTranscriptCalls = transcriptCalls.slice(0, TRANSCRIPT_RENDER_LIMIT);
  const selectedTranscript = transcriptCalls.find((call) => call.id === state.selectedTranscriptCallId) || null;
  const selectedTicket = crmTicketForCall(selectedTranscript);
  const summary = selectedTranscript ? callTranscriptSummary(selectedTranscript) : "";
  const transcriptText = selectedTranscript ? callTranscriptText(selectedTranscript) : "";

  els.transcriptGrid.innerHTML = `
    <div class="transcript-list" aria-label="Transcripts">
      ${renderLimitNote(transcriptCalls.length, visibleTranscriptCalls.length, "Transcript-Liste")}
      ${visibleTranscriptCalls.map((call) => {
        const ticket = crmTicketForCall(call);
        return `
          <button class="transcript-list-row ${call.id === selectedTranscript?.id ? "is-selected" : ""}" type="button" data-call-id="${escapeAttr(call.id)}">
            <span>
              <strong>${escapeHtml(call.contact?.company || call.from?.name || call.to?.name || "Call")}</strong>
              <small>${escapeHtml(transcriptListLine(call))}</small>
            </span>
            <span>${escapeHtml(formatDateTime(call.startedAt))}</span>
            <span class="chip is-${escapeAttr(call.direction)}">${escapeHtml(directionLabel(call.direction))}</span>
            <span class="chip">${escapeHtml(ticket?.id || "kein Ticket")}</span>
          </button>
        `;
      }).join("")}
    </div>
    ${selectedTranscript ? `
      <article class="transcript-detail-card">
      <div class="panel-header">
        <div>
          <h3>${escapeHtml(selectedTranscript.contact?.company || selectedTranscript.from?.name || selectedTranscript.to?.name || "Transcript")}</h3>
          <p class="panel-subtitle">${escapeHtml(transcriptListLine(selectedTranscript))} · ${escapeHtml(selectedTicket?.id || "kein Ticket")}</p>
        </div>
      </div>
      <div class="transcript-preview">
        <h3>Zusammenfassung</h3>
        <p>${escapeHtml(summary)}</p>
        <div class="copy-actions">
          <button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(selectedTranscript.id)}" data-copy-kind="summary">Summary kopieren</button>
        </div>
        <h3>Transkript</h3>
        <p class="transcript-preview-text">${escapeHtml(transcriptText || "Zum Laden auswählen. Danach kann der vollständige Transcript-Text kopiert werden.")}</p>
        <div class="copy-actions">
          <button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(selectedTranscript.id)}" data-copy-kind="transcript">Transcript kopieren</button>
        </div>
        <p class="transcript-meta">Transcript-ID ${escapeHtml(selectedTranscript.transcriptId)}</p>
      </div>
      </article>
    ` : `<article class="transcript-detail-card is-empty"><div class="empty-state">Wähle links ein Transcript aus.</div></article>`}
  `;
}

function statusField(label, ok, value) {
  return `
    <div class="setup-field ${ok ? "is-ok" : "is-warning"}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderSetup() {
  if (!els.setupStatus || !els.redirectStatus) return;
  const status = state.status;
  if (!status) {
    els.setupStatus.innerHTML = `<div class="empty-state">Konfiguration wird geladen.</div>`;
    els.redirectStatus.innerHTML = "";
    return;
  }

  els.setupStatus.innerHTML = [
    statusField("OAuth", status.oauthConfigured, status.oauthConfigured ? "PKCE-Login konfiguriert" : "CALLHISTORY_CLIENT_ID fehlt"),
    statusField("API Endpoint", status.historyConfigured, status.historyConfigured ? "konfiguriert" : "CALLHISTORY_API_BASE_URL / CALLS_PATH fehlen"),
    statusField("Record Details", status.transcriptsConfigured, status.transcriptsConfigured ? "GET /records/{uuid}?complete=true" : "optional nicht gesetzt"),
    statusField("Secret Discovery", status.secrets?.secretFileFound, status.secrets?.secretFileFound ? "lokale Secret-Datei gefunden" : "nur Env-Variablen"),
    statusField("Token", status.authenticated, status.authenticated ? "serverseitig vorhanden" : "nicht verbunden"),
  ].join("");

  els.redirectStatus.innerHTML = `
    <div class="setup-field is-ok">
      <span>Callback URL</span>
      <strong><code>${escapeHtml(status.redirectUri || "nicht gesetzt")}</code></strong>
    </div>
    <div class="setup-field">
      <span>Standalone</span>
      <strong><code>npm start</code> im Ordner CallHistory_API</strong>
    </div>
    <div class="setup-field">
      <span>Portvertrag</span>
      <strong>Call History bleibt lokal auf Port 3000; Portal und CTI laufen daneben.</strong>
    </div>
  `;
}

function renderAuthLoginPanel() {
  if (!els.authLoginPanel) return;
  const status = state.status || {};
  const mode = state.authLoginMode === "env" || state.authLoginMode === "browser"
    ? state.authLoginMode
    : status.oauthConfigured
      ? "env"
      : "browser";
  const envActive = mode === "env";
  const browserActive = mode === "browser";
  const authStateClass = status.authenticated ? "is-connected" : "is-pending";
  const envExample = [
    "CALLHISTORY_CLIENT_ID=<CLIENT_ID>",
    "CALLHISTORY_REDIRECT_URI=http://localhost:3000",
  ].join("\n");
  els.authLoginPanel.innerHTML = `
    <div class="auth-login-head">
      <div>
        <h2>Anmeldung</h2>
        <p>Call-History-Zugang konfigurieren und anschließend mit einem Cloudya Account anmelden.</p>
      </div>
      <span class="auth-login-state ${authStateClass}">${status.authenticated ? "OAuth verbunden" : status.oauthConfigured ? "OAuth bereit" : "Login erforderlich"}</span>
    </div>
    <div class="auth-login-body">
      <div class="auth-mode-switch" role="tablist" aria-label="Anmeldeart">
        <button class="${envActive ? "is-active" : ""}" type="button" data-auth-mode="env">Login via .env</button>
        <button class="${browserActive ? "is-active" : ""}" type="button" data-auth-mode="browser">Login via Browser</button>
      </div>
      ${envActive ? `
        <section class="auth-login-card is-active">
          <span>Lokale Konfiguration</span>
          <h3>OAuth Secret-Datei aktiv</h3>
          <p>Lege im Ordner <strong>CallHistory_API</strong> eine Datei <strong>.env</strong> an. Der Server liest sie beim Start automatisch.</p>
          <pre>${escapeHtml(envExample)}</pre>
          <p>Auth-URL, Token-URL, Scope und Call-History-Endpunkte sind vorbelegt. Redirect bleibt lokal standardmäßig <strong>http://localhost:3000</strong>.</p>
        </section>
      ` : `
        <form class="auth-login-card browser-login-form" id="callhistory-browser-login-form">
          <span>Browser-Konfiguration</span>
          <h3>Zugangsdaten für diese Sitzung setzen</h3>
          <div class="auth-form-grid">
            <label>Client ID <small>Pflichtfeld für OAuth Login</small><input name="clientId" type="text" autocomplete="username" required></label>
            <label>Redirect URI <small>leer lassen für localhost:3000</small><input name="redirectUri" type="url" value="${escapeAttr(status.redirectUri || "http://localhost:3000")}" placeholder="http://localhost:3000"></label>
          </div>
          <div class="auth-form-actions">
            <button class="primary-button" type="submit">Zugang setzen</button>
            <span>Danach den NFON OAuth-Login über den Login-Button starten.</span>
          </div>
        </form>
      `}
      <section class="auth-login-card auth-cloudya-login">
        <span>Cloudya Login</span>
        <h3>Login mit Cloudya Account</h3>
        <p>Nach der Konfiguration verbindet der OAuth-Login diese lokale Showcase-App mit einem Cloudya Account.</p>
        <div class="auth-setup-actions">
          <a class="primary-button auth-link ${status.oauthConfigured && !status.authenticated ? "is-primary" : ""}" id="auth-login" href="#demo-login" ${!status.oauthConfigured || status.authenticated ? "hidden" : ""}>Login starten</a>
          <button class="secondary-button auth-link" id="auth-logout" type="button" ${status.authenticated ? "" : "hidden"}>Logout</button>
        </div>
      </section>
      ${state.authLoginMessage ? `<p class="form-message success">${escapeHtml(state.authLoginMessage)}</p>` : ""}
      ${state.authLoginError ? `<p class="form-message error">${escapeHtml(state.authLoginError)}</p>` : ""}
    </div>
  `;
}

async function submitCallHistoryBrowserLogin(form) {
  state.authLoginMessage = "Konfiguration wird gesetzt";
  state.authLoginError = "";
  renderAuthLoginPanel();
  const data = new FormData(form);
  try {
    const result = await apiJson("/api/settings/browser-login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data.entries())),
    });
    state.status = result.status;
    state.authLoginMessage = "Browser-Konfiguration wurde für diese Sitzung gesetzt. Jetzt Login starten.";
    await loadAll();
  } catch (error) {
    state.authLoginMessage = "";
    state.authLoginError = error.message;
    renderAuthLoginPanel();
  }
}

function renderCustomerRecordsModal() {
  if (!els.customerRecordModal) return;
  if (!state.customerRecordsOpen) {
    els.customerRecordModal.innerHTML = "";
    return;
  }

  const metrics = callMetrics();
  const records = customerRecords();
  els.customerRecordModal.innerHTML = `
    <div class="crm-modal-layer" data-customer-record-close>
      <article class="crm-modal customer-records-modal" role="dialog" aria-modal="true" aria-labelledby="customer-record-title">
        <button class="modal-close-button" type="button" data-customer-record-close aria-label="Kundensätze schließen">×</button>
        <div class="customer-records-grid">
          <section class="customer-records-form">
            <div class="panel-header">
              <div>
                <span class="panel-kicker">Kundensatz</span>
                <h2 id="customer-record-title">Kunden anlegen</h2>
                <p class="panel-subtitle">${escapeHtml(metrics.autoCustomerRecords)} automatisch erkannt · ${escapeHtml(metrics.manualCustomerRecords)} Datensätze gespeichert</p>
              </div>
            </div>
            <form id="customer-record-form">
              <label class="customer-image-drop">
                <input id="customer-record-image-input" name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif">
                <span class="customer-image-preview">
                  ${state.customerRecordImagePreview ? `<img src="${escapeAttr(state.customerRecordImagePreview)}" alt="">` : `<strong>Bild</strong>`}
                </span>
                <span>
                  <strong>Kundenbild / Logo</strong>
                  <small>PNG, JPG, WebP oder GIF bis 1,2 MB</small>
                </span>
              </label>
              <div class="customer-form-grid">
                <label>
                  Firma
                  <input name="company" type="text" autocomplete="organization" required>
                </label>
                <label>
                  Kontakt
                  <input name="name" type="text" autocomplete="name">
                </label>
                <label>
                  E-Mail
                  <input name="email" type="email" autocomplete="email">
                </label>
                <label>
                  Rufnummer
                  <input name="number" type="tel" autocomplete="tel">
                </label>
                <label>
                  Satz EUR/Min.
                  <input name="rate" type="number" min="0" step="0.1" value="${escapeAttr(BILLING_RATE_EUR)}">
                </label>
                <label>
                  Notiz
                  <input name="note" type="text" placeholder="z. B. SLA, Vertrag, Ansprechpartner">
                </label>
              </div>
              <div class="customer-editor-actions">
                <button class="primary-button" type="submit">Kundensatz speichern</button>
              </div>
            </form>
          </section>

          <aside class="customer-records-list" aria-label="Gespeicherte Kundensätze">
            <div class="panel-header">
              <div>
                <span class="panel-kicker">Gespeichert</span>
                <h3>Datensätze</h3>
                <p class="panel-subtitle">${escapeHtml(records.length)} ${records.length === 1 ? "Datensatz" : "Datensätze"} gespeichert</p>
              </div>
            </div>
            <div class="manual-customer-list">
              ${records.length ? records.map((record) => `
                <article class="manual-customer-row">
                  ${record.imageData ? `<span class="customer-visual"><img src="${escapeAttr(record.imageData)}" alt=""></span>` : `<span class="customer-visual">${escapeHtml(customerInitials(record))}</span>`}
                  <div>
                    <strong>${escapeHtml(record.company || record.name)}</strong>
                    <span>${escapeHtml([record.name, record.email, record.number].filter(Boolean).join(" · ") || "ohne Kontaktdaten")}</span>
                    ${record.note ? `<small>${escapeHtml(record.note)}</small>` : ""}
                  </div>
                  <button class="secondary-button" type="button" data-delete-customer-record="${escapeAttr(record.id)}">Löschen</button>
                </article>
              `).join("") : `<div class="empty-state">Noch keine Datensätze.</div>`}
            </div>
          </aside>
        </div>
      </article>
    </div>
  `;
}

function renderView() {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `view-${state.view}`);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  if (els.filterPanel) {
    els.filterPanel.hidden = state.view === "setup";
  }
}

function persistFilters() {
  localStorage.setItem("callhistory-filters", JSON.stringify(state.filters));
}

function setSelectedCall(callId) {
  if (!callId || state.selectedCallId === callId) return;
  state.selectedCallId = callId;
  state.assignmentPreview = null;
  render();
  loadSelectedTranscript();
}

async function previewAssignment() {
  const call = selectedCall();
  if (!call) return;
  const body = JSON.stringify({
    callId: call.id,
    transcriptId: call.transcriptId,
    assignee: state.transcript?.assignee || call.user,
    ticket: state.transcript?.ticketSuggestion || crmTicketForCall(call) || call.ticket,
  });
  try {
    state.assignmentPreview = await apiJson("/api/assignment-preview", { method: "POST", body });
    renderDetail();
  } catch (error) {
    state.assignmentPreview = { error: error.message };
    renderDetail();
  }
}

function saveCustomerForm(form) {
  const key = form.dataset.customerKey;
  if (!key) return;
  const formData = new FormData(form);
  const current = state.customerEdits[key] || {};
  const rate = Number(formData.get("rate"));
  state.customerEdits[key] = {
    ...current,
    company: String(formData.get("company") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    number: String(formData.get("number") || "").trim(),
    rate: Number.isFinite(rate) && rate >= 0 ? rate : BILLING_RATE_EUR,
    visualColor: String(formData.get("visualColor") || "#f0f4f3"),
  };
  persistCustomerEdits();
  render();
}

function removeCustomerImage(key) {
  if (!key || !state.customerEdits[key]) return;
  delete state.customerEdits[key].imageData;
  persistCustomerEdits();
  render();
}

function resetCustomerRecord(key) {
  if (!key) return;
  delete state.customerEdits[key];
  persistCustomerEdits();
  render();
}

function readImageFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      resolve("");
      return;
    }
    if (file.size > MAX_CUSTOMER_IMAGE_BYTES) {
      reject(new Error("Das Bild ist zu groß. Bitte nutze ein Bild bis ca. 1,2 MB."));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("Das Bild konnte nicht gelesen werden.")));
    reader.readAsDataURL(file);
  });
}

async function saveManualCustomerRecord(form) {
  const formData = new FormData(form);
  const rate = Number(formData.get("rate"));
  const file = form.querySelector('input[name="image"]')?.files?.[0] || null;
  let imageData = state.customerRecordImagePreview;
  if (file) imageData = await readImageFile(file);
  const record = {
    id: createCustomerRecordId(),
    company: String(formData.get("company") || "").trim(),
    name: String(formData.get("name") || "").trim(),
    email: String(formData.get("email") || "").trim(),
    number: String(formData.get("number") || "").trim(),
    rate: Number.isFinite(rate) && rate >= 0 ? rate : BILLING_RATE_EUR,
    note: String(formData.get("note") || "").trim(),
    imageData,
    createdAt: new Date().toISOString(),
  };
  if (!record.company && !record.name && !record.email && !record.number) return;
  state.customerRecords = [record, ...customerRecords()];
  state.customerRecordImagePreview = "";
  persistCustomerRecords();
  form.reset();
  render();
}

function deleteManualCustomerRecord(id) {
  state.customerRecords = customerRecords().filter((record) => record.id !== id);
  persistCustomerRecords();
  render();
}

async function copyToClipboard(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-1000px";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
}

function showCopyToast(message) {
  const existing = document.querySelector(".copy-toast");
  if (existing) existing.remove();
  const toast = document.createElement("div");
  toast.className = "copy-toast";
  toast.textContent = message;
  document.body.append(toast);
  setTimeout(() => toast.remove(), 1300);
}

async function copyCallPart(callId, kind) {
  const call = state.calls.find((item) => item.id === callId);
  if (!call) return;
  await copyToClipboard(copyPayload(call, kind));
}

function storeCustomerImage(input) {
  const form = input.closest("#customer-edit-form");
  const key = form?.dataset.customerKey;
  const file = input.files?.[0];
  if (!key || !file) return;
  if (file.size > MAX_CUSTOMER_IMAGE_BYTES) {
    window.alert("Das Bild ist zu groß. Bitte nutze ein Bild bis ca. 1,2 MB.");
    input.value = "";
    return;
  }
  const reader = new FileReader();
  reader.addEventListener("load", () => {
    state.customerEdits[key] = {
      ...(state.customerEdits[key] || {}),
      imageData: String(reader.result || ""),
    };
    persistCustomerEdits();
    render();
  });
  reader.readAsDataURL(file);
}

function bindEvents() {
  els.refresh.addEventListener("click", loadAll);
  if (els.demoToggle) {
    els.demoToggle.addEventListener("change", () => {
      state.demoMode = els.demoToggle.checked;
      localStorage.setItem("callhistory-demo-mode", state.demoMode ? "1" : "0");
      clearCallData();
      loadCalls();
    });
  }

  els.rangeFilter.addEventListener("change", () => {
    state.filters.range = els.rangeFilter.value;
    persistFilters();
    loadCalls();
  });
  els.directionFilter.addEventListener("change", () => {
    state.filters.direction = els.directionFilter.value;
    persistFilters();
    loadCalls();
  });
  els.outcomeFilter.addEventListener("change", () => {
    state.filters.outcome = els.outcomeFilter.value;
    persistFilters();
    loadCalls();
  });
  els.transcriptFilter.addEventListener("change", () => {
    state.filters.transcript = els.transcriptFilter.value;
    persistFilters();
    loadCalls();
  });

  let partyTimer = 0;
  els.partyFilter.addEventListener("input", () => {
    clearTimeout(partyTimer);
    partyTimer = setTimeout(() => {
      state.filters.party = els.partyFilter.value.trim();
      persistFilters();
      loadCalls();
    }, 220);
  });

  let queueTimer = 0;
  els.queueFilter.addEventListener("input", () => {
    clearTimeout(queueTimer);
    queueTimer = setTimeout(() => {
      state.filters.queue = els.queueFilter.value.trim();
      persistFilters();
      loadCalls();
    }, 220);
  });

  document.addEventListener("click", (event) => {
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      const nextView = viewButton.dataset.view;
      if (state.view === nextView) return;
      state.view = nextView;
      if (state.view !== "crm") state.crmModalCallId = "";
      localStorage.setItem("callhistory-view", state.view);
      render();
      if (state.view !== "setup") loadCalls();
      return;
    }

    const metricAction = event.target.closest("[data-metric-action]");
    if (metricAction?.dataset.metricAction === "customer-records") {
      state.customerRecordsOpen = true;
      renderCustomerRecordsModal();
      return;
    }

    if (event.target.matches("[data-customer-record-close]") || event.target.closest("button[data-customer-record-close]")) {
      state.customerRecordsOpen = false;
      state.customerRecordImagePreview = "";
      renderCustomerRecordsModal();
      return;
    }

    const deleteCustomerRecord = event.target.closest("[data-delete-customer-record]");
    if (deleteCustomerRecord) {
      deleteManualCustomerRecord(deleteCustomerRecord.dataset.deleteCustomerRecord);
      return;
    }

    if (event.target.matches("[data-crm-modal-close]") || event.target.closest(".modal-close-button")) {
      state.crmModalCallId = "";
      renderCrm();
      return;
    }

    const copyButton = event.target.closest("[data-copy-call-id]");
    if (copyButton) {
      const originalText = copyButton.textContent;
      copyCallPart(copyButton.dataset.copyCallId, copyButton.dataset.copyKind || "all")
        .then(() => {
          copyButton.textContent = "Kopiert";
          showCopyToast("In die Zwischenablage kopiert");
          setTimeout(() => { copyButton.textContent = originalText; }, 1200);
        })
        .catch((error) => {
          copyButton.textContent = "Nicht kopiert";
          copyButton.title = error.message;
        });
      return;
    }

    const analyticsToggle = event.target.closest("[data-analytics-series]");
    if (analyticsToggle) {
      const key = analyticsToggle.dataset.analyticsSeries;
      const active = Array.isArray(state.analyticsSeries)
        ? state.analyticsSeries.filter((item) => ANALYTICS_SERIES.includes(item))
        : [...ANALYTICS_SERIES];
      if (key === "all") {
        state.analyticsSeries = [...ANALYTICS_SERIES];
      } else if (ANALYTICS_SERIES.includes(key)) {
        state.analyticsSeries = active.includes(key)
          ? active.filter((item) => item !== key)
          : [...active, key];
        if (!state.analyticsSeries.length) state.analyticsSeries = [key];
      }
      localStorage.setItem("callhistory-analytics-series", JSON.stringify(state.analyticsSeries));
      renderAnalytics();
      return;
    }

    const callTarget = event.target.closest("[data-call-id]");
    if (callTarget) {
      if (callTarget.closest(".transcript-list")) {
        state.selectedTranscriptCallId = callTarget.dataset.callId;
        if (state.selectedCallId !== callTarget.dataset.callId) {
          state.selectedCallId = callTarget.dataset.callId;
          state.assignmentPreview = null;
        }
        render();
        loadSelectedTranscript();
        return;
      }
      setSelectedCall(callTarget.dataset.callId);
      return;
    }

    const crmTarget = event.target.closest("[data-crm-open-call-id], [data-crm-modal-call-id]");
    if (crmTarget) {
      const callId = crmTarget.dataset.crmOpenCallId || crmTarget.dataset.crmModalCallId;
      state.crmModalCallId = callId;
      state.selectedCallId = callId;
      state.assignmentPreview = null;
      renderCrm();
      loadSelectedTranscript();
      return;
    }

    if (state.view === "transcripts" && state.selectedTranscriptCallId) {
      const transcriptArea = event.target.closest("#view-transcripts");
      const protectedTarget = event.target.closest(".transcript-list-row, .transcript-detail-card, [data-copy-call-id]");
      if (transcriptArea && !protectedTarget) {
        state.selectedTranscriptCallId = "";
        state.transcript = null;
        renderTranscripts();
        return;
      }
    }

    const accountFilter = event.target.closest("[data-filter-account-key]");
    if (accountFilter) {
      state.crmAccountFilterKey = accountFilter.dataset.filterAccountKey;
      renderCrm();
      return;
    }

    if (event.target.closest("#clear-crm-filter")) {
      state.crmAccountFilterKey = "";
      renderCrm();
      return;
    }

    if (event.target.closest("#assignment-preview")) {
      previewAssignment();
      return;
    }

    const removeImage = event.target.closest("#remove-customer-image");
    if (removeImage) {
      removeCustomerImage(removeImage.closest("#customer-edit-form")?.dataset.customerKey);
      return;
    }

    const resetRecord = event.target.closest("#reset-customer-record");
    if (resetRecord) {
      resetCustomerRecord(resetRecord.closest("#customer-edit-form")?.dataset.customerKey);
    }
  });

  document.addEventListener("submit", (event) => {
    const recordForm = event.target.closest("#customer-record-form");
    if (recordForm) {
      event.preventDefault();
      saveManualCustomerRecord(recordForm).catch((error) => window.alert(error.message));
      return;
    }

    const form = event.target.closest("#customer-edit-form");
    if (!form) return;
    event.preventDefault();
    saveCustomerForm(form);
  });

  document.addEventListener("change", (event) => {
    if (event.target.closest("#customer-record-image-input")) {
      const input = event.target;
      const file = input.files?.[0] || null;
      readImageFile(file)
        .then((imageData) => {
          state.customerRecordImagePreview = imageData;
          const preview = document.querySelector(".customer-image-preview");
          if (preview) {
            preview.innerHTML = imageData
              ? `<img src="${escapeAttr(imageData)}" alt="">`
              : "<strong>Bild</strong>";
          }
        })
        .catch((error) => {
          window.alert(error.message);
          input.value = "";
        });
      return;
    }

    if (event.target.closest("#customer-image-input")) {
      storeCustomerImage(event.target);
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.customerRecordsOpen) {
      state.customerRecordsOpen = false;
      renderCustomerRecordsModal();
      return;
    }
    if (event.key === "Escape" && state.crmModalCallId) {
      state.crmModalCallId = "";
      renderCrm();
      return;
    }
    const row = event.target.closest(".history-row[data-call-id]");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setSelectedCall(row.dataset.callId);
    }
  });

  if (els.authLoginPanel) {
    els.authLoginPanel.addEventListener("click", (event) => {
      const logout = event.target.closest("#auth-logout");
      if (logout) {
        apiJson("/api/auth/logout", { method: "POST" })
          .then(loadAll)
          .catch((error) => {
            state.authLoginError = error.message;
            renderAuthLoginPanel();
          });
        return;
      }

      const button = event.target.closest("[data-auth-mode]");
      if (!button) return;
      state.authLoginMode = button.dataset.authMode;
      state.authLoginMessage = "";
      state.authLoginError = "";
      localStorage.setItem("callhistory-auth-login-mode", state.authLoginMode);
      renderAuthLoginPanel();
    });
    els.authLoginPanel.addEventListener("submit", (event) => {
      if (!event.target.matches("#callhistory-browser-login-form")) return;
      event.preventDefault();
      submitCallHistoryBrowserLogin(event.target);
    });
  }
}

bindEvents();
loadAll();
