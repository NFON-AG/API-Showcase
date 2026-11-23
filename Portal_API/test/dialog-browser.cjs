'use strict';
// Optional component regression in a real browser, using only isolated local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fixture } = require('./helpers/fixture.cjs');
const { isolatedBrowser } = require('../../CTI_API/test/helpers/browser-isolation.cjs');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');

const output = process.env.DIALOG_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'portal-dialog-browser-'));
fs.mkdirSync(output, { recursive: true });
const report = { cases: [] };

(async () => {
  const cleanup = [];
  const browser = await isolatedBrowser(chromium, process.env.BROWSER_EXECUTABLE_PATH || process.env.CHROME_PATH);
  try {
    const app = await fixture({ after: fn => cleanup.push(fn) }, { public: true });
    // A realistic post-setup inventory makes the modal reach the fixed header.
    assert.equal((await app.request('/api/settings/live-writes', { enabled: true })).status, 200);
    assert.equal((await app.request('/api/daynight/gateways/apply', {
      nightTarget: { type: 'PHONEEXTENSION', routeNumber: '239', title: 'Synthetic night target' },
    })).status, 200);
    await app.control('clearlog', {});
    const base = `http://127.0.0.1:${app.port}`;
    for (const theme of ['admin-portal', 'classic']) {
      for (const width of [1280, 390]) {
        const result = { theme, width };
        report.cases.push(result);
        const context = await browser.context(base);
        try {
          const page = await context.newPage();
          await page.setViewportSize({ width, height: 900 });
          await page.goto(`${base}/?theme=${theme}&lang=en#callflow`);
          await page.locator('[data-node-id="inbound"]').waitFor();
          await page.evaluate(() => {
            window.__confirmation = null;
            confirmUi({ title: 'Apply callflow', message: 'This change will be sent to the live Portal API. Continue?' })
              .then(value => { window.__confirmation = value; });
          });
          await page.screenshot({ path: path.join(output, `${theme}-${width}-confirm.png`) });
          result.confirmation = await page.locator('.app-dialog').evaluate(dialog => {
            const style = getComputedStyle(dialog);
            const bounds = dialog.getBoundingClientRect();
            const title = dialog.querySelector('h2').getBoundingClientRect();
            const status = dialog.querySelector('.app-dialog-status');
            return {
              statusDisplay: getComputedStyle(status).display,
              titleLeft: title.left,
              contentLeft: bounds.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
              left: bounds.left, right: bounds.right,
              scrollWidth: dialog.scrollWidth, clientWidth: dialog.clientWidth,
              columns: style.gridTemplateColumns,
            };
          });
          assert.equal(result.confirmation.statusDisplay, 'none', 'Confirmation must not show a decorative status graphic');
          assert(Math.abs(result.confirmation.titleLeft - result.confirmation.contentLeft) <= 1, 'Title must align with content padding, without an empty icon gutter');
          assert(result.confirmation.left >= 0 && result.confirmation.right <= width, 'Dialog must fit the viewport');
          assert(result.confirmation.scrollWidth <= result.confirmation.clientWidth + 1, 'Dialog content must not overflow');
          assert.equal(await page.locator('#app-dialog-cancel').evaluate(button => document.activeElement === button), true, 'Cancel retains initial focus');
          await page.locator('#app-dialog-cancel').click();
          await page.waitForFunction(() => window.__confirmation === false);
          result.indicators = {};
          for (const type of ['pending', 'error', 'success']) {
            await page.evaluate(type => {
              void showUiDialog({ title: `State: ${type}`, message: 'State message.', type, pending: type === 'pending' });
            }, type);
            result.indicators[type] = await page.locator('.app-dialog-status').evaluate(status => ({
              display: getComputedStyle(status).display,
              width: status.getBoundingClientRect().width,
              content: getComputedStyle(status, '::before').content,
            }));
            assert.notEqual(result.indicators[type].display, 'none', `${type} feedback must retain its status indicator`);
            assert(result.indicators[type].width > 0);
            await page.evaluate(() => closeUiDialog(false));
          }
          await page.goto(`${base}/?theme=${theme}&lang=en#overview`);
          await page.locator('[data-resource-kind="timeControls"]').click();
          assert.equal(await page.locator('#resource-modal .resource-item').count(), 5);
          const closeResource = page.locator('#resource-modal button[data-close-resource-modal]');
          result.resourceCloseReachable = await closeResource.evaluate(button => {
            const bounds = button.getBoundingClientRect();
            const top = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            return button === top || button.contains(top);
          });
          await page.screenshot({ path: path.join(output, `${theme}-${width}-resource.png`) });
          assert.equal(result.resourceCloseReachable, true, 'Resource close button must stay above the fixed header');
          await closeResource.click();
          assert.equal(await page.locator('#resource-modal').getAttribute('aria-hidden'), 'true');
          await page.locator('[data-resource-kind="timeControls"]').click();
          await page.locator('[data-open-resource-create="timeControls"]').click();
          const closeCreate = page.locator('#resource-create-modal button[data-close-resource-create]').first();
          await closeCreate.click();
          assert.equal(await page.locator('#resource-create-modal').getAttribute('aria-hidden'), 'true');
          await closeResource.click();
          await page.goto(`${base}/?theme=${theme}&lang=en#changes`);
          await page.locator('[data-auth-login-mode="browser"]').click();
          result.setupLayout = await page.locator('#browser-login-form').evaluate(form => ({
            viewport: innerWidth,
            document: document.documentElement.scrollWidth,
            fields: [...form.querySelectorAll('input')].map(input => ({
              name: input.name, left: input.getBoundingClientRect().left, right: input.getBoundingClientRect().right,
            })),
          }));
          await page.screenshot({ path: path.join(output, `${theme}-${width}-setup.png`) });
          assert(result.setupLayout.document <= width + 1, 'Browser login must not widen the page');
          assert(result.setupLayout.fields.every(field => field.left >= 0 && field.right <= width), 'Every login field must fit the viewport');
          result.pass = true;
        } catch (error) {
          result.pass = false;
          result.error = error.stack;
        } finally {
          await context.close();
        }
      }
    }
    report.providerWrites = await app.control('writes');
    assert.deepEqual(report.providerWrites, []);
  } finally {
    for (const fn of cleanup.reverse()) await fn();
    report.isolation = { proxyDenials: browser.proxyDenials, routeDenials: browser.routeDenials };
    await browser.close();
  }
})().catch(error => {
  report.fatal = error.stack;
  process.exitCode = 1;
}).finally(() => {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  for (const result of report.cases) console.log(result.pass ? 'PASS' : 'FAIL', result.theme, result.width, result.error?.split('\n')[0] || '');
  if (report.cases.some(result => !result.pass)) process.exitCode = 1;
});
