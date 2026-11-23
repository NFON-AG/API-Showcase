const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n-messages.json'), 'utf8'));
const supportedLanguages = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'cs'];

function harness(initialLanguage = 'en', sourceOverride = appSource, storage = {getItem(){return null;},setItem(){}}) {
  const nodes = new Map();
  let language = initialLanguage;
  const listeners = new Map();
  const element = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', hidden: false, dataset: {}, style: {},
      classList: { add() {}, remove() {}, toggle() {} },
      setAttribute(name, value) { this[name] = String(value); },
      getAttribute(name) { return this[name] ?? null; },
      removeAttribute(name) { delete this[name]; }, addEventListener() {},
      closest: (parent) => element(`${selector} parent:${parent}`),
      querySelector: (child) => (child.includes("form") || child === '[role="dialog"]') ? null : element(`${selector} ${child}`),
      querySelectorAll: () => [],
    });
    return nodes.get(selector);
  };
  const document = {
    documentElement: { lang: language, dataset: { nfonTheme: 'admin-portal' } }, activeElement: null,
    querySelector: element, querySelectorAll: () => [],
    getElementById: (id) => element(`#${id}`),
    addEventListener: (event, handler) => listeners.set(event, handler),
  };
  const window = {
    location: new URL('http://localhost:3000/'),
    addEventListener: (event, handler) => listeners.set(`window:${event}`, handler),
    NFON_I18N: {
      getLanguage: () => language,
      message: (key, params = {}) => (catalog[key]?.[language] || catalog[key]?.en || '')
        .replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match),
      refresh() {},
    },
  };
  const context = vm.createContext({
    document, window, localStorage: storage,
    navigator: {}, console, Intl, Map, URLSearchParams, URL, FormData, AbortSignal,
    setTimeout, clearTimeout, fetch: () => { throw new Error('Unexpected network request'); },
  });
  vm.runInContext(sourceOverride.replace(/bindEvents\(\);\s*loadAll\(\);\s*$/, ''), context);
  return {
    nodes, element, context, document, window, listeners,
    run: (source) => vm.runInContext(source, context),
    language: (next) => { language = next; document.documentElement.lang = next; },
    output: () => [...nodes.values()].map((node) => `${node.innerHTML}\n${node.textContent}\n${node.placeholder || ''}`).join('\n'),
  };
}

function populate(app) {
  app.run(`
    state.loading = false;
    state.source = 'demo';
    state.demoMode = true;
    state.status = { configured: true, oauthConfigured: true, authenticated: true, historyConfigured: true,
      transcriptsConfigured: true, account: 'Demo account', redirectUri: 'http://localhost:3000' };
    state.calls = [{ id: 'call-1', source: 'demo', demoTemplate: 'call-history-v1',
      direction: 'inbound', outcome: 'answered', startedAt: '2026-09-24T09:00:00Z', durationSeconds: 87,
      from: { name: 'Example Customer', number: '100' }, to: { name: 'Support', number: '200' },
      user: { name: 'Example Agent', number: '200' }, contact: { name: 'Example Customer', company: 'Example Account' },
      transcriptId: 'transcript-1', summary: 'Demo-Anlage', ticket: { id: 'T-1', title: 'Demo Vorgang' }
    }, { id: 'call-2', source: 'demo', direction: 'inbound', outcome: 'missed', startedAt: '2026-09-24T08:00:00Z',
      from: { number: '101' }, to: { number: '200' } }];
    state.rawCalls = state.calls;
    state.selectedCallId = 'call-1';
    state.selectedTranscriptCallId = 'call-1';
    state.transcript = { ok: true, summary: 'Eine deutsche synthetische Zusammenfassung', text: 'Synthetischer Text' };
    state.transcriptCache.set('demo:transcript-1', state.transcript);
  `);
}

// A small DOM model that reparses forms when their container's HTML is replaced.
// Retaining node identity preserves incomplete settings edits, focus and caret.
function trackRenderedForm(app, containerId, formId) {
  const container = app.element(containerId);
  const model = { form: null, markup: '' };
  Object.defineProperty(container, 'innerHTML', {
    get: () => model.markup,
    set(markup) {
      model.markup = markup;
      const match = [...markup.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/g)]
        .find((entry) => entry[1].includes('id="' + formId + '"'));
      if (!match) { model.form = null; return; }
      const fields = Object.fromEntries([...match[2].matchAll(/<input\b([^>]*)>/g)].map((entry) => {
        const name = entry[1].match(/name="([^"]*)"/)?.[1];
        return [name, { tabIndex: 0, isConnected: true, matches: () => false, getClientRects: () => [{}], value: entry[1].match(/value="([^"]*)"/)?.[1] || '', files: [],
          focus() { app.document.activeElement = this; },
          setSelectionRange(start, end, direction) { this.selectionStart = start; this.selectionEnd = end; this.selectionDirection = direction; },
        }];
      }));
      const form = {
        id: formId, fields,
        contains: (field) => Object.values(fields).includes(field),
        replaceWith(next) { model.form = next; },
      };
      model.form = form;
    },
  });
  container.querySelector = (selector) => selector === '#' + formId ? model.form : null;
  container.querySelectorAll = () => [];
  return model;
}


function focusControl(app, dataset = {}, selectors = []) {
  return {
    dataset, tabIndex: 0, isConnected: true, disabled: false, visible: true,
    focus() { app.document.activeElement = this; },
    getClientRects() { return this.visible ? [{}] : []; },
    matches(selector) { return selector === ':disabled' ? this.disabled : selectors.includes(selector); },
    closest(selector) { return selector.split(',').some((part) => selectors.includes(part.trim())) ? this : null; },
  };
}

function deferredCalls(app) {
  const requests = [];
  app.context.fetch = (url) => new Promise((resolve, reject) => {
    requests.push({ url, reject, respond: (payload) => resolve({ ok: true, json: async () => payload }) });
  });
  return requests;
}

function callsPayload(id) {
  return { source: 'demo', calls: [{ id, direction: 'inbound', outcome: 'answered',
    startedAt: '2026-09-24T10:00:00Z', durationSeconds: 42,
    from: { name: id, number: '100' }, to: { number: '200' } }] };
}

test('every frontend message key exists and the canonical contribution is complete in all 12 languages', () => {
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const keys = [...new Set([...appSource.matchAll(/"(history\.[A-Za-z0-9]+)"/g), ...html.matchAll(/"(history\.[A-Za-z0-9]+)"/g)].map((match) => match[1]))];
  assert.ok(keys.length > 0);
  for (const key of keys) assert.ok(Object.hasOwn(catalog, key), `${key} exists in the canonical contribution`);
  for (const [key, translations] of Object.entries(catalog)) {
    for (const language of supportedLanguages) {
      assert.equal(typeof translations[language], 'string', `${key} has ${language} text`);
      assert.ok(translations[language].trim(), `${key} has nonempty ${language} text`);
      assert.deepEqual(
        translations[language].match(/\{\w+\}/g)?.sort() || [],
        translations.en.match(/\{\w+\}/g)?.sort() || [],
        `${key} preserves every parameter in ${language}`,
      );
    }
  }
});

test('all call history views render English system text', () => {
  const app = harness(); populate(app);
  for (const view of ['history', 'transcripts', 'crm', 'setup']) {
    app.run(`state.view = '${view}'; render();`);
    const output = app.output();
    assert.doesNotMatch(output, /[äöüßÄÖÜ]|Demo-Anlage|Demo Vorgang|\b(angenommen|abrechenbar|gespeichert|erkannt|Minuten|Nacharbeit|Kundenfilter|entfernen|vorbereitet|Zusammenfassung)\b/, view);
  }
  assert.match(app.output(), /Sign in|Configuration/);
});

test('R3-HIST-02: failed demo loads name the demo in every language and keep live failures distinct', async () => {
  const app = harness();
  populate(app);
  const requests = deferredCalls(app);
  const pending = app.run('loadCalls(true)');
  requests[0].reject(new Error('Synthetic read failure'));
  await pending;
  for (const language of supportedLanguages) {
    app.language(language);
    app.run('render()');
    assert.ok(app.output().includes(catalog['history.demoCallFailed'][language]), language);
    assert.ok(!app.output().includes(catalog['history.liveCallFailed'][language]), language);
  }
  app.run("state.demoMode = false; clearCallData(); render()");
  assert.ok(app.output().includes(catalog['history.liveCallFailed'].cs));
  assert.equal(app.run('state.calls.length'), 0);
});

for (const scenario of [
  { name: 'forced server demo', configured: true, serverDemo: true, uiDemo: false },
  { name: 'unconfigured server fallback', configured: false, serverDemo: false, uiDemo: false },
  { name: 'unconfigured forced demo', configured: false, serverDemo: true, uiDemo: false },
  { name: 'explicit UI demo', configured: true, serverDemo: false, uiDemo: true },
]) {
  for (const previousLoad of [false, true]) {
    for (const view of ['history', 'transcripts']) {
      test(`R4-HIST-01: ${scenario.name}, ${previousLoad ? 'refresh' : 'first load'}, ${view} reports transport failure as demo`, async () => {
        const app = harness();
        app.run(`state.loading = false; state.view = ${JSON.stringify(view)};
          state.demoMode = ${scenario.uiDemo};
          state.status = { configured: ${scenario.configured}, demoMode: ${scenario.serverDemo}, authenticated: false };`);
        if (previousLoad) {
          app.context.fetch = async () => ({ ok: true, json: async () => ({ ...callsPayload('previous-demo'), source: scenario.configured ? 'demo' : 'demo-fallback' }) });
          await app.run('loadCalls(true)');
          assert.equal(app.run('state.calls.length'), 1, 'initial server demo loads without enabling UI demo');
        }
        app.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
        await app.run('loadCalls(true)');
        for (const language of supportedLanguages) {
          app.language(language);
          app.run('render()');
          assert.equal(app.run('callDataState()[0]'), 'history.demoCallFailed', language);
          assert.equal(app.element('#connection-state').textContent, catalog['history.error'][language], language);
          assert.match(app.element('#status-note').className, /is-error/);
          assert.doesNotMatch(app.element('#status-note').innerHTML, /data-open-setup/);
          assert.ok(app.output().includes(catalog['history.demoCallFailed'][language]), language);
          assert.equal(app.element('#metrics').hidden, true);
          assert.equal(app.element('#metrics').innerHTML, '');
        }
        assert.equal(app.run('state.calls.length'), 0);
        assert.equal(app.run('state.rawCalls.length'), 0);
        assert.equal(app.run('state.transcriptCache.size'), 0);
        app.context.fetch = async () => ({ ok: true, json: async () => callsPayload('recovered-demo') });
        await app.run('loadCalls(true)');
        assert.equal(app.run('state.calls[0].id'), 'recovered-demo');
        assert.equal(app.run('state.error'), '');
      });
    }
  }
}

test('R4-HIST-01: leaving server demo does not mask a real sign-in failure or live transport failure', async () => {
  const app = harness();
  app.run('state.demoMode = false; state.status = { configured: true, demoMode: true, authenticated: false };');
  app.context.fetch = async () => ({ ok: true, json: async () => callsPayload('previous-demo') });
  await app.run('loadCalls(true)');
  app.run('state.status = { configured: true, demoMode: false, authenticated: false };');
  app.context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'Login with NFON is required for live call history' }) });
  await app.run('loadCalls(true)');
  assert.equal(app.run('callDataState()[0]'), 'history.loginRequired');
  assert.match(app.element('#status-note').innerHTML, /data-open-setup/);
  assert.equal(app.run('state.calls.length'), 0);
  app.run('state.status.authenticated = true;');
  app.context.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await app.run('loadCalls(true)');
  assert.equal(app.run('callDataState()[0]'), 'history.liveCallFailed');
  assert.equal(app.element('#connection-state').textContent, catalog['history.error'].en);
});



test('real API/customer data remains verbatim and protected from DOM translation', () => {
  const app = harness(); populate(app);
  app.run(`state.calls[0].source = 'callhistory-live'; state.calls[0].from.name = 'Angenommen GmbH';
    state.calls[0].ticket.title = 'Rückruf vereinbaren';
    state.transcript = { ok: true, summary: '## Zusammenfassung: Bitte nicht ändern.', text: 'Kundin: Bitte morgen zurückrufen.' };
    state.transcriptCache.set('demo:transcript-1', state.transcript); renderDetail();`);
  assert.equal(app.run('callTranscriptSummary(state.calls[0])'), '## Zusammenfassung: Bitte nicht ändern.');
  assert.equal(app.run('callTranscriptText(state.calls[0])'), 'Kundin: Bitte morgen zurückrufen.');
  const output = app.element('#call-detail').innerHTML;
  assert.match(output, /data-i18n-ignore>Angenommen GmbH/);
  assert.match(output, /data-i18n-ignore>## Zusammenfassung: Bitte nicht ändern\./);
  app.language('de');
  assert.equal(app.run('callTranscriptText(state.calls[0])'), 'Kundin: Bitte morgen zurückrufen.');
});

test('generated demo transcript and copied payload follow the selected language', () => {
  const app = harness(); populate(app);
  assert.match(app.run('copyPayload(state.calls[0], "all")'), /Example Customer: We need a brief update/);
  assert.doesNotMatch(app.run('copyPayload(state.calls[0], "all")'), /Zusammenfassung|Rueckmeldung|Transkript/);
  app.language('de');
  assert.match(app.run('copyPayload(state.calls[0], "all")'), /Zusammenfassung/);
  assert.match(app.run('callTranscriptText(state.calls[0])'), /Rückmeldung/);
  for (const language of supportedLanguages) {
    app.language(language);
    const copied = app.run('copyPayload(state.calls[0], "all")');
    assert.ok(copied.startsWith(catalog['history.transcript'][language] + ': transcript-1\n' + catalog['history.call'][language] + ': '), language);
    assert.ok(copied.includes(catalog['history.summary'][language]), language);
    assert.ok(copied.includes('Example Customer'), 'customer name stays unchanged');
  }
});



test('message fallback stays English if the shared runtime or key is missing', () => {
  const app = harness('fr');
  assert.equal(app.run('message("history.notAKey", "Hello {name}", { name: "Example" })'), 'Hello Example');
  app.window.NFON_I18N = undefined;
  assert.equal(app.run('message("history.callback", "Callback")'), 'Callback');
});

test('language change retains settings drafts, focus and incomplete filter typing', () => {
  const app = harness();
  const file = { name: 'logo.png' };
  let focused = false;
  const field = { value: 'Ungespeicherter Kundenname', files: [file], isConnected: true, selectionStart: 3, selectionEnd: 7, selectionDirection: 'forward',
    focus() { focused = true; }, setSelectionRange(start, end) { assert.equal(start, 3); assert.equal(end, 7); } };
  const form = { id: 'callhistory-browser-login-form', field };
  const detail = { open: true };
  let replacement;
  app.document.querySelectorAll = (selector) => selector === 'form[id]' ? [form] : selector === 'details' ? [detail] : [];
  app.document.getElementById = () => ({ replaceWith(node) { replacement = node; } });
  app.document.activeElement = field;
  app.element('#party-filter').value = 'unsaved search';
  app.element('#queue-filter').value = 'Support';
  app.run('render = () => { els.partyFilter.value = ""; els.queueFilter.value = ""; };');
  for (const language of supportedLanguages) {
  app.language(language);
  app.listeners.get('nfon:language-change')({ detail: { language, previousLanguage: 'en' } });
  assert.equal(replacement, form);
  assert.equal(replacement.field.value, 'Ungespeicherter Kundenname');
  assert.equal(replacement.field.files[0], file);
  assert.equal(app.element('#party-filter').value, 'unsaved search');
  assert.equal(app.element('#queue-filter').value, 'Support');
  assert.ok(focused);
  assert.ok(detail.open);
  }
});

test('copy fetches the selected transcript before copying and never copies a loading placeholder', async () => {
  const app = harness(); populate(app);
  app.run('state.calls[0].source = "callhistory-live"; state.transcriptCache.clear();');
  let requested = '';
  let copied = '';
  app.context.fetch = async (url) => { requested = url; return { ok: true, json: async () => ({ ok: true, text: 'Actual transcript content', summary: 'Summary' }) }; };
  app.context.navigator.clipboard = { async writeText(value) { copied = value; } };
  await app.run('copyCallPart("call-1", "transcript")');
  assert.equal(requested, '/api/transcripts/transcript-1?mode=demo');
  assert.equal(copied, 'Actual transcript content');
  app.run('state.transcriptCache.clear();');
  app.context.fetch = async () => ({ ok: false, json: async () => ({ error: 'Live transcript request failed' }) });
  copied = '';
  await assert.rejects(app.run('copyCallPart("call-1", "transcript")'), /Live transcript request failed/);
  assert.equal(copied, '');
});

test('transcript failures remain visible with an explicit error state', () => {
  const app = harness(); populate(app);
  app.run('state.transcript = { ok: false, error: "Live transcript request failed" }; renderDetail();');
  assert.match(app.element('#call-detail').innerHTML, /Transcript unavailable/);
  assert.match(app.element('#call-detail').innerHTML, /Live transcript request failed/);
});

for (const [clientName, clientSource] of [
  ['standalone', appSource],
  ['static demo', fs.readFileSync(path.join(__dirname, '../../docs/call-history/app.js'), 'utf8')],
]) {
test(`${clientName}: the fixed CRM preserves all 12 languages on initial load and appearance updates`, () => {
  for (const initialLanguage of supportedLanguages) {
    const app = harness(initialLanguage, clientSource); populate(app);
    const frame = app.element('#crm-demo-frame');
    const messages = [];
    let frameSource;
    let navigations = 0;
    Object.defineProperty(frame, 'src', {
      get: () => frameSource,
      set(value) { frameSource = value; navigations += 1; },
    });
    frame.contentWindow = {
      postMessage: (payload, origin) => messages.push({ payload: JSON.parse(JSON.stringify(payload)), origin }),
    };
    const historyBefore = app.run('JSON.stringify({ calls: state.calls, rawCalls: state.rawCalls, transcript: state.transcript, filters: state.filters })');
    app.run('renderCrmDemo();');
    const initialSource = frame.src;
    const initialUrl = new URL(initialSource, app.window.location);
    assert.equal(initialUrl.pathname, '/crm-demo/index.html');
    assert.equal(initialUrl.searchParams.get('lang'), initialLanguage, `initial ${initialLanguage} must not collapse to English`);
    assert.equal(initialUrl.searchParams.get('theme'), 'admin-portal');
    assert.deepEqual([...initialUrl.searchParams.keys()].sort(), ['lang', 'theme'], 'the initial URL carries appearance only');
    assert.equal(navigations, 1);

    for (const [index, language] of supportedLanguages.entries()) {
      const theme = index % 2 === 0 ? 'classic' : 'admin-portal';
      app.language(language);
      app.document.documentElement.dataset.nfonTheme = theme;
      app.run('renderCrmDemo();');
      assert.equal(app.element('#crm-demo-frame'), frame, 'appearance updates retain the iframe');
      assert.equal(frame.src, initialSource, 'appearance updates preserve the initial iframe URL');
      assert.equal(navigations, 1, 'appearance updates do not navigate or reload the iframe');
      assert.equal(messages.length, index + 1);
      assert.deepEqual(messages.at(-1), {
        payload: { type: 'nfon:crm-demo:appearance', theme, lang: language, active: false },
        origin: '*',
      }, `${initialLanguage} to ${language} passes only theme and unchanged language, never history data`);
    }
    assert.equal(app.run('JSON.stringify({ calls: state.calls, rawCalls: state.rawCalls, transcript: state.transcript, filters: state.filters })'), historyBefore);
  }
});

test(`${clientName}: opening and refreshing the fixed CRM does not read or mutate history data`, async () => {
  const app = harness('en', clientSource); populate(app);
  const frame = app.element('#crm-demo-frame');
  const messages = [];
  frame.contentWindow = { postMessage: (payload, origin) => messages.push({ payload: JSON.parse(JSON.stringify(payload)), origin }) };
  const before = app.run('JSON.stringify({ calls: state.calls, rawCalls: state.rawCalls, transcript: state.transcript, filters: state.filters })');
  const requests = [];
  app.context.fetch = async (url) => { requests.push(url); throw new Error('Unexpected history request from fixed CRM'); };
  app.run('bindEvents();');
  app.listeners.get('click')({ target: focusControl(app, { view: 'crm' }, ['[data-view]']) });
  const initialSrc = frame.src;
  const initialFrame = frame;
  await app.run('loadCalls();');
  app.language('de');
  app.document.documentElement.dataset.nfonTheme = 'classic';
  app.run('render();');
  assert.equal(app.run('state.view'), 'crm');
  assert.equal(app.element('#crm-demo-frame'), initialFrame, 'the editor is not recreated during parent render');
  assert.equal(frame.src, initialSrc, 'the frame is not navigated away from its unsaved draft');
  assert.equal(app.element('.filter-panel').hidden, true);
  assert.deepEqual(requests, []);
  assert.equal(app.run('JSON.stringify({ calls: state.calls, rawCalls: state.rawCalls, transcript: state.transcript, filters: state.filters })'), before);
  assert.ok(messages.length);
  assert.deepEqual(messages.findLast(item => item.payload.type.endsWith(':appearance')), { payload: { type: 'nfon:crm-demo:appearance', theme: 'classic', lang: 'de', active: true }, origin: '*' });
  for (const { payload } of messages) assert.deepEqual(Object.keys(payload).sort(), payload.type.endsWith(':visibility') ? ['active', 'type'] : ['active', 'lang', 'theme', 'type']);
});

test(`${clientName}: frame messages require the expected origin and window and cannot inject a height`, () => {
  const app = harness('en', clientSource); populate(app);
  const frame = app.element('#crm-demo-frame');
  const sent = [];
  frame.contentWindow = { postMessage: (payload) => sent.push(payload) };
  frame.src = './crm-demo/index.html';
  frame.style.height = '900px';
  app.run('state.view = "crm"; bindEvents();');
  const receive = app.listeners.get('window:message');
  const trusted = { origin: app.window.location.origin, source: frame.contentWindow };
  for (const event of [
    { ...trusted, origin: 'https://untrusted.example', data: { type: 'nfon:crm-demo:height', height: 700 } },
    { ...trusted, source: {}, data: { type: 'nfon:crm-demo:height', height: 700 } },
    { ...trusted, data: { type: 'nfon:crm-demo:height', height: '700px;background:red' } },
    { ...trusted, data: { type: 'nfon:crm-demo:height', height: Infinity } },
    { ...trusted, data: null },
  ]) receive(event);
  assert.equal(frame.style.height, '900px');
  receive({ ...trusted, origin: 'https://untrusted.example', data: { type: 'nfon:crm-demo:ready' } });
  assert.equal(sent.length, 0);
  receive({ ...trusted, data: { type: 'nfon:crm-demo:height', height: 1234.5 } });
  assert.equal(frame.style.height, '1235px');
  receive({ ...trusted, data: { type: 'nfon:crm-demo:height', height: -20 } });
  assert.ok(Number.parseInt(frame.style.height, 10) > 0);
  receive({ ...trusted, data: { type: 'nfon:crm-demo:ready' } });
  assert.deepEqual(JSON.parse(JSON.stringify(sent.at(-1))), { type: 'nfon:crm-demo:appearance', theme: 'admin-portal', lang: 'en', active: true });
});

test(`${clientName}: the sign-in prompt is localized while an authenticated account name is preserved`, () => {
  const app = harness('en', clientSource); populate(app);
  app.run('state.status.authenticated = false; state.status.account = ""; renderHeader();');
  assert.match(app.element('#account-label').innerHTML, /data-i18n-key="history.loginRequired"[^>]*>Sign in required/);
  assert.doesNotMatch(app.element('#account-label').innerHTML, /Login erforderlich/);
  app.language('de');
  app.run('renderHeader();');
  assert.match(app.element('#account-label').innerHTML, />Anmeldung erforderlich<\/span>/);
  app.language('en');
  app.run('state.status.authenticated = true; state.status.account = "Login erforderlich"; renderHeader();');
  assert.match(app.element('#account-label').innerHTML, /data-i18n-ignore>Login erforderlich<\/span>/);
});

test(`${clientName}: out-of-order transcript responses cannot replace the selected call assignment`, async () => {
  const app = harness('en', clientSource); populate(app);
  app.run(`state.view = 'history'; state.transcriptCache.clear();
    state.calls[0].source = 'callhistory-live'; state.calls[1].source = 'callhistory-live';
    state.calls[1].transcriptId = 'transcript-2';`);
  const responses = {};
  app.context.fetch = (url) => new Promise((resolve) => { responses[url] = resolve; });
  const first = app.run('loadSelectedTranscript()');
  app.run('state.selectedCallId = "call-2"');
  const second = app.run('loadSelectedTranscript()');
  responses['/api/transcripts/transcript-2?mode=demo']({ ok: true, json: async () => ({ ok: true, summary: 'Summary B', text: 'Transcript B', assignee: { name: 'Agent B', number: '202' } }) });
  await second;
  responses['/api/transcripts/transcript-1?mode=demo']({ ok: true, json: async () => ({ ok: true, summary: 'Summary A', text: 'Transcript A', assignee: { name: 'Agent A', number: '201' } }) });
  await first;
  assert.equal(app.run('state.selectedCallId'), 'call-2');
  assert.equal(app.run('state.transcript.assignee.name'), 'Agent B');
  assert.match(app.element('#call-detail').innerHTML, />202<\/strong>/);
  assert.doesNotMatch(app.element('#call-detail').innerHTML, />Agent B<\/strong>/, 'an assignee is not a queue');
  assert.doesNotMatch(app.element('#call-detail').innerHTML, /Agent A|Transcript A/);
});

test(`${clientName}: stale transcript failures and source changes do not update the visible detail`, async () => {
  const app = harness('en', clientSource); populate(app);
  app.run('state.transcriptCache.clear();');
  let reject;
  app.context.fetch = () => new Promise((_resolve, fail) => { reject = fail; });
  const pending = app.run('loadSelectedTranscript()');
  app.run('state.demoMode = false; clearCallData();');
  reject(new Error('Failure from the previous demo selection'));
  await pending;
  assert.equal(app.run('state.transcript'), null);
  assert.equal(app.run('state.transcriptCache.size'), 0);
  assert.doesNotMatch(app.element('#call-detail').innerHTML, /Failure from the previous/);
});

test(`${clientName}: a newly selected call never displays the previous transcript assignee before loading`, () => {
  const app = harness('en', clientSource); populate(app);
  app.run(`state.transcript = { ok: true, assignee: { name: 'Wrong previous agent' } };
    state.selectedCallId = 'call-2'; renderDetail();`);
  assert.doesNotMatch(app.element('#call-detail').innerHTML, /Wrong previous agent/);
});

test(`${clientName}: only the newest call request can update calls or finish loading`, async () => {
  const app = harness('en', clientSource); populate(app);
  const requests = deferredCalls(app);
  const first = app.run('state.filters.range = "today"; loadCalls()');
  const second = app.run('state.filters.range = "7d"; loadCalls()');
  requests[0].respond(callsPayload('stale-first'));
  await first;
  assert.equal(app.run('state.loading'), true, 'an older success cannot finish a newer request');
  assert.equal(app.run('state.calls[0].id'), 'call-1');
  const third = app.run('state.filters.range = "30d"; loadCalls()');
  requests[2].respond(callsPayload('latest'));
  await third;
  requests[1].respond(callsPayload('stale-second'));
  await second;
  assert.equal(app.run('state.filters.range'), '30d');
  assert.equal(app.run('state.calls[0].id'), 'latest');
  assert.equal(app.run('state.rawCalls[0].id'), 'latest');
  assert.equal(app.run('state.selectedCallId'), 'latest');
  assert.equal(app.run('state.loading'), false);
  assert.equal(app.run('state.error'), '');
  assert.doesNotMatch(app.output(), /stale-first|stale-second/);
});

test(`${clientName}: stale call errors do not clear current data or stop a newer loading state`, async () => {
  const app = harness('en', clientSource); populate(app);
  const requests = deferredCalls(app);
  const first = app.run('loadCalls()');
  const second = app.run('state.filters.range = "30d"; loadCalls()');
  requests[0].reject(new Error('stale error during loading'));
  await first;
  assert.equal(app.run('state.loading'), true);
  assert.equal(app.run('state.error'), '');
  assert.equal(app.run('state.calls[0].id'), 'call-1');
  const third = app.run('loadCalls()');
  requests[2].respond(callsPayload('current-result'));
  await third;
  requests[1].reject(new Error('stale error after success'));
  await second;
  assert.equal(app.run('state.calls[0].id'), 'current-result');
  assert.equal(app.run('state.error'), '');
  assert.equal(app.run('state.loading'), false);
  const currentFailure = app.run('loadCalls(true)');
  requests[3].reject(new Error('current request failed'));
  await currentFailure;
  assert.equal(app.run('state.error'), 'current request failed');
  assert.equal(app.run('state.calls.length'), 0);
  assert.equal(app.run('state.loading'), false);
});

test(`${clientName}: changing call source invalidates the prior call response`, async () => {
  const app = harness('en', clientSource); populate(app);
  const requests = deferredCalls(app);
  const old = app.run('loadCalls()');
  const current = app.run('state.demoMode = false; clearCallData(); loadCalls()');
  requests[0].respond(callsPayload('old-demo-result'));
  await old;
  assert.equal(app.run('state.calls.length'), 0);
  assert.equal(app.run('state.loading'), true);
  requests[1].respond({ ...callsPayload('live-result'), source: 'callhistory-live' });
  await current;
  assert.equal(app.run('state.source'), 'callhistory-live');
  assert.equal(app.run('state.calls[0].id'), 'live-result');
});

test(`${clientName}: routine rendering retains browser login drafts`, () => {
  const app = harness('en', clientSource); populate(app);
  const auth = trackRenderedForm(app, '#auth-login-panel', 'callhistory-browser-login-form');
  app.run('state.view = "setup"; state.authLoginMode = "browser"; render();');
  const authForm = auth.form;
  authForm.fields.clientId.value = 'Unsaved client ID';
  app.run('render();');
  assert.equal(auth.form, authForm);
  assert.equal(auth.form.fields.clientId.value, 'Unsaved client ID');
});


for (const responseKind of ['success', 'failure']) {
  test(`${clientName}: pending participant and queue input survives a call ${responseKind} before debounce`, async () => {
    const app = harness('en', clientSource); populate(app);
    const requests = deferredCalls(app);
    const timers = new Map();
    const handlers = {};
    let timerId = 0;
    app.context.setTimeout = (callback, delay) => {
      assert.equal(delay, 220);
      timers.set(++timerId, callback);
      return timerId;
    };
    app.context.clearTimeout = (id) => timers.delete(id);
    for (const field of ['party', 'queue']) {
      app.element('#' + field + '-filter').addEventListener = (event, handler) => {
        if (event === 'input') handlers[field] = handler;
      };
    }
    app.context.pendingLoads = [];
    app.run('const originalLoadCalls = loadCalls; loadCalls = () => { const pending = originalLoadCalls(); pendingLoads.push(pending); return pending; }; bindEvents();');
    const initialLoad = app.run('loadCalls()');
    const party = app.element('#party-filter');
    const queue = app.element('#queue-filter');
    party.value = 'old incomplete input'; handlers.party();
    party.value = '  Example Customer  '; handlers.party();
    queue.value = '  Sales  '; handlers.queue();
    assert.equal(timers.size, 2, 'retyping cancels the previous participant debounce');
    assert.equal(app.run('state.filters.party'), '', 'typing alone has not applied a server filter');
    assert.equal(app.run('state.filters.queue'), '');
    if (responseKind === 'success') { const payload = callsPayload('matching-result'); payload.calls[0].queue = { name: 'Sales' }; payload.calls[0].from.name = 'Example Customer'; requests[0].respond(payload); }
    else requests[0].reject(new Error('previous request failure'));
    await initialLoad;
    assert.equal(party.value, '  Example Customer  ');
    assert.equal(queue.value, '  Sales  ');

    // Applying one filter renders immediately while the other field is still a draft.
    const callbacks = [...timers.values()];
    callbacks[0]();
    assert.equal(party.value, 'Example Customer');
    assert.equal(queue.value, '  Sales  ');
    callbacks[1]();
    assert.equal(queue.value, 'Sales');
    assert.equal(app.run('state.filters.queue'), 'Sales');
    if (responseKind === 'failure') {
      assert.ok(requests.slice(1).every(request => !new URL(request.url, 'http://localhost').searchParams.has('party')), 'server requests fetch the period, local filters handle names and numbers');
      const payload = callsPayload('matching-result'); payload.calls[0].queue = { name: 'Sales' }; payload.calls[0].from.name = 'Example Customer';
      requests[2].respond(payload); await app.context.pendingLoads[2];
      requests[1].respond(callsPayload('obsolete-participant-result')); await app.context.pendingLoads[1];
    } else {
      await Promise.all(app.context.pendingLoads);
      assert.equal(requests.length, 1, 'local filters reuse the loaded period');
    }
    assert.equal(app.run('state.calls[0].id'), 'matching-result');
    assert.equal(app.run('state.filters.party'), 'Example Customer');
    assert.equal(party.value, 'Example Customer');
    assert.equal(queue.value, 'Sales');
    assert.equal(app.run('state.loading'), false);
  });
}

for (const change of ['dropdown', 'dropdowns and CRM navigation']) {
  test(`${clientName}: cleared text filters apply immediately during ${change} before debounce`, async () => {
    const app = harness('en', clientSource); populate(app);
    const handlers = {};
    const timers = new Map();
    let timerId = 0;
    app.context.setTimeout = (callback) => { timers.set(++timerId, callback); return timerId; };
    app.context.clearTimeout = (id) => timers.delete(id);
    for (const name of ['party', 'queue', 'transcript', 'direction', 'range']) {
      app.element('#' + name + '-filter').addEventListener = (event, handler) => { handlers[name + ':' + event] = handler; };
    }
    const requests = [];
    app.context.fetch = async (url) => {
      requests.push(url);
      const all = [
        { ...callsPayload('call-tim').calls[0], from: { number: '2102' }, user: { name: 'Tim' } },
        { ...callsPayload('call-other').calls[0], from: { number: '2103' }, user: { name: 'Other agent' } },
      ];
      const party = new URL(url, 'http://localhost').searchParams.get('party');
      return { ok: true, json: async () => ({ source: 'demo', calls: party ? all.filter((call) => call.from.number === party) : all }) };
    };
    app.run('state.view = "history"; state.filters.party = "2102"; state.filters.queue = "Tim"; state.filters.range = "today"; state.filters.direction = "inbound"; state.filters.transcript = "without"; render(); bindEvents();');
    for (const field of ['queue', 'party']) {
      app.element('#' + field + '-filter').value = '';
      handlers[field + ':input']();
    }
    app.element('#transcript-filter').value = 'all';
    handlers['transcript:change']();
    if (change === 'dropdowns and CRM navigation') {
      app.element('#direction-filter').value = 'all'; handlers['direction:change']();
      app.element('#range-filter').value = '30d'; handlers['range:change']();
      app.listeners.get('click')({ target: focusControl(app, { view: 'crm' }, ['[data-view]']) });
    }
    await new Promise(setImmediate);
    assert.equal(timers.size, 2, 'the debounce has not run yet');
    assert.equal(app.element('#party-filter').value, '');
    assert.equal(app.element('#queue-filter').value, '');
    assert.ok(requests.every((url) => !new URL(url, 'http://localhost').searchParams.has('party')), 'intervening requests must not reuse the cleared participant');
    assert.equal(app.run('state.calls.length'), 2, 'the cleared queue must also apply before its timer fires');
    assert.equal(app.run('state.view'), change === 'dropdown' ? 'history' : 'crm');
    for (const callback of [...timers.values()]) callback();
    await new Promise(setImmediate);
    assert.equal(app.run('state.filters.party'), '');
    assert.equal(app.run('state.filters.queue'), '');
    assert.equal(app.run('state.calls.length'), 2);
    assert.equal(app.run('state.loading'), false);
    assert.equal(app.element('#party-filter').value, '');
    assert.equal(app.element('#queue-filter').value, '');
  });
}
}


test('CH-H1: the render budget leaves every loaded record reachable with Show more', () => {
  const app = harness(); populate(app);
  app.run(`state.calls = Array.from({length: 95}, (_, index) => ({...state.calls[0], id: 'row-' + index})); renderCalls(); bindEvents();`);
  assert.equal((app.element('#calls-body').innerHTML.match(/class="history-row /g) || []).length, 80);
  assert.match(app.element('#calls-body').innerHTML, /data-load-more="history"/);
  app.listeners.get('click')({target: {closest: selector => selector === '[data-load-more]' ? {dataset: {loadMore:'history'}} : null}});
  assert.equal((app.element('#calls-body').innerHTML.match(/class="history-row /g) || []).length, 95);
  assert.doesNotMatch(app.element('#calls-body').innerHTML, /data-load-more="history"/);
});

test('blocked storage does not prevent startup defaults or preference interactions', () => {
  const app = harness('en', appSource, {getItem(){throw new Error('blocked');},setItem(){throw new Error('blocked');}});
  assert.equal(app.run('storedValue("any")'), null);
  assert.doesNotThrow(() => app.run('storeValue("any", "en"); persistFilters();'));
  assert.equal(app.run('state.demoMode'), false);
});


test('cockpit pause propagates only visibility to the fixed CRM frame', () => {
  const app = harness(); populate(app);
  const frame=app.element('#crm-demo-frame'), sent=[];
  frame.contentWindow={postMessage: value=>sent.push(JSON.parse(JSON.stringify(value)))};
  frame.src='./crm-demo/index.html';
  app.run('state.view="crm"; bindEvents();');
  const pause=app.listeners.get('nfon:demo-pause');
  pause({detail:{paused:true}});
  assert.deepEqual(sent.at(-1),{type:'nfon:crm-demo:visibility',active:false});
  pause({detail:{paused:false}});
  assert.deepEqual(sent.at(-1),{type:'nfon:crm-demo:visibility',active:true});
  app.run('state.view="history";'); pause({detail:{paused:false}});
  assert.equal(sent.at(-1).active,false);
});


test('OAuth start link passes only current language and theme to the local server', () => {
  const app=harness('fi');populate(app);app.document.documentElement.dataset.nfonTheme='classic';
  app.run('renderAuthLoginPanel();');
  assert.equal(app.element('#auth-login').href,'/auth/login?theme=classic&lang=fi');
});

test('History marks explicit demo, fallback and fixed CRM consistently and clears the marker for live data',()=>{
 const app=harness('en');populate(app);
 for(const source of ['demo','demo-fallback']){
  app.run(`state.loading=false;state.error='';state.view='history';state.demoMode=false;state.status.configured=false;state.source=${JSON.stringify(source)};renderHeader()`);
  assert.equal(app.element('#connection-state').textContent,'Demo');assert.equal(app.element('#connection-state').getAttribute('data-status-mode'),'demo');assert.equal(app.element('#connection-state').className,'connection');
 }
 app.run(`state.view='crm';renderHeader()`);assert.equal(app.element('#connection-state').textContent,'Demo');assert.equal(app.element('#connection-state').getAttribute('data-status-mode'),'demo');
 app.run(`state.view='history';state.source='callhistory-live';state.status.configured=true;renderHeader()`);assert.equal(app.element('#connection-state').textContent,'Ready');assert.equal(app.element('#connection-state').getAttribute('data-status-mode'),null);
});

test('R-HIST-03: average duration uses answered calls in both numerator and denominator', () => {
  const app=harness();populate(app);app.run('state.calls[0].durationSeconds=120; state.calls[1].durationSeconds=3600;');
  assert.equal(app.run('callMetrics().average'),120);
});
test('R-HIST-04: fallback filtering reuses the downloaded period without requests or selection reset',async()=>{
  const app=harness();populate(app);app.run(`state.demoMode=false;state.source='demo-fallback';state.loadedQuery=queryForCalls();state.calls[0].transcriptId='';state.selectedCallId='call-1';state.filters.party='Example';`);
  app.context.fetch=()=>{throw new Error('Fallback must remain cached');};await app.run('loadCalls()');
  assert.equal(app.run('state.selectedCallId'),'call-1');assert.equal(app.run('state.calls.length'),1);assert.equal(app.run('state.error'),'');
});
test('R-HIST-09/16: phone variants match without turning translated placeholders into queue data',()=>{
  const app=harness();populate(app);app.run(`state.calls[0].from.number='+49 (89) 1234'; state.calls[0].queue={name:'Поддержка'};`);
  for(const party of ['089 1234','(089) 1234','0049 89 1234','+49 (0)89 1234']) {
    app.run(`state.filters.party=${JSON.stringify(party)}`);assert.equal(app.run('applyLocalFilters(state.calls).length'),1);
  }
  app.run(`state.filters.party='';state.filters.queue='Поддерж';`);assert.equal(app.run('applyLocalFilters(state.calls).length'),1);
  app.run(`state.filters.queue='identified'`);assert.equal(app.run('applyLocalFilters(state.calls).length'),0);
});
test('R-HIST-11: signed-out state is neutral and offers Setup rather than a red network error',()=>{
  const app=harness();populate(app);app.run(`state.demoMode=false;state.source='callhistory-live';state.status.authenticated=false;state.error='Login with NFON is required for live call history';renderHeader();renderStatusNote();`);
  assert.equal(app.element('#connection-state').textContent,'Sign in required');assert.equal(app.element('#status-note').className,'status-note');
  assert.match(app.element('#status-note').innerHTML,/data-open-setup/);
});
test('R-HIST-17: count summaries use neutral count labels in every language, including one',()=>{
  for(const lang of supportedLanguages){const app=harness(lang);const text=app.run(`message('history.listSummary','',{count:1,source:'Demo',range:'7d'})`);assert.match(text,/: 1 · Demo/);}
});


test('R2-HIST-02/09: request failures and signed-out transcripts never imply an empty history', async () => {
  const app=harness('de');populate(app);app.run("state.demoMode=false;state.source='callhistory-live';state.view='transcripts'");
  app.context.fetch=async()=>({ok:false,status:502,json:async()=>({error:'Live Call History request failed'})});
  await app.run('loadCalls(true)');
  assert.equal(app.element('#metrics').hidden,true);
  assert.doesNotMatch(app.element('#history-subtitle').textContent,/0/);
  assert.doesNotMatch(app.element('#calls-body').innerHTML,/Keine Anrufe|No calls|Anmeldung erforderlich/);
  assert.doesNotMatch(app.element('#transcript-grid').innerHTML,/aktuellen Filter|current filters/);
  app.context.fetch=async()=>({ok:false,status:401,json:async()=>({error:'Login with NFON is required for live call history'})});
  await app.run('loadCalls(true)');
  assert.match(app.element('#transcript-grid').innerHTML,/Anmeldung erforderlich/);
  assert.doesNotMatch(app.element('#transcript-grid').innerHTML,/aktuellen Filter/);
});
test('R2-HIST-03: calls allow the maximum server budget and browser timeouts use localized system text',async()=>{
  const app=harness('de'); const budgets=[];
  app.context.AbortSignal={timeout:ms=>{budgets.push(ms);return undefined;}};
  app.context.fetch=async()=>{const error=new Error('signal timed out');error.name='TimeoutError';throw error;};
  await assert.rejects(app.run("apiJson('/api/calls?mode=live')"),/Failed to fetch/);
  assert.ok(budgets[0]>60000);
  assert.equal(app.run('systemMessage("Failed to fetch")'),catalog['history.networkError'].de);
});
test('R2-HIST-08: partial data and excluded-date warnings are both visible',()=>{
  const app=harness('de');populate(app);
  app.run("state.demoMode=false;state.source='callhistory-live';state.pagination={complete:false};state.invalidRecords=2;renderStatusNote()");
  const text=app.element('#status-note').innerHTML;
  assert.match(text,/unvollständig/);assert.match(text,/2/);assert.match(text,/Datum/);
});
test('R2-CODE-03: explicit demo caches fallback payloads for local filters without losing transcript or selection',async()=>{
  const app=harness();populate(app);let requests=0;
  app.context.fetch=async()=>{requests++;return {ok:true,json:async()=>({source:'demo-fallback',calls:app.run('state.rawCalls')})}};
  await app.run('loadCalls(true)');const before=requests;
  app.run("state.selectedCallId='call-1';state.transcriptCache.set('demo:transcript-1',{ok:true,text:'Cached transcript'});state.filters.direction='inbound'");
  await app.run('loadCalls()');
  assert.equal(requests,before);assert.equal(app.run('state.selectedCallId'),'call-1');
  assert.equal(app.run("state.transcriptCache.has('demo:transcript-1')"),true);
  assert.equal(app.run('state.transcript.text'),'Cached transcript');
});


test('R2-I18N-10: the login link includes the validated cockpit preference alongside language and theme',()=>{
  const app=harness('fi');populate(app);
  app.window.NFON_APPEARANCE={getCockpitUrl:()=> 'http://localhost:4999/apps?theme=classic'};
  app.run('renderAuthLoginPanel()');
  const target=new URL(app.element('#auth-login').href,'http://localhost:3000');
  assert.equal(target.pathname,'/auth/login');assert.equal(target.searchParams.get('cockpit'),'http://localhost:4999/apps?theme=classic');
  assert.equal(target.searchParams.get('lang'),'fi');
});
