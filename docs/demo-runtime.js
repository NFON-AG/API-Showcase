(function () {
  "use strict";

  window.NFON_WEB_ONLY_DEMO = true;

  const token = "demo-csrf-token";
  const CALL_HISTORY_CALLS_PER_DAY = 20;
  const now = () => new Date().toISOString();
  const pagePath = () => window.location.pathname.toLowerCase();
  const appKind = () => {
    const path = pagePath();
    if (path.includes("/cti/")) return "cti";
    if (path.includes("/portal/")) return "portal";
    if (path.includes("/call-history/")) return "call-history";
    return "landing";
  };

  const demo = createDemoState();
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
      return jsonResponse({ ok: false, error: error.message || "Demo API Fehler", csrfToken: token }, 400);
    }
  };

  window.EventSource = class DemoEventSource extends EventTarget {
    constructor() {
      super();
      this.readyState = 1;
      this.interval = window.setInterval(() => {
        const event = demo.cti.events[Math.floor(Math.random() * demo.cti.events.length)];
        this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({ type: "state", state: randomCtiState(event.extension || "201") }) }));
      }, 7000);
      window.setTimeout(() => this.dispatchEvent(new Event("open")), 0);
    }

    close() {
      window.clearInterval(this.interval);
      this.readyState = 2;
    }
  };

  installDemoUiGuards();

  document.addEventListener("click", (event) => {
    const link = event.target.closest("a");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    if (href.includes("/auth/") || href.includes("/api/storage/backup")) {
      event.preventDefault();
      downloadText("nfon-demo-backup.json", JSON.stringify({ exportedAt: now(), demo: true, cti: demo.cti.history }, null, 2), "application/json");
    }
  });

  function installDemoUiGuards() {
    installReadOnlyStyles();

    document.addEventListener(
      "click",
      (event) => {
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
    if (kind === "cti" && pagePath().endsWith("/setup.html")) {
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
    note.textContent = "Demo-Ansicht · Setup nur lesbar";
    container.prepend(note);
  }

  function markReadOnlyControl(control) {
    if (control.closest(".demo-readonly-note")) return;
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
    if (!root) return;
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
    if (kind === "landing") return landingRoute(path, method);
    if (kind === "cti") return ctiRoute(path, method, body, url);
    if (kind === "portal") return portalRoute(path, method, body);
    if (kind === "call-history") return callHistoryRoute(path, method, body, url);
    return { ok: true, csrfToken: token };
  }

  function normalizeApiPath(pathname) {
    const index = pathname.indexOf("/api/");
    if (index >= 0) return pathname.slice(index);
    const authIndex = pathname.indexOf("/auth/");
    if (authIndex >= 0) return pathname.slice(authIndex);
    return pathname;
  }

  function landingRoute(path, method) {
    if (path === "/api/status") {
      return {
        ok: true,
        health: "online",
        csrfToken: token,
        services: {
          cti: { health: "online", detail: "Demo bereit.", route: "./cti/index.html", upstream: "./cti/index.html", checkedAt: now() },
          portal: { health: "online", detail: "Demo bereit.", route: "./portal/index.html", upstream: "./portal/index.html", checkedAt: now() },
          "core-history": { health: "online", detail: "Demo bereit.", route: "./call-history/index.html", upstream: "./call-history/index.html", checkedAt: now() },
        },
      };
    }
    if (path.startsWith("/api/services/")) return { ok: true, csrfToken: token };
    return { ok: true, csrfToken: token };
  }

  function ctiRoute(path, method, body, url) {
    if (path === "/api/status") {
      return {
        ok: true,
        connected: true,
        demo: true,
        account: "Demo-Anlage",
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
    if (path === "/api/google/contacts") return { status: demo.cti.google, contacts: demo.cti.contacts };
    if (path === "/api/google/sync" || path === "/api/google/disconnect") return { status: demo.cti.google, contacts: demo.cti.contacts.length };
    if (path === "/api/storage") return demo.cti.storage;
    if (path === "/api/storage/restore") return { ok: true, imported: 3, message: "Demo-Backup geprüft." };
    if (path === "/api/storage/backup") {
      return downloadResponse("nfon-cti-demo-backup.json", JSON.stringify({ exportedAt: now(), history: demo.cti.history }, null, 2), "application/json");
    }
    if (path === "/api/contacts/lookup") {
      const phone = url.searchParams.get("phone") || "";
      return { contact: demo.cti.contacts.find((contact) => phone.includes(contact.phone.slice(-4))) || demo.cti.contacts[0] };
    }
    if (path === "/api/local-contacts" && method === "POST") {
      const contact = { id: `local-${Date.now()}`, name: body?.name || "Demo Kontakt", phone: body?.phone || "+49 89 000000", source: "local" };
      demo.cti.contacts.unshift(contact);
      return { contact, status: demo.cti.google, contacts: demo.cti.contacts };
    }
    if (path.startsWith("/api/local-contacts/") && method === "DELETE") return { status: demo.cti.google, contacts: demo.cti.contacts };
    if (path === "/api/settings/browser-login") return { ok: true, status: { csrfToken: token, configured: true, account: "Demo-Anlage" } };
    if (path === "/api/calls" && method === "POST") {
      const call = createCtiCall(body);
      demo.cti.activeCalls.unshift(call);
      demo.cti.history.unshift(call);
      return { ok: true, uuid: call.uuid, call, activeCalls: demo.cti.activeCalls, history: demo.cti.history };
    }
    if (path.startsWith("/api/calls/") && method === "DELETE") {
      const uuid = decodeURIComponent(path.replace("/api/calls/", ""));
      demo.cti.activeCalls = demo.cti.activeCalls.filter((call) => call.uuid !== uuid);
      return {};
    }
    return { ok: true, csrfToken: token };
  }

  function portalRoute(path, method, body) {
    if (path === "/api/status") return { ok: true, configured: true, account: "Demo-Anlage", csrfToken: token };
    if (path === "/api/customers") return { ok: true, customers: [{ account: "Demo-Anlage", name: "Demo-Anlage", label: "Demo-Anlage" }] };
    if (path === "/api/overview") return portalOverview();
    if (path === "/api/settings/customer") return { ok: true, account: body?.account || "Demo-Anlage", customer: { name: "Demo-Anlage" }, customers: [{ account: "Demo-Anlage", name: "Demo-Anlage", label: "Demo-Anlage" }] };
    if (path === "/api/settings/live-writes") return { ok: true, enabled: false, message: "Demo-Dry-Run aktiv." };
    if (path === "/api/service-groups") return serviceGroupsResponse();
    if (path === "/api/service-groups/apply") return applyDemoServiceGroups(body);
    if (path === "/api/phonebook-sync/preview") return { ok: true, summary: demo.portal.phonebookSummary, rows: demo.portal.phonebook };
    if (path === "/api/phonebook-sync/apply") return { ok: true, applied: demo.portal.phonebook.length, message: "Telefonbuch-Demo übernommen." };
    if (path === "/api/phonebook-sync/upload") return { ok: true, rows: demo.portal.phonebook, summary: demo.portal.phonebookSummary };
    if (path === "/api/extensions/batch/plan") return { ok: true, plan: extensionBatchPlan(body), rows: extensionBatchPlan(body).items };
    if (path === "/api/extensions/batch/apply") return { ok: true, applied: true, plan: extensionBatchPlan(body) };
    if (path === "/api/callflow/apply" || path === "/api/callflow/bulk-apply") return applyDemoCallflow(body);
    if (path.startsWith("/api/resources/") && method === "POST") return createDemoPortalResource(path, body);
    if (path.includes("/api/daynight/") || path.includes("/api/demo/") || path.startsWith("/api/resources/")) {
      return { ok: true, preview: true, message: "Demo-Plan erzeugt.", result: body || {} };
    }
    return { ok: true, csrfToken: token, message: "Demo-Antwort" };
  }

  function callHistoryRoute(path, method, body, url) {
    if (path === "/api/status") {
      return {
        ok: true,
        configured: true,
        authenticated: true,
        oauthConfigured: true,
        demoMode: true,
        account: "Demo-Anlage",
        csrfToken: token,
        redirectUri: window.location.href,
      };
    }
    if (path === "/api/calls") return callHistoryCalls(url.searchParams);
    if (path.startsWith("/api/transcripts/")) {
      const id = decodeURIComponent(path.replace("/api/transcripts/", ""));
      return demo.callHistory.transcripts.find((item) => item.id === id) || { ok: false, error: "Transcript nicht gefunden" };
    }
    if (path === "/api/assignment-preview") return assignmentPreview(body);
    if (path === "/api/settings/browser-login") return { ok: true, status: { csrfToken: token, authenticated: true, account: "Demo-Anlage" } };
    if (path === "/api/auth/logout") return { ok: true, status: { csrfToken: token, authenticated: false } };
    if (path.startsWith("/auth/")) return { ok: true, message: "Demo-Login aktiv." };
    return { ok: true, csrfToken: token };
  }

  function callHistoryCalls(params) {
    const range = params.get("range") || "7d";
    const direction = params.get("direction") || "all";
    const outcome = params.get("outcome") || "all";
    const party = normalize(params.get("party") || "");
    const maxAgeMinutes = range === "today" ? 24 * 60 : range === "30d" ? 30 * 24 * 60 : 7 * 24 * 60;
    const calls = demo.callHistory.calls.filter((call) => {
      if (call.relativeMinutesAgo > maxAgeMinutes) return false;
      if (direction !== "all" && call.direction !== direction) return false;
      if (outcome !== "all" && call.outcome !== outcome) return false;
      if (party && !normalize(JSON.stringify(call)).includes(party)) return false;
      return true;
    });
    return { ok: true, source: "demo", generatedAt: now(), filters: Object.fromEntries(params.entries()), calls };
  }

  function createDemoState() {
    const callHistory = createCallHistoryData();
    const cti = createCtiData();
    const portal = createPortalData();
    return { callHistory, cti, portal };
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
            ? "busy"
            : "missed";
        const durationSeconds = outcome === "answered" ? 65 + seededPick(index * 37 + dayOffset * 19, 870) : 0;
        const startedAt = callHistoryStartedAt(date, index, dayOffset);
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
      startedAt: startedAt.toISOString(),
      direction,
      from: direction === "inbound" ? external : internal,
      to: direction === "inbound" ? internal : external,
      user: { number: extension, name: agentName, email: `${agentName.toLowerCase().replaceAll(" ", ".")}@example.local` },
      durationSeconds,
      outcome,
      transcriptId,
      summary: `${contactName} · ${queue} · Demo-Anlage`,
      contact: company ? { name: contactName, company, email } : null,
      ticket: outcome === "missed" ? null : { id: `NFON-${id.slice(-7).toUpperCase()}`, title: `${queue} Demo Vorgang`, status: outcome === "answered" ? "open" : "pending" },
      tags: ["demo", queue.toLowerCase().replaceAll(" ", "-")],
    };
  }

  function callHistoryTranscript(call) {
    const customerName = call.contact?.name || call.from.name;
    const company = call.contact?.company || "Demo-Anlage";
    return {
      ok: true,
      id: call.transcriptId,
      callId: call.id,
      language: "de",
      confidence: 0.89 + seededPick(call.relativeMinutesAgo, 9) / 100,
      summary: `${customerName} wurde als Demo-Call ausgewertet und dem Konto ${company} zugeordnet. Ticket, Owner und Abrechnung wurden vorbereitet.`,
      text: [
        `${customerName}: Wir brauchen eine kurze Rueckmeldung zum aktuellen Vorgang.`,
        `${call.user.name}: Ich pruefe den Status und dokumentiere die naechsten Schritte.`,
        "System: Transcript, Ticketvorschlag und CRM-Zuordnung wurden automatisch vorbereitet.",
      ].join("\n"),
      topics: ["Demo", "Call History", call.user.name, call.contact?.company || "Unbekannt"],
      ticketSuggestion: { id: call.ticket?.id || "NFON-DEMO", title: call.ticket?.title || "Demo Ticket", priority: call.outcome === "missed" ? "hoch" : "normal" },
      assignee: { name: call.user.name, email: call.user.email },
    };
  }

  function callHistoryStartedAt(date, index, dayOffset) {
    const startedAt = new Date(date);
    startedAt.setHours(callHistoryBusinessHour(index, dayOffset), seededPick(index * 43 + dayOffset, 60), seededPick(index * 47 + dayOffset, 60), 0);
    const current = new Date();
    if (dayOffset === 0 && startedAt > current) {
      const minutesSinceBusinessStart = Math.max(20, (current.getHours() - 8) * 60 + current.getMinutes());
      const minutesBack = 5 + seededPick(index * 53 + dayOffset, Math.min(540, minutesSinceBusinessStart));
      return new Date(current.getTime() - minutesBack * 60000);
    }
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
      google: { configured: true, connected: true, contacts: 8, account: "Demo-Anlage" },
      contacts: [
        { id: "", name: "Demo Kontakt A", company: "Demo Account A", phone: "+49 89 0000 2001", email: "kontakt-a@example.local", source: "demo" },
        { id: "", name: "Demo Kontakt B", company: "Demo Account B", phone: "+49 89 0000 2002", email: "kontakt-b@example.local", source: "demo" },
        { id: "", name: "Demo Kontakt C", company: "Demo Account C", phone: "+49 89 0000 2003", email: "kontakt-c@example.local", source: "demo" },
        { id: "", name: "Demo Kontakt D", company: "Demo Account D", phone: "+49 89 0000 2004", email: "kontakt-d@example.local", source: "demo" },
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
            account: "Demo-Anlage",
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
      const extension = extensions.find((item) => item.number === number) || { number, id: number, name: `Nebenstelle ${number}`, type: "PHONE" };
      return { extensionNumber: extension.number, id: extension.id, name: extension.name, type: extension.type, penalty, skillLevel, enabled: true };
    };
    const queues = [
      { id: "10000", serviceNumber: "10000", extensionNumber: "10000", value: "10000", name: "Demo Frontdesk", color: "green", members: [member("201"), member("202")], overflow: "203" },
      { id: "10001", serviceNumber: "10001", extensionNumber: "10001", value: "10001", name: "Demo Support Queue", color: "blue", members: [member("203"), member("204"), member("207")], overflow: "205" },
    ];
    const skills = [
      { id: "10010", serviceNumber: "10010", extensionNumber: "10010", value: "10010", name: "Demo Skillgruppe", color: "purple", members: [member("202", 0, 3), member("206", 0, 2), member("208", 0, 1)] },
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
          { id: "inbound", type: "DID", title: "Eingehender Anruf", subtitle: "+49 89 12345-0", x: 8, y: 45, tone: "blue", locked: true },
          { id: "trunk", type: "Trunk", title: "Leitung", subtitle: "Main SIP Trunk", x: 34, y: 45, tone: "purple", locked: true },
          { id: "target", type: "QUEUE", title: "Demo Frontdesk", subtitle: "Warteschlange 10000", targetNumber: "10000", routeNumber: "10000", x: 68, y: 45, tone: "amber", serviceKind: "queue", serviceColor: "green", memberCount: 2, memberNames: ["201 Anna Weber", "202 Max Schneider"], isTarget: true, config: { portalMode: "existing" } },
        ],
        edges: [{ from: "inbound", to: "trunk", label: "kommt an" }, { from: "trunk", to: "target", label: "führt zu" }],
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
    return {
      ok: true,
      demo: true,
      account: "Demo-Anlage",
      version: { version: "Demo", host: "static" },
      customer: { company: "Demo-Anlage", account: "Demo-Anlage" },
      counts: { extensions: extensions.length, devices: 4, trunks: 1, dids: 3, phoneBooks: demo.portal.phonebook.length, groups: 1, queues: queues.length, skills: skills.length, ivrs: 1, timeControls: 1, announcements: 1 },
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
        announcements: [{ id: "40", name: "Nachtansage", value: "GENERAL_ANNOUNCEMENT" }],
      },
      endpoints: {},
      callflow: demo.portal.callflow,
      settings: { configured: true, authMode: "demo", account: "Demo-Anlage", csrfToken: token, liveWritesEnabled: false },
      syncedAt: now(),
    };
  }

  function serviceGroupsResponse() {
    demo.portal.serviceGroups.syncedAt = now();
    demo.portal.serviceGroups.extensions = demo.portal.extensions;
    return demo.portal.serviceGroups;
  }

  function applyDemoServiceGroups(body) {
    const services = Array.isArray(body?.services) ? body.services : [];
    for (const service of services) {
      const collection = service.kind === "skill" ? "skills" : "queues";
      const target = (demo.portal.serviceGroups[collection] || []).find((item) => String(item.serviceNumber || item.id) === String(service.serviceNumber || service.id));
      if (!target) continue;
      target.members = (service.members || []).map((member) => ({
        extensionNumber: String(member.extensionNumber || member.number || member.id || ""),
        id: String(member.extensionNumber || member.number || member.id || ""),
        name: member.name || extensionName(member.extensionNumber || member.number || member.id),
        type: member.type || "PHONE",
        penalty: Number(member.penalty || 0),
        skillLevel: Number(member.skillLevel || 1),
        enabled: member.enabled !== false,
      })).filter((member) => member.extensionNumber);
    }
    return {
      ok: true,
      title: "Demo-Mitgliedschaften übernommen",
      message: "Warteschlangen und Skillgruppen wurden lokal in der Demo-Anlage aktualisiert.",
      overview: portalOverview(),
      serviceGroups: serviceGroupsResponse(),
      appliedAt: now(),
    };
  }

  function createDemoPortalResource(path, body) {
    const collection = decodeURIComponent(path.replace("/api/resources/", "").split("/")[0] || "");
    if (collection !== "queues" && collection !== "skills") {
      return { ok: true, preview: true, message: "Demo-Ressource vorbereitet.", result: body || {} };
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
    const name = String(body?.displayName || (collection === "queues" ? "Neue Demo Warteschlange" : "Neue Demo Skillgruppe")).trim();
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
      title: `${collection === "queues" ? "Warteschlange" : "Skillgruppe"} lokal angelegt`,
      message: `${name} wurde in der Demo-Anlage angelegt.`,
      item,
      overview: portalOverview(),
      serviceGroups: serviceGroupsResponse(),
      createdAt: now(),
    };
  }

  function applyDemoCallflow(body) {
    if (body?.flow) demo.portal.callflow = body.flow;
    return {
      ok: true,
      applied: true,
      title: "Callflow lokal übernommen",
      message: "Der Callflow wurde in der Demo-Anlage lokal gespeichert.",
      flow: demo.portal.callflow,
      overview: portalOverview(),
      appliedAt: now(),
    };
  }

  function extensionName(number) {
    const extension = demo.portal.extensions.find((item) => String(item.number || item.id) === String(number));
    return extension?.name || `Nebenstelle ${number}`;
  }

  function extensionBatchPlan(body) {
    const rows = body?.rows || body?.items || [];
    const items = Array.isArray(rows) && rows.length ? rows : demo.portal.extensions.map((extension) => ({ number: extension.number, name: extension.name }));
    return { ok: true, items: items.map((item, index) => ({ index, action: "dry-run", title: `Nebenstelle ${item.number || index + 1}`, message: "Demo-Prüfung erfolgreich." })) };
  }

  function assignmentPreview() {
    return { ok: true, queue: "Support", assignee: "Demo Agent 203", billing: { minutes: 12, amount: 28.8 }, message: "Demo-Zuordnung vorbereitet." };
  }

  function createCtiCall(body) {
    return {
      uuid: `demo-call-${Date.now()}`,
      extension: body?.caller || body?.extension || "202",
      caller: body?.caller || "202",
      callee: body?.callee || body?.target || "+49 89 0000 2001",
      direction: "outbound",
      state: "answer",
      startedAt: now(),
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
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
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
