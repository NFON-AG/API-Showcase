function msg(key, fallback, params = {}) {
  return window.NFON_I18N?.message(key, params) || fallback.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
}

const STATIC_DEMO = Boolean(window.NFON_LANDING_DEMO);
const request = (path, options) => STATIC_DEMO ? window.NFON_LANDING_DEMO.request(path, options) : fetch(path, options);

const SHOWCASES = [
  {
    id: "cti",
    route: STATIC_DEMO ? "./cti/index.html" : "/cti/",
    name: "NFON CTI API",
    nameLines: ["NFON CTI", "API"],
    get source() { return msg("landing.sourceCti", "Live telephony"); },
    get scope() { return msg("landing.tenantScope", "Tenant level"); },
    get purpose() { return msg("landing.purposeCti", "Presence, extensions, click-to-dial and active calls in one dashboard."); },
    focus: "Realtime",
    index: "01",
    tone: "green",
  },
  {
    id: "portal",
    route: STATIC_DEMO ? "./portal/index.html" : "/portal/",
    name: "NFON Portal API",
    nameLines: ["NFON Portal", "API"],
    get source() { return msg("landing.sourcePortal", "PBX administration"); },
    get scope() { return msg("landing.tenantScope", "Tenant level"); },
    get purpose() { return msg("landing.purposePortal", "Phone numbers, devices, routing objects and call flow context from the portal."); },
    focus: "Inventory",
    index: "02",
    tone: "blue",
  },
  {
    id: "core-history",
    route: STATIC_DEMO ? "./call-history/index.html" : "/call-history/",
    name: "NFON Call History API",
    nameLines: ["NFON Call History", "API"],
    get source() { return msg("landing.sourceHistory", "Call history"); },
    get scope() { return msg("landing.userScope", "User level"); },
    get purpose() { return msg("landing.purposeHistory", "Login, call lists, transcripts and CRM mapping for completed calls."); },
    focus: "History",
    index: "03",
    tone: "purple",
  },
];

const HEALTH_LABELS = {
  'auth-required': () => msg('shared.authRequired', 'Sign in required'),
  online: () => STATIC_DEMO ? msg("demo.landing.active", "Demo active") : msg("landing.live", "Live"),
  warning: () => STATIC_DEMO ? msg("demo.landing.ready", "Demo ready") : msg("landing.limited", "Limited"),
  offline: () => STATIC_DEMO ? msg("demo.landing.paused", "Demo paused") : msg("landing.error", "Error"),
  checking: () => STATIC_DEMO ? msg("demo.landing.checking", "Checking demo") : msg("landing.sync", "Checking"),
};

const GATEWAY_LABELS = {
  'auth-required': () => msg('shared.authRequired', 'Sign in required'),
  online: () => msg("landing.gatewayLive", "Gateway online"),
  warning: () => msg("landing.gatewayWarning", "Gateway partially available"),
  offline: () => msg("landing.gatewayOffline", "Gateway offline"),
  checking: () => msg("landing.gatewayChecking", "Checking gateway"),
};

const els = {
  apiCards: document.getElementById("api-cards"),
  connection: document.getElementById("connection-state"),
  headerSubline: document.getElementById("header-subline"),
};

const state = {
  selectedId: routeToShowcaseId(window.location.pathname),
  gatewayHealth: "checking",
  services: {},
  actions: {},
  actionErrors: {},
  serviceControl: false,
  csrfToken: "",
  editing: null,
  drafts: {},
  editErrors: {},
};

let ekgId = 0;

function routeToShowcaseId(pathname) {
  if (pathname.startsWith("/portal")) return "portal";
  if (pathname.startsWith("/core-history")) return "core-history";
  if (pathname.startsWith("/call-history")) return "core-history";
  if (pathname.startsWith("/cti")) return "cti";
  return "";
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function shortUpstream(value) {
  if (!value) return "";
  return String(value).replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function draftFor(item) {
  if (Object.hasOwn(state.drafts, item.id)) return state.drafts[item.id];
  return serviceFor(item).upstream || "";
}

function serviceFor(item) {
  return state.services[item.id] || {
    health: "checking",
    detail: msg("landing.checking", "Checking status."),
    route: item.route,
    checkedAt: "",
  };
}

function selectedShowcase() {
  return SHOWCASES.find((item) => item.id === state.selectedId) || null;
}

function formatCheckTime(value) {
  if (!value || !Number.isFinite(new Date(value).getTime())) return msg("landing.pending", "pending");
  return new Intl.DateTimeFormat((window.NFON_I18N?.languages.find((entry) => entry.code === window.NFON_I18N.getLanguage())?.locale || "en-GB"), {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));
}

function renderMiniEkg() {
  ekgId += 1;
  const maskId = `ekg-mask-${ekgId}`;
  const gradientId = `ekg-gradient-${ekgId}`;

  return `
    <svg class="mini-ekg" viewBox="0 0 86 24" preserveAspectRatio="none" focusable="false" aria-hidden="true">
      <defs>
        <linearGradient id="${gradientId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="#fff" stop-opacity="0"></stop>
          <stop offset="40%" stop-color="#fff" stop-opacity="0.18"></stop>
          <stop offset="72%" stop-color="#fff" stop-opacity="0.64"></stop>
          <stop offset="100%" stop-color="#fff" stop-opacity="1"></stop>
        </linearGradient>
        <mask id="${maskId}" maskUnits="userSpaceOnUse" x="0" y="0" width="86" height="24">
          <rect class="ekg-mask-window" x="0" y="0" width="34" height="24" fill="url(#${gradientId})"></rect>
        </mask>
      </defs>
      <path class="ekg-signal" mask="url(#${maskId})" d="M0 13 H18 L23 8 L29 13 H40 L45 3 L52 21 L58 13 H86"></path>
      <path class="ekg-flatline" d="M0 13 H86"></path>
    </svg>
  `;
}

function renderTitle(item) {
  return (item.nameLines || [item.name])
    .map((line) => `<span>${escapeHtml(line)}</span>`)
    .join(" ");
}

function renderHeader() {
  const selected = selectedShowcase();
  const health = state.gatewayHealth || "checking";
  els.connection.className = STATIC_DEMO ? 'connection' : `connection is-${health}`;
  els.connection.setAttribute('data-status-mode', STATIC_DEMO ? 'demo' : 'gateway');
  els.connection.textContent = STATIC_DEMO ? 'Demo' : (GATEWAY_LABELS[health] || GATEWAY_LABELS.checking)();
  const gatewayLabel = STATIC_DEMO ? (health === 'offline' ? msg('demo.landing.unavailable','Demo unavailable') : health === 'checking' ? msg('demo.landing.checking','Checking demo') : msg('demo.landing.ready','Demo ready')) : (GATEWAY_LABELS[health] || GATEWAY_LABELS.checking)();
  els.connection.setAttribute('aria-label', gatewayLabel);
  els.connection.title = gatewayLabel;
  els.headerSubline.textContent = selected
    ? `${selected.name} · ${selected.route}`
    : STATIC_DEMO ? msg("demo.landing.subtitle", "Local interactive demo") : msg("landing.gateway", "Local showcase gateway");
}

function startButtonLabel(item, health) {
  if (serviceFor(item).managedElsewhere) return msg("landing.stopPrevious", "Stop previous server");
  if (STATIC_DEMO) {
    if (state.actions[item.id] === 'starting') return msg('demo.landing.resuming','Resuming demo');
    if (state.actions[item.id] === 'stopping') return msg('demo.landing.pausing','Pausing demo');
    if (state.actions[item.id] === 'error') return msg('landing.retry','Try again');
    if (health === 'offline') return msg('demo.landing.resume','Resume demo');
    if (health === 'checking') return msg('demo.landing.checking','Checking demo');
    return msg('demo.landing.pause','Pause demo');
  }
  const actionState = state.actions[item.id];
  if (actionState === "starting") return msg("landing.starting", "Starting server");
  if (actionState === "stopping") return msg("landing.stopping", "Stopping server");
  if (actionState === "error") return msg("landing.retry", "Try again");
  if (health === "offline") return msg("landing.start", "Start server");
  if (health === "checking") return msg("landing.checkServer", "Checking server");
  return msg("landing.stop", "Stop server");
}

function hoverButtonLabel(item, health) {
  if (serviceFor(item).managedElsewhere) return msg("landing.stopPrevious", "Stop previous server");
  if (STATIC_DEMO) {
    if (state.actions[item.id] === 'starting') return msg('demo.landing.resuming','Resuming demo');
    if (state.actions[item.id] === 'stopping') return msg('demo.landing.pausing','Pausing demo');
    if (state.actions[item.id] === 'error') return msg('landing.retry','Try again');
    if (health === 'offline') return msg('demo.landing.resume','Resume demo');
    if (health === 'checking') return msg('demo.landing.checking','Checking demo');
    return msg('demo.landing.pause','Pause demo');
  }
  const actionState = state.actions[item.id];
  if (actionState === "starting") return msg("landing.starting", "Starting server");
  if (actionState === "stopping") return msg("landing.stopping", "Stopping server");
  if (actionState === "error") return msg("landing.retry", "Try again");
  if (health === "offline") return msg("landing.start", "Start server");
  if (health === "checking") return msg("landing.checkServer", "Checking server");
  return msg("landing.stop", "Stop server");
}

function canControlService(item, health) {
  return state.serviceControl && health !== 'checking' && !['starting', 'stopping'].includes(state.actions[item.id]) && (STATIC_DEMO || health === 'offline' || serviceFor(item).managed || serviceFor(item).managedElsewhere);
}

function actionForHealth(health, item) {
  if (item && serviceFor(item).managedElsewhere) return "stop";
  return health === "offline" ? "start" : "stop";
}

function renderEditor(item) {
  const service = serviceFor(item);
  const draft = draftFor(item);
  const def = service.defaultUpstream || "";
  const source = service.upstreamSource || "default";
  const error = state.editErrors[item.id] || "";
  const sourceKey = source === "override" ? "landing.override" : source === "env" ? "landing.environment" : "";
  const sourcePrefix = source === "override" ? msg("landing.override", "Manually set · ") : source === "env" ? msg("landing.environment", "From environment · ") : "";

  return `
    <div class="card-back">
      <div class="editor-top">
        <span class="panel-kicker" data-i18n-key="${STATIC_DEMO ? "demo.landing.editPreview" : "landing.editLink"}">${STATIC_DEMO ? msg("demo.landing.editPreview", "Edit link preview") : msg("landing.editLink", "Edit link")}</span>
        <button class="editor-close" type="button" data-edit-cancel="${escapeHtml(item.id)}" data-i18n-aria-label="landing.closeEditor" aria-label="${escapeHtml(msg("landing.closeEditor", "Close editor"))}">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
            <path d="M3 3 L13 13 M13 3 L3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>
          </svg>
        </button>
      </div>
      <div class="editor-body">
        <label class="editor-label" for="upstream-${escapeHtml(item.id)}">${escapeHtml(item.name)}</label>
        <input
          class="editor-input"
          id="upstream-${escapeHtml(item.id)}"
          type="url"
          inputmode="url"
          spellcheck="false"
          autocomplete="off"
          data-i18n-ignore placeholder="${escapeHtml(def)}"
          value="${escapeHtml(draft)}"
          data-edit-input="${escapeHtml(item.id)}"
        >
        ${error
          ? `<p class="editor-error" role="alert">${error.key ? `<span data-i18n-key="${escapeHtml(error.key)}">${escapeHtml(msg(error.key,error.fallback))}</span>` : escapeHtml(window.NFON_I18N?.translate?.(error) || error)}</p>`
          : `<p class="editor-meta">${sourceKey ? `<span data-i18n-key="${sourceKey}">${escapeHtml(sourcePrefix)}</span>` : ""}<span data-i18n-key="landing.default">${msg("landing.default", "Default")}</span> <span data-i18n-ignore>${escapeHtml(shortUpstream(def))}</span></p>`}
        <div class="editor-actions">
          <button class="editor-reset" type="button" data-edit-reset="${escapeHtml(item.id)}" data-i18n-key="landing.default" ${source === "override" ? "" : "disabled"}>${msg("landing.default", "Default")}</button>
          <button class="editor-save" type="button" data-edit-save="${escapeHtml(item.id)}" data-i18n-key="landing.save">${msg("landing.save", "Save")}</button>
        </div>
      </div>
    </div>
  `;
}

function renderCards(preserveEditor = false) {
  if (preserveEditor && els.apiCards.querySelector('[data-service-id="cti"]')) { renderServiceControls(); return; }
  const active = document.activeElement;
  const activeCard = active?.closest?.('[data-card-id]');
  const activeAttribute = ['data-edit-id','data-service-id','data-edit-save','data-edit-reset','data-edit-cancel','data-edit-input'].find(name => active?.hasAttribute?.(name));
  const focusSelector = activeCard ? `[data-card-id="${CSS.escape(activeCard.dataset.cardId)}"] ${activeAttribute ? `[${activeAttribute}]` : '.card-link'}` : '';
  const html = SHOWCASES.map((item) => {
    const selected = item.id === state.selectedId;
    const service = serviceFor(item);
    const health = service.health || "checking";
    const statusLabel = (HEALTH_LABELS[health] || HEALTH_LABELS.checking)();
    const checkedAt = formatCheckTime(service.checkedAt);
    const flipped = state.editing === item.id;
    const linkHint = shortUpstream(service.upstream) || item.route;

    return `
      <div class="api-card-shell tone-${escapeHtml(item.tone)}" data-card-id="${escapeHtml(item.id)}">
        <article class="api-card ${selected ? "is-selected" : ""} is-${escapeHtml(health)} ${flipped ? "is-flipped" : ""}">
          <div class="card-flip">
            <div class="card-face card-front" ${flipped ? 'inert aria-hidden="true"' : ''}>
              <a class="card-link" href="${escapeHtml(item.route)}" aria-label="${escapeHtml(msg("landing.openApp", "Open {name}", { name: item.name }))}">
                <div class="api-card-header">
                  <span class="service-index">${escapeHtml(item.index)}</span>
                  <span class="status-chip ${escapeHtml(health)}">
                    <span class="status-dot" aria-hidden="true"></span>
                    <span class="status-label">${escapeHtml(statusLabel)}</span>
                    ${renderMiniEkg()}
                  </span>
                </div>
                <div class="card-body">
                  <span class="panel-kicker">${escapeHtml(item.source)}</span>
                  <h2>${renderTitle(item)}</h2>
                  <p>${escapeHtml(item.purpose)}</p>
                </div>
                <dl class="core-list">
                  <div>
                    <dt>${msg("landing.status", "Status")}</dt>
                    <dd class="service-detail">${escapeHtml(service.detailKey ? msg(service.detailKey, service.detail) : window.NFON_I18N?.translate?.(service.detail) || service.detail)}</dd>
                  </div>
                  <div>
                    <dt>${msg("landing.scope", "API scope")}</dt>
                    <dd>${escapeHtml(item.scope)}</dd>
                  </div>
                </dl>
                <div class="card-footer">
                  <span class="service-checked">${escapeHtml(msg("landing.checked", "Checked {time}", { time: checkedAt }))}</span>
                  <strong class="card-route-hint"><span data-i18n-key="landing.link">${msg("landing.link", "Link")}</span> <span data-i18n-ignore>${escapeHtml(linkHint)}</span></strong>
                  <span class="card-open"><span data-i18n-key="landing.openAction">${escapeHtml(msg("landing.openAction", "Open app"))}</span><span aria-hidden="true">↗</span></span>
                </div>
              </a>
              <button class="card-edit" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="${escapeHtml(msg("landing.editAppLink", "Edit link for {name}", { name: item.name }))}">
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
                  <path d="M11.5 1.8 L14.2 4.5 L5.3 13.4 L2 14.2 L2.8 10.9 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
                </svg>
              </button>
            </div>
            <div class="card-face card-back-face" ${flipped ? '' : 'inert aria-hidden="true"'}>
              ${renderEditor(item)}
            </div>
          </div>
        </article>
        <button
          class="service-start is-${escapeHtml(health)}"
          type="button"
          data-service-id="${escapeHtml(item.id)}"
          data-service-action="${escapeHtml(actionForHealth(health, item))}"
          ${STATIC_DEMO ? `data-i18n-aria-label="${health === 'offline' ? 'demo.landing.resumeApp' : 'demo.landing.pauseApp'}" data-i18n-params="${escapeHtml(JSON.stringify({name:item.name}))}"` : ''}
          aria-label="${escapeHtml(STATIC_DEMO ? msg(health === 'offline' ? 'demo.landing.resumeApp' : 'demo.landing.pauseApp', health === 'offline' ? 'Resume {name} demo' : 'Pause {name} demo', {name:item.name}) : `${item.name} ${startButtonLabel(item, health)}`)}"
          ${canControlService(item, health) ? "" : "disabled"}
          ${state.serviceControl ? "" : "hidden"}
        >
          <span class="button-label-rest">${escapeHtml(startButtonLabel(item, health))}</span>
          <span class="button-label-hover">${escapeHtml(hoverButtonLabel(item, health))}</span>
        </button>
        <p class="service-feedback editor-error" role="status">${state.actionErrors[item.id] ? escapeHtml(window.NFON_I18N?.translate?.(state.actionErrors[item.id]) || state.actionErrors[item.id]) : ""}</p>
      </div>
    `;
  }).join("");
  els.apiCards.innerHTML = html;

  if (focusSelector && !active.isConnected) {
    const replacement = els.apiCards.querySelector(focusSelector);
    if (replacement && !replacement.disabled) replacement.focus({ preventScroll: true });
    else els.apiCards.querySelector(`[data-card-id="${CSS.escape(activeCard.dataset.cardId)}"] .card-link`)?.focus({ preventScroll: true });
  }

  if (state.editing && !preserveEditor) {
    const input = els.apiCards.querySelector(`[data-edit-input="${CSS.escape(state.editing)}"]`);
    if (input && document.activeElement !== input) {
      const end = input.value.length;
      input.focus();
      if (["text", "search", "tel", "password"].includes(input.type)) input.setSelectionRange(end, end);
    }
  }
}

function renderServiceControls() {
  for (const item of SHOWCASES) {
    const service = serviceFor(item), health = service.health || 'checking';
    const button = els.apiCards.querySelector(`[data-service-id="${item.id}"]`);
    if (!button) continue;
    const shell = button.closest('.api-card-shell');
    const card = shell.querySelector('.api-card');
    card.className = `api-card ${item.id === state.selectedId ? 'is-selected' : ''} is-${health} ${state.editing === item.id ? 'is-flipped' : ''}`;
    shell.querySelector('.status-chip').className = `status-chip ${health}`;
    shell.querySelector('.status-label').textContent = (HEALTH_LABELS[health] || HEALTH_LABELS.checking)();
    const detail = shell.querySelector('.service-detail');
    if (detail) detail.textContent = service.detailKey ? msg(service.detailKey, service.detail) : window.NFON_I18N?.translate?.(service.detail) || service.detail;
    const checked = shell.querySelector('.service-checked');
    if (checked) checked.textContent = msg('landing.checked','Checked {time}',{time:formatCheckTime(service.checkedAt)});
    button.className = `service-start is-${health}`;
    button.disabled = !canControlService(item,health);
    button.hidden = !state.serviceControl;
    button.dataset.serviceAction = actionForHealth(health, item);
    const key = health === 'offline' ? 'demo.landing.resumeApp' : 'demo.landing.pauseApp';
    if (STATIC_DEMO) button.setAttribute('data-i18n-aria-label',key);
    button.setAttribute('aria-label', STATIC_DEMO ? msg(key,health==='offline'?'Resume {name} demo':'Pause {name} demo',{name:item.name}) : `${item.name} ${startButtonLabel(item,health)}`);
    button.querySelector('.button-label-rest').textContent = startButtonLabel(item,health);
    button.querySelector('.button-label-hover').textContent = hoverButtonLabel(item,health);
    const feedback = shell.querySelector('.service-feedback');
    if (feedback) feedback.textContent = window.NFON_I18N?.translate?.(state.actionErrors[item.id] || '') || state.actionErrors[item.id] || '';
    if (button.disabled && document.activeElement === button) shell.querySelector('.card-link')?.focus({preventScroll:true});
  }
}

function render(preserveEditor = false) {
  renderHeader();
  renderCards(preserveEditor);
}

async function refreshStatus() {
  try {
    const response = await request("/api/status", { cache: "no-store" });
    const payload = await response.json();
    state.gatewayHealth = payload.health || "warning";
    state.services = payload.services || {};
    state.serviceControl = STATIC_DEMO || payload.serviceControl === true;
    if (payload.csrfToken) state.csrfToken = payload.csrfToken;
    for (const [id, service] of Object.entries(state.services)) {
      if (!service.startError) {
        if (service.health !== 'offline' && !service.reason && state.actions[id] === 'error') { delete state.actions[id]; delete state.actionErrors[id]; }
        continue;
      }
      const errorKeys = {
        'port-in-use': ['landing.startPortInUse', 'The port is already in use.'],
        configuration: ['landing.startConfiguration', 'The server configuration is invalid.'],
        'start-failed': ['landing.startFailed', 'The server exited during startup.'],
        'service-exited': ['landing.serviceExited', 'The server has stopped.'],
      };
      const [key, fallback] = errorKeys[service.startError] || errorKeys['start-failed'];
      state.actions[id] = 'error';
      state.actionErrors[id] = msg(key, fallback);
    }
    Object.keys(state.actions).forEach((id) => {
      const actionState = state.actions[id];
      const health = state.services[id]?.health;
      if (actionState === "starting" && health && health !== "offline") {
        delete state.actions[id];
      }
      if (actionState === "stopping" && health && !state.services[id]?.managed && !state.services[id]?.managedElsewhere) {
        delete state.actions[id];
      }
    });
  } catch (error) {
    state.gatewayHealth = "offline";
    state.services = {};
  }
  // renderCards retains the open editor and refreshes the other cards in place.
  render(true);
}

function controlHeaders() {
  return state.csrfToken ? { "X-CSRF-Token": state.csrfToken } : {};
}

function openEditor(id) {
  const item = SHOWCASES.find((entry) => entry.id === id);
  if (!item) return;
  state.editing = id;
  state.drafts[id] = serviceFor(item).upstream || "";
  delete state.editErrors[id];
  render();
}

function closeEditor(id) {
  if (state.editing === id) state.editing = null;
  delete state.drafts[id];
  delete state.editErrors[id];
  render();
  els.apiCards.querySelector(`[data-edit-id="${CSS.escape(id)}"]`)?.focus();
}

async function submitUpstream(id, value) {
  try {
    const response = await request(`/api/services/${encodeURIComponent(id)}/upstream`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...controlHeaders() },
      body: JSON.stringify({ upstream: value }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      state.editErrors[id] = payload.errorKey ? {key:payload.errorKey,fallback:payload.error} : payload.error || msg("landing.saveFailed", "Saving failed.");
      render();
      return;
    }
    state.editing = null;
    delete state.drafts[id];
    delete state.editErrors[id];
    await refreshStatus();
    render();
    els.apiCards.querySelector(`[data-edit-id="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
  } catch (error) {
    state.editErrors[id] = msg("landing.saveFailed", "Saving failed.");
    render();
  }
}

function saveEditor(id) {
  return submitUpstream(id, (state.drafts[id] || "").trim());
}

function resetEditor(id) {
  state.drafts[id] = "";
  return submitUpstream(id, "");
}

async function controlDemo(id, action) {
  const item = SHOWCASES.find(item => item.id === id);
  if (!item || !canControlService(item, serviceFor(item).health)) return;
  delete state.actionErrors[id];
  state.actions[id] = action === 'start' ? 'starting' : 'stopping';
  render(true);
  try {
    const response = await request(`/api/services/${encodeURIComponent(id)}/${action}`, { method:'POST', cache:'no-store' });
    const payload = await response.json();
    if (!response.ok || !payload.ok) throw new Error(payload.errorKey ? msg(payload.errorKey, payload.error) : msg('landing.controlFailed','Service action failed.'));
    delete state.actions[id];
    await refreshStatus();
  } catch (error) {
    state.actions[id] = 'error';
    state.actionErrors[id] = error.message;
    render(true);
  }
}

async function startService(id) {
  if (STATIC_DEMO) return controlDemo(id, 'start');
  if (['starting', 'stopping'].includes(state.actions[id]) || !state.serviceControl) return;
  delete state.actionErrors[id];
  state.actions[id] = "starting";
  render();

  try {
    const response = await request(`/api/services/${encodeURIComponent(id)}/start`, {
      method: "POST",
      cache: "no-store",
      headers: controlHeaders(),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      state.actions[id] = "error";
      state.actionErrors[id] = payload.errorKey ? msg(payload.errorKey, msg('landing.controlFailed', 'Service action failed.')) : msg('landing.controlFailed', 'Service action failed.');
      render();
      return;
    }

    setTimeout(refreshStatus, 1400);
    setTimeout(async () => {
      await refreshStatus();
      if (state.actions[id] === "starting" && state.services[id]?.health === "offline") {
        state.actions[id] = "error";
        state.actionErrors[id] ||= msg('landing.startWaiting', 'The server has not responded yet.');
        render();
      }
    }, 6500);
  } catch (error) {
    state.actions[id] = "error";
    state.actionErrors[id] = msg('landing.controlFailed', 'Service action failed.');
    render();
  }
}

async function stopService(id) {
  if (STATIC_DEMO) return controlDemo(id, 'stop');
  if (['starting', 'stopping'].includes(state.actions[id]) || !state.serviceControl) return;
  delete state.actionErrors[id];
  state.actions[id] = "stopping";
  render();

  try {
    const response = await request(`/api/services/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      cache: "no-store",
      headers: controlHeaders(),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      state.actions[id] = "error";
      state.actionErrors[id] = payload.errorKey ? msg(payload.errorKey, msg('landing.controlFailed', 'Service action failed.')) : msg('landing.controlFailed', 'Service action failed.');
      render();
      return;
    }

    setTimeout(refreshStatus, 900);
    setTimeout(async () => {
      await refreshStatus();
      if (state.actions[id] === "stopping" && (state.services[id]?.managed || state.services[id]?.managedElsewhere)) {
        state.actions[id] = "error";
        state.actionErrors[id] ||= msg('landing.stopWaiting', 'The server has not stopped yet.');
        render();
      }
    }, 3600);
  } catch (error) {
    state.actions[id] = "error";
    state.actionErrors[id] = msg('landing.controlFailed', 'Service action failed.');
    render();
  }
}

window.addEventListener("popstate", () => {
  state.selectedId = routeToShowcaseId(window.location.pathname);
  render();
});

els.apiCards.addEventListener("click", (event) => {
  if (!(event.target instanceof Element)) return;

  const editButton = event.target.closest(".card-edit");
  if (editButton) {
    openEditor(editButton.dataset.editId);
    return;
  }

  const cancelButton = event.target.closest("[data-edit-cancel]");
  if (cancelButton) {
    closeEditor(cancelButton.dataset.editCancel);
    return;
  }

  const saveButton = event.target.closest("[data-edit-save]");
  if (saveButton) {
    saveEditor(saveButton.dataset.editSave);
    return;
  }

  const resetButton = event.target.closest("[data-edit-reset]");
  if (resetButton && !resetButton.disabled) {
    resetEditor(resetButton.dataset.editReset);
    return;
  }

  const button = event.target.closest(".service-start");
  if (!button || button.disabled) return;
  if (!button.dataset.serviceId) return;
  if (button.dataset.serviceAction === "start") {
    startService(button.dataset.serviceId);
    return;
  }
  stopService(button.dataset.serviceId);
});

els.apiCards.addEventListener("input", (event) => {
  if (!(event.target instanceof Element)) return;
  const input = event.target.closest("[data-edit-input]");
  if (!input) return;
  state.drafts[input.dataset.editInput] = input.value;
});

els.apiCards.addEventListener("keydown", (event) => {
  if (!(event.target instanceof Element)) return;
  const input = event.target.closest("[data-edit-input]");
  if (!input) return;
  if (event.key === "Enter") {
    event.preventDefault();
    saveEditor(input.dataset.editInput);
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeEditor(input.dataset.editInput);
  }
});

document.addEventListener("nfon:language-change", () => {
  renderHeader();
  // The shared runtime translates the editor in place without replacing its input.
  if (!state.editing) renderCards();
  else renderServiceControls();
});

render();
refreshStatus();
setInterval(refreshStatus, 15000);
