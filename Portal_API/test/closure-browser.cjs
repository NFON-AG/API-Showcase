'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn, execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');

// Retained audit flows now serve as durable browser regressions. Provider traffic is loopback-only.
assert(process.env.PLAYWRIGHT_MODULE_PATH, 'Set PLAYWRIGHT_MODULE_PATH to an installed Playwright module.');
const root = path.resolve(process.env.NFON_AUDIT_SOURCE || path.join(__dirname, '../..'));
const out = path.resolve(process.env.PORTAL_AUDIT_OUTPUT || path.join(root, 'output/playwright/closure-portal-browser'));
const chrome = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH);
const { isolatedBrowser } = require(path.join(root, 'CTI_API/test/helpers/browser-isolation.cjs'));
const source = path.join(root, 'Portal_API');
const providerScript = path.join(source, 'test/helpers/provider.mjs');
const guard = path.join(source, 'test/helpers/egress.cjs');
const mockKey = 'retest-portal-key';
const mockSecret = 'example-portal-secret';
const filter = process.argv.length > 2 ? process.argv.slice(2) : ['P-A1-direct-apply','P-A2-stale-tab-cross-account','P-A3-ivr-draft-after-reload','P-A4-timecontrol-readback','P-A13-provider-hangup-translation','P-A14-nested-ivr-readback','P-A15-header-contained','P-A16-provider-conflict'];
const report = { cases: [] };
let harness;
fs.mkdirSync(out, { recursive: true });
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const digest = data => createHash('sha256').update(data).digest('hex');

async function fixture(clean, options = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'nfon-portal-independent-'));
  clean.push(() => fs.rmSync(scratch, { recursive: true, force: true }));
  function service(args, extraEnv) {
    const child = spawn(process.execPath, args, {
      cwd: source, env: { PATH: process.env.PATH, HOME: scratch, TMPDIR: scratch, ...extraEnv },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', data => { output += data; });
    child.stderr.on('data', data => { output += data; });
    child.on('error', error => { output += error.message; });
    clean.push(async () => {
      if (child.exitCode === null && child.signalCode === null && child.pid) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
    });
    return async pattern => {
      for (let step = 0; step < 250; step++) {
        const match = output.match(pattern);
        if (match) return match;
        if (child.exitCode !== null || child.signalCode !== null) break;
        await pause(20);
      }
      throw Error('Test process did not start: ' + output);
    };
  }
  const provider = service(['--require', guard, providerScript, '0'], { TEST_PROVIDER_PORT: '0', MOCK_SECRET: mockSecret });
  const [, mockPort] = await provider(/MOCK_PORT=(\d+)/);
  const upstream = 'http://127.0.0.1:' + mockPort;
  async function control(route, body) {
    const response = await fetch(upstream + '/__mock/' + route, body === undefined ? {} : {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    assert(response.ok, 'Synthetic provider control ' + route + ' returned ' + response.status);
    return response.json();
  }
  await control('config', { customers: 3, dids: 4, userTimeControl: false, ...options.provider });
  const reservation = http.createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  const app = service(['--require', guard, 'src/server.js'], {
    HOST: '127.0.0.1', PORT: String(port), TEST_PROVIDER_PORT: mockPort,
    NFON_SHOWCASE_CONFIG_DIR: path.join(scratch, 'config'),
    Portal_API_ENV_FILE: path.join(scratch, 'absent-env'),
    PORTAL_DATA_DIR: path.join(scratch, 'data'),
    PORTAL_SECRET_FILE: path.join(scratch, 'absent-portal'), NFON_SECRET_FILE: path.join(scratch, 'absent-nfon'),
    PORTAL_BASE_URL: upstream, PORTAL_API_KEY_ID: mockKey, PORTAL_API_KEY_SECRET: mockSecret,
    PORTAL_CUSTOMER_ACCOUNT: 'K9001', PORTAL_ENABLE_LIVE_WRITES: 'true', ...options.env,
  });
  await app(/Portal API Showcase listening/);
  const origin = 'http://127.0.0.1:' + port;
  const api = async route => (await fetch(origin + route)).json();
  const readSettings = async () => {
    const { account, liveWritesEnabled, liveWritesLocked, liveWritesPermitted } = (await api('/api/status')).settings;
    return { account, liveWritesEnabled, liveWritesLocked, liveWritesPermitted };
  };
  const writes = async () => (await control('writes')).map(({ method, path, body, sigOk }) => ({ method, path, body: JSON.parse(body || '{}'), sigOk }));
  const asset = await (await fetch(origin + '/app.js')).arrayBuffer();
  assert.equal(digest(Buffer.from(asset)), digest(fs.readFileSync(path.join(source, 'public/app.js'))));
  return { origin, upstream, control, api, readSettings, writes };
}
async function shot(p, name) { await p.screenshot({ path: path.join(out, name + '.png'), fullPage: true }); }
function visibleNodes(p) {
  return p.locator('#callflow-canvas .flow-node').evaluateAll(nodes => nodes.map(node => ({
    id: node.dataset.nodeId, title: node.querySelector('.node-title')?.textContent.trim(), selected: node.classList.contains('is-selected'),
  })));
}
async function openPage(context, entry, result) {
  const p = await context.newPage();
  p.setDefaultTimeout(7500);
  p.on('pageerror', error => { (result.errors ||= []).push(error.message); });
  await p.goto(entry);
  await p.waitForLoadState('networkidle');
  return p;
}
async function closeInspector(p) {
  const close = p.locator('#close-flow-helper');
  if (await close.isVisible()) await close.click();
}
async function connect(p, node) {
  await closeInspector(p);
  await p.locator('[data-node-dock="inbound"]').press('Enter');
  await p.locator('#flow-connect-target').selectOption(node);
  await closeInspector(p);
}
async function addPalette(p, menu, title, { remove = true, link = true } = {}) {
  if (remove) await p.locator('[data-node-delete="target"]').click();
  await p.locator('[data-flow-menu="' + menu + '"]').click();
  const section = p.locator('[data-flow-menu-content="' + menu + '"]');
  if (menu === 'extensions' && /^\d+$/.test(title)) {
    await p.waitForFunction(() => document.activeElement.id === 'flow-extension-filter');
    await section.locator('#flow-extension-filter').fill(title);
  }
  await section.locator('[data-flow-palette-target]').filter({ hasText: title }).first().press('Enter');
  await p.waitForFunction(() => state.selectedNodeId && state.selectedNodeId !== 'target');
  const id = await p.evaluate(() => state.selectedNodeId);
  if (await p.locator('#flow-menu-panel').isVisible()) await p.locator('#toggle-did-rail').click();
  if (link) await connect(p, id);
  return id;
}
async function switchWrites(p, enabled) {
  await p.locator('[data-view="changes"]').click();
  const button = p.locator('[data-live-writes]');
  if ((await button.getAttribute('aria-pressed')) !== String(enabled)) {
    await button.press('Space');
    await p.locator('[data-live-writes][aria-pressed="' + enabled + '"]').waitFor();
  }
  await p.locator('[data-view="callflow"]').click();
}
async function apply(p, confirm = true, screenshot) {
  await p.locator('#stage-flow').click();
  const dialog = p.locator('#app-dialog-modal.is-open');
  await dialog.waitFor();
  const before = await p.locator('#app-dialog-title').innerText();
  const beforeMessage = await p.locator('#app-dialog-message').innerText();
  if (screenshot) await shot(p, screenshot);
  let httpStatus, body;
  if (confirm && /Apply callflow|Callflow übernehmen/i.test(before)) {
    const wait = p.waitForResponse(response => response.url().endsWith('/api/callflow/apply') && response.request().method() === 'POST');
    await p.locator('#app-dialog-confirm').click();
    const response = await wait;
    httpStatus = response.status();
    body = await response.json();
    await p.waitForFunction(() => !/applying callflow|callflow wird/i.test(document.querySelector('#app-dialog-title').textContent));
    if (body?.applied) { await p.locator('#action-notice').waitFor(); assert.equal(await dialog.count(),0); }
    else await dialog.waitFor();
  }
  const after = await p.locator('#app-dialog-title').innerText();
  const message = await p.locator('#app-dialog-message').innerText();
  return { before, beforeMessage, after, message, httpStatus, applied: body?.applied, target: body?.target,
    attempts: body?.attempts?.map(({ action, status, ignored, method }) => ({ action, status, ignored, method })) };
}
async function dismiss(p) { if (await p.locator('#app-dialog-modal.is-open').count()) await p.locator('#app-dialog-confirm').click(); }
async function selectDid(p, index) {
  await p.locator('#flow-did-selector').click();
  await p.locator('#flow-did-menu [data-did-id]').nth(index).click();
}
async function choose(p, selector, title) {
  const options = await p.locator(selector + ' option').evaluateAll(entries => entries.map(option => ({ text: option.textContent, value: option.value })));
  const item = options.find(option => option.value && option.text.includes(title));
  assert(item, 'Missing option ' + title + ' in ' + selector + ': ' + options.map(option => option.text).join(', '));
  await p.locator(selector).selectOption(item.value);
}
async function newResource(p, type, title) {
  await p.locator('[data-node-delete="target"]').click();
  await p.locator('[data-flow-empty-step]').press('Enter');
  const id = await p.evaluate(() => state.selectedNodeId);
  await p.locator('[data-node-edit="' + id + '"]').click();
  if (type === 'ANNOUNCEMENT') await p.locator('[data-node-field="type"]').selectOption('QUEUE');
  await p.locator('[data-node-field="type"]').selectOption(type);
  await p.locator('[data-node-field="title"]').fill(title);
  await p.locator('[data-node-field="title"]').blur();
  return id;
}
async function scenario(name, fn, options = {}) {
  if (filter.length && !filter.includes(name)) return;
  const clean = [];
  const result = { name };
  report.cases.push(result);
  try {
    const app = options.file ? null : await fixture(clean, options);
    const context = await harness.context(options.file ? 'null' : app.origin);
    clean.push(() => context.close());
    const url = options.file ? pathToFileURL(path.join(root, 'docs/portal/index.html')).href : app.origin + '/';
    const p = await openPage(context, url + '?theme=' + (options.theme || 'admin-portal') + '&lang=' + (options.lang || 'en') + '#callflow', result);
    await p.locator('[data-node-id="inbound"]').waitFor();
    try { await fn({ app, context, p, result }); }
    finally { await shot(p, name).catch(() => {}); }
    assert.deepEqual(result.errors || [], []);
    result.status = 'PASS';
  } catch (error) {
    result.status = 'FAIL';
    result.error = error.stack;
  } finally {
    for (const release of clean.reverse()) await release();
    console.log(result.status, name, result.error?.split('\n')[0] || '');
  }
}

async function routingCases() {
  await scenario('P-A1-direct-apply', async ({ app, p, result }) => {
    assert.equal((await app.readSettings()).liveWritesEnabled, false);
    const initial = (await app.control('state')).dids;
    await addPalette(p, 'extensions', '239');
    result.readOnly = await apply(p);
    assert.match(result.readOnly.after, /Live writes disabled/);
    assert.deepEqual(await app.writes(), []);
    await dismiss(p);
    await switchWrites(p, true);
    await p.locator('#callflow-canvas').click({ position: { x: 10, y: 10 } });
    result.applied = await apply(p);
    assert.equal(result.applied.httpStatus, 200);
    assert.equal(result.applied.applied, true);
    result.writes = await app.writes();
    assert.equal(result.writes.length, 1);
    assert.equal(result.writes[0].sigOk, true);
    result.after = (await app.control('state')).dids;
    assert.equal(result.after[0].dest.ext, '239');
    assert.deepEqual(result.after.slice(1), initial.slice(1));
    await dismiss(p);
    await p.reload();
    await p.waitForLoadState('networkidle');
    assert((await visibleNodes(p)).some(node => node.title === 'Ext 39'));
  });
  await scenario('P-A2-stale-tab-cross-account', async ({ app, context, p, result }) => {
    await switchWrites(p, true);
    await addPalette(p, 'extensions', '239');
    result.accountA = await app.readSettings();
    result.tabA = await p.locator('.settings-account-row strong').innerText();
    await shot(p, 'P-A2-account-a-prepared');
    const second = await openPage(context, app.origin + '/?theme=classic&lang=en#changes', result);
    await second.locator('[data-auth-login-mode="browser"]').click();
    const form = second.locator('#browser-login-form');
    await form.locator('[name="baseUrl"]').fill(app.upstream);
    await form.locator('[name="apiKeyId"]').fill(mockKey);
    await form.locator('[name="apiKeySecret"]').fill(mockSecret);
    await form.locator('[name="customerAccount"]').fill('K9002');
    await form.locator('[type="submit"]').click();
    await second.locator('.settings-account-row strong').filter({ hasText: 'K9002' }).waitFor();
    result.afterLogin = await app.readSettings();
    assert.equal(result.afterLogin.liveWritesEnabled, false);
    result.readonly = await apply(p);
    // Session binding rejects the stale tab even before the live-write opt-in guard.
    assert([403, 409, 423].includes(result.readonly.httpStatus));
    await dismiss(p);
    assert.deepEqual(await app.writes(), []);
    await switchWrites(second, true);
    result.accountB = await app.readSettings();
    assert.equal(result.accountB.account, 'K9002');
    assert.equal(result.accountB.liveWritesEnabled, true);
    result.before = { A: (await app.control('state?account=K9001')).dids[0], B: (await app.control('state?account=K9002')).dids[0] };
    result.tabABeforeApply = await p.locator('.settings-account-row strong').innerText();
    result.applied = await apply(p, true, 'P-A2-account-a-stale-confirm');
    result.after = { A: (await app.control('state?account=K9001')).dids[0], B: (await app.control('state?account=K9002')).dids[0] };
    result.writes = await app.writes();
    await shot(p, 'P-A2-account-a-apply-result');
    assert.deepEqual(result.after, result.before, 'A stale draft from account A changed provider state after account B opted in.');
    assert.deepEqual(result.writes, []);
  });
  await scenario('P-A3-ivr-draft-after-reload', async ({ app, p, result }) => {
    await app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/ivr-services/1' } });
    await p.reload();
    await p.waitForLoadState('networkidle');
    result.initial = await visibleNodes(p);
    assert(result.initial.some(node => node.title === 'IVR 0'));
    await addPalette(p, 'extensions', '239');
    result.edited = await visibleNodes(p);
    assert(result.edited.some(node => node.title === 'Ext 39'));
    await selectDid(p, 1);
    await selectDid(p, 0);
    result.returned = await visibleNodes(p);
    assert(result.returned.some(node => node.title === 'Ext 39'));
    await shot(p, 'P-A3-before-reload');
    await p.reload();
    await p.waitForLoadState('networkidle');
    result.reloaded = await visibleNodes(p);
    result.stored = await p.evaluate(() => Object.entries(readStoredFlowDrafts()).map(([key, value]) => ({
      key, titles: value.flow.nodes.map(node => node.title), updatedAt: value.updatedAt,
    })));
    result.writes = await app.writes();
    assert.deepEqual(result.writes, []);
    assert(result.reloaded.some(node => node.title === 'Ext 39'), 'The stored draft disappears from the canvas after reloading a DID whose provider route is IVR.');
  });
  await scenario('P-A16-provider-conflict', async ({ app, p, result }) => {
    await app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/ivr-services/1' } });
    await p.reload(); await p.waitForLoadState('networkidle');
    await addPalette(p, 'extensions', '239');
    await app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/phone-extensions/238' } });
    await p.reload(); await p.waitForLoadState('networkidle');
    result.nodes = await visibleNodes(p);
    assert(result.nodes.some(node => node.title === 'Ext 39'), 'Provider change must retain local work.');
    assert.match(await p.locator('#flow-feedback').innerText(), /Provider routing changed/);
    result.blocked = await apply(p);
    assert.match(result.blocked.message, /Provider routing changed/);
    assert.deepEqual(await app.writes(), []);
    await dismiss(p);
    await p.locator('#clear-flow-draft').click();
    result.resolved = await visibleNodes(p);
    assert(result.resolved.some(node => node.title === 'Ext 38'));
    assert(!result.resolved.some(node => node.title === 'Ext 39'));
    assert.deepEqual(await app.writes(), []);
  });
  await scenario('P-A4-timecontrol-readback', async ({ app, p, result }) => {
    await app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/time-control-services/0' } });
    await p.reload();
    await p.waitForLoadState('networkidle');
    const overview = await app.api('/api/overview');
    result.liveControl = overview.inventory.timeControls.find(service => String(service.serviceNumber) === '0');
    result.nodes = await visibleNodes(p);
    result.labels = await p.locator('#callflow-canvas [data-branch-label], #callflow-canvas svg text').allTextContents();
    assert(result.liveControl?.dayTargetHref?.includes('/phone-extensions/200'));
    assert(result.liveControl?.nightTargetHref?.includes('/HANGUP'));
    assert(result.nodes.some(node => node.title === 'Ext 0'), 'Fresh canvas omits the existing time control provider’s inside target.');
    assert(result.nodes.some(node => /hang up/i.test(node.title)), 'Fresh canvas omits the existing time control provider’s outside target.');
  });
  await scenario('P-A5-undo-did-and-member', async ({ app, p, result }) => {
    const initial = (await visibleNodes(p)).map(node => node.title);
    const id = await addPalette(p, 'queues', 'Queue 0', { remove: false, link: false });
    await p.locator('[data-node-members-toggle="' + id + '"]').click();
    const member = p.locator('#callflow-canvas [data-member-key="200"]');
    await member.waitFor();
    const memberId = await member.getAttribute('data-node-id');
    await p.locator('[data-node-delete="' + memberId + '"]').click();
    assert.equal(await member.count(), 0);
    await p.locator('#undo-flow-change').click();
    await member.waitFor();
    await selectDid(p, 1);
    assert(!(await visibleNodes(p)).some(node => node.title === 'Queue 0'));
    await selectDid(p, 0);
    assert((await visibleNodes(p)).some(node => node.title === 'Queue 0'));
    assert(await p.locator('#undo-flow-change').isEnabled());
    await p.locator('#undo-flow-change').click();
    assert.deepEqual((await visibleNodes(p)).map(node => node.title), initial);
    result.writes = await app.writes();
    assert.deepEqual(result.writes, []);
  });
}
async function stateInBrowser(p) {
  return p.evaluate(() => JSON.stringify({ draft: state.flow, selected: state.selectedNodeId, selectedIds: state.selectedNodeIds,
    expanded: state.expandedServiceNodeIds, zoom: state.flowZoom,
    scroll: [document.querySelector('#callflow-canvas').scrollLeft, document.querySelector('#callflow-canvas').scrollTop] }));
}
async function pdf(p, name) {
  const before = await stateInBrowser(p);
  const [download] = await Promise.all([p.waitForEvent('download', { timeout: 12000 }), p.locator('#export-flow-pdf').click()]);
  const file = path.join(out, name + '.pdf');
  await download.saveAs(file);
  const bytes = fs.readFileSync(file);
  assert.match(download.suggestedFilename(), /^callflow-.*\.pdf$/);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.equal(await stateInBrowser(p), before, 'PDF changed the draft, selected node, expansion, zoom or scroll.');
  const text = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
  const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  const pages = Number(info.match(/^Pages:\s+(\d+)/m)?.[1]);
  const svgFile = path.join(out, name + '-page-1.svg');
  execFileSync('pdftocairo', ['-svg', '-f', '1', '-l', '1', file, svgFile]);
  const svg = fs.readFileSync(svgFile, 'utf8');
  const paths = [...svg.matchAll(/<path\b[^>]+>/g)].map(match => match[0]);
  const arrows = paths.filter(tag => /fill-rule="nonzero"/.test(tag) && !tag.includes('stroke-width') && /\bd="M [^MLCZ]+ L [^MLCZ]+ L [^MLCZ]+ Z/.test(tag)).length;
  execFileSync('pdftoppm', ['-scale-to', '1500', '-png', file, path.join(out, name)]);
  fs.writeFileSync(path.join(out, name + '.txt'), text);
  assert(pages >= 1);
  assert(!/Delete local draft|Show targets|Hide targets/.test(text));
  return { file: path.basename(file), pages, bytes: bytes.length, sha256: digest(bytes), arrows, text };
}
async function pdfCases() {
  await scenario('P-A6-pdf-simple-repeat', async ({ app, p, result }) => {
    await p.locator('#zoom-in').click();
    await p.locator('[data-node-edit="target"]').click();
    result.first = await pdf(p, 'http-simple');
    result.second = await pdf(p, 'http-repeat');
    assert.equal(result.first.pages, 1);
    assert.equal(result.second.text, result.first.text);
    assert(result.first.arrows >= 1);
    assert.match(result.first.text, /Incoming call/);
    assert.match(result.first.text, /Ext 0/);
    assert.deepEqual(await app.writes(), []);
  });
  await scenario('P-A7-pdf-file-de-classic', async ({ p, result }) => {
    result.pdf = await pdf(p, 'file-classic-de');
    assert.match(result.pdf.text, /Eingehender Anruf|Eingehend/);
    assert(result.pdf.arrows >= 1);
  }, { file: true, theme: 'classic', lang: 'de' });
  await scenario('P-A8-pdf-large-queue-collapsed', async ({ app, p, result }) => {
    await addPalette(p, 'queues', 'Queue 0');
    assert.equal(await p.locator('#callflow-canvas [data-member-key]').count(), 0);
    result.pdf = await pdf(p, 'large-queue-collapsed');
    assert(result.pdf.pages > 1);
    for (let i = 0; i < 36; i++) assert(result.pdf.text.includes('(' + (200 + i) + ')'));
    assert.deepEqual(await app.writes(), []);
  }, { provider: { queueMembers: 36 } });
  await scenario('P-A9-pdf-ivr-branches-long-name', async ({ app, p, result }) => {
    const long = 'Łukáš Šťastný · François Müller · João Marques · Technische Kundenbetreuung für mehrsprachige Geschäftskunden';
    const id = await newResource(p, 'IVR', long);
    await choose(p, '[data-node-config-field="announcement"]', 'Announcement 0');
    await choose(p, '[data-node-target-config="key1Target"]', '239');
    await choose(p, '[data-node-target-config="key2Target"]', '238');
    await choose(p, '[data-node-target-config="timeoutTarget"]', 'Hang up');
    await connect(p, id);
    result.pdf = await pdf(p, 'ivr-branches-long-name');
    for (const value of ['Łukáš Šťastný', 'Geschäftskunden', 'Key 1', 'Key 2', 'Timeout', 'Ext 39', 'Ext 38']) assert(result.pdf.text.toLowerCase().includes(value.toLowerCase()), value);
    assert(result.pdf.arrows >= 4);
    assert.deepEqual(await app.writes(), []);
  });
  await scenario('P-A10-pdf-error-retry', async ({ p, result }) => {
    const id = await newResource(p, 'QUEUE', 'Example 😀');
    await connect(p, id);
    let downloads = 0;
    p.on('download', () => downloads++);
    await p.locator('#export-flow-pdf').click();
    await p.locator('#app-dialog-modal.is-open').waitFor();
    result.message = await p.locator('#app-dialog-message').innerText();
    assert.match(result.message, /characters are not supported/i);
    assert.equal(downloads, 0);
    assert(await p.locator('#export-flow-pdf').isEnabled());
    await shot(p, 'P-A10-pdf-error');
    await dismiss(p);
    await p.locator('[data-node-edit="' + id + '"]').click();
    await p.locator('[data-node-field="title"]').fill('Example Müller');
    await p.locator('[data-node-field="title"]').blur();
    result.pdf = await pdf(p, 'error-recovery');
    assert.match(result.pdf.text, /Example Müller/);
  });
}
async function extraCases() {
  await scenario('P-A11-partial-apply-rollback-and-retry', async ({ app, p, result }) => {
    const initial = await app.control('state');
    await switchWrites(p, true);
    const id = await newResource(p, 'QUEUE', 'Recovery Queue');
    await connect(p, id);
    result.rejected = await apply(p);
    result.failedWrites = await app.writes();
    const afterFailure = await app.control('state');
    result.afterFailure = { queues: afterFailure.queues, did: afterFailure.dids[0] };
    assert.notEqual(result.rejected.httpStatus, 200);
    assert.equal(result.rejected.applied, false);
    assert.deepEqual(result.failedWrites.map(write => write.method), ['POST', 'PUT', 'DELETE']);
    assert.deepEqual(afterFailure.queues, initial.queues);
    assert.deepEqual(afterFailure.dids, initial.dids);
    assert((await visibleNodes(p)).some(node => node.title === 'Recovery Queue'));
    await shot(p, 'P-A11-provider-failure');
    await dismiss(p);
    await app.control('clearlog');
    result.retried = await apply(p);
    result.retryWrites = await app.writes();
    const finalState = await app.control('state');
    result.afterRetry = { queues: finalState.queues, did: finalState.dids[0] };
    assert.equal(result.retried.httpStatus, 200);
    assert.equal(result.retried.applied, true);
    assert.equal(finalState.queues.length, initial.queues.length + 1);
    assert.equal(finalState.dids[0].dest.type, 'QUEUE');
    assert.equal(finalState.dids[0].dest.name, 'Recovery Queue');
  }, { provider: { writeFail: { path: '/destination$', method: 'PUT', nth: 1, status: 500 } } });
  await scenario('P-A12-template-language-controls', async ({ app, p, result }) => {
    const catalog = JSON.parse(fs.readFileSync(path.join(source, 'i18n-messages.json')));
    const langIds = await p.locator('#language-menu [data-language]').evaluateAll(nodes => nodes.map(node => node.dataset.language));
    assert.equal(langIds.length, 12);
    const id = await newResource(p, 'TIMECONTROL', '');
    await p.locator('#undo-flow-change').click();
    await p.locator('[data-node-edit="' + id + '"]').click();
    result.values = {};
    for (const lang of langIds) {
      await p.locator('#language-trigger').click();
      await p.locator('#language-menu [data-language="' + lang + '"]').click();
      const title = await p.locator('[data-node-field="title"]').inputValue();
      const hours = await p.locator('[data-node-config-field="hours"]').inputValue();
      result.values[lang] = { title, hours };
      assert.equal(title, catalog['portal.businessHours'][lang]);
      assert.equal(hours, 'Mon-Fri 08:00-17:00');
    }
    await p.locator('[data-node-field="title"]').fill('Business hours');
    await p.locator('[data-node-field="title"]').blur();
    await p.locator('[data-node-config-field="hours"]').fill('Tue 09:15-11:00');
    await p.locator('[data-node-config-field="hours"]').blur();
    await p.locator('#language-trigger').click();
    await p.locator('#language-menu [data-language="de"]').click();
    result.afterEdits = {
      title: await p.locator('[data-node-field="title"]').inputValue(),
      hours: await p.locator('[data-node-config-field="hours"]').inputValue(),
    };
    assert.deepEqual(result.afterEdits, { title: 'Business hours', hours: 'Tue 09:15-11:00' });
    assert.deepEqual(await app.writes(), []);
  });
  await scenario('P-A13-provider-hangup-translation', async ({ app, p, result }) => {
    const catalog = JSON.parse(fs.readFileSync(path.join(source, 'i18n-messages.json')));
    const langIds = await p.locator('#language-menu [data-language]').evaluateAll(nodes => nodes.map(node => node.dataset.language));
    await app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/ivr-services/1' } });
    await p.reload();
    await p.waitForLoadState('networkidle');
    result.labels = {};
    for (const lang of langIds) {
      await p.locator('#language-trigger').click();
      await p.locator('#language-menu [data-language="' + lang + '"]').click();
      const title = await p.locator('[data-node-id="target-timeoutTarget"] .node-title').innerText();
      const routeLabel = await p.locator('[data-node-id="target-timeoutTarget"] .node-type').innerText();
      const apiName = await p.locator('[data-node-id="target-key1Target"] .node-title').innerText();
      result.labels[lang] = { title, routeLabel, apiName, expected: catalog['portal.hangUp'][lang] };
      assert.equal(apiName, 'Ext 0');
      if (lang === 'en' || lang === 'fr') {
        await p.locator('[data-node-id="target-timeoutTarget"]').scrollIntoViewIfNeeded();
        await shot(p, 'P-A13-provider-hangup-' + lang);
      }
    }
    assert.deepEqual(await app.writes(), []);
    const mismatches = Object.entries(result.labels).filter(([, value]) => value.title !== value.expected).map(([lang]) => lang);
    assert.deepEqual(mismatches, [], 'The generated Hang up name remains German in the rendered provider branch.');
  });
  await scenario('P-A14-nested-ivr-readback', async ({ app, p, result }) => {
    await switchWrites(p, true);
    const id = await newResource(p, 'IVR', 'Nested IVR Root');
    await choose(p, '[data-node-config-field="announcement"]', 'Announcement 0');
    await choose(p, '[data-node-target-config="key1Target"]', 'IVR 0');
    await choose(p, '[data-node-target-config="key2Target"]', '238');
    await choose(p, '[data-node-target-config="timeoutTarget"]', 'Hang up');
    await connect(p, id);
    const overview = await app.api('/api/overview');
    const childIvr = overview.inventory.ivrs.find(service => service.name === 'IVR 0');
    assert(childIvr.keyRoutes.some(route => route.number === '1' && route.target.targetNumber === '200'));
    assert.equal(childIvr.timeoutTarget.type, 'HANGUP');
    result.childIvrKeyTargets = childIvr.keyRoutes;
    result.childTimeout = childIvr.timeoutTarget;
    result.nodes = await visibleNodes(p);
    result.applied = await apply(p);
    result.writes = await app.writes();
    assert.equal(result.applied.before, 'Apply callflow', 'Selecting a fully configured existing IVR as Key 1 destination produces phantom open paths.');
    assert.equal(result.applied.applied, true);
  });
}
async function headerCase() {
  await scenario('P-A15-header-contained', async ({p,result}) => {
    result.views=[];
    for (const width of [1400,700,390]) {
      await p.setViewportSize({width,height:1000});
      const measurements=await p.evaluate(()=>{
        const header=document.querySelector('.app-header').getBoundingClientRect();
        return [...document.querySelectorAll('#refresh-button,#refresh-button svg,#language-trigger,#daynight-mode-switch,#daynight-mode-label')].map(el=>{
          const r=el.getBoundingClientRect();const hit=document.elementFromPoint(r.left+r.width/2,Math.max(0,r.top+3));
          return {id:el.id||el.tagName,top:r.top,bottom:r.bottom,headerTop:header.top,headerBottom:header.bottom,occluded:Boolean(hit?.closest('.nfon-appearance-strip'))};
        });
      });
      result.views.push({width,measurements});await shot(p,'P-A15-header-'+width);
    }
    for(const view of result.views) for(const m of view.measurements) {
      assert.ok(m.top>=m.headerTop-1&&m.bottom<=m.headerBottom+1&&!m.occluded,JSON.stringify({width:view.width,...m}));
    }
  },{lang:'de'});
}
async function main() {
  harness = await isolatedBrowser(chromium, chrome);
  report.browser = harness.browser.version();
  await routingCases();
  await pdfCases();
  await extraCases();
  await headerCase();
}
main().catch(error => { report.fatal = error.stack; console.error(error); process.exitCode = 1; }).finally(async () => {
  if (harness) {
    report.network = { routeDenials: harness.routeDenials, proxyDenials: harness.proxyDenials };
    await harness.close();
  }
  fs.writeFileSync(path.join(out, 'browser-results' + (filter.length ? '-' + filter.join('_') : '') + '.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.cases.some(result => result.status !== 'PASS')) process.exitCode = 1;
});
