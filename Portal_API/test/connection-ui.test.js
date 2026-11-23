const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const staticSource = fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8");
const catalog = { ...JSON.parse(fs.readFileSync(path.join(root, "../shared/i18n-messages.json"), "utf8")), ...JSON.parse(fs.readFileSync(path.join(root, "i18n-messages.json"), "utf8")) };

function app(language = "en", appSource = source, staticDemo = false) {
  const elements = new Map([
    ["#connection-state", { textContent: "", className: "", setAttribute(name, value) { this[name] = value; }, removeAttribute(name) { delete this[name]; } }],
    ["#settings-summary", { innerHTML: "" }],
    ["#endpoint-status", { innerHTML: "", classList: { toggle() {} } }],
    ["#toggle-technical", { textContent: "" }],
  ]);
  let requests = 0;
  const context = vm.createContext({
    window: {
      location: { hash: "" }, addEventListener() {},
      NFON_WEB_ONLY_DEMO: staticDemo,
      NFON_I18N: {
        getLanguage: () => language,
        message(key, params = {}) {
          assert.ok(catalog[key], `Missing message ${key}`);
          return catalog[key][language].replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
        },
      },
    },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    document: { querySelector: selector => elements.get(selector) || null, querySelectorAll: () => [], addEventListener() {} },
    fetch() { requests++; throw Error("Unexpected network request"); },
    URL, Intl, Date, console,
  });
  vm.runInContext(appSource.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ""), context);
  return {
    evaluate: code => vm.runInContext(code, context),
    mockFetch(handler) { context.fetch = (...args) => { requests++; return handler(...args); }; },
    set(overview) { vm.runInContext(`state.loading=false; state.error=""; state.overview=${JSON.stringify(overview)}; renderStatus(); renderSettingsSummary();`, context); },
    header: elements.get("#connection-state"), settings: elements.get("#settings-summary"), diagnostics: elements.get("#endpoint-status"),
    get requests() { return requests; },
  };
}

function overview(state, loaded, extra = {}) {
  return {
    settings: { configured: true, liveWritesEnabled: false },
    connection: { state, requiredTotal: 9, requiredLoaded: loaded, requiredFailed: 9 - loaded },
    endpoints: {},
    ...extra,
  };
}

test("header and Setup distinguish configuration, unchecked, failed, partial and connected states in both languages", () => {
  const cases = [
    [overview("unconfigured", 0, { settings: { configured: false }, demo: true }), "Demo", "Demo", "warning"],
    [overview("unchecked", 0), "Not checked yet", "noch nicht geprüft", "warning"],
    [overview("unavailable", 0), "Connection failed", "Verbindung fehlgeschlagen", "error"],
    [overview("partial", 4), "API partially loaded", "API teilweise geladen", "warning"],
    [overview("connected", 9), "Ready", "Bereit", "online"],
  ];
  for (const language of ["en", "de"]) {
    const ui = app(language);
    for (const [data, en, de, tone] of cases) {
      ui.set(data);
      const expected = language === "en" ? en : de;
      assert.equal(ui.header.textContent, expected);
      assert.equal(ui.header.className, data.demo ? "connection" : `connection is-${tone}`);
      assert.equal(ui.header["data-status-mode"], data.demo ? "demo" : undefined);
      assert.ok(ui.settings.innerHTML.includes(`<strong>${expected}</strong>`));
    }
    ui.set(overview("unavailable", 0));
    assert.match(ui.settings.innerHTML, language === "en" ? /0 of 9 required API areas loaded/ : /0 von 9 erforderlichen API-Bereichen geladen/);
    assert.doesNotMatch(ui.settings.innerHTML, /settings-status-card is-ok/);
  }
});

test("successful empty inventory remains ready despite optional endpoint failures", () => {
  const ui = app();
  const endpoints = Object.fromEntries(["extensions", "devices", "trunks", "dids", "phoneBooks", "groups", "ivrs", "timeControls", "announcements"].map(key => [key, { ok: true, count: 0 }]));
  for (const key of ["version", "basicData", "contract", "featureStatus", "queues", "skills", "voicemails", "frontdesks"]) endpoints[key] = { ok: false, optional: true, error: "Not supported", status: 404 };
  ui.set(overview("connected", 9, { endpoints }));
  assert.equal(ui.header.textContent, "Ready");
  assert.equal(ui.evaluate("endpointIssues().length"), 0);
  ui.evaluate("renderEndpoints()");
  assert.match(ui.diagnostics.innerHTML, /Frontdesk\/Nia/);
  assert.match(ui.diagnostics.innerHTML, /Voicemail/);
  assert.equal((ui.diagnostics.innerHTML.match(/endpoint-badge is-optional/g) || []).length, 8);
});

test("older overview payloads cannot report Ready from configured credentials alone", () => {
  const ui = app();
  ui.set({ settings: { configured: true }, endpoints: {} });
  assert.equal(ui.header.textContent, "Not checked yet");
  ui.set({ settings: { configured: true }, endpoints: { version: { ok: true }, extensions: { ok: false, status: 0, error: "DNS lookup failed" } } });
  assert.equal(ui.header.textContent, "Connection failed");
  ui.set({ settings: { configured: true }, endpoints: { version: { ok: false }, extensions: { ok: true }, devices: { ok: false } } });
  assert.equal(ui.header.textContent, "API partially loaded");
});

test("refreshing or failed overview fetches supersede a previous healthy status without exposing markup", () => {
  const ui = app();
  ui.set(overview("connected", 9));
  ui.evaluate("state.loading=true; renderStatus(); renderSettingsSummary();");
  assert.equal(ui.header.textContent, "Checking");
  assert.match(ui.settings.innerHTML, /<strong>Checking<\/strong>/);
  ui.evaluate('state.loading=false; state.error="Failed <script>unsafe</script>"; renderStatus(); renderSettingsSummary();');
  assert.equal(ui.header.textContent, "Error");
  assert.match(ui.settings.innerHTML, /Failed &lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(ui.settings.innerHTML, /<script>/);
});

test("real overview refresh updates header and Setup while awaiting the response and after success or failure", async () => {
  for (const appSource of [source, staticSource]) {
    for (const responseOk of [true, false]) {
      const ui = app("en", appSource);
      ui.set(overview("connected", 9));
      // Keep the real request, state transition and status renderers; unrelated views need no DOM here.
      ui.evaluate("state.serviceGroups={}; render=()=>{renderStatus(); renderSettingsSummary();};");
      let resolveResponse;
      const response = new Promise(resolve => { resolveResponse = resolve; });
      ui.mockFetch(url => { assert.equal(url, "/api/overview"); return response; });
      const pending = ui.evaluate("loadOverview()");
      assert.equal(ui.header.textContent, "Checking");
      assert.match(ui.settings.innerHTML, /<strong>Checking<\/strong>/);
      assert.doesNotMatch(ui.settings.innerHTML, /<strong>Ready<\/strong>/);
      assert.equal(ui.evaluate("state.loading"), true);
      resolveResponse({
        ok: responseOk,
        status: responseOk ? 200 : 503,
        json: async () => responseOk ? overview("unavailable", 0, { inventory: { extensions: [], dids: [] } }) : { error: "Overview request failed" },
      });
      await pending;
      const expected = responseOk ? "Connection failed" : "Error";
      assert.equal(ui.header.textContent, expected);
      assert.ok(ui.settings.innerHTML.includes(`<strong>${expected}</strong>`));
      assert.equal(ui.evaluate("state.loading"), false);
      assert.equal(ui.evaluate("state.error"), responseOk ? "" : "Overview request failed");
      assert.equal(ui.requests, 1);
    }
  }
});

test("hard read-only override disables the switch and every client write affordance without sending requests", async () => {
  for (const language of ["en", "de"]) {
    const ui = app(language);
    ui.set(overview("connected", 9, { settings: { configured: true, liveWritesEnabled: true, liveWritesLocked: true } }));
    const button = ui.settings.innerHTML.match(/<button\b[^>]*data-live-writes[^>]*>/)?.[0];
    assert.match(button, /\sdisabled\s/);
    assert.match(button, /aria-pressed="false"/);
    assert.match(button, /aria-describedby="live-writes-lock-reason"/);
    assert.equal(ui.evaluate("portalLiveWritesEnabled()"), false);
    assert.equal(ui.evaluate("liveWritesEnabled()"), false);
    const reason = language === "en" ? "Read-only mode is enforced by the server." : "Der Server erzwingt den Nur-Lese-Modus.";
    assert.equal(ui.evaluate("liveWritesDisabledText()"), reason);
    assert.ok(ui.settings.innerHTML.includes(reason));
    await ui.evaluate("setLiveWritesEnabled(true)");
    assert.equal(ui.requests, 0);
  }
});

test("normal configured read-only sessions retain the deliberate enable switch", () => {
  const ui = app();
  ui.set(overview("connected", 9));
  const button = ui.settings.innerHTML.match(/<button\b[^>]*data-live-writes[^>]*>/)?.[0];
  assert.doesNotMatch(button, /\sdisabled\s/);
  assert.match(button, /data-live-writes="on"/);
  assert.doesNotMatch(ui.settings.innerHTML, /id="live-writes-lock-reason"/);
});

test("transport diagnostics use localized safe error kinds while HTTP errors retain their details", () => {
  for (const language of ["en", "de"]) {
    const ui = app(language);
    for (const [kind, key, code] of [
      ["dns", "portal.transportDns", "ENOTFOUND"],
      ["timeout", "portal.transportTimeout", "ETIMEDOUT"],
      ["tls", "portal.transportTls", "CERT_HAS_EXPIRED"],
      ["connection", "portal.transportConnection", "ECONNREFUSED"],
      ["network", "portal.transportNetwork", "PORTAL_NETWORK_ERROR"],
    ]) {
      const endpoint = { ok: false, errorKind: kind, errorCode: code, error: "Raw internal diagnostic with a URL" };
      const result = ui.evaluate(`portalEndpointErrorText(${JSON.stringify(endpoint)})`);
      assert.equal(result, catalog[key][language].replace("{code}", code));
      assert.doesNotMatch(result, /Raw internal/);
    }
    assert.equal(ui.evaluate('portalEndpointErrorText({ok:false,status:403,error:"403 Forbidden"})'), "403 Forbidden");
    ui.set(overview("unavailable", 0, { endpoints: { extensions: { ok: false, errorKind: "dns", errorCode: 'ENOTFOUND<script>', error: "Raw internal" } } }));
    ui.evaluate("renderEndpoints()");
    assert.match(ui.diagnostics.innerHTML, /ENOTFOUND&lt;script&gt;/);
    assert.doesNotMatch(ui.diagnostics.innerHTML, /Raw internal|<script>/);
  }
});

test("static Portal keeps explicit demo status, local editing and the live-write guard after status synchronization", async () => {
  for (const language of ["en", "de"]) {
    const ui = app(language, staticSource, true);
    ui.set(overview("connected", 9));
    assert.equal(ui.header.textContent, "Demo");
    assert.equal(ui.header["data-status-mode"], "demo");
    assert.equal(ui.header.className, "connection");
    assert.match(ui.settings.innerHTML, /<strong>Demo<\/strong>/);
    assert.equal(ui.evaluate("localWritesEnabled()"), true);
    assert.equal(ui.evaluate("liveWritesEnabled()"), false);
    assert.equal(ui.evaluate("liveWritesDisabledText()"), catalog["portal.demo.blockedMessage"][language]);
    ui.evaluate("let staticNotice; showUiNotice=notice=>{staticNotice=notice;}");
    await ui.evaluate("setLiveWritesEnabled(true)");
    assert.equal(ui.evaluate("staticNotice.message"), catalog["portal.demo.blockedMessage"][language]);
    assert.equal(ui.requests, 0);
    assert.equal(ui.evaluate("liveWritesEnabled()"), false);
  }
});

test("static paused state stays neutral on render and resumes to its actual status",()=>{for(const language of ["en","de","fr"]){const ui=app(language,source,true);ui.set(overview("connected",9,{demo:true}));ui.evaluate("state.staticPaused=true;renderStatus()");assert.equal(ui.header.textContent,catalog["demo.landing.paused"][language]);assert.equal(ui.header.className,"connection");ui.evaluate("state.staticPaused=false;renderStatus()");assert.equal(ui.header.textContent,"Demo");}});
