'use strict';
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { fixture } = require('./helpers/fixture.cjs');
const { isolatedBrowser } = require('../../CTI_API/test/helpers/browser-isolation.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const chrome = process.env.BROWSER_EXECUTABLE_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const out = process.env.PORTAL_PREPARED_OUTPUT || path.resolve(__dirname, '../../output/playwright/final-two-fixes-2026-11-04/portal/browser');
fs.mkdirSync(out, { recursive: true });
const report = { cases: [] };
let harness;
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function scenario(name, body) {
  const cleanup = [], result = { name, errors: [] }; report.cases.push(result);
  let context;
  try {
    const app = await fixture({ after: fn => cleanup.push(fn) }, { public: true, provider: { customers: 3 }, providerEnv: { MOCK_KEY_ID: 'example-portal-key', MOCK_SECRET: 'example-portal-secret' }, env: { PORTAL_API_KEY_ID: 'example-portal-key', PORTAL_API_KEY_SECRET: 'example-portal-secret' } });
    const base = `http://127.0.0.1:${app.port}`;
    context = await harness.context(base);
    const page = await context.newPage(); page.setDefaultTimeout(7000);
    page.on('pageerror', error => result.errors.push(error.message));
    await page.goto(`${base}/?theme=admin-portal&lang=en#extensions`);
    await page.locator('#view-extensions').waitFor({ state: 'visible' });
    async function batch() { await page.locator('[data-view="extensions"]').click(); await page.locator('[data-extension-section="batch"]').click(); }
    async function fill(number = '888', name = 'Prepared for account A') {
      await batch(); const row = page.locator('[data-extension-batch-row="0"]');
      for (const [field, value] of Object.entries({ extensionNumber: number, displayName: name, mailboxPin: '1234' })) await row.locator(`[data-extension-batch-field="${field}"]`).fill(value);
    }
    async function plan() { const response = page.waitForResponse(r => r.url().endsWith('/api/extensions/batch/plan')); await page.locator('#plan-extension-batch').click(); assert.equal((await (await response).json()).ok, true); }
    async function login(account) {
      await page.locator('[data-view="changes"]').click(); await page.locator('[data-auth-login-mode="browser"]').click();
      const form = page.locator('#browser-login-form');
      for (const [field, value] of Object.entries({ baseUrl: (await app.request('/api/status')).body.baseUrl, apiKeyId: 'example-portal-key', apiKeySecret: 'example-portal-secret', customerAccount: account })) await form.locator(`[name="${field}"]`).fill(value);
      const response = page.waitForResponse(r => r.url().endsWith('/api/settings/browser-login'));
      await form.locator('[type="submit"]').click(); assert.equal((await response).status(), 200);
      await page.waitForFunction(expected => document.querySelector('#account-label')?.textContent.includes(expected), account);
    }
    async function writesOn() {
      await page.locator('[data-view="changes"]').click(); await page.locator('[data-live-writes="on"]').click();
      const confirm = page.locator('#app-dialog-confirm'); if (await confirm.isVisible()) await confirm.click();
      await page.locator('[data-live-writes="off"]').waitFor();
    }
    await body({ app, page, result, batch, fill, plan, login, writesOn });
    assert.deepEqual(result.errors, []); result.status = 'PASS';
    await page.screenshot({ path: path.join(out, `${name}.png`) });
  } catch (error) { result.status = 'FAIL'; result.error = error.stack; }
  finally { if (context) await context.close(); for (const fn of cleanup.reverse()) await fn(); }
  console.log(result.status + ' ' + name);
}
(async () => {
  harness = await isolatedBrowser(chromium, chrome);
  report.browser = harness.browser.version();
  for (const sequence of [['K9002'], ['K9002', 'K9001'], ['K9001']]) {
    await scenario('batch-login-' + sequence.join('-'), async ({ app, page, result, batch, fill, plan, login, writesOn }) => {
      await fill(); await plan();
      for (const account of sequence) await login(account);
      await writesOn(); await batch();
      result.retainedName = await page.locator('[data-extension-batch-row="0"] [data-extension-batch-field="displayName"]').inputValue();
      result.retainedApply = await page.locator('#apply-extension-batch').count();
      assert.equal(result.retainedName, ''); assert.equal(result.retainedApply, 0);
      assert.deepEqual(await app.control('writes'), []);
      await fill('889', 'Checked in current session'); await plan();
      await page.locator('#apply-extension-batch').click();
      const applied = page.waitForResponse(r => r.url().endsWith('/api/extensions/batch/apply'));
      await page.locator('#app-dialog-confirm').click(); assert.equal((await applied).status(), 200);
      const account = sequence.at(-1);
      result.currentAccountCount = (await app.control(`state?account=${account}`)).ext;
      assert.equal(result.currentAccountCount, 41);
      result.writes = (await app.control('writes')).map(({ method, path }) => ({ method, path }));
      assert(result.writes.every(item => item.path.includes('/' + account + '/')));
    });
  }
  await scenario('batch-delayed-plan-login', async ({ app, page, result, batch, fill, plan, login }) => {
    await fill();
    const ready = deferred(), release = deferred();
    await page.route('**/api/extensions/batch/plan', async route => {
      const response = await route.fetch(); ready.resolve(); await release.promise; await route.fulfill({ response });
    }, { times: 1 });
    await page.locator('#plan-extension-batch').click(); await ready.promise;
    try { await login('K9002'); await fill('889', 'Current B plan'); await plan(); }
    finally { release.resolve(); }
    await page.waitForLoadState('networkidle'); await batch();
    result.planText = await page.locator('.batch-plan-list').innerText();
    assert.match(result.planText, /Current B plan/); assert.doesNotMatch(result.planText, /Prepared for account A/);
    assert.deepEqual(await app.control('writes'), []);
  });
  await scenario('batch-edit-recheck-success', async ({ app, page, result, fill, plan, writesOn, batch }) => {
    await writesOn(); await fill(); await plan();
    await page.locator('[data-extension-batch-row="0"] [data-extension-batch-field="displayName"]').fill('Edited before recheck');
    await page.locator('[data-extension-batch-row="0"] [data-extension-batch-field="mailboxPin"]').click();
    await batch(); assert.equal(await page.locator('#apply-extension-batch').count(), 0);
    await plan(); await page.locator('#apply-extension-batch').click();
    const applied = page.waitForResponse(r => r.url().endsWith('/api/extensions/batch/apply'));
    await page.locator('#app-dialog-confirm').click(); assert.equal((await applied).status(), 200);
    result.finalExtension = (await app.request('/api/overview')).body.inventory.extensions.find(item => item.number === '888');
    assert.equal(result.finalExtension.name, 'Edited before recheck');
  });
})().catch(error => { report.fatal = error.stack; }).finally(async () => {
  if (harness) { report.routeDenials = harness.routeDenials; report.proxyDenials = harness.proxyDenials; await harness.close(); }
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  if (report.fatal || report.cases.some(item => item.status !== 'PASS')) process.exitCode = 1;
});
