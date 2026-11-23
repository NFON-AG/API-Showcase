import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const { clientRenderer } = require('../Portal_API/test/helpers/client-render.cjs');
const phoneNumbers = require('../CTI_API/public/phone-number.js');
const demoSource = readFileSync(new URL('../docs/demo-runtime.js', import.meta.url), 'utf8');

// Real Blob URLs are consumed on a later event-loop turn, not captured as Blob
// objects inside click(). The DOM boundary does not simulate a native download.
function downloadBoundary({ failure, immediateRelease = false } = {}) {
  const created = [], revoked = [], clicks = [], anchors = [], timers = [], listeners = [];
  class DownloadURL extends URL {
    static createObjectURL(blob) { const url = URL.createObjectURL(blob); created.push(url); return url; }
    static revokeObjectURL(url) { revoked.push(url); URL.revokeObjectURL(url); }
  }
  const append = anchor => {
    if (failure === 'append') throw new Error('Synthetic append failure');
    anchor.connected = true;
  };
  const document = {
    readyState: 'loading', body: { dataset: { nfonApp: 'cti' }, append, appendChild: append },
    head: { appendChild() {} }, querySelector() { return null; }, querySelectorAll() { return []; }, getElementById() { return null; },
    addEventListener(type, callback) { if (type === 'click') listeners.push(callback); },
    createElement(tag) {
      if (tag !== 'a') return { dataset: {}, style: {} };
      const anchor = { connected: false,
        click() {
          assert.equal(this.connected, true, 'the download anchor is attached before handoff');
          if (failure === 'click') throw new Error('Synthetic click failure');
          clicks.push({ url: this.href, filename: this.download });
        },
        remove() { this.connected = false; },
      };
      anchors.push(anchor);
      return anchor;
    },
  };
  const schedule = (callback, delay) => {
    timers.push({ callback, delay });
    if (immediateRelease && delay === 60000) callback();
  };
  return { document, URL: DownloadURL, schedule, append, created, revoked, clicks, anchors, timers, listeners,
    cleanup() { created.forEach(url => URL.revokeObjectURL(url)); } };
}

function portalExport(boundary) {
  const ui = clientRenderer('en', { document: boundary.document, URL: boundary.URL, Blob, setTimeout: boundary.schedule });
  // clientRenderer installs its own body node after loading the full client.
  boundary.document.body.appendChild = boundary.append;
  return {
    async trigger(text = 'Größe · Support, "Nord"') {
      ui.evaluate(`downloadJsonFile('profile.json', ${JSON.stringify({ text, routes: [{ id: 'example', target: '239' }] })})`);
    },
    async verify(response, text = 'Größe · Support, "Nord"') {
      assert.equal(response.headers.get('content-type'), 'application/json');
      assert.deepEqual(await response.json(), { text, routes: [{ id: 'example', target: '239' }] });
    },
    filename: 'profile.json',
  };
}

function demoBackup(boundary) {
  const window = {
    NFON_PHONE: phoneNumbers, location: new URL('https://example.test/cti/setup.html'),
    fetch() { throw new Error('Unexpected network request'); },
    setTimeout: boundary.schedule, setInterval() {}, clearInterval() {}, addEventListener() {},
    localStorage: { getItem() { return null; }, setItem() {} },
  };
  vm.runInNewContext(demoSource, {
    window, document: boundary.document, URL: boundary.URL, Blob, Response, EventTarget, Event, MessageEvent,
    setTimeout: boundary.schedule, MutationObserver: class { observe() {} },
  });
  const backupLink = {
    getAttribute: () => '#demo-backup',
    closest: selector => selector === 'a' || selector.includes('#backup-download') ? backupLink : null,
  };
  return {
    async trigger() {
      const event = { target: backupLink, preventDefault() { this.prevented = true; } };
      for (const callback of boundary.listeners) await callback(event);
      assert.equal(event.prevented, true, 'the actual demo backup click handler owns the download');
    },
    async verify(response) {
      assert.equal(response.headers.get('content-type'), 'application/json');
      const saved = await response.json();
      const expected = await (await window.fetch('/api/storage/backup')).json();
      assert.equal(saved.schema, 'nfon-cti-local-backup-v1');
      assert.equal(saved.demo, true);
      assert.ok(saved.data.callEvents.length > 80);
      assert.deepEqual(saved.data, expected.data, 'every demo event survives the actual download serialization');
    },
    filename: 'nfon-cti-demo-backup.json',
  };
}

const later = () => new Promise(resolve => setImmediate(resolve));
for (const [name, createExport] of [['Portal profile JSON', portalExport], ['CTI demo backup', demoBackup]]) {
  test(`${name}: later-turn consumer receives the complete file before bounded cleanup`, async t => {
    const boundary = downloadBoundary(); t.after(() => boundary.cleanup());
    const exporter = createExport(boundary);
    await exporter.trigger();
    assert.equal(boundary.clicks.length, 1);
    assert.equal(boundary.clicks[0].filename, exporter.filename);
    assert.equal(boundary.anchors[0].connected, false);
    await later();
    await exporter.verify(await fetch(boundary.clicks[0].url));
    const cleanup = boundary.timers.filter(timer => timer.delay >= 1000 && timer.delay <= 60000);
    // The demo also schedules its existing UI initialization at 1000ms.
    const release = cleanup.find(timer => timer.delay === 60000);
    assert.ok(release, 'successful handoff retains the file for a bounded window');
    release.callback();
    await assert.rejects(fetch(boundary.clicks[0].url));
    assert.deepEqual(boundary.revoked, [boundary.clicks[0].url]);
  });

  test(`${name}: overlapping exports keep independent file ownership`, async t => {
    const boundary = downloadBoundary(); t.after(() => boundary.cleanup());
    const exporter = createExport(boundary);
    await exporter.trigger('first'); await exporter.trigger('second'); await later();
    assert.notEqual(boundary.clicks[0].url, boundary.clicks[1].url);
    await exporter.verify(await fetch(boundary.clicks[0].url), 'first');
    await exporter.verify(await fetch(boundary.clicks[1].url), 'second');
    const releases = boundary.timers.filter(timer => timer.delay === 60000);
    assert.equal(releases.length, 2);
    releases[0].callback();
    await assert.rejects(fetch(boundary.clicks[0].url));
    await exporter.verify(await fetch(boundary.clicks[1].url), 'second');
    releases[1].callback();
    await assert.rejects(fetch(boundary.clicks[1].url));
  });

  for (const failure of ['append', 'click']) test(`${name}: ${failure} failure releases file and temporary anchor`, async t => {
    const boundary = downloadBoundary({ failure }); t.after(() => boundary.cleanup());
    const exporter = createExport(boundary);
    await assert.rejects(exporter.trigger(), new RegExp(`Synthetic ${failure} failure`));
    assert.equal(boundary.anchors[0].connected, false);
    assert.deepEqual(boundary.revoked, boundary.created);
    assert.equal(boundary.timers.filter(timer => timer.delay === 60000).length, 0);
    await assert.rejects(fetch(boundary.created[0]));
  });

  test(`${name}: negative control detects immediate disposal instead of accepting captured Blob contents`, async t => {
    const boundary = downloadBoundary({ immediateRelease: true }); t.after(() => boundary.cleanup());
    const exporter = createExport(boundary);
    await exporter.trigger(); await later();
    await assert.rejects(fetch(boundary.clicks[0].url));
  });
}
