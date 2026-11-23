const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

const root = path.join(__dirname, '../public/crm-demo');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const languages = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'cs'];
const localeScripts = fs.readdirSync(path.join(root, 'locales')).filter(name => name.endsWith('.js')).map(name => `locales/${name}`);

// Only the deterministic data layer is evaluated here. Any request or read of
// browser/parent state is a failure: CRM examples must never consume live history.
function dataHarness(now = '2026-10-11T00:00:00Z', language = 'de', browserParent) {
  const denied = () => { throw new Error('CRM fixtures attempted to access external history or browser state'); };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return Date.parse(now); }
  }
  const window = { CALLHISTORY_CALLS: [{ uuid: 'PRIVATE-LIVE-CALL', summary: 'PRIVATE-LIVE-SUMMARY' }] };
  Object.defineProperty(window, 'parent', { get: browserParent === undefined ? denied : () => browserParent || window });
  const context = vm.createContext({
    window, Date: Clock, Intl, console, URL, URLSearchParams, location: new URL(`http://localhost/crm-demo/?lang=${language}`),
    fetch: denied, XMLHttpRequest: denied,
    localStorage: { getItem: denied, setItem: denied },
    sessionStorage: { getItem: denied, setItem: denied },
    document: { documentElement: {}, getElementById: () => null, querySelectorAll: () => [] },
  });
  for (const file of [...localeScripts, 'i18n.js', 'scenarios.js', 'demo-records.js', 'analytics.js', 'automation.js']) vm.runInContext(read(file), context, { filename: file });
  return { window, context };
}

test('every menu language has complete CRM messages and fixture translations', () => {
  const { window } = dataHarness();
  const catalogs = window.CRM_DEMO_LOCALES;
  const keys = Object.keys(catalogs.en.messages).sort();
  assert.deepEqual([...window.DEMO_I18N.languages].sort(), [...languages].sort());
  const placeholders = text => text.match(/\{\w+\}/g)?.sort() || [];
  const usedKeys = [...read('index.html').matchAll(/data-i18n(?:-aria-label)?="([^"]+)"/g)].map(match => match[1]);
  for (const file of ['app.js', 'analytics.js', 'automation.js', 'demo-records.js']) {
    usedKeys.push(...[...read(file).matchAll(/\bt\('([^']+)'/g)].map(match => match[1]));
  }
  for (const key of usedKeys) assert.ok(keys.includes(key), `UI message is catalogued: ${key}`);
  for (const lang of languages) {
    assert.deepEqual(Object.keys(catalogs[lang].messages).sort(), keys, `${lang}: no English fallback needed`);
    for (const key of keys) {
      assert.ok(catalogs[lang].messages[key].trim(), `${lang}: ${key}`);
      assert.deepEqual(placeholders(catalogs[lang].messages[key]), placeholders(catalogs.en.messages[key]), `${lang}: ${key} parameters`);
    }
    if (lang === 'de') continue;
    assert.ok([...read('index.html').matchAll(/<script[^>]+src="([^"]+)"/g)].some(match => match[1].split('?')[0] === `locales/${lang}.js`), `${lang}: catalog ships in the frame`);
    for (const scenario of window.TRANSCRIPT_SCENARIOS_BY_LANGUAGE.de) {
      const translated = catalogs[lang].scenarios[scenario.id];
      assert.equal(translated.turns.length, scenario.turns.length);
      assert.ok(translated.title && translated.category && translated.summary);
      assert.ok(translated.turns.every(text => typeof text === 'string' && text.trim()));
      assert.notEqual(translated.summary, scenario.fields.summary.value);
      assert.notDeepEqual(translated.turns, scenario.turns.map(turn => turn.text));
    }
  }
  window.DEMO_I18N.setLanguage('invalid');
  assert.equal(window.DEMO_I18N.lang, 'de', 'invalid messages cannot change the current language');
});

test('fixed CRM examples retain the accepted cohort and every available transcript has its summary', () => {
  const { window } = dataHarness();
  const records = plain(window.DEMO_RECORDS);
  const transcripts = records.filter((record) => record.transcription.available);
  assert.equal(records.length, 125);
  assert.equal(new Set(records.map((record) => record.uuid)).size, records.length);
  assert.deepEqual(Object.fromEntries(['answered', 'missed', 'cancelled'].map((status) => [status, records.filter((record) => record.status === status).length])),
    { answered: 102, missed: 18, cancelled: 5 });
  assert.ok(records.every((record) => ['answered', 'missed', 'cancelled'].includes(record.status)));
  assert.equal(transcripts.length, 75);
  for (const record of transcripts) {
    assert.ok(record.transcription.summary.trim(), `${record.uuid}: a completed transcript includes a summary`);
    assert.ok(record.transcription.transcript.some((turn) => turn.event === 'speech' && turn.text.trim()));
    assert.equal(record.transcription.transcript[0].event, 'start');
    assert.equal(record.transcription.transcript.at(-1).event, 'stop');
  }
  for (const record of records.filter((record) => !record.transcription.available)) {
    assert.equal(record.transcription.summary, undefined, 'unavailable conversations do not acquire a fabricated summary');
    assert.equal(record.transcription.transcript, undefined);
  }
});

test('CRM cohort is independent of the current date, local storage, network and parent history', () => {
  const first = dataHarness('2026-10-11T00:00:00Z').window;
  const later = dataHarness('2032-04-05T12:34:56Z').window;
  assert.deepEqual(plain(first.DEMO_RECORDS), plain(later.DEMO_RECORDS));
  assert.doesNotMatch(JSON.stringify(first.DEMO_RECORDS), /PRIVATE-LIVE/);
  assert.ok(Object.isFrozen(first.DEMO_RECORDS));
  assert.ok(first.DEMO_RECORDS.every((record) => Object.isFrozen(record) && Object.isFrozen(record.transcription)));
});

test('daily chart totals partition the same fixed records and do not invent another summary metric', () => {
  const { window } = dataHarness();
  const aggregate = plain(window.DEMO_ANALYTICS.aggregate(window.DEMO_RECORDS, window.DEMO_DATA_INFO.dates));
  assert.deepEqual(aggregate.days.map((day) => day.total), [18, 26, 21, 28, 17, 6, 9]);
  assert.equal(aggregate.total, 125);
  assert.equal(aggregate.transcripts, 75);
  assert.equal(aggregate.withoutTranscript, 50);
  assert.equal(aggregate.summaries, undefined, 'summaries are included with transcripts, not a competing count');
  for (const day of aggregate.days) {
    assert.equal(day.answered + day.missed + day.cancelled, day.total);
    assert.equal(day.transcripts + day.withoutTranscript, day.total);
    assert.equal(day.summaries, undefined);
  }
});

test('detailed CRM scenarios are members of the cohort with exact summary and transcript provenance', () => {
  const { window } = dataHarness();
  const scenarios = plain(window.TRANSCRIPT_SCENARIOS);
  const records = plain(window.DEMO_RECORDS);
  assert.equal(scenarios.length, 3);
  assert.equal(records.filter((record) => record.scenarioId).length, scenarios.length);
  for (const scenario of scenarios) {
    const record = records.find((candidate) => candidate.scenarioId === scenario.id);
    assert.ok(record, scenario.id);
    assert.equal(record.callId, scenario.callId);
    assert.equal(record.transcription.summary, scenario.fields.summary.value);
    assert.deepEqual(record.transcription.transcript.filter((turn) => turn.event === 'speech').map((turn) => turn.text), scenario.turns.map((turn) => turn.text));
    const sourceIds = new Set(scenario.turns.map((turn) => turn.id));
    for (const [field, value] of Object.entries(scenario.fields)) {
      assert.ok(value.sourceIds.length, `${scenario.id}/${field} identifies its source`);
      assert.ok(value.sourceIds.every((id) => sourceIds.has(id)), `${scenario.id}/${field} only references this conversation`);
    }
  }
});


test('all twelve languages keep matching cohort provenance and unchanged totals', () => {
  const localized = languages.map((lang) => dataHarness('2026-10-11T00:00:00Z', lang).window);
  for (const window of localized) {
    const data = window.DEMO_ANALYTICS.aggregate(window.DEMO_RECORDS, window.DEMO_DATA_INFO.dates);
    assert.equal(data.total, 125);
    assert.equal(data.transcripts, 75);
    for (const scenario of window.TRANSCRIPT_SCENARIOS) {
      const record = window.DEMO_RECORDS.find((candidate) => candidate.scenarioId === scenario.id);
      assert.equal(record.transcription.summary, scenario.fields.summary.value);
      assert.deepEqual(plain(record.transcription.transcript.filter((turn) => turn.event === 'speech').map((turn) => turn.text)), plain(scenario.turns.map((turn) => turn.text)));
    }
  }
  assert.notEqual(localized[0].TRANSCRIPT_SCENARIOS[0].fields.summary.value, localized[1].TRANSCRIPT_SCENARIOS[0].fields.summary.value);
});

test('automatic CRM activities match external numbers and retain exact API summary and transcript', () => {
  for (const language of languages) {
    const { window } = dataHarness(undefined, language);
    for (const scenario of window.TRANSCRIPT_SCENARIOS) {
      const record = window.DEMO_RECORDS.find(item => item.scenarioId === scenario.id);
      const call = window.DEMO_AUTOMATION.lookupCall(scenario.id);
      const remote = record.direction === 'inbound' ? record.caller : record.callee;
      assert.equal(call.uuid, record.uuid);
      assert.equal(call.phoneNumber, `+${remote.number}`);
      assert.equal(remote.context, 'global');
      assert.equal(call.contact.name, scenario.contact);
      assert.equal(call.contact.company, scenario.customer);
      assert.equal(call.summary, record.transcription.summary);
      assert.deepEqual(plain(call.transcript), plain(record.transcription.transcript));
      assert.equal(call.task, undefined);
      assert.equal(call.due, undefined);
      assert.equal(call.owner, undefined);
    }
  }
});

test('automation never invents an available transcript or a CRM match', () => {
  const { window } = dataHarness();
  const baseline = plain(window.DEMO_RECORDS.find(record => record.scenarioId === 'support'));
  const variants = [
    { ...baseline, transcription: { available: false } },
    { ...baseline, transcription: { ...baseline.transcription, transcript: [] } },
    { ...baseline, transcription: { ...baseline.transcription, summary: '' } },
    { ...baseline, caller: { number: '123', context: 'extension' } },
    { ...baseline, caller: { number: '498900009999', context: 'global' } },
    { ...baseline, status: 'missed' }
  ];
  for (const record of variants) {
    window.DEMO_RECORDS = [record];
    assert.equal(window.DEMO_AUTOMATION.lookupCall('support'), null);
    assert.throws(() => window.DEMO_AUTOMATION.createStore().upsert(record), /No completed demo call/);
  }
  assert.equal(window.DEMO_AUTOMATION.lookupCall('unknown'), null);
});

test('replay and locale changes update one immutable activity per call UUID', () => {
  const { window } = dataHarness();
  const automation = window.DEMO_AUTOMATION;
  const store = automation.createStore();
  const call = automation.lookupCall('support');
  const first = store.upsert(call);
  const second = store.upsert({ ...call, summary: 'Injected note', task: 'Invented task' });
  assert.equal(store.size, 1);
  assert.equal(second.id, first.id);
  assert.equal(second.summary, call.summary, 'only fixed API content enters the demo CRM');
  assert.equal(second.task, undefined);
  assert.ok(Object.isFrozen(second));
  assert.ok(Object.isFrozen(second.contact));
  assert.ok(Object.isFrozen(second.transcript));
  assert.ok(second.transcript.every(Object.isFrozen));
  assert.equal(store.get('absent'), null);
  window.DEMO_I18N.setLanguage('en');
  window.TRANSCRIPT_SCENARIOS = window.TRANSCRIPT_SCENARIOS_BY_LANGUAGE.en;
  window.rebuildDemoRecords();
  const translated = store.upsert(automation.lookupCall('support'));
  assert.equal(translated.id, first.id);
  assert.equal(store.size, 1);
  assert.notEqual(translated.summary, first.summary);
  for (const id of ['sales', 'appointment']) store.upsert(automation.lookupCall(id));
  assert.equal(store.size, 3);
});

test('the appointment follow-up preserves the agreed calendar facts outside the API record', () => {
  for (const language of ['de', 'en']) {
    const { window } = dataHarness(undefined, language);
    const call = window.DEMO_AUTOMATION.lookupCall('appointment');
    const entry = window.DEMO_AUTOMATION.createStore().upsert(call);
    const event = entry.followUp;
    const transcript = call.transcript.filter(turn => turn.event === 'speech').map(turn => turn.text).join('\n');
    assert.equal(event.kind, 'calendar');
    assert.equal(event.basis, 'transcript');
    assert.equal(event.startsAt, '2026-10-13T10:00:00+02:00');
    assert.equal(event.endsAt, '2026-10-13T10:30:00+02:00');
    assert.equal(Date.parse(event.endsAt) - Date.parse(event.startsAt), 30 * 60 * 1000);
    assert.equal(event.timeZone, 'Europe/Berlin');
    assert.equal(event.location, 'Online');
    assert.equal(event.owner, 'Lena Bergmann');
    assert.equal(event.attendee, 'Lea Sommer');
    assert.ok(event.title.trim());
    assert.ok(event.id.includes(call.uuid), 'the action stays attached to the source call UUID');
    assert.equal(event.sourceCallUuid, call.uuid);
    assert.ok(event.sourceTurnIds.includes('t3') && event.sourceTurnIds.includes('t8'), 'references include the proposal and confirmed time window');
    const sourceIds = new Set(window.TRANSCRIPT_SCENARIOS.find(scenario => scenario.id === 'appointment').turns.map(turn => turn.id));
    assert.ok(event.sourceTurnIds.every(id => sourceIds.has(id)));
    assert.match(transcript, language === 'de' ? /13\. Oktober 2026, von 10 bis 10:30 Uhr/ : /13 October 2026, from 10 to 10:30 am/);
    assert.match(transcript, /Lena Bergmann/);
    assert.match(transcript, /Lea Sommer/);
    assert.equal(call.followUp, undefined, 'calendar enrichment is not an NFON call field');
    assert.ok(window.DEMO_RECORDS.every(record => record.followUp === undefined));
  }
});

test('the sales reminder follows an internal next-business-day rule without inventing an agreed deadline', () => {
  for (const language of ['de', 'en']) {
    const { window } = dataHarness('2032-04-05T12:34:56Z', language);
    const automation = window.DEMO_AUTOMATION;
    const call = automation.lookupCall('sales');
    const store = automation.createStore();
    const reminder = store.upsert(call).followUp;
    assert.equal(reminder.kind, 'reminder');
    assert.equal(reminder.basis, 'next-business-day');
    assert.equal(reminder.dueAt, '2026-10-12T09:00:00+02:00');
    assert.equal(reminder.timeZone, 'Europe/Berlin');
    assert.equal(reminder.owner, 'Lena Bergmann');
    assert.equal(reminder.startsAt, undefined);
    assert.equal(reminder.endsAt, undefined);
    assert.ok(reminder.title.trim());
    assert.ok(reminder.id.includes(call.uuid));
    assert.equal(reminder.sourceCallUuid, call.uuid);
    assert.ok(reminder.sourceTurnIds.includes('v8') && reminder.sourceTurnIds.includes('v9'), 'sources preserve the explicitly unagreed deadline');
    const sourceIds = new Set(window.TRANSCRIPT_SCENARIOS.find(scenario => scenario.id === 'sales').turns.map(turn => turn.id));
    assert.ok(reminder.sourceTurnIds.every(id => sourceIds.has(id)));
    assert.equal(new Date(call.created).getUTCDay(), 5, 'the example call is on a business day');
    assert.equal(new Date(reminder.dueAt).getUTCDay(), 1, 'the internal reminder is on Monday');
    assert.match(call.summary, language === 'de' ? /Ein Liefertermin wurde nicht vereinbart/ : /No delivery date has been agreed/);
    const transcript = call.transcript.filter(turn => turn.event === 'speech').map(turn => turn.text).join('\n');
    assert.match(transcript, language === 'de' ? /noch kein Liefertermin vereinbart/ : /no delivery date has been agreed/);
    assert.doesNotMatch(transcript, /(?:12\. Oktober|12 October|09:00|9 am)/);
    assert.equal(call.due, undefined);
    assert.equal(call.followUp, undefined);
    const callback = store.upsert(automation.lookupCall('support')).followUp;
    assert.equal(callback.kind, 'reminder');
    assert.equal(callback.basis, 'transcript');
    assert.equal(callback.deadlineAt, '2026-10-12T15:00:00+02:00');
    assert.equal(new Date(callback.deadlineAt)-new Date(callback.dueAt), 30*60000, 'reminder gives time to meet the promised deadline');
    assert.deepEqual([...callback.sourceTurnIds], ['s7', 's8', 's9']);
  }
});

test('follow-up actions are immutable and retain one identity across replay and language changes', () => {
  const { window } = dataHarness();
  const automation = window.DEMO_AUTOMATION;
  const store = automation.createStore();
  const originals = new Map();
  for (const scenarioId of ['sales', 'appointment']) {
    const call = automation.lookupCall(scenarioId);
    const first = store.upsert(call);
    originals.set(scenarioId, first);
    assert.ok(Object.isFrozen(first.followUp));
    assert.ok(Object.isFrozen(first.followUp.sourceTurnIds));
    assert.equal(Reflect.set(first.followUp, 'owner', 'Injected owner'), false);
    assert.equal(Reflect.set(first.followUp.sourceTurnIds, '0', 'Injected source'), false);
    const replayed = store.upsert({ ...call, followUp: { id: 'INJECTED', kind: 'calendar', title: 'Injected action' } });
    assert.deepEqual(plain(replayed.followUp), plain(first.followUp));
    assert.equal(replayed.id, first.id);
  }
  assert.equal(store.size, 2);
  window.DEMO_I18N.setLanguage('en');
  window.TRANSCRIPT_SCENARIOS = window.TRANSCRIPT_SCENARIOS_BY_LANGUAGE.en;
  window.rebuildDemoRecords();
  for (const [scenarioId, original] of originals) {
    const translated = store.upsert(automation.lookupCall(scenarioId));
    assert.equal(translated.id, original.id);
    assert.equal(translated.followUp.id, original.followUp.id);
    assert.equal(translated.followUp.kind, original.followUp.kind);
    assert.equal(translated.followUp.basis, original.followUp.basis);
    assert.equal(translated.followUp.startsAt, original.followUp.startsAt);
    assert.equal(translated.followUp.endsAt, original.followUp.endsAt);
    assert.equal(translated.followUp.dueAt, original.followUp.dueAt);
    assert.notEqual(translated.followUp.title, original.followUp.title);
    assert.equal(store.get(translated.uuid), translated);
    assert.ok(Object.isFrozen(translated.followUp));
  }
  assert.equal(store.size, 2, 'language changes and replay do not add another call or follow-up');
  assert.equal(new Set([...originals.values()].map(entry => entry.followUp.id)).size, 2);
});

function playbackHarness(reducedMotion = false, language = 'de', options = {}) {
  const parent = { postMessage() {} };
  const { window, context } = dataHarness(undefined, language, options.embedded ? parent : null);
  const nodes = new Map();
  const pending = new Map();
  const listeners = new Map();
  const store = window.DEMO_AUTOMATION.createStore();
  window.DEMO_AUTOMATION = { ...window.DEMO_AUTOMATION, createStore: () => store };
  const element = id => {
    if (!nodes.has(id)) nodes.set(id, {
      innerHTML: '', textContent: '', hidden: false, dataset: {}, style: {},
      handlers: new Map(),
      setAttribute(name, value) { this[name] = value; },
      addEventListener(name, handler) { this.handlers.set(name, handler); },
      contains() { return false; }, closest() { return null; },
      querySelector(selector) { return element(`${id} ${selector}`); },
      querySelectorAll() { return []; },
      focus() { context.document.activeElement = this; }, close() { this.open = false; },
      getBoundingClientRect() { return { bottom:1000 }; }
    });
    return nodes.get(id);
  };
  let serial = 0;
  context.document = {
    documentElement: { dataset:{} }, activeElement: null, getElementById: element,
    querySelector: element, querySelectorAll: () => [],
    addEventListener: (name, callback) => listeners.set("document:" + name, callback)
  };
  context.setTimeout = callback => { const id = ++serial; pending.set(id, callback); return id; };
  context.clearTimeout = id => pending.delete(id);
  context.matchMedia = () => ({ matches: reducedMotion, addEventListener() {} });
  context.history = { replaceState() {} };
  window.addEventListener = (name, callback) => listeners.set(name, callback);
  window.dispatchEvent = event => listeners.get(event.type)?.(event);
  window.scrollY = 0;
  context.CustomEvent = class extends Event { constructor(type, options) { super(type); this.detail=options.detail; } };
  context.requestAnimationFrame = callback => callback();
  context.ResizeObserver = class { observe() {} };
  context.document.fonts = { ready:new Promise(()=>{}) };
  vm.runInContext(read('app.js'), context);
  if (options.embedded) vm.runInContext(read('bridge.js'), context);

  const tick = () => { const [id, callback] = pending.entries().next().value || []; if (callback) { pending.delete(id); callback(); } };
  const finish = () => { for (let attempt = 0; pending.size && attempt < 10; attempt++) tick(); assert.equal(pending.size, 0); };
  return { window, store, element, pending, tick, finish, parentMessage(data, validSource=true, origin=context.location.origin) { listeners.get('message')?.({data,source:validSource?parent:{},origin}); }, hidden(value) { context.document.hidden=value; listeners.get('document:visibilitychange')?.(); }, visibility(active) { listeners.get('nfon:crm-demo:visibility')({detail:{active}}); },
    language(next) { window.DEMO_I18N.setLanguage(next); listeners.get('nfon:crm-demo:language')(); },
    click: (id, target = {}) => element(id).handlers.get('click')({ target, preventDefault() {} }) };
}

test('playback creates its CRM activity without form submission and replay does not duplicate it', () => {
  const app = playbackHarness();
  assert.equal(app.store.size, 0);
  app.finish();
  assert.equal(app.store.size, 1);
  assert.match(app.element('crm-content').innerHTML, /Mara Fink/);
  assert.doesNotMatch(app.element('crm-content').innerHTML, /<(?:input|textarea|form)\b/);
  app.click('replay-flow');
  app.finish();
  assert.equal(app.store.size, 1);
});

test('switching among all menu languages preserves playback, selected case and follow-up identity', () => {
  const app = playbackHarness();
  app.click('case-list', { closest: () => ({ dataset: { case: 'appointment' } }) });
  const stale = [...app.pending.values()][0];
  app.language('fr');
  stale();
  assert.equal(app.store.size, 0, 'the previous language cannot complete an obsolete stage');
  app.finish();
  const first = app.store.upsert(app.window.DEMO_AUTOMATION.lookupCall('appointment'));
  for (const lang of languages) {
    app.language(lang);
    app.finish();
    const call = app.window.DEMO_AUTOMATION.lookupCall('appointment');
    const entry = app.store.get(call.uuid);
    assert.equal(app.store.size, 1);
    assert.equal(entry.id, first.id);
    assert.equal(entry.followUp.id, first.followUp.id);
    assert.equal(entry.followUp.startsAt, first.followUp.startsAt);
    assert.equal(entry.followUp.endsAt, first.followUp.endsAt);
    assert.equal(entry.summary, call.summary);
    const markup = app.element('crm-content').innerHTML;
    assert.ok(markup.includes('data-follow-up-kind="calendar"'));
    assert.ok(markup.includes(app.window.DEMO_I18N.t('Kalendereintrag')));
    assert.ok(markup.includes(app.window.DEMO_I18N.t('Online')));
    assert.equal((markup.match(/data-follow-up-id=/g) || []).length, 1);
  }
  app.click('case-list', { closest: () => ({ dataset: { case: 'sales' } }) });
  app.finish();
  for (const lang of languages) {
    app.language(lang);
    app.finish();
    const entry = app.store.get(app.window.DEMO_AUTOMATION.lookupCall('sales').uuid);
    assert.equal(app.store.size, 2);
    assert.equal(entry.followUp.dueAt, '2026-10-12T09:00:00+02:00');
    const markup = app.element('crm-content').innerHTML;
    assert.ok(markup.includes('data-follow-up-kind="reminder"'));
    assert.ok(markup.includes(app.window.DEMO_I18N.t('Nächster Werktag · CRM-Regel')));
  }
});

test('calendar and reminder actions appear automatically only after completed CRM delivery', () => {
  for (const [scenarioId, kind] of [['appointment', 'calendar'], ['sales', 'reminder']]) {
    const app = playbackHarness();
    app.click('case-list', { closest: () => ({ dataset: { case: scenarioId } }) });
    const call = app.window.DEMO_AUTOMATION.lookupCall(scenarioId);
    assert.equal(app.store.get(call.uuid), null);
    let advances = 0;
    while (!app.store.get(call.uuid) && app.pending.size && advances++ < 10) {
      assert.doesNotMatch(app.element('crm-content').innerHTML, /data-follow-up-kind=/, 'no action is shown before CRM delivery completes');
      app.tick();
    }
    app.finish();
    const entry = app.store.get(call.uuid);
    assert.ok(entry, 'no form submission or manual acceptance is required');
    const markup = app.element('crm-content').innerHTML;
    assert.ok(markup.includes(`data-follow-up-kind="${kind}"`));
    assert.ok(markup.includes(`data-follow-up-id="${entry.followUp.id}"`));
    assert.doesNotMatch(markup, /<(?:input|textarea|form)\b/);
    if (kind === 'calendar') {
      assert.match(markup, /13\. Oktober 2026/);
      assert.match(markup, /10:00/);
      assert.match(markup, /10:30/);
      assert.match(markup, /Lea Sommer/);
    } else {
      assert.match(markup, /12\. Oktober 2026/);
      assert.match(markup, /09:00/);
      assert.match(markup, /Nächster Werktag · CRM-Regel/);
    }
    app.click('replay-flow');
    app.finish();
    assert.equal(app.store.size, 1);
    assert.equal(app.store.get(call.uuid).followUp.id, entry.followUp.id);
    assert.equal((app.element('crm-content').innerHTML.match(/data-follow-up-id=/g) || []).length, 1);
  }
});

test('late playback callbacks cannot deliver the previous case or complete a hidden view', () => {
  const app = playbackHarness();
  const staleSupport = [...app.pending.values()][0];
  app.click('case-list', { closest: () => ({ dataset: { case: 'sales' } }) });
  const staleSales = [...app.pending.values()][0];
  app.click('view-analytics');
  staleSupport(); staleSales(); app.finish();
  assert.equal(app.store.size, 0);
  app.click('view-examples'); app.finish();
  assert.equal(app.store.size, 1);
  assert.equal(app.store.get(app.window.DEMO_AUTOMATION.lookupCall('support').uuid), null);
  assert.match(app.element('crm-content').innerHTML, /Noah Winter/);
});

test('reduced motion completes the automatic example without waiting or manual confirmation', () => {
  const app = playbackHarness(true);
  assert.equal(app.pending.size, 0);
  assert.equal(app.store.size, 1);
  assert.match(app.element('crm-content').innerHTML, /Lindenwerk GmbH/);
});

for (const href of ['http://localhost:3000/crm-demo/index.html?theme=admin-portal&lang=en','file:///download/crm-demo/index.html?theme=admin-portal&lang=en']) test('embedded CRM validates its parent and height bridge: ' + new URL(href).protocol, () => {
  const listeners = new Map();
  const frames = [];
  const sent = [];
  const dispatched = [];
  let contentBottom = 1800;
  let language = 'en';
  const parent = { postMessage: (payload, origin) => sent.push({ payload: plain(payload), origin }) };
  const root = { dataset: {} };
  const window = {
    parent, scrollY: 0,
    DEMO_I18N: { supports: value => languages.includes(value), get lang() { return language; }, setLanguage(next) { language = next; } },
    addEventListener: (event, handler) => listeners.set(event, handler),
    dispatchEvent: (event) => dispatched.push(event.type),
  };
  const context = vm.createContext({
    window, location: new URL(href),
    document: {
      documentElement: root,
      querySelector: () => ({ getBoundingClientRect: () => ({ bottom: contentBottom }) }),
      fonts: { ready: new Promise(() => {}) },
    },
    URLSearchParams, Event,
    requestAnimationFrame: (handler) => frames.push(handler),
    ResizeObserver: class { observe() {} },
  });
  vm.runInContext(read('bridge.js'), context);
  while (frames.length) frames.shift()();
  const receive = listeners.get('message');
  const valid = { source: parent, origin: new URL(href).origin, data: { type: 'nfon:crm-demo:appearance', theme: 'classic', lang: 'de' } };
  receive({ ...valid, source: {} });
  receive({ ...valid, origin: 'https://foreign.example' });
  receive({ ...valid, data: { type: 'history-data', calls: [{ uuid: 'PRIVATE-CALL' }] } });
  assert.equal(root.dataset.nfonTheme, 'admin-portal');
  assert.equal(language, 'en');
  assert.deepEqual(dispatched, []);
  receive(valid);
  assert.equal(root.dataset.nfonTheme, 'classic');
  assert.equal(language, 'de');
  assert.deepEqual(dispatched, ['nfon:crm-demo:language']);
  receive({ ...valid, data: { ...valid.data, theme: 'untrusted-theme', lang: 'invalid-language' } });
  assert.equal(root.dataset.nfonTheme, 'classic');
  assert.equal(language, 'de');
  while (frames.length) frames.shift()();
  for (const lang of languages) {
    receive({ ...valid, data: { ...valid.data, lang } });
    assert.equal(language, lang, 'the bridge preserves every supported language');
  }
  while (frames.length) frames.shift()();
  contentBottom = 800;
  listeners.get('resize')();
  while (frames.length) frames.shift()();
  const sizes = sent.filter(({ payload }) => payload.type === 'nfon:crm-demo:height').map(({ payload }) => payload.height);
  assert.deepEqual(sizes, [1804, 804], 'leaving a long transcript can shrink the parent frame');
  for (const { payload, origin } of sent) {
    assert.equal(origin, '*', 'opaque file and sandbox origins require an explicit window target with wildcard origin');
    assert.ok(['nfon:crm-demo:ready', 'nfon:crm-demo:height'].includes(payload.type));
    assert.deepEqual(Object.keys(payload).sort(), payload.type.endsWith(':height') ? ['height', 'type'] : ['type']);
  }
});


test('hidden parent iframe cancels pending playback and resumes without duplicate activities', () => {
  const app = playbackHarness();
  const stale = [...app.pending.values()][0];
  app.visibility(false); stale(); app.finish();
  assert.equal(app.store.size,0);
  app.visibility(true); app.finish();
  assert.equal(app.store.size,1);
  app.visibility(false); app.visibility(true); app.finish();
  assert.equal(app.store.size,1);
});


test('R-HIST-06/07: every localized support fixture keeps Monday explicit and a thirty-minute lead',()=>{
  for(const language of languages){
    const {window}=dataHarness('2026-10-11T00:00:00Z',language);
    const call=window.DEMO_AUTOMATION.lookupCall('support');
    const reminder=window.DEMO_AUTOMATION.createStore().upsert(call).followUp;
    const scenario=window.TRANSCRIPT_SCENARIOS.find(s=>s.id==='support');
    const source=scenario.turns.find(turn=>turn.id==='s7').text;
    assert.equal(new Date(call.created).getUTCDay(),5);
    assert.equal(new Date(reminder.deadlineAt).getUTCDay(),1);
    assert.equal(Date.parse(reminder.deadlineAt)-Date.parse(reminder.dueAt),1800000);
    assert.match(source,/12/,language+': date remains explicit in source speech');
    assert.doesNotMatch(source,/mañana|amanhã|zítra/i,language+': Friday cannot say tomorrow Monday');
    assert.match(window.DEMO_I18N.t('Erinnerung 30 Minuten vor Rückruffrist'),/30/,language+': reminder label specifies lead time');
  }
});


test('embedded reduced-motion CRM waits for valid parent activation before creating any activity',()=>{
  const app=playbackHarness(true,'de',{embedded:true});
  assert.equal(app.store.size,0,'initially paused frame must not complete before the parent handshake');
  assert.equal(app.pending.size,0);
  const active={type:'nfon:crm-demo:visibility',active:true};
  app.parentMessage(active,false);
  app.parentMessage(active,true,'https://foreign.example');
  app.parentMessage({...active,type:'unrelated'});
  app.parentMessage({...active,active:false});
  app.language('en'); app.hidden(true); app.hidden(false); app.click('replay-flow'); app.finish();
  assert.equal(app.store.size,0,'foreign messages and local presentation events cannot bypass initial pause');
  app.parentMessage(active);
  assert.equal(app.store.size,1,'validated active parent unlocks reduced-motion completion');
  const call=app.window.DEMO_AUTOMATION.lookupCall('support'), first=app.store.get(call.uuid);
  app.parentMessage({...active,active:false});app.hidden(true);app.hidden(false);app.parentMessage(active);app.finish();
  assert.equal(app.store.size,1);assert.equal(app.store.get(call.uuid).id,first.id);
  assert.equal(app.store.get(call.uuid).followUp.id,first.followUp.id);
});

test('embedded animated CRM has no timer before activation and rejects callbacks after pause',()=>{
  const app=playbackHarness(false,'de',{embedded:true});
  assert.equal(app.pending.size,0);assert.equal(app.store.size,0);
  app.parentMessage({type:'nfon:crm-demo:appearance',theme:'classic',lang:'de',active:true});
  const stale=[...app.pending.values()][0];assert.equal(typeof stale,'function');
  app.parentMessage({type:'nfon:crm-demo:visibility',active:false});stale();app.finish();
  assert.equal(app.store.size,0);
  app.parentMessage({type:'nfon:crm-demo:visibility',active:true});app.finish();
  assert.equal(app.store.size,1);
});
