// Explicit messages localize system text without translating API or customer data.
function message(key, fallback, params = {}) {
  const translated = window.NFON_I18N?.message?.(key, params);
  const template = typeof translated === "string" && translated && translated !== key ? translated : fallback;
  return template.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

function systemMessage(value) {
  const known = {
  "Client ID is required": "history.clientRequired",
  "Redirect URI is not a valid URL": "history.invalidRedirect",
  "Redirect URI must use HTTP/HTTPS and must not contain a fragment": "history.unsupportedRedirect",
  "Login with NFON is required for live call history": "history.liveLoginRequired",
  "Login with NFON is required for live transcript details": "history.transcriptLoginRequired",
  "Live Call History request failed": "history.liveCallFailed",
  "Live transcript request failed": "history.liveTranscriptFailed",
  "Call History API is not fully configured.": "history.incompleteServerConfig",
  "Failed to fetch": "history.networkError",
  "fetch failed": "history.networkError",
  "The operation was aborted due to timeout": "history.networkError",
  "Transcript unavailable": "history.transcriptUnavailable",
  "Transcript content is not available for this call.": "history.transcriptContentUnavailable"
};
  return known[value] ? message(known[value], value) : String(value || "");
}

function locale() {
  const language = window.NFON_I18N?.getLanguage?.() || document.documentElement.lang || "en";
  return language === "en" ? "en-GB" : language;
}

function storedValue(key) { try { return localStorage.getItem(key); } catch { return null; } }
function storeValue(key, value) { try { localStorage.setItem(key, value); } catch { /* Storage is optional. */ } }

const DEFAULT_FILTERS = {
  range: "7d",
  direction: "all",
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
  pagination: null,
  invalidRecords: 0,
  loadedQuery: "",
  loadedMode: "",
  selectedCallId: "",
  selectedTranscriptCallId: "",
  transcript: null,
  transcriptCache: new Map(),
  view: storedValue("callhistory-view") || "history",
  demoMode: storedValue("callhistory-demo-mode") === "1",
  filters: { ...DEFAULT_FILTERS, ...readJsonStorage("callhistory-filters", DEFAULT_FILTERS) },
  authLoginMode: storedValue("callhistory-auth-login-mode") || "",
  authLoginMessage: "",
  authLoginError: "",
  csrfToken: "",
  loading: true,
  error: "",
};

// Keep in-progress text separate until the debounce applies the filter.
const filterDrafts = { party: null, queue: null };

let transcriptRequestSequence = 0;
let callRequestSequence = 0;
let callDataGeneration = 0;
let statusRequestSequence = 0;
let copyRequestSequence = 0;
let copyWriteQueue = Promise.resolve();

const HISTORY_RENDER_LIMIT = 80;
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
  statusNote: $("#status-note"),
  filterPanel: $(".filter-panel"),
  rangeFilter: $("#range-filter"),
  directionFilter: $("#direction-filter"),
  transcriptFilter: $("#transcript-filter"),
  partyFilter: $("#party-filter"),
  queueFilter: $("#queue-filter"),
  filterFields: document.querySelectorAll("[data-filter-field]"),
  historySubtitle: $("#history-subtitle"),
  callsBody: $("#calls-body"),
  detailSubtitle: $("#detail-subtitle"),
  callDetail: $("#call-detail"),
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

function messageMarkup(key, fallback, params = {}) {
  return `<span data-i18n-key="${escapeAttr(key)}" data-i18n-params="${escapeAttr(JSON.stringify(params))}">${escapeHtml(message(key, fallback, params))}</span>`;
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}

async function apiJson(path, options = {}, acceptResponse = () => true) {
  const requestGeneration = callDataGeneration;
  if (isUnsafeRequest(options)) await ensureCsrfToken();
  let response, body;
  try { response = await fetch(path, {
    ...options,
    // Listing can use the server's full 60-second budget, plus response overhead.
    signal: options.signal || AbortSignal.timeout(path.startsWith("/api/calls?") ? 65000 : 45000),
    headers: {
      "Accept": "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(isUnsafeRequest(options) ? { "X-CSRF-Token": state.csrfToken } : {}),
      ...(options.headers || {}),
    },
  });
    body = await response.json();
  } catch (error) {
    if (["TimeoutError", "AbortError"].includes(error.name)) throw new Error("Failed to fetch");
    throw error;
  }
  const responseIsCurrent = requestGeneration === callDataGeneration && acceptResponse();
  if (responseIsCurrent) rememberCsrfToken(body);
  if (!response.ok) {
    const error = new Error(body.error || `HTTP ${response.status}`); error.statusCode = response.status;
    if (response.status === 401 && responseIsCurrent) {
      error.invalidatedCallDataGeneration = callDataGeneration;
      state.status = { ...state.status, authenticated: false, account: "" };
      callDataGeneration += 1;
      state.transcriptCache.clear();
    }
    throw error;
  }
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
  const params = new URLSearchParams({
    mode: state.demoMode ? "demo" : "live",
    range: state.filters.range,
    direction: "all",
    outcome: "all",
  });
  return params.toString();
}

function phoneSearchDigits(value) {
  return String(value || "").replace(/\(0\)/g, "").replace(/^\s*00/, "+").replace(/\D/g, "");
}
function phoneSearchMatches(value, query) {
  const haystack = phoneSearchDigits(value), needle = phoneSearchDigits(query);
  if (!needle) return false;
  return haystack.includes(needle) || (needle.startsWith("0") && needle.length >= 7 && haystack.includes(needle.slice(1)));
}

function applyLocalFilters(calls) {
  const transcriptFilter = state.filters.transcript || "all";
  const queueFilter = normalizeLookup(filterDrafts.queue ?? state.filters.queue);

  const party = String(filterDrafts.party ?? state.filters.party ?? "").trim().toLowerCase();
  const digits = party.replace(/\D/g, "");
  const phoneSearch = /^[+\d\s()./-]+$/.test(party) && Boolean(digits);
  return calls.filter((call) => {
    if (state.filters.direction !== "all" && call.direction !== state.filters.direction) return false;
    if (party) {
      const parties = [call.from, call.to, call.user, call.contact];
      const nameMatch = parties.some(value => [value?.name, value?.number, value?.company].some(text => String(text || "").toLowerCase().includes(party)));
      const phoneMatch = phoneSearch && parties.some(value => phoneSearchMatches(value?.number, party));
      if (!nameMatch && !phoneMatch) return false;
    }
    if (state.view !== "history") return true;
    if (transcriptFilter === "with" && !call.transcriptId) return false;
    if (transcriptFilter === "without" && call.transcriptId) return false;
    if (queueFilter && !normalizeLookup(call.queue?.name || call.queue?.number || "").includes(queueFilter)) return false;
    return true;
  });
}

function beginStatusRequest() {
  return { sequence: ++statusRequestSequence, generation: callDataGeneration };
}

function isCurrentStatusRequest(request, error) {
  return request.sequence === statusRequestSequence
    && (request.generation === callDataGeneration
      || (error?.invalidatedCallDataGeneration === request.generation
        && callDataGeneration === request.generation + 1));
}

function adoptStatus(status, request) {
  if (!isCurrentStatusRequest(request)) return false;
  const previous = state.status;
  const previousSource = requestedCallSource();
  state.status = status;
  if (previous && (previous.sessionRevision !== status.sessionRevision
    || previous.authenticated !== status.authenticated || previousSource !== requestedCallSource())) {
    clearCallData();
    state.error = "";
  }
  rememberCsrfToken(status);
  return true;
}

async function loadStatus() {
  const request = beginStatusRequest();
  try {
    return adoptStatus(await apiJson("/api/status"), request);
  } catch (error) {
    if (!isCurrentStatusRequest(request, error)) return false;
    throw error;
  }
}

function requestedCallSource() {
  // The server also serves demo calls when forced or not configured for live access.
  return state.demoMode || state.status?.demoMode === true || state.status?.configured === false
    ? "demo" : "callhistory-live";
}

function clearCallData(source = requestedCallSource()) {
  copyRequestSequence += 1;
  callDataGeneration += 1;
  callRequestSequence += 1;
  transcriptRequestSequence += 1;
  state.loadedQuery = "";
  state.loadedMode = "";
  state.pagination = null;
  state.invalidRecords = 0;
  state.transcriptCache.clear();
  state.rawCalls = [];
  state.calls = [];
  state.source = source;
  state.reason = "";
  state.selectedCallId = "";
  state.selectedTranscriptCallId = "";

  state.transcript = null;

}

async function loadCalls(force = false) {
  if (state.view === "crm") { state.loading = false; render(); return; }
  transcriptRequestSequence += 1;
  state.transcript = null;
  if (state.loadedMode && state.loadedMode !== requestedCallSource()) {
    clearCallData();
  }
  const requestSequence = ++callRequestSequence;
  const requestedSource = requestedCallSource();
  const query = queryForCalls();
  if (!force && state.loadedQuery === query) {
    state.calls = applyLocalFilters(state.rawCalls);
    reconcileCallSelection();
    state.loading = false;
    render();
    await loadSelectedTranscript();
    return;
  }
  const isCurrentRequest = () => requestSequence === callRequestSequence
    && requestedSource === requestedCallSource();
  state.loading = true;
  state.error = "";
  render();
  try {
    const payload = await apiJson(`/api/calls?${query}`);
    if (!isCurrentRequest()) return;
    state.loadedQuery = query;
    state.loadedMode = requestedSource;
    state.pagination = payload.pagination || null;
    state.invalidRecords = payload.invalidRecords || 0;
    state.rawCalls = payload.calls || [];
    state.calls = applyLocalFilters(state.rawCalls);
    state.source = payload.source || "";
    state.reason = payload.reason || "";
    reconcileCallSelection();

    state.loading = false;
    render();
    await loadSelectedTranscript();
  } catch (error) {
    if (!isCurrentRequest()) return;
    clearCallData();
    state.error = error.message;
    state.loading = false;
    render();
  }
}

function reconcileCallSelection() {
  const previousCall = state.selectedCallId;
  const previousTranscript = state.selectedTranscriptCallId;
  if (!state.calls.some((call) => call.id === state.selectedCallId)) {
    state.selectedCallId = state.calls[0]?.id || "";
  }
  if (!state.calls.some((call) => call.id === state.selectedTranscriptCallId && call.transcriptId)) {
    state.selectedTranscriptCallId = "";
  }
  // A removed selection must stay invalid even if a later filter restores the
  // same call. Filters that retain both selections preserve the pending copy.
  if (previousCall !== state.selectedCallId || previousTranscript !== state.selectedTranscriptCallId) {
    copyRequestSequence += 1;
  }
}

async function loadAll() {
  copyRequestSequence += 1;
  try {
    if (!await loadStatus()) return;
  } catch (error) {
    state.error = error.message;
  }
  // Explicit Refresh retries an unavailable detail; successful content remains
  // cached for ordinary navigation. A fresh list alone cannot refresh this ID.
  const call = selectedCall();
  const transcript = cachedTranscriptForCall(call);
  if (transcript && (transcript.available === false || !callTranscriptText(call))) {
    state.transcriptCache.delete(transcriptCacheKey(call.transcriptId));
  }
  await loadCalls(true);
}

function selectedCall() {
  return state.calls.find((call) => call.id === state.selectedCallId) || null;
}

async function loadSelectedTranscript() {
  if (state.view === "crm") return;
  const requestSequence = ++transcriptRequestSequence;
  const call = selectedCall();
  state.transcript = null;
  if (!call?.transcriptId) {
    renderSelectedCallContent();
    return;
  }
  const cacheKey = transcriptCacheKey(call.transcriptId);
  const isCurrentRequest = () => requestSequence === transcriptRequestSequence
    && state.selectedCallId === call.id
    && transcriptCacheKey(call.transcriptId) === cacheKey;
  if (state.transcriptCache.has(cacheKey)) {
    state.transcript = state.transcriptCache.get(cacheKey);
    renderSelectedCallContent();
    return;
  }
  try {
    const transcript = await apiJson(`/api/transcripts/${encodeURIComponent(call.transcriptId)}?mode=${state.demoMode ? "demo" : "live"}`, {}, isCurrentRequest);
    if (!isCurrentRequest()) return;
    state.transcriptCache.set(cacheKey, transcript);
    state.transcript = transcript;
  } catch (error) {
    if (!isCurrentRequest()) return;
    state.transcript = { ok: false, error: error.message };
  }
  renderSelectedCallContent();
}

function formatDateTime(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "-";
  return new Intl.DateTimeFormat(locale(), {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDuration(seconds, compact = false) {
  const total = Number(seconds || 0);
  if (!total) return "0:00";
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  if (compact) return new Intl.NumberFormat(locale(), { style: "unit", unit: "minute", unitDisplay: "short" }).format(minutes) + " " + new Intl.NumberFormat(locale(), { style: "unit", unit: "second", unitDisplay: "short" }).format(secs);
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function directionLabel(direction) {
  return {
    inbound: message("history.inbound", "Inbound"),
    outbound: message("history.outbound", "Outbound"),
    unknown: message("history.unknown", "Unknown"),
  }[direction] || direction;
}

function outcomeLabel(outcome) {
  return {
    answered: message("history.answered", "Answered"),
    missed: message("history.missed", "Missed"),
    cancelled: message("history.cancelled", "Cancelled"),
    busy: message("history.busy", "Busy"),
    failed: message("history.error", "Error"),
    unknown: message("history.unknown", "Unknown"),
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

function isGeneratedDemo(call) {
  return call?.source === "demo" && call?.demoTemplate === "call-history-v1";
}

function demoTranscriptParams(call) {
  return { customer: call.contact?.name || customerParty(call).name || message("history.customer", "Customer"), company: call.contact?.company || message("history.demoAccount", "Demo account"), agent: call.user?.name || message("history.demoAgent", "Demo agent"), queue: internalParty(call).name || "Demo" };
}

function callSummaryContent(call) {
  const transcript = cachedTranscriptForCall(call);
  if (isGeneratedDemo(call)) {
    return transcript?.ok
      ? message("history.demoTranscriptSummary", "{customer} from {company} discussed the current service request. The next steps were documented.", demoTranscriptParams(call))
      : "";
  }
  return cleanSummaryText(transcript?.summary) || cleanSummaryText(call?.summary);
}

function callTranscriptSummary(call) {
  return callSummaryContent(call) || (isGeneratedDemo(call)
    ? message("history.demoCallSummary", "{customer} · {queue} · Demo system", demoTranscriptParams(call))
    : message("history.summaryPending", "Summary has not been loaded yet."));
}

function callTranscriptText(call) {
  const transcript = cachedTranscriptForCall(call);
  if (isGeneratedDemo(call) && transcript?.ok) {
    return message("history.demoTranscriptText", "{customer}: We need a brief update on the current case.\n{agent}: I will check the status and document the next steps.", demoTranscriptParams(call));
  }
  if (Array.isArray(transcript?.transcript) && transcript.transcript.length) {
    return transcript.transcript.filter(entry => entry.event === "speech" && entry.text).map(entry => {
      const party = entry.source === "caller" ? call.from : entry.source === "callee" ? call.to : null;
      const label = party?.name || party?.number || (entry.source === "caller" ? message("history.caller", "Caller") : entry.source === "callee" ? message("history.callee", "Recipient") : message("history.unknown", "Unknown"));
      return `${label}: ${entry.text}`;
    }).join("\n");
  }
  return transcript?.text || "";
}

function cleanSummaryText(value) {
  return String(value || "").trim();
}

function aiTranscriptBadge(call, modifier = "", showEmpty = true, forcePopover = false) {
  if (!call?.transcriptId) return showEmpty ? `<span class="transcript-empty">${messageMarkup("history.none", "None")}</span>` : "";
  const hasPopover = forcePopover || !modifier.split(/\s+/).includes("is-corner");
  const summary = callTranscriptSummary(call);
  const className = `ai-transcript-badge${modifier ? ` ${modifier}` : ""}`;
  return `
    <span class="${className}" ${hasPopover && !forcePopover ? `tabindex="0"` : ""} data-i18n-aria-label="history.transcriptAvailable" aria-label="${escapeAttr(message("history.transcriptAvailable", "Transcript available"))}"${hasPopover ? "" : ` data-i18n-title="history.transcriptAvailable" title="${escapeAttr(message("history.transcriptAvailable", "Transcript available"))}"`}>
      <svg class="transcript-badge-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">
        <rect x="4" y="3.5" width="12.5" height="17" rx="2.2" fill="#00d981"></rect>
        <rect x="6.6" y="7" width="7.3" height="1.6" rx="0.8" fill="#ffffff"></rect>
        <rect x="6.6" y="10" width="7.3" height="1.6" rx="0.8" fill="#ffffff"></rect>
        <rect x="6.6" y="13" width="5" height="1.6" rx="0.8" fill="#ffffff"></rect>
        <path d="M18.7 11l0.85 2.2 2.2 0.85-2.2 0.85-0.85 2.2-0.85-2.2-2.2-0.85 2.2-0.85z" fill="#202426"></path>
      </svg>
      ${hasPopover ? `<span class="transcript-summary-popover" role="tooltip" aria-hidden="true">
        <strong>${messageMarkup("history.transcriptSummary", "Transcript summary")}</strong>
        <span data-i18n-ignore>${escapeHtml(summary)}</span>
        <small data-i18n-ignore>${escapeHtml(call.transcriptId)}</small>
      </span>` : ""}
    </span>
  `;
}

function fitTranscriptPopover(badge) {
  const popover = badge?.querySelector(".transcript-summary-popover");
  if (!popover) return;
  const viewport = window.visualViewport;
  const inset = 8, gap = 7;
  let left = (viewport?.offsetLeft || 0) + inset;
  let top = (viewport?.offsetTop || 0) + inset;
  let right = (viewport ? viewport.offsetLeft + viewport.width : window.innerWidth) - inset;
  let bottom = (viewport ? viewport.offsetTop + viewport.height : window.innerHeight) - inset;
  for (let parent = badge.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const clipsX = /^(auto|scroll|hidden|clip)$/.test(style.overflowX);
    const clipsY = /^(auto|scroll|hidden|clip)$/.test(style.overflowY);
    if (!clipsX && !clipsY) continue;
    const box = parent.getBoundingClientRect();
    if (clipsX) {
      left = Math.max(left, box.left + parent.clientLeft + inset);
      right = Math.min(right, box.left + parent.clientLeft + parent.clientWidth - inset);
    }
    if (clipsY) {
      top = Math.max(top, box.top + parent.clientTop + inset);
      bottom = Math.min(bottom, box.top + parent.clientTop + parent.clientHeight - inset);
    }
  }
  const anchor = badge.getBoundingClientRect();
  if (right - left < 32 || bottom - top < 32 || anchor.bottom < top || anchor.top > bottom) {
    popover.style.visibility = "hidden";
    return;
  }
  popover.style.visibility = "";
  popover.style.maxWidth = `${Math.floor(right - left)}px`;
  popover.style.maxHeight = "none";
  const natural = popover.getBoundingClientRect();
  const below = Math.max(0, bottom - anchor.bottom - gap);
  const above = Math.max(0, anchor.top - top - gap);
  const flip = natural.height > below && above > below;
  popover.style.maxHeight = `${Math.floor(Math.max(32, flip ? above : below))}px`;
  const box = popover.getBoundingClientRect();
  popover.style.left = `${Math.max(left, Math.min(anchor.left, right - box.width)) - anchor.left}px`;
  const desiredTop = flip ? anchor.top - gap - box.height : anchor.bottom + gap;
  popover.style.top = `${Math.max(top, Math.min(desiredTop, bottom - box.height)) - anchor.top}px`;
}

function fitVisibleTranscriptPopovers() {
  document.querySelectorAll(".ai-transcript-badge:hover, .ai-transcript-badge:focus-visible").forEach(fitTranscriptPopover);
}

function transcriptCopyText(call) {
  const summary = callSummaryContent(call);
  return [
    `${message("history.transcript", "Transcript")}: ${call.transcriptId || "-"}`,
    `${message("history.call", "Call")}: ${formatDateTime(call.startedAt)}`,
    "",
    ...(summary ? [message("history.summary", "Summary"), summary, ""] : []),
    message("history.transcript", "Transcript"),
    callTranscriptText(call),
  ].join("\n");
}

function copyPayload(call, kind) {
  if (kind === "summary") return callSummaryContent(call);
  if (kind === "transcript") return callTranscriptText(call);
  return transcriptCopyText(call);
}

function normalizeLookup(value) {
  return String(value || "").toLowerCase().normalize("NFKC").replace(/[^\p{L}\p{N}+]/gu, "");
}

function customerParty(call) {
  return call.direction === "outbound" ? call.to || {} : call.from || {};
}

function internalParty(call) {
  return call.direction === "outbound" ? call.from || {} : call.to || {};
}

function rangeLabel() {
  return { today: message("history.today", "Today"), "7d": message("history.sevenDays", "7 days"), "30d": message("history.thirtyDays", "30 days") }[state.filters.range] || state.filters.range;
}

function sourceLabel() {
  if (!state.demoMode && state.status && !state.status.authenticated && !["demo", "demo-fallback"].includes(state.source)) return message("history.loginRequired", "Sign in required");
  if (state.source === "callhistory-live") return message("history.liveData", "Live data");
  if (state.source === "demo-fallback") return message("history.demoFallback", "Demo fallback");
  return message("history.demoData", "Demo data");
}

function callMetrics() {
  const total = state.calls.length;
  const missed = state.calls.filter((call) => call.outcome === "missed").length;
  const answered = state.calls.filter((call) => call.outcome === "answered").length;
  const duration = state.calls.filter(call => call.outcome === "answered").reduce((sum, call) => sum + Math.max(0, Number(call.durationSeconds) || 0), 0);
  const transcripts = state.calls.filter((call) => call.transcriptId).length;
  return { total, missed, answered, average: answered ? Math.round(duration / answered) : 0, transcripts };
}

function render() {
  renderControls();
  renderHeader();
  renderMetrics();
  renderStatusNote();
  renderActiveViewContent();
  renderView();
}

function renderActiveViewContent() {
  clearInactiveViewContent();
  if (state.view === "crm") {
    renderCrmDemo();
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
  const focusedCallId = document.activeElement?.dataset?.callId;
  const focusedPanel = document.activeElement?.classList?.contains?.("transcript-detail-card");
  if (state.view === "transcripts") {
    renderTranscripts();
  } else if (state.view === "history") {
    renderDetail();
  }
  if (focusedPanel) focusCallSelection(state.selectedTranscriptCallId, true);
  if (focusedCallId) [...document.querySelectorAll("[data-call-id]")].find(node => node.dataset.callId === focusedCallId)?.focus({ preventScroll: true });
}

function clearInactiveViewContent() {
  if (state.view !== "history") {
    els.callsBody.innerHTML = "";
    els.callDetail.innerHTML = "";
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
  els.transcriptFilter.value = state.filters.transcript || "all";
  els.partyFilter.value = filterDrafts.party ?? state.filters.party;
  els.queueFilter.value = filterDrafts.queue ?? (state.filters.queue || "");
  renderFilterContext();
}

function renderFilterContext() {
  if (!els.filterPanel) return;
  els.filterPanel.dataset.filterView = state.view;
  const visibleFieldsByView = {
    history: new Set(["range", "direction", "transcript", "party", "queue"]),
    transcripts: new Set(["range", "direction", "party"]),
    crm: new Set(),
    setup: new Set(),
  };
  const visibleFields = visibleFieldsByView[state.view] || visibleFieldsByView.history;
  els.filterFields.forEach((field) => {
    field.hidden = !visibleFields.has(field.dataset.filterField);
  });

  const partyLabel = els.filterPanel.querySelector('[data-filter-field="party"] .filter-label-text');
  const isNumberSearch = state.view === "history" || state.view === "transcripts";
  if (partyLabel) {
    partyLabel.dataset.i18nKey = isNumberSearch ? "history.phoneNumber" : "history.participant";
    partyLabel.textContent = isNumberSearch ? message("history.phoneNumber", "Phone number") : message("history.participant", "Participant");
  }
  els.partyFilter.dataset.i18nPlaceholder = isNumberSearch ? "history.searchNumber" : "history.searchParty";
  els.partyFilter.placeholder = isNumberSearch ? message("history.searchNumber", "Search phone number") : message("history.searchParty", "Name or number");
  els.queueFilter.dataset.i18nPlaceholder = "history.searchQueue";
  els.queueFilter.placeholder = message("history.searchQueue", "Search queue");
}

function renderHeader() {
  els.connection.removeAttribute("data-status-mode");
  els.connection.setAttribute("data-i18n-ignore", "");
  const fixedDemo = state.view === "crm";
  els.refresh.hidden = fixedDemo;
  if (els.demoToggle) els.demoToggle.closest("label").hidden = fixedDemo;
  if (fixedDemo) {
    els.account.textContent = message("history.fixedCrmDemo", "Transcript integration · Demo");
    els.connection.className = "connection";
    els.connection.textContent = "Demo";
    els.connection.setAttribute("data-status-mode", "demo");
    els.connection.removeAttribute("title");
    return;
  }
  const staticDemo = window.NFON_WEB_ONLY_DEMO || window.location.protocol === "file:";
  const status = state.status;
  const account = status?.authenticated
    ? `<span data-i18n-ignore>${escapeHtml(status.account || message("history.nfonUser", "NFON user"))}</span>`
    : messageMarkup("history.loginRequired", "Sign in required");
  els.account.innerHTML = staticDemo ? messageMarkup("history.demoData", "Demo data") : status
    ? (!status.authenticated && !state.demoMode && !["demo", "demo-fallback"].includes(state.source) ? account : `${account} · ${escapeHtml(sourceLabel())}`)
    : messageMarkup("history.checkingHistory", "Checking Call History");

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
  if (!status?.authenticated && !state.demoMode && !["demo", "demo-fallback"].includes(state.source)) {
    els.connection.textContent = message("history.loginRequired", "Sign in required");
    els.connection.setAttribute("data-status-mode", "setup");
  } else if (state.error) {
    els.connection.textContent = message("history.error", "Error");
    els.connection.classList.add("is-error");
    els.connection.title = systemMessage(state.error);
  } else if (state.loading) {
    els.connection.textContent = message("history.checking", "Checking");
  } else if (state.source === "callhistory-live") {
    els.connection.textContent = message("history.ready", "Ready");
    els.connection.classList.add("is-online");
  } else if (!staticDemo && !state.demoMode && !status?.configured && !["demo", "demo-fallback"].includes(state.source)) {
    els.connection.textContent = "Setup";
    els.connection.classList.add("is-warning");
    els.connection.title = state.reason || message("history.configurationIncomplete", "Call History API configuration is incomplete.");
  } else {
    els.connection.textContent = "Demo";
    els.connection.setAttribute("data-status-mode", "demo");
    if (state.source === "demo-fallback" && state.reason) els.connection.title = systemMessage(state.reason);
  }
}

function callDataState() {
  if (state.loading) return ["history.loadingCalls", "Loading calls"];
  if (state.status && !state.status.authenticated && !state.demoMode && !["demo", "demo-fallback"].includes(state.source)) return ["history.loginRequired", "Sign in required"];
  if (state.error) return requestedCallSource() === "demo"
    ? ["history.demoCallFailed", "Demo call list could not be loaded"]
    : ["history.liveCallFailed", "Live Call History request failed"];
  return null;
}

function renderMetrics() {
  els.metrics.hidden = state.view === "setup" || state.view === "crm" || Boolean(callDataState());
  if (els.metrics.hidden) { els.metrics.innerHTML = ""; return; }
  const metrics = callMetrics();
  const items = [
    [message("history.calls", "Calls"), metrics.total, message("history.answeredCount", "{count} answered", { count: metrics.answered })],
    [message("history.missedCalls", "Missed calls"), metrics.missed, ""],
    [message("history.averageDuration", "Average duration"), formatDuration(metrics.average, true), message("history.answeredCalls", "{count} answered calls", { count: metrics.answered })],
    [message("history.transcripts", "Transcripts"), metrics.transcripts, ""],
  ];
  els.metrics.innerHTML = items.map(([label, value, detail]) => `<div class="metric"><span class="metric-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><span class="metric-detail">${escapeHtml(detail)}</span></div>`).join("");
}

function renderStatusNote() {
  if (state.view === "crm") { els.statusNote.hidden = true; els.statusNote.innerHTML = ""; return; }
  els.statusNote.hidden = false;
  if (!state.loading && !state.demoMode && !state.status?.authenticated && !["demo", "demo-fallback"].includes(state.source)) {
    els.statusNote.className = "status-note";
    els.statusNote.innerHTML = `<span>${messageMarkup("history.loginRequired", "Sign in required")}</span><button type="button" class="secondary-button" data-open-setup>${messageMarkup("history.setup", "Setup")}</button>`;
    els.statusNote.querySelector("[data-open-setup]")?.addEventListener("click", () => { state.view = "setup"; render(); });
    return;
  }
  if (state.error) {
    els.statusNote.className = "status-note is-error";
    els.statusNote.innerHTML = `<strong>${messageMarkup("history.errorPrefix", "Error.")}</strong><span>${escapeHtml(systemMessage(state.error))}</span>`;
    return;
  }

  if (state.loading) {
    els.statusNote.className = "status-note";
    els.statusNote.innerHTML = `<strong>${messageMarkup("history.loadingHistoryNote", "Loading Call History.")}</strong>`;
    return;
  }

  if (state.source === "callhistory-live" && state.pagination?.complete === false) {
    els.statusNote.className = "status-note is-warning";
    els.statusNote.innerHTML = messageMarkup("history.partialHistory", "The call list is incomplete. Narrow the period or refresh before using the totals.")
      + (state.invalidRecords ? messageMarkup("history.invalidDates", "Records without a valid date were excluded: {count}.", { count: state.invalidRecords }) : "");
    return;
  }

  if (state.invalidRecords) {
    els.statusNote.className = "status-note is-warning";
    els.statusNote.innerHTML = messageMarkup("history.invalidDates", "Records without a valid date were excluded: {count}.", { count: state.invalidRecords });
    return;
  }
  if (state.source === "callhistory-live") {
    els.statusNote.hidden = true;
    els.statusNote.innerHTML = "";
    return;
  }

  els.statusNote.className = "status-note is-warning";
  const title = state.source === "demo-fallback" ? message("history.demoFallbackActive", "Demo fallback active.") : message("history.demoActive", "Demo data active.");
  const reason = systemMessage(state.reason) || message("history.demoHint", "Synthetic call history with transcript examples.");
  els.statusNote.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(reason)}</span>`;
}

function partyCell(call) {
  const from = call.from || {};
  const to = call.to || {};
  return `
    <div class="party-stack" data-i18n-ignore>
      <strong data-i18n-ignore>${escapeHtml(from.name || from.number || message("history.unknown", "Unknown"))} → ${escapeHtml(to.name || to.number || message("history.unknown", "Unknown"))}</strong>
      <span data-i18n-ignore>${escapeHtml(from.number || "-")} → ${escapeHtml(to.number || "-")}</span>
    </div>
  `;
}

function internalAssignment(call) {
  const user = call?.user || {};
  return {
    queue: call?.queue?.name || call?.queue?.number || message("history.unrecognized", "Not identified"),
    extension: user.number || user.email || "-",
  };
}

function transcriptListLine(call) {
  const contact = call?.contact?.name || call?.contact?.company || "";
  const route = `${call?.from?.number || "-"} → ${call?.to?.number || "-"}`;
  return contact ? `${contact} · ${route}` : route;
}

let historyVisibleLimit = HISTORY_RENDER_LIMIT;
let transcriptVisibleLimit = TRANSCRIPT_RENDER_LIMIT;

function renderLimitNote(total, visible, label, view) {
  if (total <= visible) return "";
  return `
    <div class="render-limit-note">
      <strong>${escapeHtml(label)}</strong>
      <button type="button" class="secondary-button" data-load-more="${view}">${messageMarkup("history.showMore", "Show more")}</button>
      <span>${messageMarkup("history.visibleEntries", "{visible} of {total} entries", { visible, total })}</span>
    </div>
  `;
}

function renderCalls() {
  const visibleCalls = state.calls.slice(0, historyVisibleLimit);
  const unavailable = callDataState();
  els.historySubtitle.textContent = unavailable ? message(...unavailable)
    : message("history.listSummary", "{count} calls · {source} · Period: {range}", { count: state.calls.length, source: sourceLabel(), range: rangeLabel() });
  if (unavailable) {
    els.callsBody.innerHTML = `<div class="empty-state">${messageMarkup(...unavailable)}</div>`;
    return;
  }

  if (!state.calls.length) {
    els.callsBody.innerHTML = `
      <div class="empty-state">${messageMarkup(!state.demoMode && !state.status?.authenticated && !["demo", "demo-fallback"].includes(state.source) ? "history.loginRequired" : "history.noCalls", "No calls match the current filters.")}</div>
    `;
    return;
  }

  els.callsBody.innerHTML = `
    ${renderLimitNote(state.calls.length, visibleCalls.length, message("history.listView", "List view"), "history")}
    ${visibleCalls.map((call) => {
    const assignment = internalAssignment(call);
    return `
    <button class="history-row ${call.transcriptId ? "has-ai-badge" : ""} ${call.id === state.selectedCallId ? "is-selected" : ""}" type="button" data-i18n-ignore data-call-id="${escapeAttr(call.id)}" aria-label="${escapeAttr([formatDateTime(call.startedAt), directionLabel(call.direction), outcomeLabel(call.outcome), customerParty(call).name || customerParty(call).number].filter(Boolean).join(" · "))}" aria-pressed="${call.id === state.selectedCallId}">
      ${aiTranscriptBadge(call, "is-corner", false, true)}
      <span class="history-cell">
        <span class="time-cell">
          <strong>${escapeHtml(formatDateTime(call.startedAt))}</strong>
          <span>${escapeHtml(formatDuration(call.durationSeconds))}</span>
        </span>
      </span>
      <span class="history-cell">
        <div class="call-state-cell">
          ${directionBadge(call)}
          ${outcomeBadge(call)}
        </div>
      </span>
      <span class="history-cell">${partyCell(call)}</span>
      <span class="history-cell" data-label="${escapeAttr(message("history.queue", "Queue"))}">
        <div class="user-stack">
          <strong data-i18n-ignore>${escapeHtml(assignment.queue)}</strong>
        </div>
      </span>
      <span class="history-cell" data-label="${escapeAttr(message("history.extension", "Extension"))}">
        <div class="user-stack">
          <strong data-i18n-ignore>${escapeHtml(assignment.extension)}</strong>
        </div>
      </span>
    </button>
  `;
  }).join("")}
  `;
  fitVisibleTranscriptPopovers();
}

function transcriptErrorMarkup(call) {
  const failure = state.selectedCallId === call?.id && state.transcript?.ok === false ? state.transcript : null;
  if (!failure) return "";
  return `<p class="transcript-error" role="status">${messageMarkup("history.transcriptUnavailable", "Transcript unavailable")}: <span data-i18n-ignore>${escapeHtml(systemMessage(failure.error || "Transcript content is not available for this call."))}</span></p>`;
}

function renderDetail() {
  const call = selectedCall();
  if (!call) {
    els.detailSubtitle.textContent = message("history.noSelection", "No call selected");
    els.callDetail.innerHTML = `<div class="empty-state">${messageMarkup("history.selectCall", "Select a call from the call list.")}</div>`;
    return;
  }

  els.detailSubtitle.textContent = `${formatDateTime(call.startedAt)} · ${directionLabel(call.direction)} · ${outcomeLabel(call.outcome)}`;
  const transcript = cachedTranscriptForCall(call);
  const transcriptSummary = callSummaryContent(call);
  const transcriptText = callTranscriptText(call);
  const assignee = transcript?.assignee || call.user;
  const assignment = internalAssignment({ ...call, user: { ...assignee, ...call.user } });
  const transcriptSection = transcriptSummary || transcriptText ? `
    <div class="detail-section">
      <h3>${messageMarkup("history.summary", "Summary")}</h3>
      ${transcriptSummary ? `<p data-i18n-ignore>${escapeHtml(transcriptSummary)}</p>` : ""}
      ${transcriptText ? `<div class="transcript-text" data-i18n-ignore>${escapeHtml(transcriptText)}</div>` : ""}
      <div class="copy-actions">
        ${transcriptSummary ? `<button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(call.id)}" data-copy-kind="summary">${messageMarkup("history.copySummary", "Copy summary")}</button>` : ""}
        ${transcriptText ? `<button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(call.id)}" data-copy-kind="transcript">${messageMarkup("history.copyTranscript", "Copy transcript")}</button>` : ""}
      </div>
    </div>
  ` : "";

  els.callDetail.innerHTML = `
    <div class="call-route">
      <div class="party-card">
        <span>${messageMarkup("history.from", "From")}</span>
        <strong data-i18n-ignore>${escapeHtml(call.from?.name || message("history.unknown", "Unknown"))}</strong>
        <p data-i18n-ignore>${escapeHtml(call.from?.number || "-")}</p>
      </div>
      <div class="route-arrow">→</div>
      <div class="party-card">
        <span>${messageMarkup("history.to", "To")}</span>
        <strong data-i18n-ignore>${escapeHtml(call.to?.name || message("history.unknown", "Unknown"))}</strong>
        <p data-i18n-ignore>${escapeHtml(call.to?.number || "-")}</p>
      </div>
    </div>

    ${transcriptErrorMarkup(call)}
    ${transcriptSection}

    <div class="detail-section">
      <h3>${messageMarkup("history.assignment", "Assignment")}</h3>
      <div class="assignment-grid">
        <div class="assignment-card">
          <span>${messageMarkup("history.queue", "Queue")}</span>
          <strong data-i18n-ignore>${escapeHtml(assignment.queue || message("history.open", "Open"))}</strong>
          <p>${messageMarkup("history.internalContext", "Internal context")}</p>
        </div>
        <div class="assignment-card">
          <span>${messageMarkup("history.extension", "Extension")}</span>
          <strong data-i18n-ignore>${escapeHtml(assignment.extension)}</strong>
          <p>${messageMarkup("history.userExtension", "User extension")}</p>
        </div>
      </div>
    </div>
  `;
}

function renderTranscripts() {
  const unavailable = callDataState();
  if (unavailable) {
    els.transcriptGrid.innerHTML = `<div class="empty-state">${messageMarkup(...unavailable)}</div>`;
    return;
  }
  const transcriptCalls = state.calls.filter((call) => call.transcriptId);
  if (!transcriptCalls.length) {
    els.transcriptGrid.innerHTML = `<div class="empty-state">${messageMarkup("history.noTranscriptCalls", "No calls with transcripts match the current filters.")}</div>`;
    return;
  }
  const visibleTranscriptCalls = transcriptCalls.slice(0, transcriptVisibleLimit);
  const selectedTranscript = transcriptCalls.find((call) => call.id === state.selectedTranscriptCallId) || null;
  const summary = selectedTranscript ? callSummaryContent(selectedTranscript) : "";
  const transcriptText = selectedTranscript ? callTranscriptText(selectedTranscript) : "";

  els.transcriptGrid.innerHTML = `
    <div class="transcript-list" aria-label="${escapeAttr(message("history.transcripts", "Transcripts"))}" data-i18n-aria-label="history.transcripts">
      ${renderLimitNote(transcriptCalls.length, visibleTranscriptCalls.length, message("history.transcriptList", "Transcript list"), "transcripts")}
      ${visibleTranscriptCalls.map((call) => {
        return `
          <button class="transcript-list-row ${call.id === selectedTranscript?.id ? "is-selected" : ""}" type="button" data-i18n-ignore data-call-id="${escapeAttr(call.id)}">
            <span>
              <strong data-i18n-ignore>${escapeHtml(call.contact?.company || customerParty(call).name || message("history.call", "Call"))}</strong>
              <small data-i18n-ignore>${escapeHtml(transcriptListLine(call))}</small>
            </span>
            <span>${escapeHtml(formatDateTime(call.startedAt))}</span>
            <span class="chip is-${escapeAttr(call.direction)}">${escapeHtml(directionLabel(call.direction))}</span>
          </button>
        `;
      }).join("")}
    </div>
    ${selectedTranscript ? `
      <article class="transcript-detail-card">
      <div class="panel-header">
        <div>
          <h3 data-i18n-ignore>${escapeHtml(selectedTranscript.contact?.company || customerParty(selectedTranscript).name || message("history.transcript", "Transcript"))}</h3>
          <p class="panel-subtitle" data-i18n-ignore>${escapeHtml(transcriptListLine(selectedTranscript))}</p>
        </div>
      </div>
      ${transcriptErrorMarkup(selectedTranscript)}
      <div class="transcript-preview">
        ${summary ? `<h3>${messageMarkup("history.summary", "Summary")}</h3>
        <p data-i18n-ignore>${escapeHtml(summary)}</p>
        <div class="copy-actions">
          <button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(selectedTranscript.id)}" data-copy-kind="summary">${messageMarkup("history.copySummary", "Copy summary")}</button>
        </div>` : ""}
        <h3>${messageMarkup("history.transcript", "Transcript")}</h3>
        <p class="transcript-preview-text" data-i18n-ignore>${escapeHtml(transcriptText || message("history.selectToLoadTranscript", "Select to load the full transcript, then copy its text."))}</p>
        <div class="copy-actions">
          <button class="secondary-button" type="button" data-copy-call-id="${escapeAttr(selectedTranscript.id)}" data-copy-kind="transcript">${messageMarkup("history.copyTranscript", "Copy transcript")}</button>
        </div>
        <p class="transcript-meta">${messageMarkup("history.transcriptId", "Transcript ID: {id}", { id: selectedTranscript.transcriptId })}</p>
      </div>
      </article>
    ` : `<article class="transcript-detail-card is-empty"><div class="empty-state">${messageMarkup("history.selectTranscript", "Select a transcript from the list.")}</div></article>`}
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
    els.setupStatus.innerHTML = `<div class="empty-state">${messageMarkup("history.loadingConfiguration", "Loading configuration.")}</div>`;
    els.redirectStatus.innerHTML = "";
    return;
  }

  if (window.NFON_WEB_ONLY_DEMO || window.location.protocol === "file:") {
    els.setupStatus.innerHTML = `<p>${messageMarkup("history.demoData", "Demo data")}</p>`;
    const hint = document.querySelector('[data-i18n-key="history.configurationHint"]');
    if (hint) hint.hidden = true;
    els.redirectStatus.innerHTML = "";
    return;
  }

  els.setupStatus.innerHTML = [
    statusField("OAuth", status.oauthConfigured, status.oauthConfigured ? message("history.pkceConfigured", "PKCE login configured") : message("history.clientIdMissing", "CALLHISTORY_CLIENT_ID missing")),
    statusField(message("history.apiEndpoint", "API endpoint"), status.historyConfigured, status.historyConfigured ? message("history.configured", "Configured") : message("history.endpointMissing", "CALLHISTORY_API_BASE_URL / CALLS_PATH missing")),
    statusField(message("history.recordDetails", "Record details"), status.transcriptsConfigured, status.transcriptsConfigured ? "GET /records/{uuid}" : message("history.optionalUnset", "Optional, not set")),
    statusField(message("history.credentialsSource", "Credentials source"), true, status.settings?.browserCredentialsActive ? message("history.browserConfig", "Browser configuration") : message("history.localConfig", "Local configuration")),
    statusField("Token", status.authenticated, status.authenticated ? message("history.serverToken", "Available on the server") : message("history.notConnected", "Not connected")),
  ].join("");

  els.redirectStatus.innerHTML = `
    <div class="setup-field is-ok">
      <span>${messageMarkup("history.callbackUrl", "Callback URL")}</span>
      <strong><code>${escapeHtml(status.redirectUri || message("history.notSet", "Not set"))}</code></strong>
    </div>
    <div class="setup-field">
      <span>${messageMarkup("history.standalone", "Standalone mode")}</span>
      <strong>${messageMarkup("history.standaloneCommand", "npm start in the CallHistory_API folder")}</strong>
    </div>
    <div class="setup-field">
      <span>${messageMarkup("history.portContract", "Local ports")}</span>
      <strong>${messageMarkup("history.portHint", "Call History uses local port 3000; Portal and CTI run alongside it.")}</strong>
    </div>
  `;
}

// Retain the actual setup form during refresh so typing and focus survive.
function replaceContentPreservingForm(container, markup, selector) {
  const form = container.querySelector(selector);
  const focused = form?.contains(document.activeElement) ? document.activeElement : null;
  const selection = focused && typeof focused.selectionStart === "number"
    ? [focused.selectionStart, focused.selectionEnd, focused.selectionDirection] : null;
  container.innerHTML = markup;
  const replacement = container.querySelector(selector);
  if (!form || !replacement) return;
  replacement.replaceWith(form);
  if (focused) {
    focused.focus({ preventScroll: true });
    if (selection) focused.setSelectionRange(...selection);
  }
}

function renderAuthLoginPanel() {
  if (!els.authLoginPanel) return;
  const status = state.status || {};
  if (window.NFON_WEB_ONLY_DEMO || window.location.protocol === "file:") { els.authLoginPanel.hidden = true; els.authLoginPanel.innerHTML = ""; return; }
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
  replaceContentPreservingForm(els.authLoginPanel, `
    <div class="auth-login-head">
      <div>
        <h2>${messageMarkup("history.signIn", "Sign in")}</h2>
        <p>${messageMarkup("history.signInHint", "Configure Call History access, then sign in with a Cloudya account.")}</p>
      </div>
      <span class="auth-login-state ${authStateClass}">${status.authenticated ? message("history.oauthConnected", "OAuth connected") : status.oauthConfigured ? message("history.oauthReady", "OAuth ready") : message("history.loginRequired", "Sign in required")}</span>
    </div>
    <div class="auth-login-body">
      <div class="auth-mode-switch" role="tablist" data-i18n-aria-label="history.signInMethod" aria-label="${escapeAttr(message("history.signInMethod", "Sign-in method"))}">
        <button class="${envActive ? "is-active" : ""}" type="button" data-auth-mode="env">${messageMarkup("history.envLogin", "Sign in via .env")}</button>
        <button class="${browserActive ? "is-active" : ""}" type="button" data-auth-mode="browser">${messageMarkup("history.browserLogin", "Sign in via browser")}</button>
      </div>
      ${envActive ? `
        <section class="auth-login-card is-active">
          <span>${messageMarkup("history.localConfig", "Local configuration")}</span>
          <h3>${messageMarkup("history.localConfig", "Local configuration")}</h3>
          <p>${messageMarkup("history.envFileHint", "A .env file in CallHistory_API is loaded automatically when the server starts.")}</p>
          <pre>${escapeHtml(envExample)}</pre>
          <p>${messageMarkup("history.defaultEndpointsHint", "Auth URL, token URL, scope and Call History endpoints are preset. The default local redirect is http://localhost:3000.")}</p>
        </section>
      ` : `
        <form class="auth-login-card browser-login-form" id="callhistory-browser-login-form">
          <span>${messageMarkup("history.browserConfig", "Browser configuration")}</span>
          <h3>${messageMarkup("history.sessionCredentials", "Set credentials for this session")}</h3>
          <div class="auth-form-grid">
            <label>Client ID <small>${messageMarkup("history.clientIdRequired", "Required for OAuth sign-in")}</small><input name="clientId" type="text" autocomplete="username" required></label>
            <label>Redirect URI <small>${messageMarkup("history.redirectHint", "Leave empty for localhost:3000")}</small><input name="redirectUri" type="url" value="${escapeAttr(status.redirectUri || "http://localhost:3000")}" placeholder="http://localhost:3000"></label>
          </div>
          <div class="auth-form-actions">
            <button class="primary-button" type="submit">${messageMarkup("history.setCredentials", "Set credentials")}</button>
            <span>${messageMarkup("history.startLoginHint", "Then start NFON OAuth sign-in using the sign-in button.")}</span>
          </div>
        </form>
      `}
      <section class="auth-login-card auth-cloudya-login">
        <span>${messageMarkup("history.cloudyaLogin", "Cloudya sign-in")}</span>
        <h3>${messageMarkup("history.cloudyaSignIn", "Sign in with a Cloudya account")}</h3>
        <p>${messageMarkup("history.cloudyaHint", "Once configured, OAuth connects this local showcase app to a Cloudya account.")}</p>
        <div class="auth-setup-actions">
          <a class="primary-button auth-link ${status.oauthConfigured && !status.authenticated ? "is-primary" : ""}" id="auth-login" href="/auth/login" ${!status.oauthConfigured || status.authenticated ? "hidden" : ""}>${messageMarkup("history.startLogin", "Start sign-in")}</a>
          <button class="secondary-button auth-link" id="auth-logout" type="button" ${status.authenticated ? "" : "hidden"}>${messageMarkup("history.signOut", "Sign out")}</button>
        </div>
      </section>
      ${state.authLoginMessage ? `<p class="form-message success">${messageMarkup(state.authLoginMessage, state.authLoginMessage === "history.settingConfiguration" ? "Applying configuration" : "Browser configuration is set for this session. Sign-in is ready.")}</p>` : ""}
      ${state.authLoginError ? `<p class="form-message error">${escapeHtml(systemMessage(state.authLoginError))}</p>` : ""}
    </div>
  `, "#callhistory-browser-login-form");
  const loginLink = document.getElementById("auth-login");
  const cockpit = window.NFON_APPEARANCE?.getCockpitUrl?.() || "";
  if (loginLink) loginLink.href = "/auth/login?" + new URLSearchParams({
    theme: document.documentElement.dataset.nfonTheme === "classic" ? "classic" : "admin-portal",
    lang: window.NFON_I18N?.getLanguage?.() || "en",
    ...(cockpit ? { cockpit } : {}),
  });
}

async function submitCallHistoryBrowserLogin(form) {
  const request = beginStatusRequest();
  state.authLoginMessage = "history.settingConfiguration";
  state.authLoginError = "";
  renderAuthLoginPanel();
  const data = new FormData(form);
  try {
    const result = await apiJson("/api/settings/browser-login", {
      method: "POST",
      body: JSON.stringify(Object.fromEntries(data.entries())),
    });
    if (!adoptStatus(result.status, request)) return;
    state.authLoginMessage = "history.configurationSet";
    await loadAll();
  } catch (error) {
    if (!isCurrentStatusRequest(request, error)) return;
    state.authLoginMessage = "";
    state.authLoginError = error.message;
    renderAuthLoginPanel();
  }
}

let crmParentPaused = false;

// The fixed showcase receives presentation/visibility only, never history or session data.
function renderCrmDemo() {
  const frame = document.getElementById("crm-demo-frame");
  if (!frame) return;
  const theme = document.documentElement.dataset.nfonTheme === "classic" ? "classic" : "admin-portal";
  const lang = window.NFON_I18N?.getLanguage?.() || document.documentElement.lang || "en";
  if (!frame.getAttribute("src")) {
    frame.src = `./crm-demo/${window.location.protocol === "file:" ? "offline.html" : "index.html"}?${new URLSearchParams({ theme, lang })}`;
  } else {
    frame.contentWindow?.postMessage({ type: "nfon:crm-demo:appearance", theme, lang, active: state.view === "crm" && !crmParentPaused }, "*");
  }
}

function receiveCrmDemoMessage(event) {
  const frame = document.getElementById("crm-demo-frame");
  if (!frame || event.source !== frame.contentWindow || ![window.location.origin, "null"].includes(event.origin)) return;
  if (event.data?.type === "nfon:crm-demo:ready") renderCrmDemo();
  if (event.data?.type === "nfon:crm-demo:height" && Number.isFinite(event.data.height)) {
    frame.style.height = Math.max(600, Math.min(20000, Math.ceil(event.data.height))) + "px";
  }
}

function renderView() {
  const frame = document.getElementById("crm-demo-frame");
  frame?.contentWindow?.postMessage({ type: "nfon:crm-demo:visibility", active: state.view === "crm" && !crmParentPaused }, "*");
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("is-active", view.id === `view-${state.view}`);
  });
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.view === state.view);
  });
  if (els.filterPanel) {
    els.filterPanel.hidden = state.view === "setup" || state.view === "crm";
  }
}

function persistFilters() {
  storeValue("callhistory-filters", JSON.stringify(state.filters));
}

function setSelectedCall(callId) {
  if (!callId || state.selectedCallId === callId) return;
  copyRequestSequence += 1;
  state.selectedCallId = callId;
  state.transcript = null;

  render();
  focusCallSelection(callId);
  loadSelectedTranscript();
}

function focusCallSelection(callId, transcript = false) {
  const selector = transcript ? ".transcript-list-row" : ".history-row";
  const row = [...document.querySelectorAll(selector)].find(node => node.dataset.callId === callId);
  row?.focus({ preventScroll: true });
  const panel = document.querySelector(transcript ? ".transcript-detail-card" : ".detail-panel");
  if (panel && window.matchMedia?.("(max-width: 1439px)").matches) {
    panel.onkeydown = event => {
      if (event.key === "Tab" && event.shiftKey && event.target === panel) {
        event.preventDefault();
        [...document.querySelectorAll(selector)].find(node => node.dataset.callId === callId)?.focus();
      }
    };
    panel.tabIndex = -1; panel.focus({ preventScroll: true }); panel.scrollIntoView({ block: "start", behavior: "auto" });
  }
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
  const sequence = ++copyRequestSequence;
  const call = state.calls.find((item) => item.id === callId);
  if (!call) return false;
  const generation = callDataGeneration;
  const cacheKey = transcriptCacheKey(call.transcriptId);
  const source = requestedCallSource();
  const selection = { call: state.selectedCallId, transcript: state.selectedTranscriptCallId, view: state.view };
  const isCurrentAction = () => sequence === copyRequestSequence
    && selection.call === state.selectedCallId && selection.transcript === state.selectedTranscriptCallId
    && selection.view === state.view;
  const isCurrentRequest = () => isCurrentAction() && generation === callDataGeneration
    && source === requestedCallSource() && cacheKey === transcriptCacheKey(call.transcriptId);
  if (call.transcriptId && !cachedTranscriptForCall(call)) {
    let transcript;
    try {
      transcript = await apiJson(`/api/transcripts/${encodeURIComponent(call.transcriptId)}?mode=${state.demoMode ? "demo" : "live"}`, {}, isCurrentRequest);
    } catch (error) {
      // An otherwise current 401 invalidates its own generation. Report that
      // login error, but discard failures from a previously cleared context.
      const invalidatedHere = isCurrentAction() && error.invalidatedCallDataGeneration === generation
        && callDataGeneration === generation + 1 && source === requestedCallSource()
        && cacheKey === transcriptCacheKey(call.transcriptId);
      if (!isCurrentRequest() && !invalidatedHere) return false;
      throw error;
    }
    if (!isCurrentRequest()) return false;
    if (!transcript.ok) throw new Error(message("history.transcriptContentUnavailable", "Transcript content is not available for this call."));
    state.transcriptCache.set(cacheKey, transcript);
  }
  if ((kind === "summary" && !callSummaryContent(call)) || (kind !== "summary" && !callTranscriptText(call))) {
    throw new Error(message("history.transcriptContentUnavailable", "Transcript content is not available for this call."));
  }
  const payload = copyPayload(call, kind);
  // Serialize native writes too: a write already accepted by the browser cannot
  // be cancelled, but it must complete before a newer successful copy writes.
  const write = copyWriteQueue.then(async () => {
    if (!isCurrentRequest()) return false;
    try { await copyToClipboard(payload); }
    catch (error) { if (!isCurrentRequest()) return false; throw error; }
    return isCurrentRequest();
  });
  copyWriteQueue = write.catch(() => {});
  return write;
}

function bindEvents() {
  const fitHoveredSummary = event => fitTranscriptPopover(event.target.closest?.(".ai-transcript-badge"));
  document.addEventListener("pointerover", fitHoveredSummary);
  document.addEventListener("focusin", fitHoveredSummary);
  document.addEventListener("scroll", fitVisibleTranscriptPopovers, true);
  window.addEventListener("resize", fitVisibleTranscriptPopovers);
  window.visualViewport?.addEventListener("resize", fitVisibleTranscriptPopovers);
  window.visualViewport?.addEventListener("scroll", fitVisibleTranscriptPopovers);
  els.refresh.addEventListener("click", loadAll);
  els.demoToggle?.addEventListener("change", () => {
    state.demoMode = els.demoToggle.checked;
    storeValue("callhistory-demo-mode", state.demoMode ? "1" : "0");
    clearCallData();
    loadCalls();
  });

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
  els.transcriptFilter.addEventListener("change", () => {
    state.filters.transcript = els.transcriptFilter.value;
    persistFilters();
    loadCalls();
  });
  let partyTimer = 0;
  els.partyFilter.addEventListener("input", () => {
    filterDrafts.party = els.partyFilter.value;
    clearTimeout(partyTimer);
    partyTimer = setTimeout(() => {
      state.filters.party = filterDrafts.party.trim();
      filterDrafts.party = null;
      persistFilters();
      loadCalls();
    }, 220);
  });

  let queueTimer = 0;
  els.queueFilter.addEventListener("input", () => {
    filterDrafts.queue = els.queueFilter.value;
    clearTimeout(queueTimer);
    queueTimer = setTimeout(() => {
      state.filters.queue = filterDrafts.queue.trim();
      filterDrafts.queue = null;
      persistFilters();
      loadCalls();
    }, 220);
  });

  document.addEventListener("click", (event) => {
    const more = event.target.closest("[data-load-more]");
    if (more) {
      const view = more.dataset.loadMore;
      const previous = view === "history" ? historyVisibleLimit : transcriptVisibleLimit;
      if (view === "history") { historyVisibleLimit += HISTORY_RENDER_LIMIT; renderCalls(); }
      else { transcriptVisibleLimit += TRANSCRIPT_RENDER_LIMIT; renderTranscripts(); }
      const container = view === "history" ? els.callsBody : els.transcriptGrid;
      container.querySelectorAll("[data-call-id]")[previous]?.focus({ preventScroll: false });
      return;
    }
    const viewButton = event.target.closest("[data-view]");
    if (viewButton) {
      const nextView = viewButton.dataset.view;
      if (state.view === nextView) return;
      copyRequestSequence += 1;
      state.view = nextView;
      storeValue("callhistory-view", state.view);
      render();
      if (state.view === "history" || state.view === "transcripts") loadCalls();
      return;
    }
    const copyButton = event.target.closest("[data-copy-call-id]");
    if (copyButton) {
      const originalText = copyButton.textContent;
      copyCallPart(copyButton.dataset.copyCallId, copyButton.dataset.copyKind || "all")
        .then((copied) => {
          if (!copied) return;
          copyButton.textContent = message("history.copied", "Copied");
          showCopyToast(message("history.copiedToClipboard", "Copied to clipboard"));
          setTimeout(() => { copyButton.textContent = originalText; }, 1200);
        })
        .catch((error) => {
          copyButton.textContent = message("history.notCopied", "Not copied");
          copyButton.title = error.message;
        });
      return;
    }

    const callTarget = event.target.closest("[data-call-id]");
    if (callTarget) {
      if (callTarget.closest(".transcript-list")) {
        if (state.selectedTranscriptCallId !== callTarget.dataset.callId || state.selectedCallId !== callTarget.dataset.callId) copyRequestSequence += 1;
        state.selectedTranscriptCallId = callTarget.dataset.callId;
        if (state.selectedCallId !== callTarget.dataset.callId) {
          state.selectedCallId = callTarget.dataset.callId;
          state.transcript = null;

        }
        render();
        focusCallSelection(callTarget.dataset.callId, true);
        loadSelectedTranscript();
        return;
      }
      setSelectedCall(callTarget.dataset.callId);
      return;
    }

    if (state.view === "transcripts" && state.selectedTranscriptCallId) {
      const transcriptArea = event.target.closest("#view-transcripts");
      const protectedTarget = event.target.closest(".transcript-list-row, .transcript-detail-card, [data-copy-call-id]");
      if (transcriptArea && !protectedTarget) {
        copyRequestSequence += 1;
        state.selectedTranscriptCallId = "";
        state.transcript = null;
        renderTranscripts();
        return;
      }
    }

  });
  document.addEventListener("keydown", (event) => {
    const row = event.target.closest(".history-row[data-call-id]");
    if (row && (event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      setSelectedCall(row.dataset.callId);
    }
  });
  window.addEventListener("message", receiveCrmDemoMessage);
  document.addEventListener("nfon:demo-pause", event => { crmParentPaused = event.detail?.paused === true; renderView(); });
  if (els.authLoginPanel) {
    els.authLoginPanel.addEventListener("click", (event) => {
      const logout = event.target.closest("#auth-logout");
      if (logout) {
        const request = beginStatusRequest();
        apiJson("/api/auth/logout", { method: "POST" })
          .then(() => { if (!isCurrentStatusRequest(request)) return; clearCallData(); return loadAll(); })
          .catch((error) => {
            if (!isCurrentStatusRequest(request, error)) return;
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
      storeValue("callhistory-auth-login-mode", state.authLoginMode);
      renderAuthLoginPanel();
    });
    els.authLoginPanel.addEventListener("submit", (event) => {
      if (!event.target.matches("#callhistory-browser-login-form")) return;
      event.preventDefault();
      submitCallHistoryBrowserLogin(event.target);
    });
  }
}

function refreshLocalizedView() {
  const focused = document.activeElement;
  const selection = focused && typeof focused.selectionStart === "number"
    ? { start: focused.selectionStart, end: focused.selectionEnd, direction: focused.selectionDirection } : null;
  const forms = [...document.querySelectorAll("form[id]")].map((form) => ({ form, id: form.id }));
  const expanded = [...document.querySelectorAll("details")].map((detail) => detail.open);
  // In-progress filter typing may not yet have reached the debounce callback.
  const partyValue = els.partyFilter.value;
  const queueValue = els.queueFilter.value;
  render();
  forms.forEach(({ form, id }) => {
    const replacement = document.getElementById(id);
    if (replacement && replacement !== form) replacement.replaceWith(form);
  });
  document.querySelectorAll("details").forEach((detail, index) => { detail.open = expanded[index] || false; });
  els.partyFilter.value = partyValue;
  els.queueFilter.value = queueValue;
  window.NFON_I18N?.refresh?.();
  if (focused?.isConnected) {
    focused.focus({ preventScroll: true });
    if (selection) focused.setSelectionRange(selection.start, selection.end, selection.direction);
  }
}

document.addEventListener("nfon:language-change", refreshLocalizedView);
document.addEventListener("nfon:theme-change", () => {
  if (state.view === "crm") renderCrmDemo();
  fitVisibleTranscriptPopovers();
});

if (new URLSearchParams(window.location.search).get("auth") === "failed") {
  state.view = "setup";
  state.authLoginError = "Login with NFON is required for live call history";
  try { const url = new URL(window.location.href); url.searchParams.delete("auth"); window.history.replaceState(window.history.state, "", url.href); } catch { /* Optional history. */ }
}
bindEvents();
loadAll();
