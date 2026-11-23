const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { writeFixture: fixture } = require('./helpers/fixture.cjs');
const night = { nightTarget: { type: 'PHONEEXTENSION', routeNumber: '239', title: 'Night' } };

for (const provider of [
  { locationOnly: true, trailingLocationSlash: true },
  { timeControlResponse: 'body-only', assignTcOffset: 100 },
  { timeControlResponse: 'collection-with-body', assignTcOffset: 100 },
]) {
  test('R3-01: created time-control identity survives routing, restart, restore and cleanup ' + JSON.stringify(provider), async t => {
    const app = await fixture(t, { provider });
    const made = await app.request('/api/daynight/gateways/apply', night);
    assert.equal(made.status, 200, JSON.stringify(made));
    assert.ok(made.body.results.every(item => /time-control-services\/\d+$/.test(item.href)));
    assert.equal((await app.request('/api/daynight/gateway-routing/apply', night)).status, 200);
    await app.restart();
    assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, false);
    assert.equal((await app.request('/api/settings/live-writes', { enabled: true })).status, 200);
    assert.equal((await app.request('/api/overview')).body.daynight.active, true);
    assert.equal((await app.request('/api/daynight/restore', {})).body.restoredRoutings, 4);
    const reset = await app.request('/api/daynight/reset', {});
    assert.equal(reset.body.deletedTimeControls, 4);
    assert.equal((await app.control('state?account=K9001')).tcs.length, 1);
  });
}

test('R3-01: previously stored trailing slash ownership remains readable', async t => {
  const app = await fixture(t);
  await app.request('/api/daynight/gateways/apply', night);
  const directory = path.join(app.dir, 'data');
  const file = path.join(directory, fs.readdirSync(directory).find(name => /^daynight-/.test(name)));
  const stored = JSON.parse(fs.readFileSync(file));
  stored.ownedTimeControls.forEach(item => { item.href += '/'; });
  fs.writeFileSync(file, JSON.stringify(stored));
  assert.equal((await app.request('/api/daynight/gateway-routing/apply', night)).status, 200);
  assert.equal((await app.request('/api/daynight/reset', {})).body.deletedTimeControls, 4);
});

for (const provider of [
  { collectionLocation: true },
  { collectionLocation: true, concurrentTimeControl: true },
  { collectionLocation: true, concurrentTimeControl: true, hideCreatedTimeControl: true },
  ...['missing', 'conflicting', 'foreign-account', 'foreign-origin', 'wrong-endpoint'].map(timeControlResponse => ({ timeControlResponse })),
]) {
  test('R3-01: unproven create identity never grants ownership or deletes resources ' + JSON.stringify(provider), async t => {
    const app = await fixture(t, { provider });
    const result = await app.request('/api/daynight/gateways/apply', night);
    assert.equal(result.status, 502, JSON.stringify(result));
    assert.equal(result.body.applied, false);
    assert.match(result.body.results[0].error, /Created resource could not be identified/);
    assert.equal(app.snapshot()?.ownedTimeControls?.length || 0, 0);
    assert.equal((await app.request('/api/daynight/reset', {})).body.deletedTimeControls, 0);
    const writes = await app.control('writes');
    assert.equal(writes.filter(write => write.method === 'POST').length, 1);
    assert.equal(writes.filter(write => write.method === 'DELETE').length, 0);
    if (provider.concurrentTimeControl) {
      assert.ok((await app.control('state?account=K9001')).tcs.some(item => item.serviceNumber === '999'));
    }
  });
}

test('R3-01/R2-09: a pre-existing foreign time control stays unowned with a translatable blocker', async t => {
  const app = await fixture(t, { provider: { foreignTn: true, collectionLocation: true } });
  const preview = await app.request('/api/daynight/gateway-preview', night);
  assert.equal(preview.body.ok, false);
  assert.ok(preview.body.blockers.some(item => item.messageKey === 'portal.timeControlNotOwned'));
  assert.equal((await app.request('/api/daynight/gateways/apply', night)).status, 400);
  assert.equal((await app.control('writes')).length, 0);
});

function queueFlow(timeout) {
  return { nodes: [{ id: 'inbound', type: 'DID', locked: true }, { id: 'q', type: 'QUEUE', title: 'Queue', routeNumber: '500', config: { timeoutSeconds: timeout } }, { id: 'ext', type: 'PHONEEXTENSION', routeNumber: '239' }], edges: [{ from: 'inbound', to: 'q' }, { from: 'q', to: 'ext', branchField: 'timeoutTarget' }] };
}

test('R3-02/-03: deep graphs and invalid queue timeouts reject before provider writes', async t => {
  const app = await fixture(t);
  const did = (await app.request('/api/overview')).body.inventory.dids[0];
  const deep = { nodes: Array.from({ length: 2000 }, (_, i) => ({ id: String(i), type: 'TIMECONTROL', title: 'Hours', config: { hours: 'Mon-Fri 08:00-17:00' } })), edges: Array.from({ length: 1999 }, (_, i) => ({ from: String(i), to: String(i + 1) })) };
  for (const flow of [deep, queueFlow(0), queueFlow('0'), queueFlow(false), queueFlow({}), queueFlow(-1)]) {
    const result = await app.request('/api/callflow/apply', { did, flow, commit: true });
    assert.equal(result.status, 400, JSON.stringify(result));
    assert.ok(result.body.errorKey);
    assert.doesNotMatch(JSON.stringify(result.body), /stack size|TypeError/);
  }
  assert.equal((await app.control('writes')).length, 0);
  assert.equal((await app.request('/api/status')).status, 200);
});

test('R3-05/K3-01/R2-13: malformed nested inputs reject with catalog errors and no writes', async t => {
  const app = await fixture(t);
  for (const [route, body] of [
    ['/api/service-groups/apply', { account: 'K9001', services: [null] }],
    ['/api/extensions/batch/plan', { rows: [null] }],
    ['/api/extensions/batch/apply', { rows: [null] }],
    ['/api/callflow/bulk-apply', { changes: 'x', commit: true }],
    ['/api/resources/queues', { displayName: {} }],
    ['/api/resources/queues', { displayName: ['Queue'] }],
    ['/api/resources/queues', { displayName: 'A<B' }],
    ['/api/resources/queues', { displayName: 'Queue', serviceNumber: {} }],
    ['/api/resources/ivrs', { displayName: 'Voice menu', announcementName: 'Announcement 0', keyTarget: 'x' }],
    ['/api/settings/customer', { account: {} }],
    ['/api/settings/live-writes', { enabled: 'true' }],
  ]) {
    const result = await app.request(route, body);
    assert.equal(result.status, 400, route + ': ' + JSON.stringify(result));
    assert.ok(result.body.errorKey, JSON.stringify(result));
  }
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, true);
  assert.equal((await app.control('writes')).length, 0);
});

test('R3-06: unconfigured opt-in does not report enabled writes or successful apply', async t => {
  const app = await fixture(t, { env: { PORTAL_API_KEY_ID: '', PORTAL_API_KEY_SECRET: '', PORTAL_CUSTOMER_ACCOUNT: '' } });
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, false);
  for (const [route, body] of [['/api/resources/queues', { displayName: 'Queue' }], ['/api/resources/timeControls', { displayName: 'Hours' }], ['/api/phonebook-sync/apply', {}]]) {
    const result = await app.request(route, body);
    assert.equal(result.status, 409);
    assert.equal(result.body.errorKey, 'portal.error.notConfigured');
  }
  assert.equal((await app.control('writes')).length, 0);
});

test('R3-07: foreign account target is rejected before creation', async t => {
  const app = await fixture(t);
  const result = await app.request('/api/daynight/gateways/apply', { nightTarget: { type: 'PHONEEXTENSION', href: '/api/customers/K9002/targets/phone-extensions/239' } });
  assert.equal(result.status, 403);
  assert.equal((await app.control('writes')).length, 0);
});

test('R3-CTI-02 Portal: duplicate environment reports a concise startup error without values or stack', async t => {
  await assert.rejects(fixture(t, { envText: 'PORTAL_DISABLE_LIVE_WRITES=false\nPORTAL_DISABLE_LIVE_WRITES=true\n' }), error => {
    assert.match(error.message, /Portal configuration error: Duplicate environment key/);
    assert.doesNotMatch(error.message, /at loadEnvFile|server\.js:\d|=false|=true/);
    return true;
  });
});
