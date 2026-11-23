const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

test('offline cards offer normal Start without a separate stale-entry action', () => {
  const cards = { innerHTML: '', addEventListener() {}, querySelector() { return null; } };
  const context = vm.createContext({
    window: { location: { pathname: '/' }, addEventListener() {} },
    document: { getElementById() { return cards; }, addEventListener() {} },
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  // Render the production cards with an API status result; skip only bootstrap polling.
  vm.runInContext(source.replace(/\nrender\(\);\nrefreshStatus\(\);\nsetInterval\(refreshStatus, 15000\);\s*$/, ''), context);
  vm.runInContext(`state.serviceControl = true;
    state.services.cti = {health:'offline', staleOwnership:true, detail:'Status endpoint unavailable.'};
    renderCards();`, context);
  assert.doesNotMatch(cards.innerHTML, /service-forget|data-forget-service|Clear stale entry/);
  const start = cards.innerHTML.match(/<button\s+class="service-start[^>]+data-service-id="cti"[^>]*>/)?.[0];
  assert.ok(start, 'the ordinary CTI control is rendered');
  assert.match(start, /data-service-action="start"/);
  assert.doesNotMatch(start, /\bdisabled\b|\bhidden\b/);
});
