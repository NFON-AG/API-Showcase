import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const appearanceSource = readFileSync(path.join(root, 'shared/appearance.js'), 'utf8');
const i18nSource = readFileSync(path.join(root, 'docs/i18n.js'), 'utf8');

// A deterministic DOM model keeps these tests offline, dependency-free and explicit
// about node identity. Browser layout/focus rendering still requires visual QA.
function dom() {
  const observers = [];
  const events = [];
  const frames = [];
  function mutation(target, type, attributeName, addedNodes = []) {
    for (const observer of observers) {
      if (!observer.target?.contains(target)) continue;
      if (type === 'attributes' && observer.options.attributeFilter && !observer.options.attributeFilter.includes(attributeName)) continue;
      observer.records.push({ target, type, attributeName, addedNodes });
    }
  }
  class Node {
    constructor(type) { this.nodeType = type; this.parentElement = null; this.children = []; }
    get isConnected() { return html.contains(this); }
    contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
    append(...nodes) { for (const node of nodes) { node.remove(); node.parentElement = this; this.children.push(node); } mutation(this, 'childList', undefined, nodes); }
    appendChild(node) { this.append(node); return node; }
    prepend(node) { node.remove(); node.parentElement = this; this.children.unshift(node); mutation(this, 'childList', undefined, [node]); }
    remove() { if (!this.parentElement) return; const parent = this.parentElement; parent.children.splice(parent.children.indexOf(this), 1); this.parentElement = null; mutation(parent, 'childList'); }
    insert(node, offset) { const parent = this.parentElement; node.remove(); node.parentElement = parent; parent.children.splice(parent.children.indexOf(this) + offset, 0, node); mutation(parent, 'childList', undefined, [node]); }
    before(node) { this.insert(node, 0); }
    after(node) { this.insert(node, 1); }
    get textContent() { return this.nodeType === 3 ? this.nodeValue : this.children.map((child) => child.textContent).join(''); }
    set textContent(value) { this.children.forEach((node) => { node.parentElement = null; }); this.children = []; this.append(new Text(String(value))); }
  }
  class Text extends Node {
    constructor(value) { super(3); this.value = value; }
    get nodeValue() { return this.value; }
    set nodeValue(value) { this.value = value; mutation(this, 'characterData'); }
  }
  class Element extends Node {
    constructor(tag) {
      super(1); this.tagName = tag.toUpperCase(); this.attrs = new Map(); this.listeners = new Map();
      this.dataset = new Proxy({}, { set: (_, key, value) => { this.setAttribute(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, value); return true; }, get: (_, key) => this.getAttribute(`data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`) ?? undefined });
      this.classList = {
        contains: (name) => this.className.split(/\s+/).includes(name),
        add: (...names) => { this.className = [...new Set([...this.className.split(/\s+/).filter(Boolean), ...names])].join(' '); },
        remove: (...names) => { this.className = this.className.split(/\s+/).filter((name) => !names.includes(name)).join(' '); },
        toggle: (name) => { const add = !this.classList.contains(name); this.classList[add ? 'add' : 'remove'](name); return add; },
      };
    }
    get className() { return this.getAttribute('class') || ''; }
    set className(value) { this.setAttribute('class', value); }
    get id() { return this.getAttribute('id') || ''; }
    set id(value) { this.setAttribute('id', value); }
    get href() { return this.getAttribute('href'); }
    set href(value) { this.setAttribute('href', value); }
    setAttribute(key, value) { this.attrs.set(key, String(value)); mutation(this, 'attributes', key); }
    getAttribute(key) { return this.attrs.get(key) ?? null; }
    hasAttribute(key) { return this.attrs.has(key); }
    removeAttribute(key) { this.attrs.delete(key); mutation(this, 'attributes', key); }
    matches(selector) {
      if (selector.includes(',')) return selector.split(',').some((part) => this.matches(part.trim()));
      if (selector.startsWith('.')) return this.classList.contains(selector.slice(1));
      const attr = selector.match(/^(\w+)?\[([^=\]]+)(?:="([^"]*)")?\]$/);
      if (attr) return (!attr[1] || this.tagName === attr[1].toUpperCase()) && this.hasAttribute(attr[2]) && (attr[3] === undefined || this.getAttribute(attr[2]) === attr[3]);
      return this.tagName === selector.toUpperCase();
    }
    closest(selector) { for (let node = this; node; node = node.parentElement) if (node.matches?.(selector)) return node; return null; }
    querySelectorAll(selector) {
      if (selector.startsWith(':scope > ')) return this.children.filter((node) => node.matches?.(selector.slice(9)));
      const list = []; const visit = (node) => { for (const child of node.children) { if (child.matches?.(selector)) list.push(child); visit(child); } }; visit(this); return list;
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    addEventListener(name, callback) { const list = this.listeners.get(name) || []; list.push(callback); this.listeners.set(name, list); }
    focus() { document.activeElement = this; }
  }
  const html = new Element('html'); const head = new Element('head'); const body = new Element('body'); html.append(head, body);
  const listeners = new Map();
  const document = {
    documentElement: html, head, body, title: 'Test', readyState: 'complete', currentScript: { src: 'http://127.0.0.1:3002/appearance.js' },
    createElement: (tag) => new Element(tag), createComment: () => new Node(8),
    getElementById: (id) => [html, ...allNodes(html)].find((node) => node.id === id) || null,
    querySelectorAll: (selector) => html.querySelectorAll(selector), querySelector: (selector) => html.querySelector(selector),
    addEventListener(name, callback) { const list = listeners.get(name) || []; list.push(callback); listeners.set(name, list); },
    dispatchEvent(event) { events.push(event); for (const fn of listeners.get(event.type) || []) fn(event); },
    createTreeWalker(node) { const nodes = allNodes(node); let index = 0; return { nextNode() { return nodes[index++] || null; } }; },
  };
  function allNodes(node) { return node.children.flatMap((child) => [child, ...allNodes(child)]); }
  class MutationObserver {
    constructor(callback) { this.callback = callback; this.records = []; observers.push(this); }
    observe(target, options) { this.target = target; this.options = options; }
    takeRecords() { return this.records.splice(0); }
  }
  function flush() {
    let count = 0;
    while (observers.some((o) => o.records.length) || frames.length) {
      assert.ok(++count < 20, 'observer refresh must settle');
      observers.forEach((o) => { if (o.records.length) o.callback(o.takeRecords()); });
      frames.splice(0).forEach((frame) => frame());
    }
  }
  return { document, Element, Text, MutationObserver, events, listeners, frames, flush, observers, Node: { ELEMENT_NODE: 1, TEXT_NODE: 3, DOCUMENT_NODE: 9 } };
}

function appearance({ href = 'http://127.0.0.1:3002/', saved, blocked = false, shell = false, mobile = false, collapsed = false, settings = false, cockpit = false } = {}) {
  const d = dom(); const storage = new Map(saved ? [['nfon-showcase-theme', saved]] : []); const calls = []; const windowListeners = new Map();
  storage.set('nfon-showcase-navigation-collapsed', String(collapsed));
  const media = { matches: mobile, addEventListener(_, listener) { this.listener = listener; } };
  const location = new URL(href); const controls = [];
  if (shell) {
    const header = d.document.createElement('header'); header.className = 'app-header';
    const actions = d.document.createElement('div'); actions.className = 'header-actions'; header.append(actions);
    for (const label of cockpit ? [] : ['Overview', 'Setup']) { const node = d.document.createElement('a'); node.className = 'nav-button'; node.href = label === 'Setup' ? '/setup.html' : '/'; node.textContent = label; actions.append(node); controls.push(node); }
    const input = d.document.createElement('input'); input.value = 'Unchanged draft'; d.document.body.append(header, input); controls.push(input);
  }
  if (settings) { const container = d.document.createElement('div'); container.setAttribute('data-appearance-settings', ''); d.document.body.append(container); }
  const context = { ...d, URL, location, requestAnimationFrame: (frame) => d.frames.push(frame), history: { state: { unchanged: true }, replaceState(state, _, url) { assert.equal(state.unchanged, true); location.href = url; } },
    localStorage: { getItem(key) { if (blocked) throw new Error('denied'); return storage.get(key) || null; }, setItem(key, value) { if (blocked) throw new Error('denied'); storage.set(key, value); } },
    CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    fetch: (...args) => calls.push(args),
  };
  context.window = { matchMedia: () => media, addEventListener: (name, listener) => windowListeners.set(name, listener) };
  vm.runInNewContext(appearanceSource, context);
  return { ...d, api: context.window.NFON_APPEARANCE, storage, calls, controls, location, windowListeners, media };
}

function i18n(messages, language = 'en', options = {}) {
  const d = dom(); const storage = options.storage || new Map(language === null ? [] : [['nfon-showcase-language', language]]);
  const windowListeners = new Map();
  const location = new URL(options.href || "http://127.0.0.1:3002/");
  const browserLanguage = options.browserLanguage || language || 'de-DE';
  const context = { ...d, URL, location, history: { state: null, replaceState(_, __, href) { location.href = href; } }, NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 }, navigator: { language: browserLanguage, languages: [browserLanguage] },
    requestAnimationFrame: (frame) => d.frames.push(frame), CustomEvent: class { constructor(type, options) { this.type = type; this.detail = options.detail; } },
    window: { addEventListener(name, callback) { windowListeners.set(name, callback); }, NFON_MESSAGES: messages, localStorage: {
      getItem: (key) => { if (options.blocked) throw new Error('Storage unavailable'); return storage.get(key); },
      setItem: (key, value) => { if (options.blocked) throw new Error('Storage unavailable'); storage.set(key, value); },
    } },
  };
  vm.runInNewContext(i18nSource, context);
  return { ...d, api: context.window.NFON_I18N, storage, windowListeners, location };
}

test('first visits default to English independently of the browser language', () => {
  for (const browserLanguage of ['de-DE', 'fr-FR', 'es-ES', 'ja-JP']) {
    const firstVisit = i18n({}, null, { browserLanguage });
    assert.equal(firstVisit.api.getLanguage(), 'en');
    assert.equal(firstVisit.document.documentElement.lang, 'en');
    assert.equal(firstVisit.storage.has('nfon-showcase-language'), false, 'initialization does not invent a saved choice');
  }
  assert.equal(i18n({}, 'invalid').api.getLanguage(), 'en');
  assert.equal(i18n({}, 'fr', { blocked: true }).api.getLanguage(), 'en');
});

test('an explicit language choice persists across reloads while invalid values cannot replace it', () => {
  const a = i18n({}, null, { browserLanguage: 'de-DE' });
  a.api.setLanguage('fr', true);
  assert.equal(a.storage.get('nfon-showcase-language'), 'fr');
  const reloaded = i18n({}, null, { storage: a.storage, browserLanguage: 'de-DE' });
  assert.equal(reloaded.api.getLanguage(), 'fr');
  reloaded.api.refresh();
  reloaded.api.setLanguage('invalid', true);
  assert.equal(reloaded.api.getLanguage(), 'fr');
  assert.equal(reloaded.storage.get('nfon-showcase-language'), 'fr');
  const blocked = i18n({}, null, { blocked: true });
  assert.doesNotThrow(() => blocked.api.setLanguage('es', true));
  assert.equal(blocked.api.getLanguage(), 'es', 'selection still works for the current page without storage');
});

test('navigation language overrides saved preference and storage changes update the active tab', () => {
  const a = i18n({}, 'de', { href: 'http://127.0.0.1:4321/?lang=fi' });
  assert.equal(a.api.getLanguage(), 'fi');
  assert.equal(a.storage.get('nfon-showcase-language'), 'fi');
  a.storage.set('nfon-showcase-language', 'pl'); // The other tab has already written it.
  let writes = 0;
  const write = a.storage.set.bind(a.storage);
  a.storage.set = (...args) => { writes++; return write(...args); };
  a.windowListeners.get('storage')({ key: 'nfon-showcase-language', newValue: 'pl' });
  assert.equal(a.api.getLanguage(), 'pl');
  assert.equal(a.location.searchParams.get('lang'), 'pl');
  assert.equal(writes, 0, 'storage events must not write back to other tabs');
  const reloaded = i18n({}, null, { href: a.location.href, storage: a.storage });
  assert.equal(reloaded.api.getLanguage(), 'pl');
  assert.equal(a.storage.get('nfon-showcase-language'), 'pl');
  a.api.setLanguage('fr', true);
  assert.equal(a.location.searchParams.get('lang'), 'fr');
  const nav = appearance({ href: 'http://localhost:4321/?theme=classic&lang=fi' });
  const target = new URL(nav.api.internalLink('http://127.0.0.1:4457/setup.html'));
  assert.equal(target.searchParams.get('lang'), 'fi');
  assert.equal(target.searchParams.get('theme'), 'classic');
});

test('unknown names are not translated by word fragments', () => {
  const a = i18n({ 'queue': { en: 'Queue', de: 'Warteschlange' } }, 'en');
  assert.equal(a.api.translate('Warteschlange Müller'), 'Warteschlange Müller');
  assert.equal(a.api.translate('i'), 'i');
});

const messages = {
  'test.status': { en: 'Status for {name}: {count}', de: 'Status für {name}: {count}' },
  'test.title': { en: 'Call from {name}', de: 'Von {name} anrufen' },
  'test.empty': { en: 'No data found', de: 'Keine Daten gefunden' },
  'test.updated': { en: 'Updated call details for {name}: {count}', de: 'Aktualisierte Anrufdetails für {name}: {count}' },
};

test('theme URL wins over storage and remains usable when storage is denied', () => {
  assert.equal(appearance().api.getTheme(), 'admin-portal');
  assert.equal(appearance({ saved: 'classic' }).api.getTheme(), 'classic');
  assert.equal(appearance({ href: 'http://127.0.0.1:3002/?theme=classic', saved: 'admin-portal' }).api.getTheme(), 'classic');
  assert.equal(appearance({ href: 'http://127.0.0.1:3002/?theme=classic', blocked: true }).api.getTheme(), 'classic');
  assert.equal(appearance({ href: 'http://127.0.0.1:3002/?theme=invalid', saved: 'classic' }).api.getTheme(), 'classic');
});

test('switching theme moves existing controls and restores order without writes or rebuilding forms', () => {
  const a = appearance({ shell: true }); const [overview, setup, input] = a.controls;
  const nav = a.document.querySelector('.nfon-sidebar').querySelector('nav');
  assert.equal(nav.children[0], overview); assert.equal(nav.children[1], setup);
  overview.customHandler = () => 'kept';
  assert.equal(a.api.setTheme('classic'), true);
  const restored = a.document.querySelector('.header-actions').children.filter((node) => node.nodeType === 1);
  assert.deepEqual(restored, [overview, setup]);
  a.api.setTheme('admin-portal'); a.api.setTheme('classic');
  assert.equal(overview.customHandler(), 'kept'); assert.equal(input.value, 'Unchanged draft');
  assert.equal(a.api.setTheme('javascript:evil'), false);
  assert.equal(a.api.getTheme(), 'classic'); assert.equal(a.calls.length, 0);
  assert.equal(a.storage.get('nfon-showcase-theme'), 'classic');
});

test('internal links carry only a validated theme and preserve API, OAuth, downloads and external URLs', () => {
  const a = appearance({ saved: 'classic' });
  for (const link of ['http://127.0.0.1:3000/', 'http://localhost:3001/setup.html?mode=test#form', '/analytics.html']) {
    const url = new URL(a.api.internalLink(link)); assert.equal(url.searchParams.get('theme'), 'classic');
  }
  for (const link of ['/api/storage/backup', '/auth/google/start', '/oauth/callback', '/backup.json', '#form', 'mailto:test@example.invalid', 'https://admin.nfon.com/', 'https://external.example:9999/']) assert.equal(a.api.internalLink(link), link);
  assert.equal(new URL(a.api.internalLink('http://localhost:3001/setup.html?mode=test#form')).hash, '#form');
});

test('navigation hrefs already carry theme for middle-click and opening a new tab', () => {
  const a = appearance({ shell: true, saved: 'classic' });
  assert.equal(new URL(a.controls[0].href, a.location.href).searchParams.get('theme'), 'classic');
  a.api.setTheme('admin-portal');
  assert.equal(new URL(a.controls[0].href, a.location.href).searchParams.get('theme'), 'admin-portal');
  const added = a.document.createElement('a'); added.href = 'http://localhost:3001/setup.html'; a.document.body.append(added); a.flush();
  assert.equal(new URL(added.href).searchParams.get('theme'), 'admin-portal');
  added.href = 'http://localhost:3000/'; a.flush();
  assert.equal(new URL(added.href).searchParams.get('theme'), 'admin-portal');
});

test('cross-tab theme sync cannot leave a stale URL override for the next reload', () => {
  const a = appearance({ href: 'http://127.0.0.1:3002/?theme=classic' });
  a.windowListeners.get('storage')({ key: 'nfon-showcase-theme', newValue: 'admin-portal' });
  assert.equal(a.api.getTheme(), 'admin-portal');
  assert.equal(a.location.searchParams.get('theme'), 'admin-portal');
});

test('desktop navigation collapse persists without moving controls or discarding drafts', () => {
  const a = appearance({ shell: true });
  const button = a.document.querySelector('.nfon-sidebar-toggle');
  const click = () => button.listeners.get('click')[0]();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  click();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(a.storage.get('nfon-showcase-navigation-collapsed'), 'true');
  assert.equal(a.controls[0].parentElement.tagName, 'NAV');
  assert.equal(a.controls[0].getAttribute('title'), 'Overview');
  a.document.dispatchEvent({ type: 'click', target: a.controls[2] });
  assert.equal(button.getAttribute('aria-expanded'), 'false', 'outside clicks must not expand the desktop rail');
  a.api.setTheme('classic'); a.api.setTheme('admin-portal');
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(a.controls[2].value, 'Unchanged draft');
  const reloaded = appearance({ shell: true, collapsed: true });
  assert.equal(reloaded.document.querySelector('.nfon-sidebar-toggle').getAttribute('aria-expanded'), 'false');
  click(); assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(a.storage.get('nfon-showcase-navigation-collapsed'), 'false');
});

test('mobile drawer remains independent of the saved desktop rail and closes on Escape', () => {
  const a = appearance({ shell: true, mobile: true, collapsed: true });
  const button = a.document.querySelector('.nfon-menu-button');
  button.listeners.get('click')[0]();
  assert.equal(button.getAttribute('aria-expanded'), 'true');
  assert.equal(a.storage.get('nfon-showcase-navigation-collapsed'), 'true');
  a.document.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(a.document.activeElement, button);
  button.listeners.get('click')[0]();
  a.document.querySelector('.nfon-sidebar-toggle').listeners.get('click')[0]();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  assert.equal(a.document.activeElement, button, 'closing from inside the drawer must return focus to the visible opener');
  a.media.matches = false; a.media.listener();
  assert.equal(button.getAttribute('aria-expanded'), 'false');
  a.windowListeners.get('storage')({ key: 'nfon-showcase-navigation-collapsed', newValue: 'false' });
  assert.equal(button.getAttribute('aria-expanded'), 'true');
});

test('design switch names both appearances and preserves drafts across clicks and cross-tab updates', () => {
  const a = appearance({ shell: true, settings: true });
  const control = a.document.querySelector('[data-nfon-theme-switch]');
  const click = () => control.listeners.get('click')[0]();
  assert.equal(control.querySelector('.nfon-theme-classic').textContent, 'Classic Design');
  assert.equal(control.querySelector('.nfon-theme-modern').textContent, 'Modern Design');
  assert.equal(control.getAttribute('role'), 'switch');
  assert.equal(control.getAttribute('aria-label'), 'Modern Design');
  assert.equal(control.getAttribute('aria-checked'), 'true');
  click();
  assert.equal(a.api.getTheme(), 'classic');
  assert.equal(control.getAttribute('aria-checked'), 'false');
  assert.equal(a.controls[2].value, 'Unchanged draft');
  a.windowListeners.get('storage')({ key: 'nfon-showcase-theme', newValue: 'admin-portal' });
  assert.equal(control.getAttribute('aria-checked'), 'true');
  click(); click();
  assert.equal(a.api.getTheme(), 'admin-portal');
  assert.equal(a.document.querySelector('[data-nfon-theme-switch]'), control);
  assert.equal(a.controls[2].value, 'Unchanged draft');
  assert.equal(a.calls.length, 0);
});

test('cockpit has no sidebar or navigation toggles and retains the theme switch', () => {
  const a = appearance({ shell: true, cockpit: true, settings: true });
  assert.equal(a.document.querySelector('.nfon-sidebar'), null);
  assert.equal(a.document.querySelector('.nfon-menu-button'), null);
  assert.equal(a.document.querySelector('.nfon-sidebar-toggle'), null);
  assert.ok(a.document.querySelector('[data-nfon-theme-switch]'));
  a.api.setTheme('classic');
  a.api.setTheme('admin-portal');
  assert.equal(a.document.querySelector('.nfon-sidebar'), null);
});

test('every app gets one top switch, including pages without a settings placeholder', () => {
  for (const settings of [false, true]) {
    for (const cockpit of [false, true]) {
      const a = appearance({ shell: true, settings, cockpit });
      const strip = a.document.querySelector('.nfon-appearance-strip');
      const header = a.document.querySelector('.app-header');
      const control = strip.querySelector('[data-nfon-theme-switch]');
      assert.ok(control);
      assert.equal(a.document.querySelectorAll('[data-nfon-theme-switch]').length, 1);
      assert.ok(a.document.body.children.indexOf(strip) < a.document.body.children.indexOf(header));
      control.listeners.get('click')[0]();
      assert.equal(a.api.getTheme(), 'classic');
      assert.equal(strip.querySelector('[data-nfon-theme-switch]'), control);
      assert.equal(a.controls.at(-1).value, 'Unchanged draft');
      if (!cockpit) assert.equal(new URL(a.controls[1].href).searchParams.get('theme'), 'classic');
    }
  }
});

test('message substitution preserves user data and unsupported locales fall back to English', () => {
  const a = i18n(messages);
  assert.equal(a.api.message('test.status', { name: '<Test> Frei', count: 0 }, 'fr'), 'Status for <Test> Frei: 0');
  assert.equal(a.api.message('missing', {}), '');
  assert.equal(a.api.message('test.status', { name: 'Frei' }, 'de'), 'Status für Frei: {count}');
});

test('keyed text and attributes update in place without changing form values or ignored records', () => {
  const a = i18n(messages); const element = a.document.createElement('input');
  element.value = 'Real draft'; element.setAttribute('data-i18n-placeholder', 'test.status');
  element.setAttribute('data-i18n-params', JSON.stringify({ name: 'Actual name', count: 3 }));
  element.setAttribute('data-i18n-title', 'test.title');
  element.setAttribute('data-i18n-title-params', JSON.stringify({ name: 'Different name' }));
  const output = a.document.createElement('span'); output.setAttribute('data-i18n-key', 'test.status'); output.setAttribute('data-i18n-params', JSON.stringify({ name: 'Unverändert', count: 0 }));
  const ignored = a.document.createElement('span'); ignored.setAttribute('data-i18n-ignore', ''); ignored.textContent = 'Keine Daten gefunden';
  a.document.body.append(element, output, ignored); a.flush();
  assert.equal(output.textContent, 'Status for Unverändert: 0');
  a.api.setLanguage('de'); a.flush();
  assert.equal(element.getAttribute('title'), 'Von Different name anrufen');
  assert.equal(element.getAttribute('placeholder'), 'Status für Actual name: 3');
  assert.equal(output.textContent, 'Status für Unverändert: 0');
  assert.equal(ignored.textContent, 'Keine Daten gefunden'); assert.equal(element.value, 'Real draft');
  a.api.setLanguage('en'); a.flush(); assert.equal(output.textContent, 'Status for Unverändert: 0');
  assert.equal(a.events.filter((event) => event.type === 'nfon:language-change').length, 2);
});

test('navigation and language accessibility labels stay localized with the complete canonical catalog', () => {
  const catalogs = ['shared', 'CTI_API', 'Portal_API', 'CallHistory_API', 'landing'];
  const canonical = Object.assign({}, ...catalogs.map((directory) => JSON.parse(readFileSync(path.join(root, directory, 'i18n-messages.json'), 'utf8'))));
  const languages = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'cs'];
  const keys = ['appearance.label', 'appearance.menu', 'appearance.collapseNavigation', 'appearance.expandNavigation', 'appearance.navigation', 'appearance.apps', 'cti.back', 'portal.language'];
  const a = i18n(canonical);
  const keyed = keys.map((key) => {
    const button = a.document.createElement('button');
    button.setAttribute('data-i18n-aria-label', key);
    button.setAttribute('data-i18n-title', key);
    a.document.body.append(button);
    return { key, button };
  });
  const legacy = ['portal.language', 'cti.back'].map((key) => {
    const button = a.document.createElement('button');
    button.setAttribute('aria-label', canonical[key].en);
    a.document.body.append(button);
    return { key, button };
  });
  a.flush();
  for (const language of languages) {
    a.api.setLanguage(language); a.flush();
    for (const { key, button } of keyed) {
      const expected = canonical[key][language];
      assert.ok(expected, `${key} has ${language} text without relying on English fallback`);
      assert.equal(button.getAttribute('aria-label'), expected, `${key} aria-label follows ${language}`);
      assert.equal(button.getAttribute('title'), expected, `${key} title follows ${language}`);
    }
    for (const { key, button } of legacy) {
      assert.equal(a.api.translate(canonical[key].en, language), canonical[key][language], `${key} canonical lookup does not mask its translation`);
      assert.equal(button.getAttribute('aria-label'), canonical[key][language], `${key} unkeyed aria-label follows ${language}`);
    }
  }
  assert.equal(canonical['cti.back'].de, 'Zur Übersicht');
});

test('observer handles later text, attribute and keyed-param changes without looping or stale copy', () => {
  const a = i18n(messages); const element = a.document.createElement('span');
  element.textContent = 'Keine Daten gefunden'; a.document.body.append(element); a.flush();
  assert.equal(element.textContent, 'No data found');
  element.children[0].nodeValue = 'Aktualisierte Anrufdetails für New record: 4'; a.flush();
  assert.equal(element.textContent, 'Updated call details for New record: 4');
  element.setAttribute('title', 'Keine Daten gefunden'); a.flush();
  assert.equal(element.getAttribute('title'), 'No data found');
  element.setAttribute('title', 'Aktualisierte Anrufdetails für Other record: 9'); a.flush();
  assert.equal(element.getAttribute('title'), 'Updated call details for Other record: 9');
  element.setAttribute('data-i18n-key', 'test.status'); element.setAttribute('data-i18n-params', '{"name":"New record","count":5}'); a.flush();
  assert.equal(element.textContent, 'Status for New record: 5');
  element.setAttribute('data-i18n-params', 'invalid json'); a.flush();
  assert.equal(element.textContent, 'Status for {name}: {count}');
  a.api.setLanguage('en'); a.flush(); assert.equal(a.events.filter((event) => event.type === 'nfon:language-change').length, 0);
});

function syncFixture(t, catalogs) {
  const temporary = mkdtempSync(path.join(tmpdir(), 'nfon-shared-test-')); t.after(() => rmSync(temporary, { recursive: true, force: true }));
  for (const dir of ['scripts', 'shared/assets/material', 'shared/assets/fonts', 'docs', 'CTI_API', 'Portal_API', 'CallHistory_API', 'landing']) mkdirSync(path.join(temporary, dir), { recursive: true });
  cpSync(path.join(root, 'scripts/sync-shared.mjs'), path.join(temporary, 'scripts/sync-shared.mjs'));
  for (const file of ['appearance.js', 'appearance.css']) writeFileSync(path.join(temporary, 'shared', file), '/* isolated fixture */');
  writeFileSync(path.join(temporary, 'shared/server-safety.cjs'), 'module.exports = {};');
  writeFileSync(path.join(temporary, 'docs/i18n.js'), '/* isolated i18n */');
  writeFileSync(path.join(temporary, 'docs/demo-runtime.js'), '/* isolated demo runtime */');
  for (const app of ['shared', 'CTI_API', 'Portal_API', 'CallHistory_API', 'landing', 'docs']) writeFileSync(path.join(temporary, app, 'i18n-messages.json'), JSON.stringify(catalogs[app] || {}));
  return { temporary, run: () => spawnSync(process.execPath, ['scripts/sync-shared.mjs'], { cwd: temporary, encoding: 'utf8' }) };
}

test('attribute-specific data-label parameters trigger a fresh translation', () => {
  const a = i18n(messages); const element = a.document.createElement('span');
  element.setAttribute('data-i18n-data-label', 'test.title');
  element.setAttribute('data-i18n-data-label-params', '{"name":"First"}');
  a.document.body.append(element); a.flush();
  assert.equal(element.getAttribute('data-label'), 'Call from First');
  element.setAttribute('data-i18n-data-label-params', '{"name":"Second"}'); a.flush();
  assert.equal(element.getAttribute('data-label'), 'Call from Second');
});

test('sync emits identical standalone catalogs and rejects duplicates and incomplete translations', (t) => {
  const allLanguages = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'cs'];
  const complete = (values) => Object.fromEntries(allLanguages.map((language) => [language, values[language] || values.en]));
  const completeMessages = Object.fromEntries(Object.entries(messages).map(([key, values]) => [key, complete(values)]));
  const good = syncFixture(t, { shared: completeMessages }); const result = good.run(); assert.equal(result.status, 0, result.stderr);
  const targets = ['docs', 'CTI_API/public', 'Portal_API/public', 'CallHistory_API/public', 'landing/public'];
  const copies = targets.map((target) => readFileSync(path.join(good.temporary, target, 'messages.js'), 'utf8'));
  copies.forEach((copy) => assert.equal(copy, copies[0]));
  const served = path.join(good.temporary, 'docs/messages.js');
  const before = statSync(served);
  assert.equal(good.run().status, 0);
  assert.equal(statSync(served).mtimeMs, before.mtimeMs, 'unchanged assets must not be rewritten');
  const reader = openSync(served, 'r');
  try {
    writeFileSync(path.join(good.temporary, 'shared/i18n-messages.json'), JSON.stringify({ ...completeMessages, extra: complete({ en: 'New', de: 'Neu' }) }));
    assert.equal(good.run().status, 0);
    const buffer = Buffer.alloc(before.size);
    assert.equal(readSync(reader, buffer, 0, buffer.length, 0), buffer.length);
    assert.equal(buffer.toString(), copies[0], 'an existing server reader must retain the complete old asset');
    assert.match(readFileSync(served, 'utf8'), /"extra"/);
  } finally { closeSync(reader); }
  const duplicate = syncFixture(t, { shared: completeMessages, CTI_API: { 'test.status': completeMessages['test.status'] } }); const duplicateResult = duplicate.run(); assert.notEqual(duplicateResult.status, 0); assert.match(duplicateResult.stderr, /Duplicate message key/);
  const missing = syncFixture(t, { shared: { key: { en: 'English only' } } }); assert.notEqual(missing.run().status, 0);
  const missingFinnish = { ...completeMessages['test.status'] }; delete missingFinnish.fi;
  const incomplete = syncFixture(t, { shared: { key: missingFinnish } });
  const incompleteResult = incomplete.run(); assert.notEqual(incompleteResult.status, 0); assert.match(incompleteResult.stderr, /invalid fi translation/);
  const mismatchedFinnish = syncFixture(t, { shared: { key: { ...completeMessages['test.status'], fi: 'Tila {wrong}' } } });
  const mismatchResult = mismatchedFinnish.run(); assert.notEqual(mismatchResult.status, 0); assert.match(mismatchResult.stderr, /Mismatched message parameters: key \(fi\)/);
});

test('sync rejects non-string messages and mismatched parameter names', (t) => {
  const nonString = syncFixture(t, { shared: { key: { en: 4, de: 5 } } }); assert.notEqual(nonString.run().status, 0);
  const mismatch = syncFixture(t, { shared: { key: { en: 'Count {count}', de: 'Anzahl {value}' } } }); assert.notEqual(mismatch.run().status, 0);
});

test('catalogs include shared and own keys without unrelated app payloads', t => {
  const entry=Object.fromEntries(['en','de','fr','es','it','nl','pl','pt','sv','da','fi','cs'].map(l=>[l,'Fixture']));
  const f=syncFixture(t,{shared:{common:entry},CTI_API:{'cti.only':entry},Portal_API:{'portal.only':entry},landing:{'landing.only':entry}});
  assert.equal(f.run().status,0);
  for(const relative of ['CTI_API/public/messages.js','docs/cti/messages.js']){
    const content=readFileSync(path.join(f.temporary,relative),'utf8');assert.match(content,/"common"/);assert.match(content,/"cti.only"/);assert.doesNotMatch(content,/"portal.only"/);
  }
  const cockpit=readFileSync(path.join(f.temporary,'docs/messages.js'),'utf8');assert.match(cockpit,/"landing.only"/);assert.doesNotMatch(cockpit,/"portal.only"/);
});

test('shared asset check detects retired files in its generated namespaces', t => {
  const f=syncFixture(t,{});assert.equal(f.run().status,0);
  const retired=path.join(f.temporary,'CTI_API/public/assets/fonts/retired.woff2');
  mkdirSync(path.dirname(retired),{recursive:true});writeFileSync(retired,'obsolete');
  const run=spawnSync(process.execPath,['scripts/sync-shared.mjs','--check'],{cwd:f.temporary,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/Orphaned shared asset/);
  assert.equal(f.run().status,0);assert.equal(existsSync(retired),false);
});

test('German legacy metric text never falls back to English during language refresh', () => {
  const a = i18n(messages);
  assert.equal(a.api.translate('Vortag 0', 'de'), 'Vortag 0');
  assert.equal(a.api.translate('  Vortag 12  ', 'de'), '  Vortag 12  ');
  assert.equal(a.api.translate('Vortag 0', 'en'), 'Previous day 0');
  const metric = a.document.createElement('span'); metric.textContent = 'Vortag 0';
  a.document.body.append(metric); a.flush();
  assert.equal(metric.textContent, 'Previous day 0');
  a.api.setLanguage('de'); a.flush();
  assert.equal(metric.textContent, 'Vortag 0');
  metric.textContent = 'Vortag 8'; a.flush();
  assert.equal(metric.textContent, 'Vortag 8');
  a.api.setLanguage('en'); a.flush();
  assert.equal(metric.textContent, 'Previous day 8');
});
