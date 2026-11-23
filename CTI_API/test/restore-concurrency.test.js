const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixture, eventually, sleep } = require('./helpers/fixture.cjs');
const { connectedHistoryClient } = require('./helpers/connected-history-client.cjs');

const preload = [path.join(__dirname, 'helpers/history-io.cjs')];
function event(uuid, state = 'hangup') {
  return { uuid, state, extension: '21', updated: '2026-10-22T10:00:00Z' };
}
function key(event) { return [event.account || '', event.uuid, event.state, event.updated].join(':'); }
function marker(f, name) { return path.join(f.dir, 'data', '.' + name); }
function setMarker(f, name) { fs.writeFileSync(marker(f, name), 'test'); }
function clearMarker(f, name) { fs.rmSync(marker(f, name), { force: true }); }
async function held(f, operation) { await eventually(() => fs.existsSync(marker(f, 'entered-' + operation))); }
async function persisted(f, expected) {
  const backup = await f.get('/api/storage/backup');
  assert.equal(backup.status, 200);
  const rows = backup.body.data.callEvents;
  const disk = fs.readFileSync(path.join(f.dir, 'data/call-events.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  const history = (await f.get('/api/history')).body;
  const expectedKeys = expected.map(key).sort();
  for (const [label, values] of [['backup', rows], ['disk', disk], ['history', history]]) {
    assert.deepEqual(values.map(key).sort(), expectedKeys, label);
    assert.equal(new Set(values.map(key)).size, values.length, label + ' has unique event identities');
  }
  assert.equal((await f.get('/api/storage')).body.files['call-events.jsonl'].records, expected.length);
}

test('R4-CTI-01 parallel overlapping restores persist each identity once and survive restart', async t => {
  for (const count of [2, 4, 8]) await t.test(`${count} simultaneous requests`, async t => {
    const f = await fixture(t, { credentials: true, preload });
    await f.start();
    const shared = event('shared-' + count);
    const calls = Array.from({ length: count }, (_, i) => event(`unique-${count}-${i}`));
    setMarker(f, 'hold-read');
    const pending = calls.map(unique => f.post('/api/storage/restore', { callEvents: [shared, unique, shared] }));
    await held(f, 'read');
    await sleep(100); // Let all HTTP requests reach the held filesystem boundary.
    clearMarker(f, 'hold-read');
    const results = await Promise.all(pending);
    assert.deepEqual(results.map(r => r.status), calls.map(() => 200));
    const expected = [shared, ...calls].map(e => ({ ...e, account: 'K1' }));
    // Assert durable state before response counters: repeated rows must not hide behind aggregation.
    await persisted(f, expected);
    assert.equal(results.reduce((n, r) => n + r.body.imported, 0), count + 1);
    assert.equal(results.reduce((n, r) => n + r.body.duplicates, 0), count * 3 - count - 1);
    await f.stop(); await f.start();
    await persisted(f, expected);
    assert.equal((await f.post('/api/storage/restore', { callEvents: expected })).body.imported, 0);
  });
});

test('R4-CTI-01 a live stream event arriving during restore cannot persist the same identity twice', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const client = await connectedHistoryClient(f.base); t.after(() => client.close());
  const call = event('stream-during-restore');
  setMarker(f, 'hold-read');
  const restore = f.post('/api/storage/restore', { callEvents: [call] });
  await held(f, 'read');
  f.send('one', 'calls', call);
  await eventually(() => client.frames.some(frame => frame.type === 'call' && frame.call?.uuid === call.uuid));
  assert.deepEqual((await f.get('/api/history')).body, [], 'the held restore has not committed the stream event');
  clearMarker(f, 'hold-read');
  assert.equal((await restore).status, 200);
  await persisted(f, [{ ...call, account: 'K1' }]);
  await f.stop(); await f.start();
  await persisted(f, [{ ...call, account: 'K1' }]);
});

test('R4-CTI-01 restore waits for a pending stream append and retains distinct states', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const call = event('restore-during-stream', 'ring');
  const ended = event(call.uuid);
  setMarker(f, 'hold-append');
  f.send('one', 'calls', call);
  await held(f, 'append');
  const restore = f.post('/api/storage/restore', { callEvents: [call, ended] });
  clearMarker(f, 'hold-append');
  const result = await restore;
  assert.equal(result.status, 200);
  assert.equal(result.body.imported, 1);
  assert.equal(result.body.duplicates, 1);
  await persisted(f, [call, ended].map(e => ({ ...e, account: 'K1' })));
});

test('R4-CTI-01 a failed restore append does not poison later restore, history or backup reads', async t => {
  const f = await fixture(t, { preload });
  await f.start();
  const call = event('retry-after-failure');
  setMarker(f, 'fail-append');
  assert.equal((await f.post('/api/storage/restore', { callEvents: [call] })).status, 500);
  const retry = await f.post('/api/storage/restore', { callEvents: [call] });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.imported, 1);
  await persisted(f, [call]);
});

test('R4-CTI-01 a failed live append can be retried without reserving a phantom duplicate', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const call = event('stream-retry-after-failure');
  setMarker(f, 'fail-append');
  f.send('one', 'calls', call);
  await eventually(() => f.logs().includes('Could not persist call event:'));
  f.send('one', 'calls', call);
  await eventually(() => fs.existsSync(path.join(f.dir, 'data/call-events.jsonl')));
  await persisted(f, [{ ...call, account: 'K1' }]);
});

test('R4-CTI-01 queued old-account restore cannot appear in the new account history', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start();
  const call = event('old-account-restore');
  setMarker(f, 'hold-read');
  const restore = f.post('/api/storage/restore', { app: { account: 'K1' }, callEvents: [call] });
  await held(f, 'read');
  const login = f.post('/api/settings/browser-login', { kAccount: 'K2', username: 'two', password: 'test-only' });
  await eventually(async () => (await f.get('/api/status')).body.account === 'K2');
  clearMarker(f, 'hold-read');
  assert.equal((await login).status, 200);
  assert.ok([200, 409].includes((await restore).status));
  assert.deepEqual((await f.get('/api/history')).body, []);
  assert.deepEqual((await f.get('/api/storage/backup')).body.data.callEvents, []);
  assert.equal((await f.post('/api/storage/restore', { callEvents: [{ ...call, account: 'K1' }] })).status, 409);
  assert.equal((await f.post('/api/storage/restore', { callEvents: [null] })).status, 400);
  assert.equal((await f.post('/api/storage/restore', { callEvents: [event('new-account')] })).status, 200);
  assert.deepEqual((await f.get('/api/history')).body.map(e => e.account), ['K2']);
});
