'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const catalog = { ...require('../../shared/i18n-messages.json'), ...require('../i18n-messages.json') };

function element() {
  return { innerHTML: '', textContent: '', value: '', hidden: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute() {}, getAttribute() { return null; }, removeAttribute() {} };
}
function client(language = 'en') {
  let locale = language;
  const nodes = Object.fromEntries(['contacts-list', 'call-popup'].map(id => [id, element()]));
  const listeners = new Map();
  const document = { documentElement: { lang: language }, activeElement: null,
    body: { classList: { add() {}, remove() {} } },
    getElementById: id => nodes[id] || null, querySelectorAll: () => [],
    addEventListener: (name, handler) => listeners.set(name, handler) };
  const sandbox = { window: { location: { protocol: 'http:', pathname: '/' }, addEventListener() {},
    NFON_PHONE: require('../public/phone-number.js'), NFON_I18N: { getLanguage: () => locale,
      message: (key, params = {}) => (catalog[key]?.[locale] || catalog[key]?.en || '').replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? `{${k}}`)) } },
    document, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Date, Intl, URL, URLSearchParams, Blob, Map, setTimeout, clearTimeout,
    fetch() { throw Error('Unexpected request'); } };
  vm.createContext(sandbox);
  assert.match(source, /\nstartApp\(\);\s*$/);
  vm.runInContext(source.replace(/\nstartApp\(\);\s*$/, ''), sandbox);
  return { sandbox, nodes, run: code => vm.runInContext(code, sandbox),
    language(value) { locale = value; document.documentElement.lang = value; }, listeners };
}
function history() {
  return Array.from({ length: 83 }, (_, i) => ({ uuid: `closure-${String(i + 1).padStart(2, '0')}`,
    extension: '21', direction: 'inbound', caller: `+1202555${String(i + 100).padStart(4, '0')}`, callee: '21',
    state: 'hangup', updated: new Date(Date.UTC(2026, 10, 4, 10, 0, 90 - i)).toISOString() }));
}
const decode = text => text.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&#39;', "'");
function readCsv(text) {
  const [head, ...lines] = text.replace(/^\uFEFF/, '').split('\n');
  return { headers: head.split(';'), rows: lines.filter(Boolean).map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map(m => m[1].replaceAll('""', '"'))) };
}
function readXls(text) {
  return { headers: [...text.matchAll(/<th>(.*?)<\/th>/g)].map(m => decode(m[1])),
    rows: [...text.matchAll(/<tr>((?:<td[\s\S]*?<\/td>)+)<\/tr>/g)].map(m => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(v => decode(v[1]))) };
}

// Exercise real Blob URLs after the click handler returns. DOM doubles only
// observe the handoff; an actual browser download is checked separately.
function downloadConsumer(a, clickError) {
  const clicked = [], anchors = [], created = [], revoked = [], timers = [];
  a.sandbox.URL = class extends URL {
    static createObjectURL(blob) {
      const url = URL.createObjectURL(blob);
      created.push(url);
      return url;
    }
    static revokeObjectURL(url) {
      revoked.push(url);
      URL.revokeObjectURL(url);
    }
  };
  a.sandbox.document.createElement = tag => {
    assert.equal(tag, 'a');
    const anchor = {
      connected: false,
      click() {
        assert.equal(this.connected, true);
        if (clickError) throw clickError;
        clicked.push({ url: this.href, filename: this.download });
      },
      remove() { this.connected = false; },
    };
    anchors.push(anchor);
    return anchor;
  };
  a.sandbox.document.body.append = anchor => { anchor.connected = true; };
  a.sandbox.setTimeout = (callback, delay) => { timers.push({ callback, delay }); };
  return { clicked, anchors, created, revoked, timers,
    cleanup() { created.forEach(url => URL.revokeObjectURL(url)); } };
}

for (const [format, read, mime, suffix] of [
  ['csv', readCsv, 'text/csv;charset=utf-8', 'csv'],
  ['excel', readXls, 'application/vnd.ms-excel;charset=utf-8', 'xls'],
]) {
  test(`CTI ${format} export keeps its actual file readable after the download handoff`, async t => {
    const a = client();
    const consumer = downloadConsumer(a);
    t.after(() => consumer.cleanup());
    a.sandbox.events = history();
    a.run('state.history = events;');
    a.sandbox.fetch = async () => ({ ok: true, text: async () => JSON.stringify({ contact: null }) });
    await a.run(`exportHistory(${JSON.stringify(format)})`);
    assert.equal(consumer.clicked.length, 1);
    assert.equal(consumer.anchors[0].connected, false);
    assert.match(consumer.clicked[0].filename, new RegExp(`^nfon-cti-calls-\\d{4}-\\d{2}-\\d{2}\\.${suffix}$`));
    await new Promise(resolve => setImmediate(resolve));
    const response = await fetch(consumer.clicked[0].url);
    assert.equal(response.headers.get('content-type'), mime);
    const file = read(await response.text());
    assert.deepEqual(file.headers, ['Date', 'Status', 'Direction', 'From', 'To', 'Extension', 'Duration', 'Events', 'Call ID']);
    assert.deepEqual(file.rows.map(row => row[8]), history().map(event => event.uuid));
    assert.equal(consumer.timers.length, 1, 'the file is released after a bounded handoff window');
    assert.ok(consumer.timers[0].delay >= 1000 && consumer.timers[0].delay <= 60000);
    consumer.timers[0].callback();
    await assert.rejects(fetch(consumer.clicked[0].url));
    assert.deepEqual(consumer.revoked, [consumer.clicked[0].url]);
  });
}

test('CTI concurrent downloads retain separate files until each handoff window ends', async t => {
  const a = client();
  const consumer = downloadConsumer(a);
  t.after(() => consumer.cleanup());
  a.run('downloadBlob("first.csv", "first export", "text/csv"); downloadBlob("second.csv", "second export", "text/csv");');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await (await fetch(consumer.clicked[0].url)).text(), 'first export');
  assert.equal(await (await fetch(consumer.clicked[1].url)).text(), 'second export');
  consumer.timers[0].callback();
  await assert.rejects(fetch(consumer.clicked[0].url));
  assert.equal(await (await fetch(consumer.clicked[1].url)).text(), 'second export');
  consumer.timers[1].callback();
  await assert.rejects(fetch(consumer.clicked[1].url));
});

test('CTI a rejected download handoff releases its temporary link and file immediately', async t => {
  const a = client();
  const failure = new Error('Download handoff rejected');
  const consumer = downloadConsumer(a, failure);
  t.after(() => consumer.cleanup());
  assert.throws(() => a.run('downloadBlob("rejected.csv", "export", "text/csv");'), failure);
  assert.equal(consumer.anchors[0].connected, false);
  assert.deepEqual(consumer.revoked, consumer.created);
  assert.equal(consumer.timers.length, 0);
  await assert.rejects(fetch(consumer.created[0]));
});

for (const [format, read] of [['csv', readCsv], ['excel', readXls]]) {
  for (const nextLanguage of [null, 'de']) {
    test(`CTI-01 ${format}: 83 exported calls stay complete with ${nextLanguage ? 'language change during lookup' : 'stable language'}`, async () => {
      const a = client();
      const events = history();
      a.sandbox.events = events;
      a.run('state.history = events; state.extensions = [{ extension_number: "21", name: "Original Éléna" }];');
      let reached, release;
      const barrier = new Promise(resolve => { release = resolve; });
      const entered = new Promise(resolve => { reached = resolve; });
      let captures = [];
      a.sandbox.fetch = async input => {
        const url = new URL(input, 'http://localhost');
        assert.equal(url.pathname, '/api/contacts/lookup');
        const phone = url.searchParams.get('phone');
        if (phone === events[80].caller) { reached(); await barrier; }
        return { ok: true, text: async () => JSON.stringify({ contact: { name: 'Unverändert Ä', organization: 'Acme <Ltd>', source: 'local' } }) };
      };
      a.sandbox.capture = (...args) => captures.push(args);
      a.run('downloadBlob = (...args) => capture(...args);');
      const pending = a.run(`exportHistory(${JSON.stringify(format)})`);
      await entered;
      if (nextLanguage) a.language(nextLanguage);
      release(); await pending;
      assert.equal(captures.length, 1);
      const result = read(captures[0][1]);
      assert.deepEqual(result.headers, ['Date', 'Status', 'Direction', 'From', 'To', 'Extension', 'Duration', 'Events', 'Call ID']);
      assert.equal(result.rows.length, 83);
      assert.deepEqual(result.rows.map(row => row[8]), events.map(e => e.uuid));
      for (const [i, row] of result.rows.entries()) {
        assert.equal(row.length, 9, `row ${i + 1}`);
        assert.equal(row[0], events[i].updated);
        assert.equal(row[1], 'Missed', 'status uses the same language as the captured header');
        assert.equal(row[2], 'Inbound');
        assert.match(row[3], /^Unverändert Ä · Acme <Ltd>/);
        assert.equal(row[4], 'Original Éléna · Extension 21');
        assert.equal(row[5], 'Original Éléna (21)');
        assert.equal(row[6], '00:00');
        assert.equal(row[7], '1');
      }
    });
  }
}

for (const sourceKind of ['local', 'google', null, 'unrecognized']) {
  test(`CTI-02 contact list and ringing popup show only actual source: ${sourceKind}`, () => {
    const a = client();
    const contact = sourceKind === null ? null : { id: 'source-contact', source: sourceKind, name: 'Original Person', phones: [{ value: '+12025550118' }] };
    a.sandbox.contact = contact;
    if (contact) {
      a.run(`state.contactsMode = ${JSON.stringify(sourceKind === 'local' ? 'local' : 'google')}; state.contacts = [contact]; renderContactsPage();`);
      if (sourceKind === 'local') assert.match(a.nodes['contacts-list'].innerHTML, /Local contact/);
      if (sourceKind === 'google') assert.match(a.nodes['contacts-list'].innerHTML, /Google contact/);
      if (sourceKind !== 'google') assert.doesNotMatch(a.nodes['contacts-list'].innerHTML, /Google contact|Google \/ CRM/);
    }
    a.run('showCallPopup({uuid:"source-case",extension:"21",caller:"+12025550118",callee:"21",direction:"inbound",state:"ring"}, contact);');
    const rendered = a.nodes['call-popup'].innerHTML;
    if (sourceKind === 'local') assert.match(rendered, /Local contact/);
    if (sourceKind === 'google') assert.match(rendered, /Google contact/);
    if (sourceKind !== 'google') assert.doesNotMatch(rendered, /Google|CRM/);
  });
}

test('CTI-01 anonymous caller keeps the export language after a delayed lookup', async () => {
  const a = client();
  const events = history();
  events[82].caller = 'unknown';
  a.sandbox.events = events;
  a.run('state.history = events;');
  let reached, release;
  const entered = new Promise(resolve => { reached = resolve; });
  const barrier = new Promise(resolve => { release = resolve; });
  a.sandbox.fetch = async input => {
    if (new URL(input, 'http://localhost').searchParams.get('phone') === events[80].caller) {
      reached(); await barrier;
    }
    return { ok: true, text: async () => JSON.stringify({ contact: null }) };
  };
  const pending = a.run('exportRows()');
  await entered; a.language('de'); release();
  const rows = await pending;
  assert.equal(rows[82].From, 'Unknown');
});

test('CTI-02 literal organization and name survive source rendering and locale changes', () => {
  const a = client();
  a.run('state.contactsMode="local"; state.contacts=[{id:"x",source:"local",name:"Google literal name",organization:"CRM literal company <A>",phones:[]}]; renderContactsPage();');
  assert.match(a.nodes['contacts-list'].innerHTML, /Google literal name/);
  assert.match(a.nodes['contacts-list'].innerHTML, /CRM literal company &lt;A&gt;/);
  a.language('de'); a.run('renderContactsPage();');
  assert.match(a.nodes['contacts-list'].innerHTML, /CRM literal company &lt;A&gt;/);
});

test('CTI-02 source labels follow all twelve languages while actual company text stays literal', () => {
  const a = client();
  for (const language of ['en','de','fr','es','it','nl','pl','pt','sv','da','fi','cs']) {
    a.language(language);
    a.run('state.contactsMode="local"; state.contacts=[{id:"local",source:"local",name:"Original Person",phones:[]}];renderContactsPage();');
    assert(a.nodes['contacts-list'].innerHTML.includes(catalog['cti.contacts.localContact'][language]), language+' local list');
    a.run('showCallPopup({uuid:"local",extension:"21",caller:"+12025550118",callee:"21",direction:"inbound",state:"ring"},state.contacts[0]);');
    assert(a.nodes['call-popup'].innerHTML.includes(catalog['cti.contacts.localContact'][language]), language+' local popup');
    a.run('state.contactsMode="google"; state.contacts=[{id:"google",source:"google",name:"Original Person",phones:[]}];renderContactsPage();');
    assert(a.nodes['contacts-list'].innerHTML.includes(catalog['cti.contacts.googleContact'][language]), language+' Google list');
    a.run('showCallPopup({uuid:"google",extension:"21",caller:"+12025550118",callee:"21",direction:"inbound",state:"ring"},state.contacts[0]);');
    assert(a.nodes['call-popup'].innerHTML.includes(catalog['cti.contacts.googleContact'][language]), language+' Google popup');
    a.run('state.contacts[0].organization="Original Firma & Partner";renderContactsPage();');
    assert.match(a.nodes['contacts-list'].innerHTML,/data-i18n-ignore>Original Firma &amp; Partner<\/span>/);
  }
});
