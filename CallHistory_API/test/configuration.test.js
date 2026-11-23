const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function rejectedStartup(t, settings, envText = '') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-config-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  fs.cpSync(path.join(__dirname, '../src'), path.join(temp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(temp, '.env'), envText);
  // A failed validation must exit before opening a listener or reading auth data.
  fs.writeFileSync(path.join(temp, 'guard.cjs'), `
    require('node:http').Server.prototype.listen = () => { throw new Error('Unexpected listener'); };
    globalThis.fetch = () => { throw new Error('Unexpected provider request'); };
  `);
  const child = spawnSync(process.execPath, ['--require', './guard.cjs', 'src/server.js'], {
    cwd: temp, encoding: 'utf8', timeout: 3000,
    env: { PATH: process.env.PATH, HOME: temp, PORT: '0',
      NFON_SHOWCASE_CONFIG_DIR: path.join(temp, 'config'),
      CALLHISTORY_DATA_DIR: path.join(temp, 'data'), ...settings },
  });
  assert.equal(child.error, undefined);
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.doesNotMatch(child.stderr, /\n\s+at |Unexpected listener|Unexpected provider request/);
  assert.equal(fs.existsSync(path.join(temp, 'data')), false);
  return child.stderr;
}

test('R3-HIST-03: malformed paging configuration fails explicitly before startup', t => {
  const cases = [
    ['CALLHISTORY_LIMIT', '0'], ['CALLHISTORY_LIMIT', '501'],
    ['CALLHISTORY_MAX_REQUESTS', '0'], ['CALLHISTORY_MAX_REQUESTS', '-5'],
    ['CALLHISTORY_MAX_REQUESTS', '2.7'], ['CALLHISTORY_MAX_REQUESTS', 'abc'],
    ['CALLHISTORY_MAX_REQUESTS', ''], ['CALLHISTORY_MAX_REQUESTS', 'Infinity'],
    ['CALLHISTORY_MAX_REQUESTS', '1001'],
    ['CALLHISTORY_MAX_RECORDS', '100001'],
    ['CALLHISTORY_TIMEOUT_MS', '99'], ['CALLHISTORY_TIMEOUT_MS', '2147483648'],
    ['CALLHISTORY_PAGING_BUDGET_MS', '249'], ['CALLHISTORY_PAGING_BUDGET_MS', '60001'],
  ];
  for (const [key, value] of cases) {
    const stderr = rejectedStartup(t, { [key]: value });
    assert.ok(stderr.startsWith(`Configuration error: Invalid integer configuration: ${key} `), key);
  }
});

test('R3-CTI-02: History duplicate environment keys fail without a stack or values', t => {
  const marker = 'private-value-not-for-output';
  const stderr = rejectedStartup(t, {}, `DEMO_MODE=false\nDEMO_MODE=${marker}\n`);
  assert.match(stderr, /^Configuration error: Duplicate environment key: DEMO_MODE on lines 1 and 2\n$/);
  assert.ok(!stderr.includes(marker));
});

test('invalid History flags use the same concise configuration diagnostic', t => {
  const stderr = rejectedStartup(t, { DEMO_MODE: 'not-a-boolean' });
  assert.equal(stderr, 'Configuration error: Invalid boolean configuration: DEMO_MODE\n');
});
