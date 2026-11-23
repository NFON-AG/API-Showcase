(function () {
  "use strict";

  // The standalone CTI page loads the same adapter as the download. It is
  // entirely inert in live mode; selecting Demo reloads into a fresh context.
  if (document.currentScript?.dataset?.nfonOptionalDemo === 'cti') {
    if (new URL(window.location.href).searchParams.get('demo') !== '1') return;
    document.body.dataset.nfonApp = 'cti';
    window.NFON_LOCAL_DEMO = true;
  }
  window.NFON_WEB_ONLY_DEMO = true;

  function demoMessage(key, fallback, params = {}) {
    const translated = window.NFON_I18N?.message?.(key, params);
    return translated || fallback.replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
  }

  function localAppearanceControl(target) {
    return target?.closest?.("[data-appearance-settings], .language-picker, #demo-control");
  }

  function localCtiDemoControl(target) {
    return appKind() === "cti" && target?.closest?.(".setup-contacts-layout, #contacts-module-panel, #contacts-list, #backup-download, #storage-refresh");
  }

  const token = "demo-csrf-token";
  const CALL_HISTORY_CALLS_PER_DAY = 20;
  const now = () => new Date().toISOString();
  const appKind = () => document.body?.dataset?.nfonApp || '';

  const demo = createDemoState();
  const ctiGoogleContactSeed = appKind() === 'cti' ? JSON.parse(JSON.stringify(demo.cti.contacts)) : [];
  let ctiLocalContactSequence = 0;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function demoFetch(input, options = {}) {
    const url = new URL(typeof input === "string" ? input : input.url, window.location.href);
    const method = String(options.method || "GET").toUpperCase();
    if (!isDemoApiUrl(url)) {
      return originalFetch(input, options);
    }
    const bodyText = options.body ? String(options.body) : "";
    const body = parseJson(bodyText);
    try {
      const payload = route(url, method, body);
      if (payload instanceof Response) return payload;
      return jsonResponse(payload);
    } catch (error) {
      return jsonResponse({ ok: false, error: error.message || demoMessage("demo.apiError", "Demo API error"), csrfToken: token }, 400);
    }
  };

  window.EventSource = class DemoEventSource extends EventTarget {
    constructor() {
      super();
      this.readyState = 1;
      this.interval = window.setInterval(() => {
        if (isAppPaused()) return;
        const event = demo.cti.events[Math.floor(Math.random() * demo.cti.events.length)];
        const message = new MessageEvent("message", { data: JSON.stringify({ type: "state", state: randomCtiState(event.extension || "201") }) });
        this.dispatchEvent(message);
        if (typeof this.onmessage === "function") this.onmessage(message);
      }, 7000);
      window.setTimeout(() => this.dispatchEvent(new Event("open")), 0);
    }

    close() {
      window.clearInterval(this.interval);
      this.readyState = 2;
    }
  };

  installDemoUiGuards();

  document.addEventListener("click", async (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    let path;
    try { path = normalizeApiPath(new URL(href, window.location.href).pathname); } catch { return; }
    if (appKind() === "cti" && (href === "#demo-google-login" || path === "/auth/google/start")) {
      event.preventDefault();
      connectCtiDemoContacts();
      await window.refreshContactsPage?.();
      return;
    }
    if (path.startsWith("/auth/")) {
      event.preventDefault();
      return;
    }
    if (path === "/api/storage/backup" || (appKind() === "cti" && href === "#demo-backup")) {
      event.preventDefault();
      downloadText("nfon-cti-demo-backup.json", JSON.stringify(createCtiDemoBackup(), null, 2), "application/json");
    }
  });

  function installDemoUiGuards() {
    installReadOnlyStyles();

    document.addEventListener(
      "click",
      (event) => {
        if (localAppearanceControl(event.target) || localCtiDemoControl(event.target)) return;
        const readonly = event.target.closest("[data-demo-readonly='true']");
        if (!readonly) return;
        const interactive = event.target.closest("a, button, label, input, select, textarea");
        if (!interactive || interactive.classList.contains("demo-readonly-note")) return;
        event.preventDefault();
        if (typeof window.NFON_SHOW_DEMO_BLOCKED === "function") {
          window.NFON_SHOW_DEMO_BLOCKED();
        }
        event.stopImmediatePropagation();
      },
      true,
    );

    document.addEventListener(
      "submit",
      (event) => {
        if (localAppearanceControl(event.target) || localCtiDemoControl(event.target)) return;
        if (!event.target.closest("[data-demo-readonly='true']")) return;
        event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );

    const apply = () => {
      applySetupReadOnly();
      replaceLegacyDemoTerms(document.body);
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", apply, { once: true });
    } else {
      apply();
    }

    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    window.setTimeout(apply, 0);
    window.setTimeout(apply, 250);
    window.setTimeout(apply, 1000);
  }

  function applySetupReadOnly() {
    if (appKind() === "cti") {
      const contacts = document.querySelector("#contacts-module-panel");
      if (contacts && !contacts.querySelector(".demo-contacts-note")) {
        const note = document.createElement("p");
        note.className = "demo-contacts-note";
        note.dataset.i18nKey = "demo.cti.contactsLocal";
        note.textContent = demoMessage("demo.cti.contactsLocal", "Sample contacts · changes stay in this demo");
        contacts.prepend(note);
      }
    }
    for (const container of setupReadOnlyContainers()) {
      if (!container) continue;
      container.dataset.demoReadonly = "true";
      ensureReadOnlyNote(container);
      for (const control of container.querySelectorAll("button, input, select, textarea, a, label")) {
        markReadOnlyControl(control);
      }
    }
  }

  function setupReadOnlyContainers() {
    const kind = appKind();
    if (kind === "cti" && window.location.pathname.toLowerCase().endsWith("/setup.html")) {
      return [document.querySelector("main.app-shell")];
    }
    if (kind === "portal") {
      return [document.querySelector("#view-changes")];
    }
    if (kind === "call-history") {
      return [document.querySelector("#view-setup")];
    }
    return [];
  }

  function ensureReadOnlyNote(container) {
    if (container.querySelector(":scope > .demo-readonly-note")) return;
    const note = document.createElement("div");
    note.className = "demo-readonly-note";
    const key = appKind() === "cti" ? "demo.cti.setupReadOnly" : "demo.setupReadOnly";
    note.dataset.i18nKey = key;
    note.textContent = demoMessage(key, appKind() === "cti" ? "Demo view · Credentials and backup restore are read-only" : "Demo view · Setup is read-only");
    container.prepend(note);
  }

  function markReadOnlyControl(control) {
    if (localAppearanceControl(control) || localCtiDemoControl(control) || control.closest(".demo-readonly-note")) return;
    const tag = control.tagName.toLowerCase();
    if (tag === "a") {
      control.setAttribute("aria-disabled", "true");
      control.setAttribute("tabindex", "-1");
      control.dataset.demoDisabled = "true";
      return;
    }
    if (tag === "label") {
      control.setAttribute("aria-disabled", "true");
      control.dataset.demoDisabled = "true";
      return;
    }
    if (tag === "button") {
      control.dataset.demoDisabled = "true";
      return;
    }
    if ("disabled" in control) control.disabled = true;
    control.dataset.demoDisabled = "true";
  }

  function installReadOnlyStyles() {
    if (document.getElementById("demo-readonly-styles")) return;
    const style = document.createElement("style");
    style.id = "demo-readonly-styles";
    style.textContent = `
      .demo-readonly-note {
        margin: 0 0 16px;
        padding: 12px 16px;
        border: 1px solid var(--line, #d8e0df);
        background: var(--surface-strong, #f0f4f3);
        color: var(--text, #202426);
        font-weight: 800;
      }

      [data-demo-readonly="true"] [data-demo-disabled="true"] {
        cursor: not-allowed !important;
        opacity: 0.48;
      }

      [data-demo-readonly="true"] a[data-demo-disabled="true"],
      [data-demo-readonly="true"] label[data-demo-disabled="true"] {
        pointer-events: none;
      }
    `;
    document.head.appendChild(style);
  }

  function replaceLegacyDemoTerms(root) {
    if (!root || ["cti", "call-history"].includes(appKind())) return;
    const legacyPlant = "F" + "ake";
    const legacySeed = "Se" + "ed";
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const replacements = [
      [new RegExp(`${legacyPlant}-Anlage`, "g"), "Demo-Anlage"],
      [new RegExp(`${legacyPlant} Daten`, "g"), "Demo-Daten"],
      [new RegExp(`${legacyPlant}-Daten`, "g"), "Demo-Daten"],
      [new RegExp(legacyPlant, "g"), "Demo"],
      [new RegExp(legacySeed, "g"), "Demo"],
    ];
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const node of nodes) {
      if (node.parentElement?.closest("[data-i18n-ignore], script, style, code, pre, textarea")) continue;
      let text = node.nodeValue;
      for (const [pattern, replacement] of replacements) text = text.replace(pattern, replacement);
      if (text !== node.nodeValue) node.nodeValue = text;
    }
  }

  function isDemoApiUrl(url) {
    return url.pathname.includes("/api/") || url.pathname.startsWith("/api/") || url.pathname.includes("/auth/");
  }

  function route(url, method, body) {
    const kind = appKind();
    const path = normalizeApiPath(url.pathname);
    if (kind === "landing") return landingRoute(path, method, body);
    if (isAppPaused() && !['GET','HEAD'].includes(method)) return landingError('demo.landing.paused', 'Demo paused', 423);
    if (kind === "cti") return ctiRoute(path, method, body, url);
    if (kind === "portal") return portalRoute(path, method, body);
    if (kind === "call-history") return callHistoryRoute(path, method, body, url);
    return landingError('demo.landing.unknownAction', 'Unknown demo action.', 404);
  }

  function normalizeApiPath(pathname) {
    const index = pathname.indexOf("/api/");
    if (index >= 0) return pathname.slice(index);
    const authIndex = pathname.indexOf("/auth/");
    if (authIndex >= 0) return pathname.slice(authIndex);
    return pathname;
  }

  const landingDefaults = Object.freeze({
    cti: "./cti/index.html",
    portal: "./portal/index.html",
    "core-history": "./call-history/index.html",
  });
  const landingStorageKey = `nfon-static-landing-v1:${new URL(appKind() === 'landing' ? '.' : '../', window.location.href).pathname}`;
  const landingState = loadLandingState();
  window.NFON_DEMO_PAUSED = isAppPaused();
  for (const type of ['click','submit','change']) document.addEventListener(type, event => {
    if (!isAppPaused() || appKind() === 'landing') return;
    if (localAppearanceControl(event.target) || event.target.closest?.('#demo-pause-panel, .nfon-menu-button, .nfon-sidebar, .home-icon-button')) return;
    if (event.target.closest?.('button, a, input, select, textarea, form, label')) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  function isAppPaused() {
    const id = appKind() === 'call-history' ? 'core-history' : appKind();
    return landingState.active[id] === false;
  }
  function renderPause() {
    if (appKind() === 'landing') return;
    const paused = isAppPaused();
    window.NFON_DEMO_PAUSED = paused;
    const existing = document.getElementById('demo-pause-panel');
    document.querySelectorAll('main').forEach(main => { main.inert = paused; });
    if (!paused) existing?.remove();
    else if (!existing) {
      const panel = document.createElement('section');
      panel.id = 'demo-pause-panel';
      panel.setAttribute('role', 'region');
      panel.setAttribute('aria-live', 'polite');
      panel.setAttribute('aria-labelledby', 'demo-pause-title');
      panel.style.cssText = 'position:fixed;inset:35% 16px auto;max-width:420px;margin:auto;padding:24px;z-index:1000;background:var(--surface,#fff);border:1px solid var(--line,#ddd);box-shadow:0 4px 20px #0002;';
      const title = document.createElement('h2');
      title.id = 'demo-pause-title';
      title.dataset.i18nKey = 'demo.landing.paused';
      title.textContent = demoMessage('demo.landing.paused', 'Demo paused');
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.i18nKey = 'demo.landing.resume';
      button.textContent = demoMessage('demo.landing.resume', 'Resume demo');
      button.addEventListener('click', () => {
        const id = appKind() === 'call-history' ? 'core-history' : appKind();
        landingState.active[id] = true;
        saveLandingState();
        window.location.reload();
      });
      panel.append(title, button);
      document.body.append(panel);
      button.focus();
    }
    document.dispatchEvent(new CustomEvent('nfon:demo-pause', { detail: { paused } }));
  }
  window.addEventListener('storage', event => {
    if (event.key !== landingStorageKey) return;
    const wasPaused = isAppPaused();
    Object.assign(landingState, loadLandingState());
    if (wasPaused && !isAppPaused()) { window.location.reload(); return; }
    renderPause();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', renderPause, { once: true });
  else renderPause();
  if (appKind() === "landing") {
    // The static landing calls this local handler directly, even if fetch is replaced.
    window.NFON_LANDING_DEMO = Object.freeze({
      async request(path, options = {}) {
        const url = new URL(path, window.location.href);
        const payload = landingRoute(normalizeApiPath(url.pathname), String(options.method || "GET").toUpperCase(), parseJson(options.body || ""));
        return payload instanceof Response ? payload : jsonResponse(payload);
      },
    });
  }

  function validLandingPreview(value, id) {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed || trimmed === landingDefaults[id]) return "";
    try {
      const url = new URL(trimmed);
      if (!["http:", "https:"].includes(url.protocol) || !url.hostname || url.username || url.password) return null;
      return url.href;
    } catch { return null; }
  }

  function loadLandingState() {
    let saved;
    try { saved = JSON.parse(window.localStorage.getItem(landingStorageKey) || "{}"); } catch { saved = {}; }
    const result = { active: {}, overrides: {} };
    for (const id of Object.keys(landingDefaults)) {
      result.active[id] = saved?.active?.[id] !== false;
      const override = validLandingPreview(saved?.overrides?.[id], id);
      if (override) result.overrides[id] = override;
    }
    return result;
  }

  function saveLandingState() {
    try { window.localStorage.setItem(landingStorageKey, JSON.stringify(landingState)); } catch { /* Keep this page usable without storage. */ }
  }

  function landingStatus() {
    return {
      ok: true,
      demo: true,
      health: "online",
      csrfToken: token,
      services: Object.fromEntries(Object.entries(landingDefaults).map(([id, route]) => {
        const active = landingState.active[id];
        const detailKey = active ? "demo.landing.activeDetail" : "demo.landing.pausedDetail";
        return [id, {
          health: active ? "online" : "offline",
          demoActive: active,
          detailKey,
          detail: demoMessage(detailKey, active ? "Local demo active." : "Local demo paused."),
          route,
          defaultUpstream: route,
          upstream: landingState.overrides[id] || route,
          upstreamSource: landingState.overrides[id] ? "override" : "default",
          checkedAt: now(),
        }];
      })),
    };
  }

  function landingError(key, fallback, status = 400) {
    return jsonResponse({ ok: false, errorKey: key, error: demoMessage(key, fallback), csrfToken: token }, status);
  }

  function landingRoute(path, method, body) {
    if (path === "/api/status" && method === "GET") return landingStatus();
    const action = path.match(/^\/api\/services\/([^/]+)\/(start|stop|upstream)$/);
    if (!action || !Object.hasOwn(landingDefaults, action[1])) {
      return landingError("demo.landing.unknownAction", "Unknown demo action.", 404);
    }
    if (method !== "POST") return landingError("demo.landing.postRequired", "Demo actions require POST.", 405);
    const [, id, command] = action;
    if (command === "upstream") {
      const upstream = validLandingPreview(body?.upstream, id);
      if (upstream === null) return landingError("demo.landing.invalidUrl", "Enter an HTTP(S) URL without credentials, or reset to the default.");
      if (upstream) landingState.overrides[id] = upstream;
      else delete landingState.overrides[id];
    } else {
      landingState.active[id] = command === "start";
    }
    saveLandingState();
    return landingStatus();
  }

  function createCtiDemoBackup() {
    return {
      schema: "nfon-cti-local-backup-v1",
      exportedAt: now(),
      demo: true,
      app: { name: "NFON CTI API Demo", account: "NFON Demo" },
      data: { callEvents: demo.cti.history },
    };
  }

  function ctiContactsPayload() {
    demo.cti.google.contacts = demo.cti.contacts.filter((contact) => contact.source === "google").length;
    demo.cti.storage.files["contacts.json"].records = demo.cti.contacts.length;
    return { status: demo.cti.google, contacts: demo.cti.contacts };
  }

  function connectCtiDemoContacts() {
    demo.cti.google.connected = true;
    demo.cti.google.lastSyncAt = now();
    demo.cti.contacts = [
      ...demo.cti.contacts.filter((contact) => contact.source === "local"),
      ...JSON.parse(JSON.stringify(ctiGoogleContactSeed)),
    ];
    return ctiContactsPayload();
  }

  function ctiContactError(key, fallback, status) {
    return jsonResponse({ ok: false, error: demoMessage(key, fallback, { detail: "" }) }, status);
  }

  function ctiContactPhone(value) {
    return window.NFON_PHONE?.lookup(value, { countryCode: "49", nationalPrefix: "0" }) || "";
  }

  function ctiRoute(path, method, body, url) {
    if (path === "/api/status") {
      return {
        ok: true,
        connected: true,
        authStatus: "demo",
        credentialsConfigured: true,
        phoneNumberContext: { countryCode: "49", nationalPrefix: "0" },
        demo: true,
        account: "NFON Demo",
        configured: true,
        serverTime: now(),
        csrfToken: token,
        google: demo.cti.google,
        storage: { available: true },
      };
    }
    if (path === "/api/extensions") return demo.cti.extensions;
    if (path === "/api/states") return demo.cti.states;
    if (path === "/api/history") return demo.cti.history;
    if (path === "/api/active-calls") return demo.cti.activeCalls;
    if (path === "/api/events") return "";
    if (path === "/api/google/status") return demo.cti.google;
    if (path === "/api/google/contacts") return ctiContactsPayload();
    if (path === "/auth/google/start" && method === "GET") return connectCtiDemoContacts();
    if (path === "/api/google/sync" || path === "/api/google/disconnect") {
      if (method !== "POST") return ctiContactError("demo.cti.contactActionMethod", "Contact actions require POST.", 405);
      if (path === "/api/google/disconnect") {
        demo.cti.google.connected = false;
        demo.cti.google.lastSyncAt = null;
        demo.cti.contacts = demo.cti.contacts.filter((contact) => contact.source === "local");
        return ctiContactsPayload();
      }
      if (!demo.cti.google.connected) return ctiContactError("demo.cti.contactsDisconnected", "Connect the sample contacts first.", 409);
      const result = connectCtiDemoContacts();
      return { status: result.status, contacts: result.status.contacts };
    }
    if (path === "/api/storage") return demo.cti.storage;
    if (path === "/api/storage/restore") return { ok: true, imported: 3, message: demoMessage("demo.cti.backupChecked", "Demo backup checked.") };
    if (path === "/api/storage/backup") {
      return downloadResponse("nfon-cti-demo-backup.json", JSON.stringify(createCtiDemoBackup(), null, 2), "application/json");
    }
    if (path === "/api/contacts/lookup") {
      const phone = ctiContactPhone(url.searchParams.get("phone"));
      return { contact: phone ? demo.cti.contacts.find((contact) => (contact.phones || []).some((entry) => {
        const candidate = ctiContactPhone(entry.value);
        return candidate && candidate === phone;
      })) || null : null };
    }
    if (path === "/api/local-contacts" && method === "POST") {
      const name = typeof body?.name === "string" ? body.name.trim() : "";
      const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
      if (!name || !ctiContactPhone(phone)) return ctiContactError("cti.error.contactRequired", "Name and phone number are required", 400);
      const contact = {
        id: `local-demo-${++ctiLocalContactSequence}`, name, phone,
        organization: typeof body?.organization === "string" ? body.organization.trim() : "",
        phones: [{ value: phone, canonical: phone, normalized: ctiContactPhone(phone) }],
        emails: [], source: "local",
      };
      demo.cti.contacts.unshift(contact);
      return jsonResponse({ contact, ...ctiContactsPayload() }, 201);
    }
    if (path.startsWith("/api/local-contacts/") && method === "DELETE") {
      const id = decodeURIComponent(path.slice("/api/local-contacts/".length));
      const contact = demo.cti.contacts.find((entry) => entry.id === id && entry.source === "local");
      if (!contact) return ctiContactError("cti.error.contactNotFound", "Local contact not found", 404);
      demo.cti.contacts = demo.cti.contacts.filter((entry) => entry !== contact);
      return ctiContactsPayload();
    }
    if (path === "/api/settings/browser-login") return { ok: true, status: { csrfToken: token, configured: true, account: "NFON Demo" } };
    if (path === "/api/calls" && method === "POST") {
      const target = window.NFON_PHONE?.target(body?.callee || body?.target, { context: body?.context });
      if (!target) return ctiContactError('cti.error.dialTarget','Enter an extension or international number.',400);
      if (body?.timeout !== undefined && body.timeout !== "") {
        const timeout = ["string", "number"].includes(typeof body.timeout) ? Number(body.timeout) : NaN;
        if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120) return ctiContactError('cti.error.dialTimeout','Enter a timeout from 1 to 120 seconds.',400);
      }
      const call = createCtiCall({...body,callee:target.number,context:target.context});
      demo.cti.activeCalls.unshift(call);
      demo.cti.history.unshift(call);
      return { ok: true, uuid: call.uuid, call, activeCalls: demo.cti.activeCalls, history: demo.cti.history };
    }
    if (path.startsWith("/api/calls/") && method === "DELETE") {
      const uuid = decodeURIComponent(path.replace("/api/calls/", ""));
      demo.cti.activeCalls = demo.cti.activeCalls.filter((call) => call.uuid !== uuid);
      return {};
    }
    return landingError('demo.landing.unknownAction', 'Unknown demo action.', 404);
  }

  function portalDemoMessage(key, fallback, params = {}) {
    return window.NFON_I18N?.message?.(key, params) || fallback.replace(/\{(\w+)\}/g, (match, name) => Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match);
  }

  function portalDemoSettings() {
    return { configured: true, authMode: "demo", account: "Demo-Anlage", csrfToken: token, liveWritesEnabled: false, writeContext: "demo-portal-context" };
  }

  function portalRoute(path, method, body) {
    if (path === "/api/status") return { ok: true, configured: true, account: "Demo-Anlage", csrfToken: token, settings: portalDemoSettings() };
    if (path === "/api/customers") return { ok: true, customers: [{ account: "Demo-Anlage", name: "Demo-Anlage", label: "Demo-Anlage" }] };
    if (path === "/api/overview") return portalOverview();
    if (path === "/api/settings/customer") return { ok: true, account: body?.account || "Demo-Anlage", customer: { name: "Demo-Anlage" }, customers: [{ account: "Demo-Anlage", name: "Demo-Anlage", label: "Demo-Anlage" }] };
    if (path === "/api/settings/live-writes") return { ok: true, enabled: false, message: portalDemoMessage("portal.demo.dryRunActive", "Demo dry run active.") };
    if (path === "/api/service-groups") return serviceGroupsResponse();
    if (path === "/api/service-groups/apply") return applyDemoServiceGroups(body);
    if (path === "/api/phonebook-sync/preview") return demoPhonebookPlan();
    if (path === "/api/phonebook-sync/apply") return { ok: false, applied: false, blocked: true, type: "phonebook-sync", message: portalDemoMessage("portal.demo.blockedMessage", "This action is unavailable in demo mode.") };
    if (path === "/api/phonebook-sync/upload") return uploadDemoPhonebook(body);
    if (path === "/api/extensions/batch/plan") return extensionBatchPlan(body);
    if (path === "/api/extensions/batch/apply") return { ...extensionBatchPlan(body), ok: false, applied: false, blocked: true, message: portalDemoMessage("portal.demo.blockedMessage", "This action is unavailable in demo mode.") };
    if (path === "/api/callflow/apply" || path === "/api/callflow/bulk-apply") return applyDemoCallflow(body);
    if (path.startsWith("/api/resources/") && method === "POST") return createDemoPortalResource(path, body);
    if (path === "/api/demo/clone-extension" || path === "/api/demo/create-extension") {
      const clone = path.endsWith("clone-extension");
      return { ok: true, dryRun: true, type: clone ? "clone-extension" : "create-extension", title: portalDemoMessage(clone ? "portal.server.copyPrepared" : "portal.server.newExtensionPrepared", clone ? "Copy prepared" : "New extension prepared"), message: portalDemoMessage("portal.nothingWasSavedInThePortal", "Nothing was saved in the Portal."), body: { extensionNumber: String(body?.extensionNumber || ""), displayName: String(body?.displayName || ""), templateSource: clone ? String(body?.source?.number || body?.source?.id || "") : "" } };
    }
    if (["/api/daynight/gateway-preview", "/api/daynight/gateways/apply", "/api/daynight/time-controls/cleanup", "/api/daynight/reset", "/api/daynight/restore", "/api/daynight/gateway-routing/apply", "/api/daynight/announcement-target/plan", "/api/daynight/announcement-target/apply"].includes(path) && method === "POST") {
      return { ok: true, preview: true, message: portalDemoMessage("portal.demo.planPrepared", "Demo plan prepared."), result: body || {} };
    }
    return landingError('demo.landing.unknownAction', 'Unknown demo action.', 404);
  }

  function callHistoryRoute(path, method, body, url) {
    if (path === "/api/status") {
      return {
        ok: true,
        configured: false,
        authenticated: false,
        oauthConfigured: false,
        historyConfigured: true,
        transcriptsConfigured: true,
        demoMode: true,
        demo: true,
        appId: "core-history",
        account: "NFON Demo",
        csrfToken: token,
        redirectUri: window.location.href,
      };
    }
    if (path === "/api/calls") return callHistoryCalls(url.searchParams);
    if (path.startsWith("/api/transcripts/")) {
      const id = decodeURIComponent(path.replace("/api/transcripts/", ""));
      const call = demo.callHistory.calls.find((item) => item.transcriptId === id);
      return (call ? callHistoryTranscript(call) : demo.callHistory.transcripts.find((item) => item.id === id)) || { ok: false, error: demoMessage("demo.history.transcriptMissing", "Transcript not found") };
    }
    if (path === "/api/assignment-preview") return jsonResponse({ok:false,error:"Not found"},404);
    if (path === "/api/settings/browser-login") return { ok: true, status: { csrfToken: token, authenticated: true, account: "NFON Demo" } };
    if (path === "/api/auth/logout") return { ok: true, status: { csrfToken: token, authenticated: false } };
    if (path.startsWith("/auth/")) return { ok: true, message: demoMessage("demo.history.loginActive", "Demo sign-in active.") };
    return landingError('demo.landing.unknownAction', 'Unknown demo action.', 404);
  }

  function callHistoryCalls(params) {
    const range = params.get("range") || "7d";
    const direction = params.get("direction") || "all";
    const outcome = params.get("outcome") || "all";
    const party = normalize(params.get("party") || "");
    const end = new Date();
    const start = range === "today" ? new Date(end) : new Date(end.getTime() - (range === "30d" ? 30 : 7) * 86400000);
    if (range === "today") start.setHours(0, 0, 0, 0);
    const calls = demo.callHistory.calls.filter((call) => {
      const startedAt = new Date(call.startedAt);
      if (startedAt < start || startedAt > end) return false;
      if (direction !== "all" && call.direction !== direction) return false;
      if (outcome !== "all" && call.outcome !== outcome) return false;
      if (party && !normalize(JSON.stringify(call)).includes(party)) {
        const digits = party.replace(/\D/g, "");
        if (!digits || ![call.from?.number, call.to?.number].some(number => String(number || "").replace(/\D/g, "").includes(digits))) return false;
      }
      return true;
    });
    return { ok: true, source: "demo", generatedAt: now(), filters: Object.fromEntries(params.entries()), calls };
  }

  function createDemoState() {
    const state = {};
    for (const [key, create] of Object.entries({callHistory:createCallHistoryData, cti:createCtiData, portal:createPortalData})) {
      let value;
      Object.defineProperty(state,key,{get(){ return value || (value=create()); }});
    }
    return state;
  }

  function createCallHistoryData() {
    const customers = [
      ["Mara Seidel", "Demo Account A", "mara.seidel@example.local", "+49 89 0000 2101"],
      ["Klaus Berger", "Demo Account B", "klaus.berger@example.local", "+49 89 0000 2102"],
      ["Nadine Roth", "Demo Account C", "nadine.roth@example.local", "+49 89 0000 2103"],
      ["Oliver Brandt", "Demo Account D", "oliver.brandt@example.local", "+49 89 0000 2104"],
      ["Fatima Yildiz", "Demo Account E", "fatima.yildiz@example.local", "+49 89 0000 2105"],
      ["Henrik Vogt", "Demo Account F", "henrik.vogt@example.local", "+49 89 0000 2106"],
      ["Carla Nguyen", "Demo Account G", "carla.nguyen@example.local", "+49 89 0000 2107"],
      ["Ben Hoffmann", "Demo Account H", "ben.hoffmann@example.local", "+49 89 0000 2108"],
      ["Iris Schaefer", "Demo Account I", "iris.schaefer@example.local", "+49 89 0000 2109"],
      ["David Lorenz", "Demo Account J", "david.lorenz@example.local", "+49 89 0000 2110"],
      ["Selin Aydin", "Demo Account K", "selin.aydin@example.local", "+49 89 0000 2111"],
      ["Robert Hahn", "Demo Account L", "robert.hahn@example.local", "+49 89 0000 2112"],
    ];
    const agents = [
      ["201", "Anna Weber", "Reception"],
      ["202", "Max Schneider", "Sales"],
      ["203", "Laura Fischer", "Support"],
      ["204", "Mehmet Kaya", "Customer Success"],
      ["205", "Sophie Neumann", "Operations"],
      ["206", "Jonas Becker", "Sales"],
      ["207", "Mira Hoffmann", "Support"],
      ["208", "Daniel Wagner", "Finance"],
      ["209", "Nina Bauer", "Service"],
      ["210", "Felix Richter", "Service"],
      ["211", "Lea Wolf", "Backoffice"],
      ["212", "Tim Schwarz", "Logistics"],
    ];
    const queues = ["Reception", "Sales", "Support", "Customer Success", "Service", "Backoffice"];
    const calls = [];
    const today = new Date();

    for (let dayOffset = 29; dayOffset >= 0; dayOffset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - dayOffset);
      const count = callHistoryBusinessVolume(date, dayOffset);
      for (let index = 0; index < count; index += 1) {
        const customer = customers[(index * 5 + dayOffset) % customers.length];
        const agent = agents[(index * 7 + dayOffset) % agents.length];
        const queue = queues[(index * 3 + dayOffset) % queues.length];
        const direction = seededPick(index * 17 + dayOffset * 13, 100) < 64 ? "inbound" : "outbound";
        const answered = direction === "outbound"
          ? seededPick(index * 31 + dayOffset, 100) < 92
          : seededPick(index * 29 + dayOffset, 100) < 76;
        const outcome = answered
          ? "answered"
          : direction === "outbound" && seededPick(index * 11 + dayOffset, 100) < 55
            ? "cancelled"
            : "missed";
        const durationSeconds = outcome === "answered" ? 65 + seededPick(index * 37 + dayOffset * 19, 870) : 0;
        const startedAt = callHistoryStartedAt(date, index, dayOffset);
        if (startedAt.getTime() + durationSeconds * 1000 > today.getTime()) continue;
        const id = `demo-call-${ctiDayKey(startedAt).replaceAll("-", "")}-${String(index + 1).padStart(3, "0")}`;
        const hasTranscript = outcome === "answered" && seededPick(index * 41 + dayOffset * 23, 100) < (direction === "inbound" ? 72 : 46);
        calls.push(demoCallAt({
          id,
          startedAt,
          direction,
          outcome,
          transcriptId: hasTranscript ? `tr-${id}` : "",
          contactName: customer[0],
          company: customer[1],
          email: customer[2],
          phone: customer[3],
          queue,
          extension: agent[0],
          agentName: agent[1],
          durationSeconds,
        }));
      }
    }

    calls.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt));
    const transcripts = calls.filter((call) => call.transcriptId).map(callHistoryTranscript);
    return { calls, transcripts };
  }

  function demoCall(id, relativeMinutesAgo, direction, outcome, transcriptId, contactName, company, queue, extension, durationSeconds) {
    const startedAt = new Date(Date.now() - relativeMinutesAgo * 60000);
    return demoCallAt({ id, startedAt, direction, outcome, transcriptId, contactName, company, email: "", phone: `+49 00 0000 ${id.slice(-4)}`, queue, extension, agentName: `Demo Agent ${extension}`, durationSeconds });
  }

  function demoCallAt({ id, startedAt, direction, outcome, transcriptId, contactName, company, email, phone, queue, extension, agentName, durationSeconds }) {
    const relativeMinutesAgo = Math.max(0, Math.round((Date.now() - startedAt.getTime()) / 60000));
    const external = { number: phone, name: contactName, type: "external" };
    const internal = { number: extension, name: queue, type: "extension" };
    return {
      id,
      relativeMinutesAgo,
      source: "demo",
      demoTemplate: "call-history-v1",
      startedAt: startedAt.toISOString(),
      direction,
      from: direction === "inbound" ? external : internal,
      to: direction === "inbound" ? internal : external,
      user: { number: extension, name: agentName, email: `${agentName.toLowerCase().replaceAll(" ", ".")}@example.local` },
      queue: { name: queue, id: queue },
      durationSeconds,
      outcome,
      transcriptId,
      summary: demoMessage("history.demoCallSummary", "{customer} · {queue} · Demo system", { customer: contactName, queue }),
      contact: company ? { name: contactName, company, email } : null,
      tags: ["demo", queue.toLowerCase().replaceAll(" ", "-")],
    };
  }

  function callHistoryTranscript(call) {
    const customerName = call.contact?.name || call.from.name;
    const company = call.contact?.company || "NFON Demo";
    return {
      ok: true,
      id: call.transcriptId,
      callId: call.id,
      language: window.NFON_I18N?.getLanguage?.() || "en",
      source: "demo",
      confidence: 0.89 + seededPick(call.relativeMinutesAgo, 9) / 100,
      summary: demoMessage("history.demoTranscriptSummary", "{customer} from {company} discussed the current service request. The next steps were documented.", { customer: customerName, company }),
      text: demoMessage("history.demoTranscriptText", "{customer}: We need a brief update on the current case.\n{agent}: I will check the status and document the next steps.", { customer: customerName, agent: call.user.name }),
      topics: ["Demo", "Call History", call.user.name, call.contact?.company || "Demo"],
      assignee: { name: call.user.name, email: call.user.email },
    };
  }

  function callHistoryStartedAt(date, index, dayOffset) {
    const startedAt = new Date(date);
    startedAt.setHours(callHistoryBusinessHour(index, dayOffset), seededPick(index * 43 + dayOffset, 60), seededPick(index * 47 + dayOffset, 60), 0);
    return startedAt;
  }

  function callHistoryBusinessVolume(date, dayOffset) {
    return CALL_HISTORY_CALLS_PER_DAY;
  }

  function callHistoryBusinessHour(index, dayOffset) {
    const buckets = [
      [8, 7],
      [9, 13],
      [10, 15],
      [11, 12],
      [12, 6],
      [13, 10],
      [14, 16],
      [15, 12],
      [16, 7],
      [17, 2],
    ];
    let pick = seededPick(index * 19 + dayOffset * 31, 100);
    for (const [hour, weight] of buckets) {
      if (pick < weight) return hour;
      pick -= weight;
    }
    return 16;
  }

  function createCtiData() {
    const extensionNames = [
      ["201", "Anna Weber", "Frontdesk"],
      ["202", "Max Schneider", "Sales"],
      ["203", "Laura Fischer", "Support"],
      ["204", "Mehmet Kaya", "Customer Success"],
      ["205", "Sophie Neumann", "Operations"],
      ["206", "Jonas Becker", "Sales"],
      ["207", "Mira Hoffmann", "Support"],
      ["208", "Daniel Wagner", "Finance"],
      ["209", "Nina Bauer", "Service"],
      ["210", "Felix Richter", "Service"],
      ["211", "Lea Wolf", "Backoffice"],
      ["212", "Tim Schwarz", "Logistics"],
      ["213", "Amira Klein", "Support"],
      ["214", "Lukas Braun", "Sales"],
      ["215", "Julia Krueger", "HR"],
      ["216", "Paul Zimmermann", "Operations"],
      ["217", "Sarah Hartmann", "Customer Success"],
      ["218", "Noah Lange", "Support"],
      ["219", "Elena Schmitt", "Marketing"],
      ["220", "Tobias Meyer", "Management"],
    ];
    const extensions = extensionNames.map(([number, name, team]) => ({
      extension_number: number,
      extension: number,
      name,
      email: `${name.toLowerCase().replaceAll(" ", ".")}@example.local`,
      team,
    }));
    const states = extensions.map((extension, index) => ({
      extension: extension.extension_number,
      presence: index % 7 === 2 ? "busy" : index % 11 === 4 ? "away" : "available",
      line: index % 6 === 2 ? "in-use" : "idle",
    }));
    const history = createCtiHistory(extensions);
    return {
      extensions,
      states,
      history,
      activeCalls: createCtiActiveCalls(extensions),
      events: history.slice(0, 32).map((call) => ({ extension: call.extension })),
      google: { configured: true, connected: true, contacts: 4, account: "NFON Demo", demo: true, lastSyncAt: now() },
      contacts: [
        { id: "", name: "Demo Contact A", organization: "Demo Account A", phone: "+49 89 0000 2001", phones: [{ value: "+49 89 0000 2001", normalized: "498900002001" }], emails: [{ value: "kontakt-a@example.local" }], source: "google" },
        { id: "", name: "Demo Contact B", organization: "Demo Account B", phone: "+49 89 0000 2002", phones: [{ value: "+49 89 0000 2002", normalized: "498900002002" }], emails: [{ value: "kontakt-b@example.local" }], source: "google" },
        { id: "", name: "Demo Contact C", organization: "Demo Account C", phone: "+49 89 0000 2003", phones: [{ value: "+49 89 0000 2003", normalized: "498900002003" }], emails: [{ value: "kontakt-c@example.local" }], source: "google" },
        { id: "", name: "Demo Contact D", organization: "Demo Account D", phone: "+49 89 0000 2004", phones: [{ value: "+49 89 0000 2004", normalized: "498900002004" }], emails: [{ value: "kontakt-d@example.local" }], source: "google" },
      ],
      storage: { ok: true, files: { "history.json": { bytes: history.length * 420, records: history.length }, "contacts.json": { bytes: 4096, records: 4 } } },
    };
  }

  function createCtiHistory(extensions) {
    const externalNumbers = [
      "+49 89 0000 2001",
      "+49 89 0000 2002",
      "+49 89 0000 2003",
      "+49 89 0000 2004",
      "+49 89 0000 2005",
      "+49 89 0000 2006",
      "+49 89 0000 2007",
      "+49 89 0000 2008",
      "+49 89 0000 2009",
      "+49 89 0000 2010",
      "+49 89 0000 2011",
      "+49 89 0000 2012",
    ];
    const history = [];
    const today = new Date();
    for (let dayOffset = 13; dayOffset >= 0; dayOffset -= 1) {
      const date = new Date(today);
      date.setDate(today.getDate() - dayOffset);
      const count = ctiBusinessVolume(date, dayOffset);
      for (let index = 0; index < count; index += 1) {
        const extension = extensions[(index * 3 + dayOffset) % extensions.length];
        const external = externalNumbers[(index * 5 + dayOffset) % externalNumbers.length];
        const direction = seededPick(index + dayOffset * 17, 100) < 66 ? "inbound" : "outbound";
        const answered = direction === "outbound" || seededPick(index * 19 + dayOffset, 100) < 78;
        const startedAt = new Date(date);
        const hour = ctiBusinessHour(index, dayOffset);
        startedAt.setHours(hour, seededPick(index * 29 + dayOffset, 60), seededPick(index * 31 + dayOffset, 60), 0);
        const durationSeconds = answered ? 45 + seededPick(index * 37 + dayOffset, 540) : 0;
        if (startedAt.getTime() + Math.max(10,durationSeconds) * 1000 > today.getTime()) continue;
        const uuid = `demo-cti-${ctiDayKey(startedAt)}-${String(index).padStart(3, "0")}`;
        const caller = direction === "outbound" ? extension.extension_number : external;
        const callee = direction === "outbound" ? external : "+49 89 12345-0";
        const sequence = direction === "outbound"
          ? ["caller-dial", "dial", "answer", "hangup"]
          : answered ? ["caller-ring", "ring", "answer", "hangup"] : ["caller-ring", "ring", "hangup"];
        sequence.forEach((stateName, stateIndex) => {
          const eventDate = new Date(startedAt);
          const offset = stateName === "hangup" ? Math.max(10, durationSeconds) : stateIndex * 4;
          eventDate.setSeconds(startedAt.getSeconds() + offset);
          history.push({
            uuid,
            id: `${uuid}-${stateName}`,
            demo: true,
            account: "NFON Demo",
            extension: extension.extension_number,
            caller,
            callee,
            direction,
            state: stateName,
            startedAt: startedAt.toISOString(),
            updated: eventDate.toISOString(),
            receivedAt: eventDate.toISOString(),
            durationMs: durationSeconds * 1000,
            team: extension.team,
          });
        });
      }
    }
    return history.sort((a, b) => new Date(b.receivedAt || b.updated) - new Date(a.receivedAt || a.updated));
  }

  function ctiBusinessVolume(date, dayOffset) {
    const weekday = date.getDay();
    if (weekday === 0) return 14 + seededPick(dayOffset, 8);
    if (weekday === 6) return 22 + seededPick(dayOffset, 10);
    const base = [72, 86, 79, 91, 68][weekday - 1] || 76;
    return base + seededPick(dayOffset * 11, 15);
  }

  function ctiBusinessHour(index, dayOffset) {
    const buckets = [
      [8, 5],
      [9, 10],
      [10, 14],
      [11, 13],
      [12, 7],
      [13, 11],
      [14, 15],
      [15, 12],
      [16, 9],
      [17, 4],
    ];
    let pick = seededPick(index * 23 + dayOffset * 41, 100);
    for (const [hour, weight] of buckets) {
      if (pick < weight) return hour;
      pick -= weight;
    }
    return 17;
  }

  function ctiDayKey(date) {
    return new Date(date).toLocaleDateString("sv-SE");
  }

  function seededPick(seed, max) {
    const x = Math.sin(seed + 1) * 10000;
    return Math.floor((x - Math.floor(x)) * max);
  }

  function createCtiActiveCalls(extensions) {
    const nowDate = new Date();
    return [
      {
        uuid: "active-demo-cti-1",
        id: "active-demo-cti-1",
        extension: extensions[1]?.extension_number || "202",
        caller: "+49 89 0000 2004",
        callee: "+49 89 12345-0",
        direction: "inbound",
        state: "answer",
        updated: new Date(nowDate.getTime() - 180000).toISOString(),
        receivedAt: new Date(nowDate.getTime() - 180000).toISOString(),
        team: extensions[1]?.team || "Sales",
      },
      {
        uuid: "active-demo-cti-2",
        id: "active-demo-cti-2",
        extension: extensions[6]?.extension_number || "207",
        caller: extensions[6]?.extension_number || "207",
        callee: "+49 89 0000 2008",
        direction: "outbound",
        state: "answer",
        updated: new Date(nowDate.getTime() - 90000).toISOString(),
        receivedAt: new Date(nowDate.getTime() - 90000).toISOString(),
        team: extensions[6]?.team || "Support",
      },
    ];
  }

  function createPortalData() {
    const extensions = [
      { id: "201", number: "201", name: "Anna Weber", type: "PHONE", email: "anna.weber@example.local", device: "Yealink T54W" },
      { id: "202", number: "202", name: "Max Schneider", type: "PHONE", email: "max.schneider@example.local", device: "Softphone" },
      { id: "203", number: "203", name: "Laura Fischer", type: "PHONE", email: "laura.fischer@example.local", device: "Yealink T46S" },
      { id: "204", number: "204", name: "Mehmet Kaya", type: "PHONE", email: "mehmet.kaya@example.local", device: "Softphone" },
      { id: "205", number: "205", name: "Sophie Neumann", type: "PHONE", email: "sophie.neumann@example.local", device: "Yealink T54W" },
      { id: "206", number: "206", name: "Jonas Becker", type: "PHONE", email: "jonas.becker@example.local", device: "Softphone" },
      { id: "207", number: "207", name: "Mira Hoffmann", type: "PHONE", email: "mira.hoffmann@example.local", device: "Yealink T46S" },
      { id: "208", number: "208", name: "Daniel Wagner", type: "PHONE", email: "daniel.wagner@example.local", device: "Softphone" },
    ];
    const member = (number, penalty = 0, skillLevel = 1) => {
      const extension = extensions.find((item) => item.number === number) || { number, id: number, name: portalDemoMessage("portal.extensionValue", "Extension {p0}", { p0: number }), type: "PHONE" };
      return { extensionNumber: extension.number, id: extension.id, name: extension.name, type: extension.type, penalty, skillLevel, enabled: true };
    };
    const queues = [
      { id: "10000", serviceNumber: "10000", extensionNumber: "10000", value: "10000", name: "Demo Frontdesk", color: "green", members: [member("201"), member("202")], overflow: "203" },
      { id: "10001", serviceNumber: "10001", extensionNumber: "10001", value: "10001", name: "Demo Support Queue", color: "blue", members: [member("203"), member("204"), member("207")], overflow: "205" },
    ];
    const skills = [
      { id: "10010", serviceNumber: "10010", extensionNumber: "10010", value: "10010", name: portalDemoMessage("portal.demo.skillGroup", "Demo skill group"), color: "purple", members: [member("202", 0, 3), member("206", 0, 2), member("208", 0, 1)] },
    ];
    const phonebook = [
      phonebookEntry("pb-001", "Mara Seidel", "Demo Account A", "+49 89 0000 2101", "mara.seidel@example.local"),
      phonebookEntry("pb-002", "Klaus Berger", "Demo Account B", "+49 89 0000 2102", "klaus.berger@example.local"),
      phonebookEntry("pb-003", "Nadine Roth", "Demo Account C", "+49 89 0000 2103", "nadine.roth@example.local"),
      phonebookEntry("pb-004", "Oliver Brandt", "Demo Account D", "+49 89 0000 2104", "oliver.brandt@example.local"),
      phonebookEntry("pb-005", "Fatima Yildiz", "Demo Account E", "+49 89 0000 2105", "fatima.yildiz@example.local"),
      phonebookEntry("pb-006", "Henrik Vogt", "Demo Account F", "+49 89 0000 2106", "henrik.vogt@example.local"),
      phonebookEntry("pb-007", "Carla Nguyen", "Demo Account G", "+49 89 0000 2107", "carla.nguyen@example.local"),
      phonebookEntry("pb-008", "Ben Hoffmann", "Demo Account H", "+49 89 0000 2108", "ben.hoffmann@example.local"),
      phonebookEntry("pb-009", "Iris Schaefer", "Demo Account I", "+49 89 0000 2109", "iris.schaefer@example.local"),
      phonebookEntry("pb-010", "David Lorenz", "Demo Account J", "+49 89 0000 2110", "david.lorenz@example.local"),
      phonebookEntry("pb-011", "Selin Aydin", "Demo Account K", "+49 89 0000 2111", "selin.aydin@example.local"),
      phonebookEntry("pb-012", "Robert Hahn", "Demo Account L", "+49 89 0000 2112", "robert.hahn@example.local"),
      phonebookEntry("pb-013", "Tanja Krueger", "Demo Account M", "+49 89 0000 2113", "tanja.krueger@example.local"),
      phonebookEntry("pb-014", "Philip Sommer", "Demo Account N", "+49 89 0000 2114", "philip.sommer@example.local"),
      phonebookEntry("pb-015", "Jana Keller", "Demo Account O", "+49 89 0000 2115", "jana.keller@example.local"),
      phonebookEntry("pb-016", "Martin Lehmann", "Demo Account P", "+49 89 0000 2116", "martin.lehmann@example.local"),
      phonebookEntry("pb-017", "Leonie Fuchs", "Demo Account Q", "+49 89 0000 2117", "leonie.fuchs@example.local"),
      phonebookEntry("pb-018", "Armin Weiss", "Demo Account R", "+49 89 0000 2118", "armin.weiss@example.local"),
    ];
    return {
      extensions,
      callflow: {
        source: "demo",
        didId: "+49 89 12345-0",
        original: { did: "+49 89 12345-0", destinationName: "Demo Frontdesk", destinationExtension: "10000", destinationServiceNumber: "10000", destinationType: "QUEUE" },
        nodes: [
          { id: "inbound", type: "DID", title: portalDemoMessage("portal.incomingCall", "Incoming call"), subtitle: "+49 89 12345-0", x: 8, y: 45, tone: "blue", locked: true },
          { id: "trunk", type: "Trunk", title: portalDemoMessage("portal.line", "Line"), subtitle: "Main SIP Trunk", x: 34, y: 45, tone: "purple", locked: true },
          { id: "target", type: "QUEUE", title: "Demo Frontdesk", subtitle: portalDemoMessage("portal.demo.queueNumber", "Queue 10000"), targetNumber: "10000", routeNumber: "10000", x: 68, y: 45, tone: "amber", serviceKind: "queue", serviceColor: "green", memberCount: 2, memberNames: ["201 Anna Weber", "202 Max Schneider"], isTarget: true, config: { portalMode: "existing" } },
        ],
        edges: [{ from: "inbound", to: "trunk", label: portalDemoMessage("portal.server.arrivesAt", "Arrives at") }, { from: "trunk", to: "target", label: portalDemoMessage("portal.routesTo", "routes to") }],
      },
      phonebook,
      phonebookSummary: { create: 4, update: 3, unchanged: phonebook.length - 7 },
      serviceGroups: { ok: true, account: "Demo-Anlage", queues, skills, extensions, syncedAt: now() },
    };
  }

  function phonebookEntry(id, name, company, phone, email) {
    return {
      id,
      name,
      contact: name,
      company,
      email,
      number: phone,
      phone,
      status: "present",
      bookName: "Company",
      phones: [{ value: phone, normalized: phone.replace(/\D/g, "") }],
    };
  }

  function portalOverview() {
    const extensions = demo.portal.extensions;
    const queues = demo.portal.serviceGroups.queues || [];
    const skills = demo.portal.serviceGroups.skills || [];
    const overview = {
      ok: true,
      demo: true,
      account: "Demo-Anlage",
      version: { version: "Demo", host: "static" },
      customer: { company: "Demo-Anlage", account: "Demo-Anlage" },
      counts: { extensions: extensions.length, devices: 2, trunks: 1, dids: 3, phoneBooks: demo.portal.phonebook.length, groups: 1, queues: queues.length, skills: skills.length, ivrs: 1, timeControls: 1, announcements: 1 },
      inventory: {
        extensions,
        devices: [{ id: "demo-softphone", name: "Softphone" }, { id: "demo-t54", name: "Yealink T54W" }],
        trunks: [{ id: "demo-trunk", name: "Main SIP Trunk", value: "+49 89 12345-0" }],
        dids: [
          { id: "+49 89 12345-0", name: "+49 89 12345-0", value: "Demo Frontdesk", trunkNumber: "+49 89 12345(0-9)", didExtension: "0", destinationName: "Demo Frontdesk", destinationExtension: "10000", destinationServiceNumber: "10000", destinationType: "QUEUE" },
          { id: "+49 89 12345-1", name: "+49 89 12345-1", value: "Demo Support Queue", trunkNumber: "+49 89 12345(0-9)", didExtension: "1", destinationName: "Demo Support Queue", destinationExtension: "10001", destinationServiceNumber: "10001", destinationType: "QUEUE" },
          { id: "+49 89 12345-2", name: "+49 89 12345-2", value: "Anna Weber", trunkNumber: "+49 89 12345(0-9)", didExtension: "2", destinationName: "Anna Weber", destinationExtension: "201", destinationType: "PHONEEXTENSION" },
        ],
        phoneBooks: demo.portal.phonebook,
        groups: [{ id: "10", name: "Reception Group" }],
        queues,
        skills,
        ivrs: [{ id: "20", serviceNumber: "20", value: "20", name: "Welcome IVR" }],
        timeControls: [{ id: "30", serviceNumber: "30", value: "30", name: "Business Hours" }],
        announcements: [{ id: "40", name: portalDemoMessage("portal.server.nightAnnouncement", "Night announcement"), value: "GENERAL_ANNOUNCEMENT" }],
      },
      endpoints: {},
      callflow: demo.portal.callflow,
      settings: portalDemoSettings(),
      syncedAt: now(),
    };
    let applied = {};
    try { applied = JSON.parse(localStorage.getItem('nfon-portal-flow-applied-v2') || '{}'); } catch { /* Unavailable or malformed browser storage. */ }
    for (const did of overview.inventory.dids) {
      const snapshot = applied?.[`${overview.account}:${did.id}`];
      if (snapshot?.did !== did.name || !Array.isArray(snapshot?.flow?.nodes)) continue;
      const target = snapshot.target?.type ? snapshot.target : demoFlowRoot(snapshot.flow);
      if (target) Object.assign(did, demoRouting(did.id,target));
    }
    const changed = demo.portal.routingOverride;
    if (changed) { const did = overview.inventory.dids.find(item => item.id === changed.did); if (did) Object.assign(did, changed); }
    return overview;
  }

  function serviceGroupsResponse() {
    demo.portal.serviceGroups.syncedAt = now();
    demo.portal.serviceGroups.extensions = demo.portal.extensions;
    for (const group of [...demo.portal.serviceGroups.queues, ...demo.portal.serviceGroups.skills]) group.memberRevision = JSON.stringify(group.members);
    return demo.portal.serviceGroups;
  }

  function applyDemoServiceGroups(body) {
    const services = Array.isArray(body?.services) ? body.services : [];
    const current = serviceGroupsResponse();
    if (body.account !== current.account) return jsonResponse({ok:false,error:'Account changed.'},409);
    const changes = [];
    for (const service of services) {
      const target = (current[service.kind === 'skill' ? 'skills' : 'queues'] || []).find(item => String(item.serviceNumber || item.id) === String(service.serviceNumber));
      if (!target || service.baseRevision !== target.memberRevision) return jsonResponse({ok:false,error:'Memberships changed. Reload before applying.'},409);
      if (!Array.isArray(service.add) || !Array.isArray(service.remove) || !Array.isArray(service.update)) return jsonResponse({ok:false,error:'Explicit membership changes required.'},400);
      changes.push({service,target});
    }
    for (const {service,target} of changes) {
      const key = member => String(member.extensionNumber || member.number || member.id || member);
      const members = new Map(target.members.map(member=>[key(member),member]));
      for (const member of service.remove) members.delete(key(member));
      for (const member of [...service.add,...service.update]) {
        const number=key(member); members.set(number,{...members.get(number),...member,extensionNumber:number,id:number,name:member.name || extensionName(number),type:member.type || 'PHONE'});
      }
      target.members=[...members.values()];
    }
    return {ok:true,title:portalDemoMessage('portal.demo.localMembershipsApplied','Demo memberships applied'),message:portalDemoMessage('portal.demo.membershipsSaved','Queues and skill groups were updated locally in the demo PBX.'),overview:portalOverview(),serviceGroups:serviceGroupsResponse(),appliedAt:now()};
  }

  function createDemoPortalResource(path, body) {
    const collection = decodeURIComponent(path.replace("/api/resources/", "").split("/")[0] || "");
    if (!['queues','skills','ivrs','timeControls'].includes(collection)) return landingError('demo.landing.unknownAction', 'Unknown demo action.', 404);
    if (collection !== "queues" && collection !== "skills") {
      return { ok: true, preview: true, message: portalDemoMessage("portal.demo.resourcePrepared", "Demo resource prepared."), result: body || {} };
    }
    const existing = [
      ...(demo.portal.serviceGroups.queues || []),
      ...(demo.portal.serviceGroups.skills || []),
    ];
    const start = collection === "queues" ? 10000 : 10010;
    const used = new Set(existing.map((item) => Number(item.serviceNumber || item.id || item.value)).filter(Number.isFinite));
    let next = start;
    while (used.has(next)) next += 1;
    const number = String(body?.extensionNumber || body?.serviceNumber || next);
    const name = String(body?.displayName || (collection === "queues" ? portalDemoMessage("portal.demo.newQueue", "New demo queue") : portalDemoMessage("portal.demo.newSkillGroup", "New demo skill group"))).trim();
    const item = {
      id: number,
      serviceNumber: number,
      extensionNumber: number,
      value: number,
      name,
      color: collection === "queues" ? "amber" : "purple",
      members: [],
    };
    demo.portal.serviceGroups[collection].push(item);
    return {
      ok: true,
      title: portalDemoMessage("portal.demo.resourceCreated", "{p0} created locally", { p0: collection === "queues" ? portalDemoMessage("portal.queue", "Queue") : portalDemoMessage("portal.skillGroup", "Skill group") }),
      message: portalDemoMessage("portal.demo.namedResourceCreated", "{p0} was created in the demo PBX.", { p0: name }),
      item,
      overview: portalOverview(),
      serviceGroups: serviceGroupsResponse(),
      createdAt: now(),
    };
  }

  function demoFlowRoot(flow) {
    const nodes=flow?.nodes || [], edges=flow?.edges || [];
    let node=nodes.find(item=>item.id==='inbound') || nodes.find(item=>item.locked);
    const seen=new Set();
    while(node?.locked || String(node?.type).toUpperCase()==='TRUNK') {
      if(seen.has(node.id)) return null;
      seen.add(node.id);
      const outgoing=edges.filter(edge=>edge.from===node.id&&!edge.virtual&&!edge.branchField);
      if(outgoing.length!==1) return null;
      node=nodes.find(item=>item.id===outgoing[0].to);
    }
    return node || nodes.find(item=>item.isTarget) || null;
  }

  function demoRouting(did,target) {
    return {did,destinationName:target.title || '',destinationExtension:target.targetNumber || target.number || '',destinationServiceNumber:target.routeNumber || '',destinationType:target.type,value:target.title || ''};
  }

  function applyDemoCallflow(body) {
    let target=body?.target?.type ? body.target : demoFlowRoot(body?.flow);
    if (target && !target.routeNumber && !target.targetNumber && !target.number && target.type !== 'HANGUP') {
      const seed = [...String(target.id || target.title || target.type)].reduce((hash,char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0);
      const number = String(12000 + seed % 8000);
      target = { ...target, number, targetNumber: number, routeNumber: number };
    }
    if (body?.flow) {
      demo.portal.callflow = body.flow;
      if (target) demo.portal.routingOverride = demoRouting(body.did?.id || body.flow.didId || body.flow.original?.did,target);
    }
    return {
      ok: true,
      applied: true,
      title: portalDemoMessage("portal.demo.flowAppliedLocally", "Callflow applied locally"),
      message: portalDemoMessage("portal.demo.flowSavedLocally", "The callflow was saved locally in the demo PBX."),
      flow: demo.portal.callflow,
      target,
      overview: portalOverview(),
      appliedAt: now(),
    };
  }

  function extensionName(number) {
    const extension = demo.portal.extensions.find((item) => String(item.number || item.id) === String(number));
    return extension?.name || portalDemoMessage("portal.extensionValue", "Extension {p0}", { p0: number });
  }

  function extensionBatchPlan(body) {
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    const existing = new Set(demo.portal.extensions.map(item => String(item.number || item.id)));
    const seen = new Set();
    const entries = rows.map((item, index) => {
      const extensionNumber = String(item.extensionNumber || item.number || "").trim();
      const displayName = String(item.displayName || item.name || "").trim();
      const mailboxPin = String(item.mailboxPin || item.pin || "").trim();
      const errors = [];
      if (!extensionNumber) errors.push(portalDemoMessage("portal.server.numberMissing", "Number missing"));
      if (!/^\d{2,8}$/.test(extensionNumber)) errors.push(portalDemoMessage("portal.server.numberMustContain2To8Digits", "Number must contain 2 to 8 digits"));
      if (!displayName) errors.push(portalDemoMessage("portal.server.nameMissing", "Name missing"));
      if (!mailboxPin) errors.push(portalDemoMessage("portal.server.mailboxPinMissing", "Mailbox PIN missing"));
      if (mailboxPin && !/^\d{4,12}$/.test(mailboxPin)) errors.push(portalDemoMessage("portal.server.mailboxPinMustContain4To12Digits", "Mailbox PIN must contain 4 to 12 digits"));
      if (existing.has(extensionNumber)) errors.push(portalDemoMessage("portal.server.extensionAlreadyExists", "Extension already exists"));
      if (seen.has(extensionNumber)) errors.push(portalDemoMessage("portal.server.numberAppearsMoreThanOnceInTheList", "Number appears more than once in the list"));
      seen.add(extensionNumber);
      return { ...item, index, extensionNumber, displayName, mailboxPin, ok: errors.length === 0, errors };
    });
    const valid = entries.filter(entry => entry.ok).length;
    const ok = entries.length > 0 && valid === entries.length;
    return { ok, dryRun: true, type: "extension-batch", title: ok ? portalDemoMessage("portal.server.batchImportChecked", "Batch import checked") : portalDemoMessage("portal.server.batchImportIncomplete", "Batch import incomplete"), message: portalDemoMessage("portal.demo.batchPreview", "Extensions ready: {valid} of {total}. Nothing is saved.", { valid, total: entries.length }), entries, summary: { total: entries.length, valid, invalid: entries.length - valid, existing: existing.size } };
  }

  function uploadDemoPhonebook(body) {
    const contacts = body?.contacts;
    if (!Array.isArray(contacts) || !contacts.length) throw new Error(portalDemoMessage("portal.server.uploadContainsNoContacts", "Upload contains no contacts."));
    if (contacts.length > 5000) throw new Error(portalDemoMessage("portal.server.uploadIsTooLargeMaximum5000ContactsPerFile", "Upload is too large. Maximum 5000 contacts per file."));
    demo.portal.phonebookSource = contacts.flatMap((contact) => {
      const phones = Array.isArray(contact.phones) ? contact.phones : String(contact.phones || contact.phone || "").split(/[;,]/);
      return phones.map(phone => ({ contact: String(contact.name || contact.displayName || "").trim(), phone: String(phone?.value || phone).trim() })).filter(row => row.contact && row.phone);
    });
    if (!demo.portal.phonebookSource.length) throw new Error(portalDemoMessage("portal.server.uploadContainsNoContacts", "Upload contains no contacts."));
    demo.portal.phonebookSourceFile = String(body?.source || "demo-contacts");
    return { ok: true, contacts: contacts.length, settings: { ...portalOverview().settings, googleContactsFile: demo.portal.phonebookSourceFile } };
  }

  function demoPhonebookPlan() {
    const target = demo.portal.phonebook;
    const source = demo.portal.phonebookSource || target.map(row => ({contact: row.contact, phone: row.phone}));
    const phoneKey = value => String(value || "").replace(/\D/g, "");
    const byPhone = new Map(target.map(row => [phoneKey(row.phone), row]));
    const seen = new Set();
    const actions = [];
    const summary = { create: 0, update: 0, unchanged: 0, duplicate: 0 };
    const rows = source.map(row => {
      const key = phoneKey(row.phone);
      const previous = byPhone.get(key);
      if (seen.has(key)) { summary.duplicate += 1; return {...row, status: "duplicate", reason: portalDemoMessage("portal.server.duplicatePhoneNumberInTheContactSource", "Duplicate phone number in the contact source")}; }
      seen.add(key);
      const status = !previous ? "create" : previous.contact === row.contact ? "unchanged" : "update";
      summary[status] += 1;
      if (status !== "unchanged") actions.push({action: status, contact: row.contact, phone: row.phone});
      return {...row, status};
    });
    return { ok: true, dryRun: true, type: "phonebook-sync", title: portalDemoMessage("portal.demo.phonebookPreview", "Phonebook comparison"), message: portalDemoMessage("portal.demo.previewOnly", "Local preview. No live changes are written."), source: { file: demo.portal.phonebookSourceFile || "demo-contacts", googleContacts: source.length, googlePhones: source.length }, target: { portalEntries: target.length, phoneBook: "Company" }, summary, actions, preview: { google: rows, nfon: target }, rows };
  }

  function createCtiCall(body) {
    const timestamp = now();
    return {
      uuid: `demo-call-${Date.now()}`,
      extension: body?.caller || body?.extension || "202",
      caller: body?.caller || "202",
      callee: body?.callee || body?.target || "+49 89 0000 2001",
      direction: "outbound",
      state: "answer",
      startedAt: timestamp,
      updated: timestamp,
      receivedAt: timestamp,
      durationMs: 0,
      team: "Demo",
    };
  }

  function randomCtiState(extension) {
    return { extension, presence: "available", line: Math.random() > 0.5 ? "idle" : "in-use" };
  }

  function jsonResponse(payload, status = 200) {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  function downloadResponse(filename, text, type) {
    return new Response(text, {
      status: 200,
      headers: { "Content-Type": type, "Content-Disposition": `attachment; filename=\"${filename}\"` },
    });
  }

  function downloadText(filename, text, type) {
    const url = URL.createObjectURL(new Blob([text], { type }));
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
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  function parseJson(text) {
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  function normalize(value) {
    return String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }
})();
