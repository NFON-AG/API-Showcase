'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '../public/styles.css'), 'utf8');

// Execute the real delegated events with supplied layout measurements. These
// geometry regressions supplement, rather than replace, the actual browser check.
function geometry({ viewport = { width: 1280, height: 1165 }, anchor = { left: 94, top: 1080, width: 15, height: 15 },
  clip = { left: 72, top: 510, width: 1020, height: 655.13 }, naturalHeight = 120 } = {}) {
  const events = new Map(), nodes = new Map();
  const on = (key, fn) => events.set(key, [...(events.get(key) || []), fn]);
  const rect = item => ({ ...item, right: item.left + item.width, bottom: item.top + item.height });
  const root = { parentElement: null, overflowX: 'visible', overflowY: 'visible' };
  const scroller = { parentElement: root, clientLeft: 0, clientTop: 0, overflowX: 'auto', overflowY: 'auto',
    get clientWidth() { return clip.width; }, get clientHeight() { return clip.height; }, getBoundingClientRect: () => rect(clip) };
  const attributes = new Map();
  const badge = { parentElement: scroller, isConnected: true, hovered: true, getBoundingClientRect: () => rect(anchor),
    closest: selector => selector === '.ai-transcript-badge' ? badge : null,
    querySelector: selector => selector === '.transcript-summary-popover' ? popover : null };
  const popover = { parentElement: badge, style: {},
    setAttribute: (name, value) => attributes.set(name, value),
    getBoundingClientRect() {
      const width = Math.min(360, Number.parseFloat(this.style.maxWidth) || Infinity);
      const height = Math.min(typeof naturalHeight === 'function' ? naturalHeight(width) : naturalHeight, Number.parseFloat(this.style.maxHeight) || Infinity);
      return rect({ left: anchor.left + (Number.parseFloat(this.style.left) || 0),
        top: anchor.top + (this.style.top === undefined || this.style.top === '' ? anchor.height + 7 : Number.parseFloat(this.style.top)), width, height });
    } };
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false, dataset: {}, style: {},
      classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, getAttribute() { return null; },
      querySelector() { return null; }, querySelectorAll: () => [], addEventListener() {} });
    return nodes.get(selector);
  };
  const visualViewport = { offsetTop: 0, offsetLeft: 0, height: viewport.height, width: viewport.width,
    addEventListener: (name, fn) => on('visual:' + name, fn) };
  const document = { documentElement: { dataset: {}, lang: 'en' }, querySelector: element, getElementById: id => element('#' + id),
    querySelectorAll: selector => selector.includes('.ai-transcript-badge') && badge.hovered ? [badge] : [],
    addEventListener: (name, fn) => on('document:' + name, fn), activeElement: null };
  const window = { location: new URL('http://127.0.0.1:3000/'), innerWidth: viewport.width, innerHeight: viewport.height, visualViewport,
    addEventListener: (name, fn) => on('window:' + name, fn), NFON_I18N: { getLanguage: () => 'en', message: () => '' } };
  const context = vm.createContext({ document, window, localStorage: { getItem() { return null; }, setItem() {} },
    getComputedStyle: node => ({ overflowX: node.overflowX || 'visible', overflowY: node.overflowY || 'visible' }),
    navigator: {}, URL, URLSearchParams, Intl, FormData, Map, setTimeout, clearTimeout,
    fetch() { throw new Error('Unexpected network request'); } });
  vm.runInContext(source.replace(/loadAll\(\);\s*$/, ''), context);
  return { badge, popover, anchor, clip, scroller, root, window, visualViewport,
    event(key, target = badge) { for (const fn of events.get(key) || []) fn({ target }); },
    bounds() { return popover.getBoundingClientRect(); },
    run: code => vm.runInContext(code, context) };
}
function inside(box, bounds) {
  assert(box.left >= bounds.left, `left ${box.left} outside ${bounds.left}`);
  assert(box.right <= bounds.right, `right ${box.right} outside ${bounds.right}`);
  assert(box.top >= bounds.top, `top ${box.top} outside ${bounds.top}`);
  assert(box.bottom <= bounds.bottom, `bottom ${box.bottom} outside ${bounds.bottom}`);
}

test('summary tooltip on the last visible row flips above without extending the list', () => {
  const app = geometry(); app.event('document:pointerover');
  assert(app.bounds().bottom <= app.anchor.top, 'last-row tooltip must use the available space above');
  inside(app.bounds(), { left: 72, right: 1092, top: 510, bottom: 1165 });
});

test('summary tooltip fits narrow and nested clipping bounds rather than the outer viewport alone', () => {
  const app = geometry({ viewport: { width: 390, height: 844 }, anchor: { left: 327, top: 680, width: 15, height: 15 },
    clip: { left: 24, top: 430, width: 342, height: 306 }, naturalHeight: width => width < 300 ? 190 : 120 });
  app.root.overflowX = 'hidden'; app.root.overflowY = 'hidden'; app.root.clientLeft = 1; app.root.clientTop = 1;
  app.root.clientWidth = 300; app.root.clientHeight = 320;
  app.root.getBoundingClientRect = () => ({ left: 40, top: 420 });
  app.event('document:pointerover');
  inside(app.bounds(), { left: 41, right: 341, top: 430, bottom: 736 });
});

test('summary tooltip uses space below an early row and bounds a very long summary', () => {
  const app = geometry({ anchor: { left: 94, top: 520, width: 15, height: 15 }, naturalHeight: 900 });
  app.event('document:pointerover');
  assert(app.bounds().top >= app.anchor.top + app.anchor.height);
  inside(app.bounds(), { left: 72, right: 1092, top: 510, bottom: 1165 });
  assert(Number.parseFloat(app.popover.style.maxHeight) < 900);
});

test('active summary tooltip is fitted again after scroll, theme and visual viewport resize', () => {
  const app = geometry(); app.event('document:pointerover');
  app.anchor.top = 610; app.clip.height = 240;
  app.event('document:scroll'); inside(app.bounds(), { left: 72, right: 1092, top: 510, bottom: 750 });
  app.visualViewport.height = 700; app.event('visual:resize');
  inside(app.bounds(), { left: 72, right: 1092, top: 510, bottom: 700 });
  app.anchor.left = 1070; app.event('document:nfon:theme-change');
  inside(app.bounds(), { left: 72, right: 1092, top: 510, bottom: 700 });
});

test('visual viewport offsets are respected and unhovered summaries cannot enlarge scroll content', () => {
  const app = geometry({ viewport: { width: 390, height: 844 }, anchor: { left: 35, top: 600, width: 15, height: 15 },
    clip: { left: 0, top: 200, width: 390, height: 600 } });
  app.visualViewport.offsetLeft = 20; app.visualViewport.width = 340;
  app.visualViewport.offsetTop = 100; app.visualViewport.height = 560;
  app.event('document:pointerover'); inside(app.bounds(), { left: 20, right: 360, top: 200, bottom: 660 });
  assert.match(css, /\.transcript-summary-popover\s*\{[^}]*display:\s*none/s, 'closed absolute tooltips must not create extra list scroll range');
});
