const assert = require('node:assert/strict');
const test = require('node:test');
const { writeFixture: fixture } = require('./helpers/fixture.cjs');

const extensionPath = '/targets/phone-extensions$';
const newExtension = { rows: [{ number: '900', name: 'Synthetic new extension', mailboxPin: '1234' }] };
const extension = number => ({
  href: '/api/customers/K9001/targets/phone-extensions/' + number,
  data: [{ name: 'extensionNumber', value: String(number) }, { name: 'displayName', value: 'Synthetic extension' }],
});

async function assertBlocked(app, key = 'extensions') {
  const overview = (await app.request('/api/overview')).body;
  const result = await app.request('/api/extensions/batch/apply', newExtension);
  const writes = await app.control('writes');
  assert.deepEqual({ status: result.status, writes: writes.length, ok: overview.endpoints[key].ok, complete: overview.endpoints[key].complete === true },
    { status: 409, writes: 0, ok: false, complete: false });
}

for (const value of [null, 17, true, 'broken item', [], {}, { href: '' }, { href: {} }, { data: [] }, { displayName: 'Missing identity' }, { extensionNumber: {} }, { extensionNumber: false }, { ...extension(200), extensionNumber: '201', data: [] }]) {
  test('R5-PORTAL-01: invalid individual inventory item blocks writes: ' + JSON.stringify(value), async t => {
    const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body: { items: [value], total: 1 } } } });
    await assertBlocked(app);
  });
}

for (const [key, suffix] of Object.entries({
  devices: '/devices', trunks: '/trunks', dids: '/dids', phoneBooks: '/phone-books', groups: '/targets/group-services',
  ivrs: '/targets/ivr-services', timeControls: '/targets/time-control-services', announcements: '/announcements',
})) {
  test('R5-PORTAL-01: invalid individual ' + key + ' resource blocks dependent writes', async t => {
    const app = await fixture(t, { provider: { getResponse: { path: suffix + '$', body: { items: [{}], total: 1 } } } });
    await assertBlocked(app, key);
  });
}

for (const total of [null, false, true, '', ' ', '0', [], {}, -1, 0.5, 'invalid']) {
  test('R5-PORTAL-01: invalid first-page total blocks writes: ' + JSON.stringify(total), async t => {
    const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body: { items: [], total }, firstPageOnly: true } } });
    await assertBlocked(app);
  });
}

for (const body of [{ entries: [null], total: 1 }, { collection: { items: [null], total: 1 } }, { collection: { items: [], total: null }, total: 0 }, { collection: { items: [], total: 0 }, total: 1 }]) {
  test('R5-PORTAL-01: alternate collection envelopes validate raw entries and totals: ' + JSON.stringify(body), async t => {
    const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body } } });
    await assertBlocked(app);
  });
}

for (const item of [null, {}, 17]) {
  test('R5-PORTAL-01: malformed later-page item blocks the entire inventory: ' + JSON.stringify(item), async t => {
    const app = await fixture(t, { provider: { extensions: 17, getResponse: { path: extensionPath, offset: 16, body: { items: [item], total: 17 } } } });
    await assertBlocked(app);
  });
}

for (const total of [null, false, '', []]) {
  test('R5-PORTAL-01: invalid later total remains invalid when the initial total is absent: ' + JSON.stringify(total), async t => {
    const app = await fixture(t, { provider: { extensions: 17, paging: { extensions: 'noTotal' }, getResponse: { path: extensionPath, offset: 16, body: { items: [extension(216)], total } } } });
    await assertBlocked(app);
  });
}

for (const body of [{ items: [], total: 0 }, { entries: [], total: 0 }, { collection: { items: [], total: 0 } }, { items: [] }]) {
  test('R5-PORTAL-01: valid empty collection permits a new extension: ' + JSON.stringify(body), async t => {
    const app = await fixture(t, { provider: { extensions: 0, getResponse: { path: extensionPath, body } } });
    const overview = (await app.request('/api/overview')).body;
    assert.equal(overview.endpoints.extensions.complete, true);
    assert.equal(overview.endpoints.extensions.count, 0);
    assert.equal((await app.request('/api/extensions/batch/apply', newExtension)).status, 200);
    assert.equal((await app.control('writes')).length, 2);
  });
}

for (const mode of ['', 'noTotal', 'nextOnly']) {
  test('R5-PORTAL-01: valid paginated inventory rejects existing extension with paging ' + (mode || 'numeric total'), async t => {
    const app = await fixture(t, { provider: { extensions: 137, paging: { extensions: mode } } });
    const overview = (await app.request('/api/overview')).body;
    assert.equal(overview.endpoints.extensions.complete, true);
    assert.equal(overview.endpoints.extensions.count, 137);
    assert.equal((await app.request('/api/extensions/batch/apply', { rows: [{ number: '336', name: 'Existing extension', mailboxPin: '1234' }] })).status, 400);
    assert.equal((await app.control('writes')).length, 0);
  });
}

for (const body of [
  { items: [extension(200)], total: 1 },
  { entries: [{ extensionNumber: '200', displayName: 'Flat synthetic resource' }], total: 1 },
  { collection: { items: [{ extensionNumber: 200, displayName: 'Numeric synthetic identity' }], total: 1 } },
  { items: [{ href: '/api/customers/K9001/targets/phone-extensions/200' }], total: 1 },
  { collection: { entries: [extension(200)], total: 1 } },
]) {
  test('R5-PORTAL-01: supported resource representation preserves the actual extension number: ' + JSON.stringify(body), async t => {
    const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body } } });
    const overview = (await app.request('/api/overview')).body;
    assert.equal(overview.endpoints.extensions.complete, true);
    assert.equal(overview.inventory.extensions[0].number, '200');
    assert.equal((await app.request('/api/extensions/batch/apply', { rows: [{ number: '200', name: 'Existing extension', mailboxPin: '1234' }] })).status, 400);
    assert.equal((await app.control('writes')).length, 0);
  });
}

test('R5-PORTAL-01: DID resource href may identify an inbound trunk number outside its collection path', async t => {
  const item = { href: '/api/customers/K9001/trunks/10/inbound-trunk-numbers/100', data: [{ name: 'didNumber', value: '+4912340' }, { name: 'destinationType', value: 'PHONEEXTENSION' }, { name: 'destinationExtensionNumber', value: '200' }] };
  const app = await fixture(t, { provider: { getResponse: { path: '/dids$', body: { items: [item], total: 1 } } } });
  const overview = (await app.request('/api/overview')).body;
  assert.equal(overview.endpoints.dids.complete, true);
  assert.equal(overview.inventory.dids[0].href, item.href);
  assert.equal((await app.request('/api/extensions/batch/apply', newExtension)).status, 200);
  assert.equal((await app.control('writes')).length, 2);
});

for (const total of [17, 18]) {
  test('R5-PORTAL-01: a numeric total first appearing later must agree with the complete item count: ' + total, async t => {
    const app = await fixture(t, { provider: { extensions: 17, paging: { extensions: 'noTotal' }, getResponse: { path: extensionPath, offset: 16, body: { items: [extension(216)], total } } } });
    if (total === 18) return assertBlocked(app);
    const overview = (await app.request('/api/overview')).body;
    assert.equal(overview.endpoints.extensions.complete, true);
    assert.equal(overview.endpoints.extensions.count, 17);
    assert.equal((await app.request('/api/extensions/batch/apply', newExtension)).status, 200);
    assert.equal((await app.control('writes')).length, 2);
  });
}

for (const entry of [{ name: 'extensionNumber', value: null }, { name: 'extensionNumber', value: '' }, { name: 'extensionNumber' }]) {
  for (const later of [false, true]) {
    test('R5-PORTAL-01 follow-up: inferred identity survives re-normalization ' + JSON.stringify(entry) + (later ? ' on later page' : ' on first page'), async t => {
      const number = later ? '216' : '200';
      const item = { href: '/api/customers/K9001/targets/phone-extensions/' + number, data: [entry] };
      const app = await fixture(t, { provider: { extensions: later ? 17 : 1, getResponse: { path: extensionPath, ...(later ? { offset: 16 } : {}), body: { items: [item], total: later ? 17 : 1 } } } });
      const overview = (await app.request('/api/overview')).body;
      assert.equal(overview.endpoints.extensions.complete, true);
      assert.equal(overview.inventory.extensions.at(-1).number, number);
      assert.equal((await app.request('/api/extensions/batch/apply', { rows: [{ number, name: 'Existing extension', mailboxPin: '1234' }] })).status, 400);
      assert.equal((await app.control('writes')).length, 0);
    });
  }
}

for (const key of ['id', 'extensionNumber']) {
  test('R5-PORTAL-01 follow-up: metadata changes cannot distinguish repeated flat identity ' + key, async t => {
    const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body: { items: [{ [key]: '200', displayName: 'A' }, { [key]: '200', displayName: 'B' }], total: 2 } } } });
    await assertBlocked(app);
  });
}

test('R5-PORTAL-01 follow-up: later flat identity repeats the existing href resource', async t => {
  const app = await fixture(t, { provider: { extensions: 17, getResponse: { path: extensionPath, offset: 16, body: { items: [{ id: '200', displayName: 'Changed label' }], total: 17 } } } });
  await assertBlocked(app);
});

test('R5-PORTAL-01 follow-up: distinct flat identities remain complete', async t => {
  const app = await fixture(t, { provider: { getResponse: { path: extensionPath, body: { items: [{ id: '200', displayName: 'Same label' }, { id: '201', displayName: 'Same label' }], total: 2 } } } });
  const overview = (await app.request('/api/overview')).body;
  assert.equal(overview.endpoints.extensions.complete, true);
  assert.deepEqual(overview.inventory.extensions.map(item => item.number), ['200', '201']);
  assert.equal((await app.request('/api/extensions/batch/apply', newExtension)).status, 200);
  assert.equal((await app.control('writes')).length, 2);
});
