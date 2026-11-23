const assert = require('node:assert/strict');
const test = require('node:test');
const { writeFixture: fixture } = require('./helpers/fixture.cjs');

const base = '/api/customers/K9001';
const memberPath = '/targets/skill-services/600/members$';
const batch = { rows: [{ number: '900', name: 'Synthetic new extension', mailboxPin: '1234' }] };

function memberBody(shape, enabled, skillLevel = 1) {
  const fields = { extensionNumber: '200', skillLevel, ...(enabled === undefined ? {} : { enabled }) };
  const member = { href: base + '/targets/skill-services/600/members/200',
    ...(shape === 'flat' ? fields : { data: Object.entries(fields).map(([name, value]) => ({ name, value })) }) };
  return { items: [member], total: 1 };
}

async function skill(app) {
  const response = await app.request('/api/service-groups');
  assert.equal(response.status, 200);
  const service = response.body.skills.find(item => item.serviceNumber === '600');
  assert.equal(service.memberError || '', '');
  return service;
}

function update(service, skillLevel = 2) {
  return { account: 'K9001', services: [{ kind: 'skill', serviceNumber: '600', baseRevision: service.memberRevision,
    add: [], remove: [], update: [{ ...service.members[0], skillLevel }] }] };
}

for (const shape of ['flat', 'collection-json']) {
  for (const enabled of [true, false, undefined]) {
    test(`R6-PORTAL-01: ${shape} enabled=${enabled} survives read and skill-level update`, async t => {
      const app = await fixture(t, { provider: { getResponse: { path: memberPath, body: memberBody(shape, enabled) } } });
      const service = await skill(app);
      assert.equal(service.members[0].enabled, enabled !== false);
      assert.equal((await app.request('/api/service-groups/apply', update(service))).status, 200);
      const writes = await app.control('writes');
      assert.equal(writes.length, 1);
      assert.equal(writes[0].sigOk, true);
      assert.equal(writes[0].method, 'PUT');
      assert.deepEqual(JSON.parse(writes[0].body).data, [{ name: 'skillLevel', value: 2 }, { name: 'enabled', value: enabled !== false }]);
    });
  }

  for (const initial of [true, false]) {
    test(`R6-PORTAL-01: ${shape} external enabled ${initial}→${!initial} rejects stale edit`, async t => {
      const app = await fixture(t, { provider: { getResponse: { path: memberPath, body: memberBody(shape, initial) } } });
      const before = await skill(app);
      await app.control('patch', { getResponse: { path: memberPath, body: memberBody(shape, !initial) } });
      const after = await skill(app);
      const result = await app.request('/api/service-groups/apply', update(before));
      assert.deepEqual({ status: result.status, writes: (await app.control('writes')).length, revisionChanged: before.memberRevision !== after.memberRevision },
        { status: 409, writes: 0, revisionChanged: true });
      assert.equal(after.members[0].enabled, !initial);
    });
  }
}

test('R6-PORTAL-01 control: external skill-level change still rejects stale edit', async t => {
  const app = await fixture(t, { provider: { getResponse: { path: memberPath, body: memberBody('flat', true) } } });
  const before = await skill(app);
  await app.control('patch', { getResponse: { path: memberPath, body: memberBody('flat', true, 2) } });
  const after = await skill(app);
  assert.notEqual(before.memberRevision, after.memberRevision);
  assert.equal((await app.request('/api/service-groups/apply', update(before, 3))).status, 409);
  assert.equal((await app.control('writes')).length, 0);
});

async function assertInventory(app, { complete, count, key = 'phoneBooks' }) {
  const overview = (await app.request('/api/overview')).body;
  const result = await app.request('/api/extensions/batch/apply', batch);
  const writes = await app.control('writes');
  assert.deepEqual({ ok: overview.endpoints[key].ok, complete: overview.endpoints[key].complete === true, status: result.status, writes: writes.length },
    { ok: complete, complete, status: complete ? 200 : 409, writes: complete ? 2 : 0 });
  if (complete) assert.equal(overview.endpoints[key].count, count);
}

const book = (id, extra = {}) => ({ href: base + '/phone-books/' + id, ...extra });
for (const [name, second] of Object.entries({
  scalarAlias: { id: '1000', displayName: 'Other label' },
  fragmentAlias: book('1000#duplicate', { displayName: 'Other label' }),
  sameHref: book('1000', { displayName: 'Other label' }),
})) {
  for (const later of [false, true]) {
    test(`R6-PORTAL-02: ${name} on ${later ? 'later' : 'first'} page cannot prove complete inventory`, async t => {
      const app = await fixture(t, { provider: { phonebook: later ? 17 : 2, getResponse: { path: '/phone-books$',
        ...(later ? { offset: 16 } : {}), body: { items: later ? [second] : [book('1000', { id: '1000' }), second], total: later ? 17 : 2 } } } });
      await assertInventory(app, { complete: false });
    });
  }
}

test('R6-PORTAL-02: scalar identity followed by href representation is also duplicate', async t => {
  const app = await fixture(t, { provider: { getResponse: { path: '/phone-books$', body: { items: [{ id: 1000 }, book('1000')], total: 2 } } } });
  await assertInventory(app, { complete: false });
});

for (const href of ['1000', base + '/phone-books/100%30', base + '/phone-books/1000/']) {
  test('R6-PORTAL-02: collection-relative, encoded and trailing-slash href aliases share scalar identity: ' + href, async t => {
    const app = await fixture(t, { provider: { getResponse: { path: '/phone-books$', body: { items: [{ id: '1000' }, { href }], total: 2 } } } });
    await assertInventory(app, { complete: false });
  });
}

test('R6-PORTAL-02 control: distinct collection-relative hrefs remain complete', async t => {
  const app = await fixture(t, { provider: { getResponse: { path: '/phone-books$', body: { items: [{ href: '1000' }, { id: '1001' }], total: 2 } } } });
  await assertInventory(app, { complete: true, count: 2 });
});

for (const later of [false, true]) {
  test(`R6-PORTAL-02 control: distinct mixed resources remain complete on ${later ? 'later' : 'first'} page`, async t => {
    const app = await fixture(t, { provider: { phonebook: 17, getResponse: { path: '/phone-books$', ...(later ? { offset: 16 } : {}),
      body: { items: later ? [{ id: '1016' }] : [book('1000'), { id: '1001' }], total: later ? 17 : 2 } } } });
    await assertInventory(app, { complete: true, count: later ? 17 : 2 });
  });
}

test('R6-PORTAL-02 control: equal local IDs in different resource namespaces remain distinct', async t => {
  const app = await fixture(t, { provider: { getResponse: { path: '/dids$', body: { items: [
    { href: base + '/trunks/10/inbound-trunk-numbers/100', didNumber: '+491000' },
    { href: base + '/trunks/20/inbound-trunk-numbers/100', didNumber: '+492000' },
  ], total: 2 } } } });
  await assertInventory(app, { complete: true, count: 2, key: 'dids' });
});
