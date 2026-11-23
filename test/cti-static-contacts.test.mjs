import { createRequire } from 'node:module';
const phoneNumbers = createRequire(import.meta.url)('../CTI_API/public/phone-number.js');
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const runtime = read('docs/demo-runtime.js');
const messages = Object.assign({}, ...['shared', 'CTI_API', 'CallHistory_API', 'docs'].map((dir) => JSON.parse(read(`${dir}/i18n-messages.json`))));

function createDemo(language = 'en') {
  const listeners = [];
  const downloads = [];
  const blobs = new Map();
  let externalFetches = 0;
  let refreshes = 0;
  class Element {
    constructor(tag = 'div', id = '', className = '') { this.tagName = tag.toUpperCase(); this.id = id; this.className = className; this.children = []; this.dataset = {}; this.attributes = {}; this.disabled = false; this.classList = { contains: (name) => this.className.split(' ').includes(name) }; }
    append(...nodes) { for (const node of nodes) { this.children.push(node); node.parentElement = this; } }
    appendChild(node) { this.append(node); return node; }
    prepend(node) { this.children.unshift(node); node.parentElement = this; }
    remove() { this.parentElement.children = this.parentElement.children.filter((node) => node !== this); }
    matches(selector) {
      return selector.split(',').some((part) => {
        const query = part.trim();
        if (query.startsWith('#')) return this.id === query.slice(1);
        if (query.startsWith('.')) return this.classList.contains(query.slice(1));
        if (query === "[data-demo-readonly='true']") return this.dataset.demoReadonly === 'true';
        if (query === '[data-appearance-settings]') return this.attributes['data-appearance-settings'] !== undefined;
        return this.tagName === query.toUpperCase();
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches(selector)) return node; return null; }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return selector.startsWith(':scope > ') ? this.children.find((node) => node.matches(selector.slice(9))) : this.querySelectorAll(selector)[0] || null; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name] ?? null; }
    click() { downloads.push({ filename: this.download, href: this.href, blob: blobs.get(this.href) }); }
  }
  const body = new Element('body'); const head = new Element('head');
  const main = new Element('main', '', 'app-shell'); body.append(main);
  const contacts = new Element('section', '', 'setup-contacts-layout'); main.append(contacts);
  const module = new Element('aside', 'contacts-module-panel'); contacts.append(module);
  const contactButton = new Element('button'); const input = new Element('input'); const form = new Element('form');
  const login = new Element('a'); login.setAttribute('href', '#demo-google-login'); module.append(contactButton, form, login); form.append(input);
  const credentials = new Element('input', 'credentials'); const restore = new Element('input', 'backup-import'); main.append(credentials, restore);
  const backup = new Element('a', 'backup-download'); backup.setAttribute('href', '#demo-backup'); main.append(backup);
  const appearance = new Element('div'); appearance.setAttribute('data-appearance-settings', ''); const theme = new Element('select'); appearance.append(theme); main.append(appearance);
  body.dataset.nfonApp = "cti";
  const document = {
    body, head, readyState: 'loading',
    addEventListener(type, fn, options) { listeners.push({ type, fn, capture: options === true }); },
    getElementById(id) { return [head, body].flatMap((node) => node.querySelectorAll(`#${id}`))[0] || null; },
    createElement: (tag) => new Element(tag),
    querySelector(selector) { return selector === 'main.app-shell' ? main : body.querySelector(selector); },
    querySelectorAll(selector) { return body.querySelectorAll(selector); },
    dispatchEvent(event) { for (const listener of listeners.filter(item => item.type === event.type)) listener.fn(event); },
  };
  const storage = new Map();
  class DemoURL extends URL { static createObjectURL(blob) { const url = `blob:local-demo-${blobs.size}`; blobs.set(url, blob); return url; } static revokeObjectURL() {} }
  const window = {
    NFON_PHONE: phoneNumbers,
    document, location: new URL('https://demo.example/showcase/cti/setup.html'),
    fetch() { externalFetches += 1; throw new Error('Unexpected network request'); },
    setTimeout() {}, setInterval() {}, clearInterval() {}, addEventListener() {},
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value) },
    async refreshContactsPage() { refreshes += 1; await window.fetch('/api/google/contacts'); },
    NFON_I18N: { getLanguage: () => language, message(key, params = {}) { return (messages[key]?.[language] || messages[key]?.en || '').replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match); } },
  };
  const context = vm.createContext({ window, document, URL: DemoURL, Response, Blob, EventTarget, Event, CustomEvent, MessageEvent, Date, Intl, console, MutationObserver: class { observe() {} } });
  vm.runInContext(runtime, context);
  return {
    window, document, main, module, input, credentials, restore, form, contactButton, login, backup, theme, downloads,
    get externalFetches() { return externalFetches; }, get refreshes() { return refreshes; },
    async request(path, body, method = body === undefined ? 'GET' : 'POST') {
      const response = await window.fetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
      return { status: response.status, body: await response.json() };
    },
    boot() { for (const listener of listeners.filter((item) => item.type === 'DOMContentLoaded')) listener.fn(); },
    async dispatch(type, target) {
      const event = { target, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
      for (const capture of [true, false]) for (const listener of listeners.filter((item) => item.type === type && item.capture === capture)) { if (event.stopped) break; await listener.fn(event); }
      return event;
    },
    link(href) { const link = new Element('a'); link.setAttribute('href', href); body.append(link); return link; },
  };
}

test('disconnect removes only Google sample contacts and sync requires an active demo connection', async () => {
  const demo = createDemo();
  const local = await demo.request('/api/local-contacts', { name: 'Warteschlange Team', phone: '+49 123 4567', organization: 'Beispiel GmbH' });
  assert.equal(local.status, 201);
  const disconnected = (await demo.request('/api/google/disconnect', {})).body;
  assert.equal(disconnected.status.connected, false);
  assert.equal(disconnected.status.configured, true);
  assert.equal(disconnected.status.contacts, 0);
  assert.equal(disconnected.status.lastSyncAt, null);
  assert.deepEqual(disconnected.contacts.map((contact) => contact.id), [local.body.contact.id]);
  assert.equal((await demo.request('/api/status')).body.google.connected, false);
  assert.equal((await demo.request('/api/google/sync', {})).status, 409);
  assert.equal((await demo.request('/api/google/contacts')).body.contacts.length, 1);
  const connected = (await demo.request('/auth/google/start')).body;
  assert.equal(connected.status.connected, true);
  assert.equal(connected.status.demo, true);
  assert.equal(connected.status.contacts, 4);
  assert.equal(connected.contacts.length, 5);
  const sync = (await demo.request('/api/google/sync', {})).body;
  assert.equal(sync.contacts, 4);
  assert.ok(Number.isFinite(Date.parse(sync.status.lastSyncAt)));
  assert.equal((await demo.request('/api/google/contacts')).body.contacts.length, 5, 'sync does not duplicate samples or local entries');
  assert.equal(demo.externalFetches, 0);
});

test('Google login links reconnect locally and never cause backup downloads or OAuth requests', async () => {
  const demo = createDemo(); demo.boot();
  for (const link of [demo.login, demo.link('/showcase/auth/google/start?returnTo=setup'), demo.link('/auth/google/start')]) {
    await demo.request('/api/google/disconnect', {});
    const event = await demo.dispatch('click', link);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, false);
    assert.equal((await demo.request('/api/google/status')).body.connected, true);
  }
  assert.equal(demo.refreshes, 3);
  const unknown = await demo.dispatch('click', demo.link('/auth/other/start'));
  assert.equal(unknown.prevented, true);
  assert.equal(demo.downloads.length, 0);
  assert.equal(demo.externalFetches, 0);
  await demo.dispatch('click', demo.backup);
  assert.equal(demo.downloads.length, 1, 'only an explicit backup link downloads a backup');
});

test('local contacts preserve submitted names and phone schema, have unique IDs, and delete precisely', async () => {
  const demo = createDemo();
  const first = (await demo.request('/api/local-contacts', { name: 'Neue Nebenstelle', phone: '+49 89 12345', organization: 'Geräte Team' })).body.contact;
  const second = (await demo.request('/api/local-contacts', { name: 'Neue Nebenstelle', phone: '0049 89 54321' })).body.contact;
  assert.notEqual(first.id, second.id);
  assert.equal(first.name, 'Neue Nebenstelle');
  assert.equal(first.organization, 'Geräte Team');
  assert.deepEqual(first.phones, [{ value: '+49 89 12345', canonical: '+49 89 12345', normalized: '498912345' }]);
  const deleted = (await demo.request(`/api/local-contacts/${encodeURIComponent(first.id)}`, undefined, 'DELETE')).body;
  assert.equal(deleted.contacts.some((contact) => contact.id === first.id), false);
  assert.equal(deleted.contacts.some((contact) => contact.id === second.id), true);
  assert.equal(deleted.status.contacts, 4);
  assert.equal((await demo.request('/api/storage')).body.files['contacts.json'].records, 5);
  assert.equal((await demo.request(`/api/local-contacts/${first.id}`, undefined, 'DELETE')).status, 404);
  assert.equal((await demo.request('/api/local-contacts/', undefined, 'DELETE')).status, 404);
  assert.equal((await demo.request('/api/google/contacts')).body.contacts.length, 5);
});

test('lookup returns matching existing records and never invents a match after disconnect or deletion', async () => {
  const demo = createDemo();
  const local = (await demo.request('/api/local-contacts', { name: 'Local sample', phone: '+49 12345' })).body.contact;
  assert.equal((await demo.request('/api/contacts/lookup?phone=0049%2012345')).body.contact.id, local.id);
  for (const phone of ['', 'text', '999999999']) assert.equal((await demo.request(`/api/contacts/lookup?phone=${phone}`)).body.contact, null);
  assert.equal((await demo.request('/api/contacts/lookup?phone=498900002001')).body.contact.source, 'google');
  await demo.request('/api/google/disconnect', {});
  assert.equal((await demo.request('/api/contacts/lookup?phone=498900002001')).body.contact, null);
  await demo.request(`/api/local-contacts/${local.id}`, undefined, 'DELETE');
  assert.equal((await demo.request('/api/contacts/lookup?phone=4912345')).body.contact, null);
});

for (const language of ['en', 'de']) {
  test(`${language}: contact controls stay editable while credentials and restore stay blocked; notes are explicit`, async () => {
    const demo = createDemo(language); demo.boot(); demo.boot();
    assert.equal(demo.input.disabled, false);
    assert.equal(demo.login.dataset.demoDisabled, undefined);
    assert.equal(demo.theme.disabled, false);
    assert.equal(demo.credentials.disabled, true);
    assert.equal(demo.restore.disabled, true);
    assert.equal((await demo.dispatch('click', demo.contactButton)).prevented, false);
    assert.equal((await demo.dispatch('submit', demo.form)).prevented, false);
    assert.equal((await demo.dispatch('click', demo.credentials)).stopped, true);
    assert.equal((await demo.dispatch('click', demo.restore)).stopped, true);
    const note = demo.module.querySelector('.demo-contacts-note');
    assert.equal(note.dataset.i18nKey, 'demo.cti.contactsLocal');
    assert.equal(note.textContent, messages['demo.cti.contactsLocal'][language]);
    assert.equal(demo.module.querySelectorAll('.demo-contacts-note').length, 1);
    assert.equal(demo.main.querySelector('.demo-readonly-note').textContent, messages['demo.cti.setupReadOnly'][language]);
    const invalid = await demo.request('/api/local-contacts', { name: '', phone: '+491234' });
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.error, messages['cti.error.contactRequired'][language].replace('{detail}', ''));
    assert.equal((await demo.request('/api/google/disconnect')).status, 405);
    assert.equal((await demo.request('/api/google/status')).body.connected, true);
  });
}


test('both static backup downloads satisfy the actual CTI import normalization and deduplication contract', async () => {
  // Execute the real pure import helpers without loading the server or touching files.
  const serverSource = read('CTI_API/src/server.js');
  const start = serverSource.indexOf('function eventKey(event) {');
  const end = serverSource.indexOf('async function importBackup(body) {', start);
  assert.ok(start >= 0 && end > start, 'locate the real import helpers');
  const contract = {};
  vm.runInNewContext(`${serverSource.slice(start, end)}; this.normalize = normalizeBackupEvents; this.key = eventKey;`, contract);

  const demo = createDemo(); demo.boot();
  const history = (await demo.request('/api/history')).body;
  assert.ok(history.length > 0);
  assert.ok(history.every((event) => event.uuid && event.state && Number.isFinite(Date.parse(event.updated))));
  const apiResponse = await demo.window.fetch('/api/storage/backup');
  assert.equal(apiResponse.headers.get('content-type'), 'application/json');
  assert.match(apiResponse.headers.get('content-disposition'), /nfon-cti-demo-backup\.json/);
  const apiBackup = await apiResponse.json();
  await demo.dispatch('click', demo.backup);
  await demo.dispatch('click', demo.link('/api/storage/backup'));
  assert.equal(demo.downloads.length, 2);
  const backups = [apiBackup, ...await Promise.all(demo.downloads.map(async (download) => {
    assert.equal(download.filename, 'nfon-cti-demo-backup.json');
    return JSON.parse(await download.blob.text());
  }))];
  for (const backup of backups) {
    assert.equal(backup.schema, 'nfon-cti-local-backup-v1');
    assert.equal(backup.demo, true);
    assert.ok(Number.isFinite(Date.parse(backup.exportedAt)));
    assert.equal(backup.cti, undefined);
    assert.equal(backup.history, undefined);
    const incoming = contract.normalize(backup);
    assert.deepEqual(incoming, history, 'all real uuid events survive the importer unchanged');
    const seen = new Set(incoming.map(contract.key));
    assert.equal(seen.size, history.length, 'each event has a distinct actual import key');
    assert.equal(contract.normalize(backup).filter((event) => !seen.has(contract.key(event))).length, 0, 'a second import is entirely duplicates');
  }
  assert.equal(demo.restore.disabled, true);
  assert.equal((await demo.dispatch('click', demo.restore)).stopped, true);
  assert.equal(demo.externalFetches, 0);
});
