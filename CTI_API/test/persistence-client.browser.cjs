'use strict';

// Opt-in real Chromium regression. No production functions, fetch, EventSource,
// export or DOM methods are replaced. See the remediation note for invocation.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { test, before, after } = require('node:test');
const { fixture, eventually } = require('./helpers/fixture.cjs');
const { isolatedBrowser } = require('./helpers/browser-isolation.cjs');
const { chromium } = require(process.env.CTI_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(process.env.CTI_BROWSER_EVIDENCE || path.join(root, 'output/playwright/retest7-fix/cti/browser'));
const preload = [path.join(__dirname, 'helpers/history-partial-io.cjs')];
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex');
const sources = ['CTI_API/src/server.js', 'CTI_API/public/app.js', 'CTI_API/public/index.html'];
const initialHashes = Object.fromEntries(sources.map(file => [file, hash(file)]));
const identity = row => JSON.stringify([row.account || '', row.uuid, row.state, row.updated || row.receivedAt || '']);
const identities = rows => rows.map(identity).sort();
const event = (uuid, state = 'hangup', second = 0) => ({ uuid, state, extension: '21', direction: 'inbound', caller: '+49305550101', callee: '21', updated: `2026-10-24T10:00:${String(second).padStart(2, '0')}Z` });
const marker = (f, name) => path.join(f.dir, 'data/.' + name);
const mark = (f, name, value = 'test') => fs.writeFileSync(marker(f, name), value);
const clear = (f, name) => fs.rmSync(marker(f, name), { force: true });
const records = f => {
  const file = path.join(f.dir, 'data/call-events.jsonl');
  const raw = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const rows = [], invalid = [];
  for (const line of raw.split('\n').filter(Boolean)) { try { rows.push(JSON.parse(line)); } catch { invalid.push(line); } }
  return { raw, rows, invalid };
};
let isolated;
const report = { runtime: process.version, sourceHashesBefore: initialHashes, cases: [], browserErrors: [] };

before(async () => {
  fs.mkdirSync(out, { recursive: true });
  isolated = await isolatedBrowser(chromium, process.env.CTI_BROWSER_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  report.browser = isolated.browser.version();
});
after(async () => {
  report.sourceHashesAfter = Object.fromEntries(sources.map(file => [file, hash(file)]));
  report.sourceUnchanged = JSON.stringify(initialHashes) === JSON.stringify(report.sourceHashesAfter);
  if (isolated) {
    report.routeDenials = isolated.routeDenials;
    report.proxyDenials = isolated.proxyDenials;
    await isolated.close();
  }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  assert.equal(report.sourceUnchanged, true, 'browser tests never modify production source');
  assert.deepEqual(report.browserErrors, [], 'no client JavaScript errors');
  assert.deepEqual(report.routeDenials || [], [], 'no application egress attempts');
});

async function open(context, f) {
  const page = await context.newPage();
  page.on('pageerror', error => report.browserErrors.push(error.message));
  await page.goto(f.base + '/analytics.html?lang=en', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof eventSource !== 'undefined' && eventSource?.readyState === 1 && state.status?.account === 'K1');
  return page;
}
async function downloads(page, name) {
  const result = {};
  for (const [format, selector] of [['csv', '#export-csv'], ['xls', '#export-excel']]) {
    const pending = page.waitForEvent('download');
    await page.locator(selector).click();
    const download = await pending;
    const file = path.join(out, name + '.' + format);
    await download.saveAs(file);
    result[format] = fs.readFileSync(file, 'utf8');
  }
  const csvRows = result.csv.replace(/^\uFEFF/, '').split('\n').slice(1).filter(Boolean).map(line => {
    const cells = [...line.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map(match => match[1].replaceAll('""', '"'));
    return { uuid: cells[8], events: Number(cells[7]) };
  });
  const xlsRows = await page.evaluate(html => {
    const document = new DOMParser().parseFromString(html, 'text/html');
    return [...document.querySelectorAll('tbody tr')].map(row => ({ uuid: row.cells[8].textContent, events: Number(row.cells[7].textContent) }));
  }, result.xls);
  return { csvRows, xlsRows };
}
async function capture(page, f, name) {
  const backup = (await f.get('/api/storage/backup')).body.data.callEvents;
  const server = (await f.get('/api/history')).body;
  const browser = await page.evaluate(() => ({ history: state.history, active: state.activeCalls, rendered: [...document.querySelectorAll('#history-body [data-session-id]')].map(row => row.dataset.sessionId), connection: document.getElementById('connection-state').textContent }));
  return { browser, server, backup, disk: records(f), downloads: await downloads(page, name) };
}
function compare(result, expected, errors, stage, { allowInvalid = false } = {}) {
  const expectedRows = expected.map(row => ({ ...row, account: 'K1' }));
  const sessions = [...new Set(expectedRows.map(row => row.uuid))].sort();
  const exportRows = sessions.map(uuid => ({ uuid, events: expectedRows.filter(row => row.uuid === uuid).length }));
  const check = (name, actual, wanted) => {
    try { assert.deepEqual(actual, wanted, stage + ': ' + name); }
    catch (error) { errors.push({ stage, check: name, actual, expected: wanted, message: error.message }); }
  };
  for (const [label, rows] of [['browser history', result.browser.history], ['server history', result.server], ['backup', result.backup], ['disk', result.disk.rows]]) check(label, identities(rows), identities(expectedRows));
  check('rendered history', result.browser.rendered.sort(), sessions);
  check('CSV download', result.downloads.csvRows.sort((a,b) => a.uuid.localeCompare(b.uuid)), exportRows);
  check('XLS download', result.downloads.xlsRows.sort((a,b) => a.uuid.localeCompare(b.uuid)), exportRows);
  if (!allowInvalid) check('valid JSONL', result.disk.invalid, []);
}

for (const mode of ['healthy', 'before-byte', 'partial', 'complete', 'complete-no-lf']) {
  test(`R7-CTI-01 connected browser history and CSV/XLS match disk after ${mode} append, recovery and reload`, async t => {
    const f = await fixture(t, { credentials: true, publicFiles: true, preload });
    await f.start(); await eventually(() => f.mock.streams.size === 2);
    const context = await isolated.context(f.base); t.after(() => context.close());
    const page = await open(context, f);
    const call = event('client-' + mode);
    const row = { name: mode, stages: {}, errors: [] }; report.cases.push(row);
    if (mode === 'before-byte') mark(f, 'fail-append');
    else if (mode !== 'healthy') mark(f, 'partial-append', mode);
    f.send('one', 'calls', call);
    await page.waitForFunction(uuid => state.events.some(item => item.uuid === uuid), call.uuid);
    if (mode !== 'healthy') await eventually(() => f.logs().includes(mode === 'before-byte' ? 'Synthetic history I/O failure' : 'Synthetic ENOSPC after actual history append'));
    else await eventually(async () => (await f.get('/api/storage/backup')).body.data.callEvents.length === 1);
    // Allow a compensating SSE frame to arrive after the completed persistence queue.
    await f.get('/api/storage/backup'); await page.waitForTimeout(120);
    const expected = ['before-byte', 'partial'].includes(mode) ? [] : [call];
    row.stages.settled = await capture(page, f, mode + '-settled');
    compare(row.stages.settled, expected, row.errors, 'settled', { allowInvalid: mode === 'partial' });
    if (mode !== 'healthy' && mode !== 'before-byte') {
      row.nativeWrite = JSON.parse(fs.readFileSync(marker(f, 'wrote-partial'), 'utf8'));
      assert.ok(row.nativeWrite.bytesWritten > 0, 'fault is injected after actual native append bytes');
      if (mode === 'partial') assert.ok(row.nativeWrite.bytesWritten < row.nativeWrite.attemptedBytes);
      if (mode === 'complete') assert.equal(row.nativeWrite.bytesWritten, row.nativeWrite.attemptedBytes);
      if (mode === 'complete-no-lf') assert.equal(row.nativeWrite.bytesWritten, row.nativeWrite.attemptedBytes - 1);
    }
    await page.screenshot({ path: path.join(out, mode + '-settled.png') });
    const fresh = await open(context, f);
    row.stages.fresh = await capture(fresh, f, mode + '-fresh');
    compare(row.stages.fresh, expected, row.errors, 'fresh', { allowInvalid: mode === 'partial' });
    await fresh.close();
    // Retry on the already connected original page, before any manual refresh.
    f.send('one', 'calls', call);
    await eventually(async () => (await f.get('/api/storage/backup')).body.data.callEvents.length === 1);
    const next = event('after-' + mode, 'hangup', 1);
    f.send('one', 'calls', next);
    await eventually(async () => (await f.get('/api/storage/backup')).body.data.callEvents.length === 2);
    await page.waitForFunction(uuid => state.history.some(row => row.uuid === uuid), next.uuid);
    row.stages.recovery = await capture(page, f, mode + '-recovery');
    compare(row.stages.recovery, [call, next], row.errors, 'recovery');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => eventSource?.readyState === 1 && state.history.length === 2);
    row.stages.reload = await capture(page, f, mode + '-reload');
    compare(row.stages.reload, [call, next], row.errors, 'reload');
    await page.close(); await f.stop(); await f.start();
    const restarted = await open(context, f);
    row.stages.restart = await capture(restarted, f, mode + '-restart');
    compare(row.stages.restart, [call, next], row.errors, 'restart');
    row.serverLog = f.logs(); row.pass = row.errors.length === 0;
    assert.deepEqual(row.errors, [], 'all connected history/export/durable observations agree');
  });
}

for (const fail of [false, true]) {
  test(`R7-CTI-01 active calls remain realtime while append is held${fail ? ' and fails' : ' (healthy control)'}`, async t => {
    const f = await fixture(t, { credentials: true, publicFiles: true, preload });
    await f.start(); await eventually(() => f.mock.streams.size === 2);
    const context = await isolated.context(f.base); t.after(() => context.close());
    const page = await open(context, f);
    const row = { name: fail ? 'held-failure' : 'held-healthy', stages: {}, errors: [] }; report.cases.push(row);
    const ring = event(row.name, 'ring', 2), hangup = event(row.name, 'hangup', 3);
    mark(f, 'hold-append'); if (fail) mark(f, 'fail-append');
    f.send('one', 'calls', ring);
    await eventually(() => fs.existsSync(marker(f, 'entered-append')));
    await page.waitForFunction(uuid => state.activeCalls.some(call => call.uuid === uuid), ring.uuid, { timeout: 1500 });
    assert.equal(records(f).rows.length, 0, 'ring reaches active call UI before history I/O completes');
    const fresh = await open(context, f);
    row.stages.pending = {
      connected: await page.evaluate(() => state.history), fresh: await fresh.evaluate(() => state.history),
      history: (await f.get('/api/history')).body, snapshot: (await f.get('/api/snapshot')).body.history,
      downloads: await downloads(page, row.name + '-pending'),
    };
    await fresh.close();
    f.send('one', 'calls', hangup);
    await page.waitForFunction(uuid => !state.activeCalls.some(call => call.uuid === uuid), ring.uuid, { timeout: 1500 });
    assert.equal(fs.existsSync(marker(f, 'hold-append')), true, 'hangup also reaches active call UI while append is held');
    clear(f, 'hold-append');
    const expected = fail ? [hangup] : [ring, hangup];
    await eventually(async () => (await f.get('/api/storage/backup')).body.data.callEvents.length === expected.length);
    await page.waitForTimeout(120);
    row.stages.settled = await capture(page, f, row.name + '-settled');
    compare(row.stages.settled, expected, row.errors, 'settled');
    for (const [surface, values] of Object.entries(row.stages.pending)) {
      const wanted = surface === 'downloads' ? { csvRows: [], xlsRows: [] } : [];
      try { assert.deepEqual(values, wanted, 'pending history: ' + surface); }
      catch (error) { row.errors.push({ stage: 'pending', check: surface, actual: values, expected: wanted, message: error.message }); }
    }
    row.pass = row.errors.length === 0;
    assert.deepEqual(row.errors, [], 'history/export reconcile without delaying realtime telephony');
  });
}
