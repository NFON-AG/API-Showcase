const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/fixture.cjs');

async function writePayload(app) {
  const overview = await app.request('/api/overview');
  assert.equal(overview.status, 200);
  return {
    did: overview.body.inventory.dids[0],
    target: { type: 'PHONEEXTENSION', routeNumber: '239', number: '239' },
    commit: true,
  };
}

function assertOff(settings) {
  assert.equal(settings.liveWritesEnabled, false);
  assert.equal(settings.liveWritesDefaultEnabled, false);
  assert.equal(settings.liveWritesRuntimeOverride, false);
}

test('server permission leaves a new Portal session read-only until explicit opt-in', async t => {
  const app = await fixture(t);
  const status = await app.request('/api/status');
  assert.equal(status.body.settings.configured, true);
  assert.equal(status.body.settings.liveWritesPermitted, true);
  assert.equal(status.body.settings.liveWritesLocked, false);
  assertOff(status.body.settings);
  const blocked = await app.request('/api/callflow/apply', await writePayload(app));
  assert.equal(blocked.status, 423);
  assert.equal((await app.control('writes')).length, 0);
});

test('explicit session opt-in permits a mock change and disabling blocks the next change', async t => {
  const app = await fixture(t);
  const payload = await writePayload(app);
  assert.equal((await app.request('/api/callflow/apply', payload)).status, 423);
  const enabled = await app.request('/api/settings/live-writes', { enabled: true });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.settings.liveWritesEnabled, true);
  assert.equal(enabled.body.settings.liveWritesDefaultEnabled, false);
  assert.equal(enabled.body.settings.liveWritesRuntimeOverride, true);
  assert.equal((await app.control('writes')).length, 0, 'enabling itself never writes to the provider');
  const applied = await app.request('/api/callflow/apply', payload);
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(applied.body.ok, true);
  assert.equal((await app.control('writes')).length, 1);
  const disabled = await app.request('/api/settings/live-writes', { enabled: false });
  assert.equal(disabled.status, 200);
  assertOff(disabled.body.settings);
  assert.equal((await app.request('/api/callflow/apply', payload)).status, 423);
  assert.equal((await app.control('writes')).length, 1, 'disabled session sends no further mutation');
});

test('restarting a previously enabled Portal server starts a fresh read-only session', async t => {
  const app = await fixture(t);
  const payload = await writePayload(app);
  const enabled = await app.request('/api/settings/live-writes', { enabled: true });
  assert.equal(enabled.status, 200);
  assert.equal(enabled.body.settings.liveWritesEnabled, true);
  await app.restart();
  const status = await app.request('/api/status');
  assert.equal(status.body.settings.liveWritesPermitted, true);
  assertOff(status.body.settings);
  assert.equal((await app.request('/api/callflow/apply', payload)).status, 423);
  assert.equal((await app.control('writes')).length, 0);
});

for (const reset of ['account change', 'browser login']) {
  test(`${reset} requires a fresh session opt-in before any provider change`, async t => {
    const app = await fixture(t, { provider: { customers: 3 } });
    const initial = (await app.request('/api/status')).body;
    assert.equal((await app.request('/api/settings/live-writes', { enabled: true })).status, 200);
    const response = reset === 'account change'
      ? await app.request('/api/settings/customer', { account: 'K9002' })
      : await app.request('/api/settings/browser-login', {
        baseUrl: initial.baseUrl,
        apiKeyId: 'retest-portal-key',
        apiKeySecret: 'retest-portal-secret',
        customerAccount: 'K9001',
      });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assertOff(response.body.settings);
    assert.equal(response.body.settings.liveWritesPermitted, true);
    assert.equal((await app.request('/api/callflow/apply', await writePayload(app))).status, 423);
    assert.equal((await app.control('writes')).length, 0);
  });
}

for (const [name, env, locked] of [
  ['missing server permission', { PORTAL_ENABLE_LIVE_WRITES: 'false' }, false],
  ['hard read-only override', { PORTAL_DISABLE_LIVE_WRITES: 'true' }, true],
]) {
  test(`${name} cannot be bypassed by the session switch`, async t => {
    const app = await fixture(t, { env });
    const status = await app.request('/api/status');
    assertOff(status.body.settings);
    assert.equal(status.body.settings.liveWritesLocked, locked);
    const enabled = await app.request('/api/settings/live-writes', { enabled: true });
    assert.equal(enabled.status, 423);
    assert.equal(enabled.body.code, locked ? 'LIVE_WRITES_LOCKED' : 'LIVE_WRITES_DISABLED');
    assert.equal((await app.request('/api/callflow/apply', await writePayload(app))).status, 423);
    assert.equal((await app.control('writes')).length, 0);
  });
}
