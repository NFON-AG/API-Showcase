const phoneNumbers = require('../CTI_API/public/phone-number.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const docs = path.resolve(__dirname, '../docs');
const repo = path.resolve(docs, '..');
// Local afternoon guarantees completed business-hour examples in every TZ.
const FIXED_NOW = new Date(2026,8,24,17,0,0).toISOString();
class FixtureDate extends Date {
  constructor(...args) { super(...(args.length ? args : [FIXED_NOW])); }
  static now() { return new Date(FIXED_NOW).getTime(); }
}
const source = fs.readFileSync(path.join(docs, 'demo-runtime.js'), 'utf8');
const catalog = Object.assign({}, ...['docs', 'CTI_API', 'CallHistory_API'].map((folder) => JSON.parse(fs.readFileSync(path.join(repo, folder, 'i18n-messages.json'), 'utf8'))));

function runtime(kind, language = 'en', clock = FIXED_NOW) {
  class RuntimeDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return new Date(clock).getTime(); } }
  let currentLanguage = language;
  let networkRequests = 0;
  let interval;
  let clearedInterval = false;
  const listeners = [];
  const document = {
    readyState: 'loading', body: {dataset:{nfonApp:kind}}, head: { appendChild() {} },
    getElementById() { return null; },
    addEventListener(name, fn, options) { listeners.push({ name, fn, options }); },
    createElement() { return { dataset: {}, textContent: '', className: '' }; },
  };
  const window = {
    NFON_PHONE: phoneNumbers,
    location: { href: `https://example.test/showcase/${kind}/index.html`, pathname: `/showcase/${kind}/index.html` },
    addEventListener(name, fn, options) { listeners.push({ target: 'window', name, fn, options }); },
    NFON_I18N: {
      getLanguage: () => currentLanguage,
      message: (key, params = {}) => (catalog[key]?.[currentLanguage] || catalog[key]?.en || '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match),
    },
    fetch() { networkRequests++; throw new Error('A static demo requested the network'); },
    setTimeout() {}, setInterval(fn) { interval = fn; return 1; }, clearInterval() { clearedInterval = true; },
  };
  const sandbox = { window, document, URL, Response, EventTarget, MessageEvent, Event, Date: RuntimeDate, Math, Blob, MutationObserver: class { observe() {} } };
  vm.createContext(sandbox);
  vm.runInContext(source.replace(/\}\)\(\);\s*$/, 'window.__demoTests = { markReadOnlyControl, ensureReadOnlyNote };\n})();'), sandbox);
  return {
    window, document, sandbox, listeners,
    request: async (url, options) => (await window.fetch(url, options)).json(),
    language(next) { currentLanguage = next; },
    requests: () => networkRequests,
    tick: () => interval(),
    closed: () => clearedInterval,
  };
}

test('all CTI and Call History static entry points use relative shared assets and local links', () => {
  for (const [folder, pages] of [['cti', ['index', 'analytics', 'setup', 'contacts']], ['call-history', ['index']]]) {
    for (const page of pages) {
      const html = fs.readFileSync(path.join(docs, folder, `${page}.html`), 'utf8');
      for (const shared of ['appearance.js', 'appearance.css', 'messages.js', 'i18n.js', 'demo-runtime.js']) {
        const assetPath = shared === 'messages.js' ? './messages.js' : `../${shared}`;
        assert.ok(html.includes(assetPath), `${folder}/${page}: ${shared}`);
      }
      assert.ok(html.indexOf('./messages.js') < html.indexOf('../i18n.js'));
      assert.ok(html.indexOf('../i18n.js') < html.indexOf('../demo-runtime.js'));
      assert.ok(html.indexOf('../demo-runtime.js') < html.indexOf('./app.js'));
      assert.doesNotMatch(html, /(?:href|src)="\/(?!\/)|href="https?:\/\/(?:localhost|127\.0\.0\.1)|href="\/auth\//);
      assert.doesNotMatch(html, /id="demo-toggle"/);
    }
  }
});

test('synthetic Call History data has an explicit locale marker and localized transcripts', async () => {
  const app = runtime('call-history');
  const status = await app.request('/api/status');
  assert.ok(status.historyConfigured && status.transcriptsConfigured);
  const history = await app.request('/api/calls?range=30d');
  assert.ok(history.calls.length >= 580 && history.calls.length <= 600);
  assert.ok(history.calls.every(call => Date.parse(call.startedAt) + call.durationSeconds * 1000 <= Date.parse(FIXED_NOW)));
  assert.ok(history.calls.every((call) => call.source === 'demo' && call.demoTemplate === 'call-history-v1'));
  assert.doesNotMatch(JSON.stringify(history), /Demo-Anlage|Demo Vorgang/);
  const call = history.calls.find((item) => item.transcriptId);
  const transcript = await app.request(`/api/transcripts/${call.transcriptId}`);
  assert.equal(transcript.language, 'en');
  assert.match(transcript.text, /We need a brief update/);
  app.language('de');
  const german = await app.request(`/api/transcripts/${call.transcriptId}`);
  assert.equal(german.language, 'de');
  assert.match(german.text, /kurze Rückmeldung/);
  app.language('fr');
  const french = await app.request(`/api/transcripts/${call.transcriptId}`);
  assert.equal(french.language, 'fr');
  assert.match(french.text, /Nous avons besoin/);
  assert.doesNotMatch(french.text, /We need a brief update/);
  assert.equal(app.requests(), 0);
});

test('static Call History filters match current-day, direction and outcome semantics', async () => {
  const app = runtime('call-history');
  const calls = (await app.request('/api/calls?range=today&direction=inbound&outcome=answered')).calls;
  const midnight = new Date(FIXED_NOW); midnight.setHours(0, 0, 0, 0);
  assert.ok(calls.length > 0);
  assert.ok(calls.every((call) => new Date(call.startedAt) >= midnight && call.direction === 'inbound' && call.outcome === 'answered'));
  const absent = await app.request('/api/calls?range=30d&party=does-not-exist');
  assert.equal(absent.calls.length, 0);
});

test('CTI demo contacts follow the current phone and organization schema', async () => {
  const app = runtime('cti');
  const result = await app.request('/api/google/contacts');
  assert.equal(result.status.contacts, result.contacts.length);
  assert.ok(result.contacts.every((contact) => contact.name && contact.organization && contact.phones[0].value));
  assert.doesNotMatch(JSON.stringify(result), /Demo-Anlage|Demo Kontakt/);
  const fullNumber = result.contacts.find(contact => contact.name === 'Demo Contact B').phones[0].value;
  assert.equal((await app.request('/api/contacts/lookup?phone=2002')).contact, null, 'a short suffix must not match an unrelated contact');
  const lookup = await app.request('/api/contacts/lookup?phone=' + encodeURIComponent(fullNumber));
  assert.equal(lookup.contact.name, 'Demo Contact B');
  assert.equal(app.requests(), 0);
});

test('CTI local simulated dialing and ending stay within the demo adapter', async () => {
  const app = runtime('cti');
  const created = await app.request('/api/calls', { method: 'POST', body: JSON.stringify({ caller: '201', callee: '+49000000001' }) });
  assert.equal(created.call.callee, phoneNumbers.dial('+49000000001'));
  assert.equal(created.call.updated,FIXED_NOW);
  assert.equal(created.call.receivedAt,FIXED_NOW);
  const client=fs.readFileSync(path.join(repo,'CTI_API/public/app.js'),'utf8');
  const timestampFunction=client.slice(client.indexOf('function eventTimestamp('),client.indexOf('\nfunction buildCallSessions('));
  vm.runInContext(timestampFunction,app.sandbox);
  app.sandbox.call=created.call;
  assert.equal(vm.runInContext('eventTimestamp(call)',app.sandbox),FIXED_NOW,'the actual CTI client can date the new event');
  assert.ok((await app.request('/api/active-calls')).some((call) => call.uuid === created.uuid));
  await app.request(`/api/calls/${created.uuid}`, { method: 'DELETE' });
  assert.ok(!(await app.request('/api/active-calls')).some((call) => call.uuid === created.uuid));
  assert.equal(app.requests(), 0);
});

test('CTI simulated EventSource delivers onmessage and closes its timer', () => {
  const app = runtime('cti');
  const events = new app.window.EventSource('/api/events');
  let payload;
  let listenerCalls = 0;
  events.onmessage = (event) => { payload = JSON.parse(event.data); };
  events.addEventListener('message', () => { listenerCalls++; });
  app.tick();
  assert.equal(payload.type, 'state');
  assert.ok(payload.state.extension);
  assert.equal(listenerCalls, 1);
  events.close();
  assert.ok(app.closed());
  assert.equal(events.readyState, 2);
});

test('appearance stays interactive while credential controls remain read-only', () => {
  for (const kind of ['cti', 'call-history', 'portal']) {
    const app = runtime(kind);
    const control = (isAppearance) => ({
      tagName: 'SELECT', disabled: false, dataset: {},
      closest: (selector) => selector.split(',').some((part) => part.trim() === '[data-appearance-settings]') && isAppearance ? {} : selector === "[data-demo-readonly='true']" ? {} : null,
    });
    const appearance = control(true);
    const credential = control(false);
    app.window.__demoTests.markReadOnlyControl(appearance);
    app.window.__demoTests.markReadOnlyControl(credential);
    assert.equal(appearance.disabled, false);
    assert.equal(credential.disabled, true);
    let blocked = false;
    const guard = app.listeners.find((listener) => listener.name === 'click' && listener.options === true);
    guard.fn({ target: appearance, preventDefault() { blocked = true; }, stopImmediatePropagation() { blocked = true; } });
    assert.equal(blocked, false);
    let note;
    app.window.__demoTests.ensureReadOnlyNote({ querySelector() { return null; }, prepend(value) { note = value; } });
    assert.equal(note.dataset.i18nKey, kind === 'cti' ? 'demo.cti.setupReadOnly' : 'demo.setupReadOnly');
    assert.match(note.textContent, kind === 'cti' ? /Credentials and backup restore are read-only/ : /Setup is read-only/);
  }
});

test('a CTI static file preview does not contact or navigate to a localhost server', async () => {
  const app = runtime('cti');
  Object.assign(app.window.location, { protocol: 'file:', pathname: '/showcase/cti/index.html', replace() { throw new Error('Unexpected navigation'); } });
  const empty = () => null;
  Object.assign(app.document, { getElementById: empty, querySelectorAll: () => [], documentElement: { lang: 'en' }, activeElement: null });
  Object.assign(app.sandbox, { localStorage: { getItem: empty, setItem() {} }, Map, Intl, setTimeout() {}, clearTimeout() {}, fetch: (...args) => app.window.fetch(...args) });
  const client = fs.readFileSync(path.join(docs, 'cti/app.js'), 'utf8');
  vm.runInContext(client.replace(/\nstartApp\(\);\s*$/, ''), app.sandbox);
  assert.equal(await vm.runInContext('redirectFileModeToServer()', app.sandbox), false);
  assert.equal(vm.runInContext('apiPath("/api/status")', app.sandbox), '/api/status');
  assert.equal(app.requests(), 0);
});

test('retired assignment and ticket paths are absent from the static API', async () => {
  const app = runtime('call-history');
  const preview = await app.request('/api/assignment-preview', {method:'POST',body:'{}'});
  assert.equal(preview.ok,false); assert.equal(preview.error,'Not found');
  const calls=(await app.request('/api/calls?range=30d')).calls;
  assert.ok(calls.every(call=>!Object.hasOwn(call,'ticket')));
  const call=calls.find(call=>call.transcriptId);
  assert.equal(Object.hasOwn(await app.request('/api/transcripts/'+call.transcriptId),'ticketSuggestion'),false);
  assert.equal(app.requests(),0);
});

test('fixed demo generators do not create future calls or collapse morning calls to midnight', async () => {
  const clock='2026-09-24T00:05:00';
  const history=runtime('call-history','en',clock);
  assert.equal((await history.request('/api/calls?range=today')).calls.length,0);
  const cti=runtime('cti','en',clock);
  const events=await cti.request('/api/history');
  assert.ok(events.length>0);assert.ok(events.every(event=>Date.parse(event.updated || event.receivedAt)<=Date.parse(clock)));
});

test('explicit static app identity survives a misleading parent folder and rejects unknown API paths',async()=>{
  const app=runtime('cti');
  app.window.location.href='https://example.test/portal/customer/cti/index.html';
  app.window.location.pathname='/portal/customer/cti/index.html';
  assert.ok(Array.isArray(await app.request('/api/history')));
  assert.equal((await app.window.fetch('/api/not-implemented')).status,404);
});

test('static dialing accepts internal extensions with the shared live target and timeout rules',async()=>{
  const app=runtime('cti');
  for(const callee of ['1','203','123456']) {
    const response=await app.window.fetch('/api/calls',{method:'POST',body:JSON.stringify({caller:'202',callee,timeout:30})});
    assert.equal(response.status,200);assert.equal((await response.json()).call.callee,callee);
  }
  for(const timeout of [0,121,1.5,'invalid',true,false,null,{},[]])assert.equal((await app.window.fetch('/api/calls',{method:'POST',body:JSON.stringify({caller:'202',callee:'203',timeout})})).status,400);
  for(const timeout of [undefined,'',1,120,'60'])assert.equal((await app.window.fetch('/api/calls',{method:'POST',body:JSON.stringify({caller:'202',callee:'203',timeout})})).status,200);
});
