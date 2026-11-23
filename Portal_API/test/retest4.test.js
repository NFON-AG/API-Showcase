const assert = require('node:assert/strict');
const test = require('node:test');
const { writeFixture: fixture } = require('./helpers/fixture.cjs');

const extensionPath = '/targets/phone-extensions$';
const batch = { rows: [{ number: '200', name: 'Synthetic duplicate', mailboxPin: '1234' }] };

for (const [key, suffix] of Object.entries({
  devices: '/devices', trunks: '/trunks', dids: '/dids', phoneBooks: '/phone-books', groups: '/targets/group-services',
  ivrs: '/targets/ivr-services', timeControls: '/targets/time-control-services', announcements: '/announcements',
})) {
  test('R4-PORTAL-01: malformed ' + key + ' inventory blocks dependent writes', async t => {
    const app = await fixture(t, { provider: { getResponse: { path: suffix + '$', body: {} } } });
    const overview = (await app.request('/api/overview')).body;
    const result = await app.request('/api/extensions/batch/apply', { rows: [{ number: '900', name: 'New synthetic extension', mailboxPin: '1234' }] });
    const writes = await app.control('writes');
    assert.deepEqual({ status: result.status, writes: writes.length, ok: overview.endpoints[key].ok, complete: overview.endpoints[key].complete === true },
      { status: 409, writes: 0, ok: false, complete: false });
  });
}

for (const body of [null, {}, [], 17, true, { unexpected: 'broken list' }, { items: null }, { items: {} }, { collection: {} }]) {
  test('R4-PORTAL-01: malformed first inventory blocks writes: ' + JSON.stringify(body), async t => {
    const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body, firstPageOnly: true } } });
    const overview = (await app.request('/api/overview')).body;
    const result = await app.request('/api/extensions/batch/apply', batch);
    const writes = await app.control('writes');
    assert.deepEqual({ status: result.status, writes: writes.length, ok: overview.endpoints.extensions.ok, complete: overview.endpoints.extensions.complete === true },
      { status: 409, writes: 0, ok: false, complete: false });
  });
}

test('R4-PORTAL-01: a valid inventory still rejects a duplicate without writes', async t => {
  const app = await fixture(t);
  const overview = (await app.request('/api/overview')).body;
  assert.equal(overview.endpoints.extensions.complete, true);
  assert.equal((await app.request('/api/extensions/batch/apply', batch)).status, 400);
  assert.equal((await app.control('writes')).length, 0);
});

for (const body of [{ items: [], total: 0 }, { entries: [], total: 0 }, { collection: { items: [], total: 0 } }]) {
  test('R4-PORTAL-01: a valid empty collection permits a new extension: ' + JSON.stringify(body), async t => {
    const app = await fixture(t, { provider: { extensions: 0, getResponse: { path: extensionPath, body } } });
    const overview = (await app.request('/api/overview')).body;
    assert.equal(overview.endpoints.extensions.ok, true);
    assert.equal(overview.endpoints.extensions.complete, true);
    assert.equal(overview.endpoints.extensions.count, 0);
    assert.equal((await app.request('/api/extensions/batch/apply', batch)).status, 200);
    assert.equal((await app.control('writes')).length, 2);
  });
}

test('R4-PORTAL-01: singular customer, version, IVR and routing details remain usable', async t => {
  const app = await fixture(t);
  const overview = (await app.request('/api/overview')).body;
  for (const key of ['version', 'basicData', 'contract']) assert.equal(overview.endpoints[key].ok, true, key);
  assert.equal(overview.inventory.ivrs[0].detailError, '');
  assert.equal(overview.inventory.ivrs[0].timeoutSeconds, '20');
  assert.equal(overview.inventory.ivrs[0].keyRoutes[0].target.routeNumber, '200');
  assert.equal(overview.inventory.timeControls[0].detailError, '');
  assert.match(overview.inventory.timeControls[0].dayTargetHref, /phone-extensions\/200$/);
});
