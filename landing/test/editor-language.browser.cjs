'use strict';

// Opt-in browser regression: real Cockpit rendering/i18n, isolated HTTP fixture.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { isolatedBrowser } = require('../../CTI_API/test/helpers/browser-isolation.cjs');

const publicRoot = path.resolve(__dirname, '../public');
const messages = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../i18n-messages.json'), 'utf8'));
const output = process.env.COCKPIT_BROWSER_OUTPUT;
const report = { cases: [], errors: [] };
let source = 'env';
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/status') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ health: 'online', serviceControl: false, services: {
      cti: { health: 'online', upstream: 'http://127.0.0.1:3002', defaultUpstream: 'http://127.0.0.1:3002', upstreamSource: source },
    } }));
    return;
  }
  const file = path.resolve(publicRoot, '.' + (url.pathname === '/' ? '/index.html' : url.pathname));
  if (!file.startsWith(publicRoot + path.sep) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[path.extname(file)] || 'application/octet-stream');
  res.end(fs.readFileSync(file));
});

(async () => {
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = 'http://127.0.0.1:' + server.address().port;
  const isolated = await isolatedBrowser(chromium, process.env.BROWSER_EXECUTABLE_PATH);
  try {
    for (const theme of ['admin-portal', 'classic']) {
      for (source of ['env', 'override', 'default']) {
        const result = { theme, source }; report.cases.push(result);
        const context = await isolated.context(base);
        try {
          const page = await context.newPage(); page.setDefaultTimeout(5000);
          page.on('pageerror', error => report.errors.push(error.message));
          await page.goto(`${base}/?theme=${theme}&lang=de`);
          await page.waitForFunction(() => document.querySelector('[data-card-id="cti"] .api-card')?.classList.contains('is-online'));
          await page.locator('[data-edit-id="cti"]').click();
          const input = page.locator('[data-edit-input="cti"]');
          await input.fill('https://draft.example/a?name=Unverändert');
          const originalInput = await input.elementHandle();
          for (const language of ['en', 'fr', 'es', 'it', 'nl', 'pl', 'pt', 'sv', 'da', 'fi', 'cs', 'de']) {
            await page.locator('#language-trigger').click();
            await page.locator(`.language-option[data-language="${language}"]`).click();
            const key = source === 'env' ? 'landing.environment' : source === 'override' ? 'landing.override' : null;
            const expected = (key ? messages[key][language] : '') + messages['landing.default'][language] + ' 127.0.0.1:3002';
            assert.equal(await page.locator('[data-card-id="cti"] .editor-meta').innerText(), expected, `${source}/${theme}/${language}: editor metadata must follow the current language`);
            assert.equal(await input.inputValue(), 'https://draft.example/a?name=Unverändert');
            assert.equal(await input.evaluate((node, original) => node === original, originalInput), true, 'Language changes must preserve the actual edited input');
          }
          await page.locator('[data-nfon-theme-switch]').click();
          assert.equal(await input.inputValue(), 'https://draft.example/a?name=Unverändert');
          if (output) await page.screenshot({ path: path.join(output, `editor-language-${theme}-${source}.png`), fullPage: true });
          await input.press('Escape');
          assert.equal(await page.locator('[data-edit-id="cti"]').evaluate(button => button === document.activeElement), true);
          result.pass = true;
        } catch (error) { result.pass = false; result.error = error.stack; }
        finally { await context.close(); }
      }
    }
  } finally { await isolated.close(); }
  assert.equal(report.cases.filter(item => !item.pass).length, 0, JSON.stringify(report.cases.filter(item => !item.pass)));
  assert.deepEqual(report.errors, []);
})().catch(error => { report.fatal = error.message; process.exitCode = 1; }).finally(async () => {
  server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  if (output) fs.writeFileSync(path.join(output, 'editor-language-results.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
});
