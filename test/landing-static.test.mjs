import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('docs/demo-runtime.js');
const app = read('docs/landing/app.js').replace(/\nrender\(\);\nrefreshStatus\(\);\nsetInterval\(refreshStatus, 15000\);\s*$/, '');
const messages = Object.assign({}, ...['shared', 'landing', 'docs'].map((dir) => JSON.parse(read(`${dir}/i18n-messages.json`))));
const routes = { cti: './cti/index.html', portal: './portal/index.html', 'core-history': './call-history/index.html' };
const storageKey = 'nfon-static-landing-v1:/showcase/';

// This model checks handlers and input identity without a browser or a real server.
// The separate foundation tests cover actual language/theme DOM transformations.
function createDemo({ language = 'en', theme = 'admin-portal', storage = new Map(), storageDenied = false, pathname = '/showcase/index.html' } = {}) {
  let externalFetches = 0;
  const timers = [];
  const listeners = new Map();
  class Element {
    constructor() { this.dataset = {}; this.listeners = new Map(); this.attributes = new Map(); this.writes = 0; this.inputs = []; this.buttons = []; }
    addEventListener(name, fn) { this.listeners.set(name, fn); }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name); }
    set innerHTML(value) {
      this.html = value; this.writes += 1;
      this.buttons = [...value.matchAll(/<button\s+class="service-start[\s\S]*?<\/button>/g)].map(([markup]) => {
        const button = new Element();
        button.dataset.serviceId = markup.match(/data-service-id="([^"]*)"/)[1];
        button.dataset.serviceAction = markup.match(/data-service-action="([^"]*)"/)[1];
        const labels = Object.fromEntries(['.button-label-rest', '.button-label-hover'].map((selector) => [selector, new Element()]));
        button.querySelector = (selector) => labels[selector];
        const shellNodes = Object.fromEntries(['.api-card', '.status-chip', '.status-label', '.service-detail', '.service-checked', '.service-feedback'].map((selector) => [selector, new Element()]));
        button.closest = (selector) => selector === '.api-card-shell' ? { querySelector: (query) => shellNodes[query] } : null;
        return button;
      });
      this.inputs = [...value.matchAll(/<input\b[\s\S]*?>/g)].map(([markup]) => {
        const input = new Element();
        input.dataset.editInput = markup.match(/data-edit-input="([^"]*)"/)?.[1];
        input.value = markup.match(/value="([^"]*)"/)?.[1] || '';
        input.type = 'url';
        return input;
      });
    }
    get innerHTML() { return this.html || ''; }
    querySelector(selector) { return this.inputs.find((input) => selector === `[data-edit-input="${input.dataset.editInput}"]`) || this.buttons.find((button) => selector === `[data-service-id="${button.dataset.serviceId}"]`) || null; }
    closest(selector) { return selector === '[data-edit-input]' && this.dataset.editInput ? this : null; }
    focus() { document.activeElement = this; }
  }
  const cards = new Element();
  const connection = new Element();
  const subline = new Element();
  const document = {
    readyState: 'loading', body: {dataset:{nfonApp:pathname.includes('/cti/') ? 'cti' : pathname.includes('/call-history/') ? 'call-history' : 'landing'}}, head: { appendChild() {} },
    documentElement: { dataset: { nfonTheme: theme } },
    getElementById(id) { return ({ 'api-cards': cards, 'connection-state': connection, 'header-subline': subline })[id] || {}; },
    addEventListener(name, fn) { const list = listeners.get(name) || []; list.push(fn); listeners.set(name, list); },
    querySelector: () => null, querySelectorAll: () => [],
  };
  const localStorage = {
    getItem(key) { if (storageDenied) throw new Error('Storage denied'); return storage.get(key) ?? null; },
    setItem(key, value) { if (storageDenied) throw new Error('Storage denied'); storage.set(key, value); },
  };
  const window = {
    document, localStorage, location: new URL(`https://demo.example${pathname}`),
    fetch() { externalFetches += 1; throw new Error('Unexpected network request'); },
    setTimeout(fn, delay) { timers.push(delay); }, setInterval(fn, delay) { timers.push(delay); }, clearInterval() {}, addEventListener() {},
    NFON_I18N: {
      languages: [{ code: 'en', locale: 'en-GB' }, { code: 'de', locale: 'de-DE' }],
      getLanguage: () => language,
      message(key, params = {}) { return (messages[key]?.[language] || messages[key]?.en || '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match); },
    },
  };
  const context = vm.createContext({ window, document, localStorage, URL, Response, EventTarget, Event, MessageEvent, Date, Intl, console, Element, CSS: { escape: (value) => value }, MutationObserver: class { observe() {} }, setInterval: window.setInterval });
  vm.runInContext(runtime, context);
  const evaluate = (code) => vm.runInContext(code, context);
  return {
    window, document, storage, cards, connection, subline, timers, evaluate,
    get externalFetches() { return externalFetches; },
    loadApp(source = app) { vm.runInContext(source, context); return evaluate('refreshStatus()'); },
    setLanguage(value) { language = value; for (const listener of listeners.get('nfon:language-change') || []) listener({ detail: { language } }); },
    typeDraft(id, value) { const input = cards.querySelector(`[data-edit-input="${id}"]`); input.value = value; cards.listeners.get('input')({ target: input }); return input; },
    async request(path, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await window.NFON_LANDING_DEMO.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
  };
}

test('stopping the previous managed address completes while the new upstream stays online', async () => {
  const demo = createDemo();
  let ownedElsewhere = true;
  delete demo.window.NFON_LANDING_DEMO;
  demo.window.fetch = async () => new Response(JSON.stringify({
    health: 'online', serviceControl: true,
    services: { cti: { health: 'online', managed: false, managedElsewhere: ownedElsewhere } },
  }), { headers: { 'Content-Type': 'application/json' } });
  demo.evaluate('globalThis.fetch = (...args) => window.fetch(...args)');
  const localApp = read('landing/public/app.js').replace(/\nrender\(\);\nrefreshStatus\(\);\nsetInterval\(refreshStatus, 15000\);\s*$/, '');
  await demo.loadApp(localApp);
  assert.equal(demo.evaluate('startButtonLabel(SHOWCASES[0], "online")'), 'Stop previous server');
  demo.evaluate('state.actions.cti = "stopping"');
  ownedElsewhere = false;
  await demo.evaluate('refreshStatus()');
  assert.equal(demo.evaluate('state.actions.cti'), undefined);
  assert.equal(demo.evaluate('state.services.cti.health'), 'online');
  assert.equal(demo.evaluate('canControlService(SHOWCASES[0], "online")'), false, 'the new upstream remains unowned');
});

test('static landing pauses and resumes each independent local simulation, including after reload', async () => {
  const demo = createDemo();
  for (const [id, route] of Object.entries(routes)) {
    const initial = (await demo.request('/api/status')).body.services[id];
    assert.equal(initial.health, 'online');
    assert.equal(initial.demoActive, true);
    assert.equal(initial.defaultUpstream, route);
    const stopped = (await demo.request(`/api/services/${id}/stop`, {})).body.services[id];
    assert.equal(stopped.health, 'offline');
    assert.equal(stopped.demoActive, false);
    assert.equal(stopped.detail, 'Local demo paused.');
  }
  const reloaded = createDemo({ storage: demo.storage });
  assert.ok(Object.values((await reloaded.request('/api/status')).body.services).every((service) => !service.demoActive));
  for (const id of Object.keys(routes)) {
    const resumed = (await reloaded.request(`/api/services/${id}/start`, {})).body.services[id];
    assert.equal(resumed.health, 'online');
    assert.equal(resumed.demoActive, true);
  }
  assert.equal(demo.externalFetches + reloaded.externalFetches, 0);
});

test('pausing in the cockpit blocks API activity in the corresponding static app', async () => {
  const cockpit = createDemo();
  await cockpit.request('/api/services/cti/stop', {});
  const paused = createDemo({ storage: cockpit.storage, pathname: '/showcase/cti/index.html' });
  assert.equal((await paused.window.fetch('/api/history')).status, 200);
  assert.equal((await paused.window.fetch('/api/calls', { method: 'POST', body: '{}' })).status, 423);
  const other = createDemo({ storage: cockpit.storage, pathname: '/showcase/call-history/index.html' });
  assert.equal((await other.window.fetch('/api/calls')).status, 200);
  await cockpit.request('/api/services/cti/start', {});
  const resumed = createDemo({ storage: cockpit.storage, pathname: '/showcase/cti/index.html' });
  assert.equal((await resumed.window.fetch('/api/history')).status, 200);
  assert.equal(paused.externalFetches + other.externalFetches + resumed.externalFetches, 0);
});

test('preview overrides persist locally and never replace portable demo card destinations', async () => {
  const demo = createDemo();
  await demo.loadApp();
  demo.evaluate('openEditor("cti")');
  demo.typeDraft('cti', ' HTTPS://preview.example:8443/a?name=Team#anchor ');
  await demo.evaluate('saveEditor("cti")');
  assert.equal(demo.evaluate('state.editing'), null);
  const service = (await demo.request('/api/status')).body.services.cti;
  assert.equal(service.upstream, 'https://preview.example:8443/a?name=Team#anchor');
  assert.equal(service.upstreamSource, 'override');
  assert.equal(service.route, routes.cti);
  assert.deepEqual([...demo.cards.innerHTML.matchAll(/class="card-link" href="([^"]+)"/g)].map((match) => match[1]), Object.values(routes));
  assert.match(demo.cards.innerHTML, /preview\.example:8443/);
  const reloaded = createDemo({ storage: demo.storage });
  assert.equal((await reloaded.request('/api/status')).body.services.cti.upstream, service.upstream);
  demo.evaluate('openEditor("cti")');
  await demo.evaluate('resetEditor("cti")');
  assert.equal((await demo.request('/api/status')).body.services.cti.upstream, routes.cti);
  assert.equal(JSON.parse(demo.storage.get(storageKey)).overrides.cti, undefined);
  assert.equal(demo.externalFetches + reloaded.externalFetches, 0);
});

test('invalid preview inputs and unsupported service actions leave saved state unchanged', async () => {
  const demo = createDemo();
  await demo.request('/api/services/portal/upstream', { upstream: 'https://valid.example/' });
  for (const upstream of ['javascript:alert(1)', 'file:///tmp/a', '//external.example/', '../portal', 'https://user:' + 'password' + '@example.com', 'not a URL', null, {}, 123]) {
    const result = await demo.request('/api/services/portal/upstream', { upstream });
    assert.equal(result.status, 400, JSON.stringify(upstream));
    assert.equal(result.body.errorKey, 'demo.landing.invalidUrl');
    assert.equal((await demo.request('/api/status')).body.services.portal.upstream, 'https://valid.example/');
  }
  assert.equal((await demo.request('/api/services/unknown/start', {})).status, 404);
  assert.equal((await demo.request('/api/services/portal/delete', {})).status, 404);
  assert.equal((await demo.request('/api/services/portal/stop')).status, 405);
  assert.equal((await demo.request('/api/status')).body.services.portal.demoActive, true);
  await demo.request('/api/services/portal/upstream', { upstream: routes.portal });
  assert.equal((await demo.request('/api/status')).body.services.portal.upstreamSource, 'default');
  assert.equal(demo.externalFetches, 0);
});

test('malformed, unavailable and unrelated storage cannot break the local demo', async () => {
  const corrupt = createDemo({ storage: new Map([[storageKey, '{']]) });
  assert.equal((await corrupt.request('/api/status')).body.services.cti.demoActive, true);
  const sanitized = createDemo({ storage: new Map([[storageKey, JSON.stringify({ active: { cti: false, portal: 'false' }, overrides: { cti: 'javascript:alert(1)', portal: 'https://valid.example', unknown: 'https://other.example' } })]]) });
  const services = (await sanitized.request('/api/status')).body.services;
  assert.equal(services.cti.demoActive, false);
  assert.equal(services.portal.demoActive, true);
  assert.equal(services.cti.upstream, routes.cti);
  assert.equal(services.portal.upstream, 'https://valid.example/');
  assert.equal(services.unknown, undefined);
  const denied = createDemo({ storageDenied: true });
  assert.equal((await denied.request('/api/services/cti/stop', {})).body.services.cti.demoActive, false);
  assert.equal((await denied.request('/api/status')).body.services.cti.demoActive, false);
  const unrelated = createDemo({ storage: sanitized.storage, pathname: '/another-demo/index.html' });
  assert.equal((await unrelated.request('/api/status')).body.services.cti.demoActive, true);
});

for (const theme of ['admin-portal', 'classic']) {
  test(`${theme}: all 12 languages retain open editor drafts and localized status through polls`, async () => {
    const demo = createDemo({ theme });
    await demo.loadApp();
    assert.equal(demo.connection.textContent, 'Demo');
    assert.equal(demo.connection.getAttribute('data-status-mode'), 'demo');
    assert.equal(demo.connection.className, 'connection');
    assert.match(demo.cards.innerHTML, />Demo active</);
    assert.match(demo.cards.innerHTML, />Pause demo</);
    assert.doesNotMatch(demo.cards.innerHTML, /Server running|Stop server|Server läuft|Server stoppen/);
    const initialTimers = demo.timers.length;
    await demo.evaluate('stopService("cti")');
    assert.equal(demo.evaluate('state.services.cti.demoActive'), false);
    assert.equal(demo.cards.querySelector('[data-service-id="cti"]').querySelector('.button-label-rest').textContent,'Resume demo');
    assert.equal(demo.evaluate('Object.keys(state.actions).length'), 0);
    demo.setLanguage('de');
    assert.match(demo.cards.innerHTML, />Demo fortsetzen</);
    assert.match(demo.cards.innerHTML, />Demo pausiert</);
    await demo.evaluate('startService("cti")');
    assert.equal(demo.cards.querySelector('[data-service-id="cti"]').closest('.api-card-shell').querySelector('.status-label').textContent,'Demo aktiv');
    assert.equal(demo.timers.length, initialTimers, 'no simulated process-start delays');
    demo.evaluate('openEditor("portal")');
    const input = demo.typeDraft('portal', 'https://preview.example/Entwurf?name=Größe');
    const writes = demo.cards.writes;
    for (const language of ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'cs']) {
      demo.setLanguage(language);
      assert.equal(demo.cards.querySelector('[data-edit-input="portal"]'), input, `input identity survives ${language}`);
      assert.equal(demo.evaluate('state.drafts.portal'), 'https://preview.example/Entwurf?name=Größe');
      assert.equal(demo.connection.getAttribute('aria-label'), messages['demo.landing.ready'][language]);
    }
    demo.setLanguage('en');
    await demo.evaluate('refreshStatus()');
    await demo.evaluate('stopService("cti")');
    assert.equal(demo.cards.writes, writes, 'language, poll and control do not replace an open input');
    const ctiButton = demo.cards.querySelector('[data-service-id="cti"]');
    assert.equal(ctiButton.dataset.serviceAction, 'start');
    assert.equal(ctiButton.querySelector('.button-label-rest').textContent, 'Resume demo');
    assert.equal(ctiButton.getAttribute('aria-label'), 'Resume NFON CTI API demo');
    assert.match(ctiButton.closest('.api-card-shell').querySelector('.api-card').className, /is-offline/);
    assert.equal(demo.document.activeElement, input);
    assert.equal(demo.cards.querySelector('[data-edit-input="portal"]'), input);
    assert.equal(demo.evaluate('state.drafts.portal'), input.value);
    assert.match(demo.cards.innerHTML, /data-i18n-key="demo.landing.editPreview"/);
    assert.match(demo.cards.innerHTML, /data-i18n-aria-label="demo.landing.pauseApp"/);
    assert.equal(demo.document.documentElement.dataset.nfonTheme, theme);
    demo.evaluate('closeEditor("portal")');
    assert.match(demo.cards.innerHTML, />Resume demo</);
    assert.equal(demo.externalFetches, 0);
  });
}

test('validation retains the invalid draft and translatable error; reset is disabled before an override exists', async () => {
  const demo = createDemo({ language: 'de' });
  await demo.loadApp();
  demo.evaluate('openEditor("core-history")');
  demo.typeDraft('core-history', 'not yet a URL');
  await demo.evaluate('saveEditor("core-history")');
  assert.equal(demo.evaluate('state.editing'), 'core-history');
  assert.equal(demo.evaluate('state.drafts["core-history"]'), 'not yet a URL');
  assert.match(demo.cards.innerHTML, /data-i18n-key="demo.landing.invalidUrl"/);
  assert.match(demo.cards.innerHTML, /HTTP\(S\)-URL ohne Zugangsdaten/);
  assert.match(demo.cards.innerHTML, /data-edit-reset="core-history"[^>]*disabled/);
  demo.setLanguage('en');
  await demo.evaluate('saveEditor("core-history")');
  assert.match(demo.cards.innerHTML, /Enter an HTTP\(S\) URL without credentials/);
  await demo.evaluate('resetEditor("core-history")');
  assert.equal(demo.evaluate('state.editing'), null);
  assert.equal(demo.evaluate('state.services["core-history"].upstream'), routes['core-history']);
});

test('static landing never falls through to network even if fetch changes or the demo handler is unavailable', async () => {
  const demo = createDemo();
  demo.window.fetch = () => { throw new Error('fetch must not be called'); };
  await demo.loadApp();
  await demo.evaluate('stopService("portal")');
  assert.equal(demo.evaluate('state.services.portal.demoActive'), false);
  delete demo.window.NFON_LANDING_DEMO;
  await demo.evaluate('refreshStatus()');
  assert.equal(demo.evaluate('state.gatewayHealth'), 'offline');
  assert.equal(demo.connection.title, 'Demo unavailable');
  assert.equal(demo.externalFetches, 0);
});
