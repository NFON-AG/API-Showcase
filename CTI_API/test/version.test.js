const assert = require('node:assert/strict');
const test = require('node:test');
const { version } = require('../package.json');
const { fixture, eventually } = require('./helpers/fixture.cjs');

for (const [name, env, expectedVersion] of [
  ['package default', {}, version],
  ['explicit APP_VERSION', { APP_VERSION: '9.8.7-test' }, '9.8.7-test'],
]) {
  test(`CTI ${name} is consistent across status, saved backup and upstream requests`, async t => {
    const f = await fixture(t, { credentials: true, env });
    await f.start();
    await eventually(() => f.mock.streams.size === 2 && f.mock.extensionReads && f.mock.stateReads);
    const status = await f.get('/api/status');
    const backup = await f.get('/api/storage/backup');
    assert.equal(status.status, 200);
    assert.equal(backup.status, 200);
    assert.deepEqual({
      statusVersion: status.body.appVersion,
      backupVersion: backup.body.app.version,
      upstreamUserAgents: [...new Set(f.mock.ua)],
    }, {
      statusVersion: expectedVersion,
      backupVersion: expectedVersion,
      upstreamUserAgents: [`cti-dashboard/${expectedVersion} (K1)`],
    });
    assert.equal(f.mock.writes, 0);
    assert.equal(f.mock.deletes, 0);
  });
}
