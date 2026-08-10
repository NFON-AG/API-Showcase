const SHOWCASES = [
  {
    id: "cti",
    route: "/cti/",
    name: "NFON CTI API",
    nameLines: ["NFON CTI", "API"],
    source: "Live-Telefonie",
    scope: "K-Ebene",
    purpose: "Präsenz, Nebenstellen, Click-to-Dial und laufende Telefonie im Dashboard.",
    focus: "Realtime",
    index: "01",
    tone: "green",
  },
  {
    id: "portal",
    route: "/portal/",
    name: "NFON Portal API",
    nameLines: ["NFON Portal", "API"],
    source: "PBX Administration",
    scope: "K-Ebene",
    purpose: "Rufnummern, Geräte, Routing-Objekte und Callflow-Kontext aus dem Portal.",
    focus: "Inventory",
    index: "02",
    tone: "blue",
  },
  {
    id: "core-history",
    route: "/call-history/",
    name: "NFON Call History API",
    nameLines: ["NFON Call History", "API"],
    source: "Gesprächshistorie",
    scope: "User-Ebene",
    purpose: "Login, Ruflisten, Transcripts und CRM-Zuordnung für abgeschlossene Gespräche.",
    focus: "History",
    index: "03",
    tone: "purple",
  },
];

const HEALTH_LABELS = {
  online: "Live",
  warning: "Ready",
  offline: "Error",
  checking: "Sync",
};

const GATEWAY_LABELS = {
  online: "Gateway live",
  warning: "Gateway mit Teilproblem",
  offline: "Gateway offline",
  checking: "Gateway wird geprüft",
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
    detail: "Status wird geprüft.",
    route: item.route,
    checkedAt: "",
  };
}

function selectedShowcase() {
  return SHOWCASES.find((item) => item.id === state.selectedId) || null;
}

function formatCheckTime(value) {
  if (!value) return "noch offen";
  return new Intl.DateTimeFormat("de-DE", {
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
  els.connection.className = `connection is-${health}`;
  els.connection.textContent = "";
  els.connection.setAttribute("aria-label", GATEWAY_LABELS[health] || GATEWAY_LABELS.checking);
  els.connection.title = GATEWAY_LABELS[health] || GATEWAY_LABELS.checking;
  els.headerSubline.textContent = selected
    ? `${selected.name} · ${selected.route}`
    : "Lokales Showcase-Gateway";
}

function startButtonLabel(item, health) {
  const actionState = state.actions[item.id];
  if (actionState === "starting") return "Server startet";
  if (actionState === "stopping") return "Server stoppt";
  if (actionState === "error") return "Erneut versuchen";
  if (health === "offline") return "Server starten";
  if (health === "checking") return "Server wird geprüft";
  return "Server läuft";
}

function hoverButtonLabel(item, health) {
  const actionState = state.actions[item.id];
  if (actionState === "starting") return "Server startet";
  if (actionState === "stopping") return "Server stoppt";
  if (health === "offline") return "Server starten";
  if (health === "checking") return "Server wird geprüft";
  return "Server stoppen";
}

function canControlService(item, health) {
  return health !== "checking" || state.actions[item.id] === "error";
}

function actionForHealth(health) {
  return health === "offline" ? "start" : "stop";
}

function renderEditor(item) {
  const service = serviceFor(item);
  const draft = draftFor(item);
  const def = service.defaultUpstream || "";
  const source = service.upstreamSource || "default";
  const error = state.editErrors[item.id] || "";
  const sourcePrefix = source === "override" ? "Manuell gesetzt · " : source === "env" ? "Aus Umgebung · " : "";

  return `
    <div class="card-back">
      <div class="editor-top">
        <span class="panel-kicker">Link bearbeiten</span>
        <button class="editor-close" type="button" data-edit-cancel="${escapeHtml(item.id)}" aria-label="Bearbeiten schließen">
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
          placeholder="${escapeHtml(def)}"
          value="${escapeHtml(draft)}"
          data-edit-input="${escapeHtml(item.id)}"
        >
        ${error
          ? `<p class="editor-error" role="alert">${escapeHtml(error)}</p>`
          : `<p class="editor-meta">${escapeHtml(sourcePrefix)}Standard ${escapeHtml(shortUpstream(def))}</p>`}
        <div class="editor-actions">
          <button class="editor-reset" type="button" data-edit-reset="${escapeHtml(item.id)}" ${source === "override" ? "" : "disabled"}>Standard</button>
          <button class="editor-save" type="button" data-edit-save="${escapeHtml(item.id)}">Speichern</button>
        </div>
      </div>
    </div>
  `;
}

function renderCards() {
  els.apiCards.innerHTML = SHOWCASES.map((item) => {
    const selected = item.id === state.selectedId;
    const service = serviceFor(item);
    const health = service.health || "checking";
    const statusLabel = HEALTH_LABELS[health] || HEALTH_LABELS.checking;
    const checkedAt = formatCheckTime(service.checkedAt);
    const flipped = state.editing === item.id;
    const linkHint = shortUpstream(service.upstream) || item.route;

    return `
      <div class="api-card-shell tone-${escapeHtml(item.tone)}">
        <article class="api-card ${selected ? "is-selected" : ""} is-${escapeHtml(health)} ${flipped ? "is-flipped" : ""}">
          <div class="card-flip">
            <div class="card-face card-front">
              <a class="card-link" href="${escapeHtml(item.route)}" aria-label="${escapeHtml(item.name)} öffnen">
                <div class="api-card-header">
                  <span class="service-index">${escapeHtml(item.index)}</span>
                  <span class="status-chip ${escapeHtml(health)}">
                    <span class="status-dot" aria-hidden="true"></span>
                    <span class="status-label">${escapeHtml(statusLabel)}</span>
                    ${renderMiniEkg()}
                  </span>
                </div>
                <div class="card-body">
                  ${item.preview ? `<span class="preview-badge">Preview API</span>` : ""}
                  <span class="panel-kicker">${escapeHtml(item.source)}</span>
                  <h2>${renderTitle(item)}</h2>
                  <p>${escapeHtml(item.purpose)}</p>
                </div>
                <dl class="core-list">
                  <div>
                    <dt>Status</dt>
                    <dd>${escapeHtml(service.detail)}</dd>
                  </div>
                  <div>
                    <dt>API-Ebene</dt>
                    <dd>${escapeHtml(item.scope)}</dd>
                  </div>
                </dl>
                <div class="card-footer">
                  <span>Geprüft ${escapeHtml(checkedAt)}</span>
                  <strong class="card-route-hint">Link ${escapeHtml(linkHint)}</strong>
                </div>
              </a>
              <button class="card-edit" type="button" data-edit-id="${escapeHtml(item.id)}" aria-label="Link für ${escapeHtml(item.name)} bearbeiten">
                <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
                  <path d="M11.5 1.8 L14.2 4.5 L5.3 13.4 L2 14.2 L2.8 10.9 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"></path>
                </svg>
              </button>
            </div>
            <div class="card-face card-back-face">
              ${renderEditor(item)}
            </div>
          </div>
        </article>
        <button
          class="service-start is-${escapeHtml(health)}"
          type="button"
          data-service-id="${escapeHtml(item.id)}"
          data-service-action="${escapeHtml(actionForHealth(health))}"
          aria-label="${escapeHtml(`${item.name} ${actionForHealth(health) === "start" ? "Server starten" : "Server stoppen"}`)}"
          ${canControlService(item, health) ? "" : "disabled"}
        >
          <span class="button-label-rest">${escapeHtml(startButtonLabel(item, health))}</span>
          <span class="button-label-hover">${escapeHtml(hoverButtonLabel(item, health))}</span>
        </button>
      </div>
    `;
  }).join("");

  if (state.editing) {
    const input = els.apiCards.querySelector(`[data-edit-input="${CSS.escape(state.editing)}"]`);
    if (input && document.activeElement !== input) {
      const end = input.value.length;
      input.focus();
      input.setSelectionRange(end, end);
    }
  }
}

function render() {
  renderHeader();
  renderCards();
}

async function refreshStatus() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const payload = await response.json();
    state.gatewayHealth = payload.health || "warning";
    state.services = payload.services || {};
    if (payload.csrfToken) state.csrfToken = payload.csrfToken;
    Object.keys(state.actions).forEach((id) => {
      const actionState = state.actions[id];
      const health = state.services[id]?.health;
      if (actionState === "starting" && health && health !== "offline") {
        delete state.actions[id];
      }
      if (actionState === "stopping" && health === "offline") {
        delete state.actions[id];
      }
    });
  } catch (error) {
    state.gatewayHealth = "offline";
    state.services = {};
  }
  // Do not rebuild while a link is being edited — it would drop the open editor
  // and the in-progress input. The poll still refreshes state for the next render.
  if (!state.editing) render();
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
}

async function submitUpstream(id, value) {
  try {
    const response = await fetch(`/api/services/${encodeURIComponent(id)}/upstream`, {
      method: "POST",
      cache: "no-store",
      headers: { "Content-Type": "application/json", ...controlHeaders() },
      body: JSON.stringify({ upstream: value }),
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      state.editErrors[id] = payload.error || "Speichern fehlgeschlagen.";
      render();
      return;
    }
    state.editing = null;
    delete state.drafts[id];
    delete state.editErrors[id];
    await refreshStatus();
    render();
  } catch (error) {
    state.editErrors[id] = "Speichern fehlgeschlagen.";
    render();
  }
}

function saveEditor(id) {
  submitUpstream(id, (state.drafts[id] || "").trim());
}

function resetEditor(id) {
  state.drafts[id] = "";
  submitUpstream(id, "");
}

async function startService(id) {
  state.actions[id] = "starting";
  render();

  try {
    const response = await fetch(`/api/services/${encodeURIComponent(id)}/start`, {
      method: "POST",
      cache: "no-store",
      headers: controlHeaders(),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      state.actions[id] = "error";
      render();
      return;
    }

    setTimeout(refreshStatus, 1400);
    setTimeout(async () => {
      await refreshStatus();
      if (state.actions[id] === "starting" && state.services[id]?.health === "offline") {
        state.actions[id] = "error";
        render();
      }
    }, 6500);
  } catch (error) {
    state.actions[id] = "error";
    render();
  }
}

async function stopService(id) {
  state.actions[id] = "stopping";
  render();

  try {
    const response = await fetch(`/api/services/${encodeURIComponent(id)}/stop`, {
      method: "POST",
      cache: "no-store",
      headers: controlHeaders(),
    });
    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      state.actions[id] = "error";
      render();
      return;
    }

    setTimeout(refreshStatus, 900);
    setTimeout(async () => {
      await refreshStatus();
      if (state.actions[id] === "stopping" && state.services[id]?.health !== "offline") {
        state.actions[id] = "error";
        render();
      }
    }, 3600);
  } catch (error) {
    state.actions[id] = "error";
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

render();
refreshStatus();
setInterval(refreshStatus, 15000);
