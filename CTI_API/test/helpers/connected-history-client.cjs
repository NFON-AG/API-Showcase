'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Execute the full production client, omitting only automatic page startup.
// The unchanged event reducer, history renderer and export transformations are
// driven by frames read from the real server's HTTP event stream. Browser-only
// objects are inert adapters; no production function is replaced.
function element() {
  const attributes = new Map();
  return { textContent: '', innerHTML: '', value: '', hidden: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} }, addEventListener() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute(key, value) { attributes.set(key, value); }, getAttribute(key) { return attributes.get(key); },
    removeAttribute(key) { attributes.delete(key); }, closest() { return null; } };
}

async function connectedHistoryClient(base) {
  const nodes = Object.fromEntries(['account-label', 'connection-state', 'history-body', 'history-count', 'history-more'].map(id => [id, element()]));
  const document = { getElementById(id) { return nodes[id] || null; }, querySelectorAll() { return []; },
    addEventListener() {}, documentElement: { lang: 'en' }, body: { classList: { add() {}, remove() {} } }, activeElement: null };
  const sandbox = { window: { NFON_PHONE: require('../../public/phone-number.js'), NFON_I18N: { getLanguage() { return 'en'; }, message() { return ''; } },
    location: { protocol: 'http:', pathname: '/', href: base + '/' }, addEventListener() {} }, document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} }, Intl, Date, URL, URLSearchParams, Blob, Map, setTimeout, clearTimeout,
    fetch(input, init) { return fetch(new URL(input, base), init); } };
  vm.createContext(sandbox);
  const source = fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8');
  if (!/\nstartApp\(\);\s*$/.test(source)) throw Error('Client startup seam changed; review this harness');
  vm.runInContext(source.replace(/\nstartApp\(\);\s*$/, ''), sandbox);
  const response = await fetch(base + '/api/events');
  if (!response.ok) throw Error('SSE failed with ' + response.status);
  const reader = response.body.getReader(), decoder = new TextDecoder(), frames = [];
  let buffer = '', failure;
  const pumping = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read(); if (done) return;
        buffer += decoder.decode(value, { stream: true }).replaceAll('\r\n', '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const text = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
          if (!text) continue;
          const payload = JSON.parse(text); frames.push(payload); sandbox.payload = payload;
          vm.runInContext('handleEvent(payload)', sandbox);
        }
      }
    } catch (error) { failure = error; }
  })();
  return { frames, nodes,
    get(code) { if (failure) throw failure; return vm.runInContext(code, sandbox); },
    async close() {
      // The fixture may already have closed its server during test cleanup.
      try { await reader.cancel(); } catch (error) { if (error.message !== 'terminated') throw error; }
      await pumping;
    },
  };
}

module.exports = { connectedHistoryClient };
