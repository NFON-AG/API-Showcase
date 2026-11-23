const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { writeFixture: fixture } = require('./helpers/fixture.cjs');

// Only test fixtures are configured. Every assertion reaches the actual HTTP route
// and captures independent, HMAC/MD5-verified provider requests and readback.
const evidence = [];
if (process.env.R7_PORTAL_EVIDENCE_DIR) process.on('exit', () => {
  fs.mkdirSync(process.env.R7_PORTAL_EVIDENCE_DIR, { recursive: true });
  fs.writeFileSync(path.join(process.env.R7_PORTAL_EVIDENCE_DIR, 'input-observations.json'), JSON.stringify(evidence, null, 2));
});

async function setup(t) {
  const app = await fixture(t, { provider: { skillMembers: 2, queueMembers: 2 } });
  await app.control('mutate', { kind: 'skill', service: '600', setMember: { extensionNumber: '200', enabled: false } });
  return app;
}
async function groups(app) {
  const result = await app.request('/api/service-groups');
  assert.equal(result.status, 200);
  for (const key of ['skills', 'queues']) for (const group of result.body[key]) assert.equal(group.memberError || '', '');
  return result.body;
}
const collection = kind => kind === 'skill' ? 'skills' : 'queues';
function change(before, kind, action, entry) {
  const serviceNumber = kind === 'skill' ? '600' : '500';
  const service = before[collection(kind)].find(item => item.serviceNumber === serviceNumber);
  return { kind, serviceNumber, baseRevision: service.memberRevision, add: [], remove: [], update: [], [action]: [entry] };
}
function members(snapshot) {
  return Object.fromEntries(['skills', 'queues'].map(key => [key, snapshot[key].map(group => ({ serviceNumber: group.serviceNumber, members: group.members }))]));
}
async function execute(t, app, before, changes) {
  const payload = { account: 'K9001', services: changes };
  const result = await app.request('/api/service-groups/apply', payload);
  const writes = await app.control('writes');
  const after = await groups(app);
  evidence.push({ name: t.name, payload, before: members(before), result, writes, after: members(after) });
  return { result, writes, after };
}
function assertRejected({ result, writes, after }, before) {
  assert.deepEqual({ status: result.status, writes: writes.length, unchanged: JSON.stringify(members(after)) === JSON.stringify(members(before)) },
    { status: 400, writes: 0, unchanged: true }, 'Malformed request must be rejected before any provider mutation');
  assert.doesNotMatch(JSON.stringify(result.body), /TypeError|Cannot read properties|normalizeDesiredMember|server\.js|\bat\s+\w+\s*\(/);
}

for (const action of ['add', 'update', 'remove']) {
  for (const [label, enabled] of [['null', null], ['string-false', 'false'], ['zero', 0], ['one', 1], ['empty-string', ''], ['object', {}], ['array', []]]) {
    test(`R7-PORTAL-01: skill ${action} rejects enabled ${label} with zero writes`, async t => {
      const app = await setup(t); const before = await groups(app);
      const entry = { extensionNumber: action === 'add' ? '202' : '200', skillLevel: 2, enabled };
      assertRejected(await execute(t, app, before, [change(before, 'skill', action, entry)]), before);
    });
  }
}

for (const kind of ['skill', 'queue']) for (const action of ['add', 'update', 'remove']) {
  for (const [label, entry] of [['null', null], ['array', []], ['number', 200], ['boolean', false], ['empty-object', {}]]) {
    test(`R7-PORTAL-02: ${kind} ${action} rejects ${label} member with 400 and zero writes`, async t => {
      const app = await setup(t); const before = await groups(app);
      assertRejected(await execute(t, app, before, [change(before, kind, action, entry)]), before);
    });
  }
}

for (const kind of ['skill', 'queue']) for (const action of ['add', 'update', 'remove']) {
  for (const shape of ['object', 'string-shorthand']) test(`R7 control: ${kind} ${action} accepts valid ${shape}`, async t => {
    const app = await setup(t); const before = await groups(app);
    const number = action === 'add' ? '202' : '200';
    const entry = shape === 'string-shorthand' ? number : { extensionNumber: number, skillLevel: 3, penalty: 4, enabled: false };
    const { result, writes, after } = await execute(t, app, before, [change(before, kind, action, entry)]);
    assert.equal(result.status, 200); assert.equal(writes.length, 1); assert.equal(writes[0].sigOk, true);
    assert.equal(writes[0].method, { add: 'POST', update: 'PUT', remove: 'DELETE' }[action]);
    assert.match(writes[0].path, new RegExp(`/targets/${kind}-services/${kind === 'skill' ? '600' : '500'}/members${action === 'add' ? '$' : '/' + number + '$'}`));
    const member = after[collection(kind)].find(group => group.serviceNumber === (kind === 'skill' ? '600' : '500')).members.find(row => row.extensionNumber === number);
    if (action === 'remove') { assert.equal(member, undefined); return; }
    const data = JSON.parse(writes[0].body).data;
    const expected = kind === 'queue' ? [{ name: 'penalty', value: shape === 'object' ? 4 : 0 }]
      : [{ name: 'skillLevel', value: shape === 'object' ? 3 : 1 }, ...(action === 'update' ? [{ name: 'enabled', value: shape === 'string-shorthand' }] : [])];
    assert.deepEqual(data, expected);
    assert.equal(member[kind === 'skill' ? 'skillLevel' : 'penalty'], expected[0].value);
    if (kind === 'skill' && action === 'update') assert.equal(member.enabled, shape === 'string-shorthand');
  });
}

for (const enabled of [false, true, undefined]) test(`R7 control: skill update native enabled=${enabled} keeps existing omission contract`, async t => {
  const app = await setup(t); const before = await groups(app);
  assert.equal(before.skills[0].members.find(member => member.extensionNumber === '200').enabled, false);
  const entry = { extensionNumber: '200', skillLevel: 2, ...(enabled === undefined ? {} : { enabled }) };
  const { result, writes, after } = await execute(t, app, before, [change(before, 'skill', 'update', entry)]);
  assert.equal(result.status, 200); assert.equal(writes.length, 1); assert.equal(writes[0].sigOk, true);
  assert.deepEqual(JSON.parse(writes[0].body).data, [{ name: 'skillLevel', value: 2 }, { name: 'enabled', value: enabled !== false }]);
  assert.equal(after.skills[0].members.find(member => member.extensionNumber === '200').enabled, enabled !== false);
});

for (const enabled of [null, 'false', 0, {}, []]) test(`R7 control: queue enabled is ignored (${JSON.stringify(enabled)})`, async t => {
  const app = await setup(t); const before = await groups(app);
  const { result, writes } = await execute(t, app, before, [change(before, 'queue', 'update', { extensionNumber: '200', penalty: 2, enabled })]);
  assert.equal(result.status, 200); assert.equal(writes.length, 1); assert.equal(writes[0].sigOk, true);
  assert.deepEqual(JSON.parse(writes[0].body).data, [{ name: 'penalty', value: 2 }]);
});

for (const kind of ['skill', 'queue']) for (const action of ['add', 'update', 'remove']) {
  for (const malformed of ['null', 'enabled-string']) {
    if (kind === 'queue' && malformed === 'enabled-string') continue;
    test(`R7 atomic validation: late ${kind} ${action} ${malformed} prevents writes across earlier groups and entries`, async t => {
      const app = await setup(t); const before = await groups(app);
      const earlierKind = kind === 'skill' ? 'queue' : 'skill';
      const early = change(before, earlierKind, 'update', { extensionNumber: '200', penalty: 4, skillLevel: 3, enabled: false });
      const valid = { extensionNumber: action === 'add' ? '202' : '200', penalty: 4, skillLevel: 3, enabled: false };
      const later = change(before, kind, action, valid);
      later[action].push(malformed === 'null' ? null : { extensionNumber: action === 'add' ? '203' : '201', skillLevel: 2, enabled: 'false' });
      assertRejected(await execute(t, app, before, [early, later]), before);
    });
  }
}
