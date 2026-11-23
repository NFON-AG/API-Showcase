const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixture, eventually, sleep } = require('./helpers/fixture.cjs');
const { connectedHistoryClient } = require('./helpers/connected-history-client.cjs');

const preload = [path.join(__dirname, 'helpers/history-partial-io.cjs')];
const event = (uuid, state = 'hangup') => ({ uuid, state, extension: '21', updated: '2026-10-23T10:00:00Z' });
const identity = event => JSON.stringify([event.account || '', event.uuid, event.state, event.updated || event.receivedAt || '']);
const historyFile = f => path.join(f.dir, 'data/call-events.jsonl');
const marker = (f, name) => path.join(f.dir, 'data/.' + name);
const mark = (f, name, value = 'test') => fs.writeFileSync(marker(f, name), value);
const clear = (f, name) => fs.rmSync(marker(f, name), { force: true });
const held = (f, operation) => eventually(() => fs.existsSync(marker(f, 'entered-' + operation)));
const account = events => events.map(event => ({ ...event, account: 'K1' }));

function disk(f) {
  const raw = fs.existsSync(historyFile(f)) ? fs.readFileSync(historyFile(f), 'utf8') : '';
  const rows = [], invalid = [];
  for (const line of raw.split('\n').filter(line => line.trim())) {
    try { rows.push(JSON.parse(line)); } catch { invalid.push(line); }
  }
  return { raw, rows, invalid };
}
async function persisted(f, expected, { allowInvalid = false } = {}) {
  const backup = await f.get('/api/storage/backup'); // Await the persistence queue.
  assert.equal(backup.status, 200);
  const stored = disk(f);
  if (!allowInvalid) assert.deepEqual(stored.invalid, [], 'no corrupt suffix survives recovery');
  const history = await f.get('/api/history');
  const keys = expected.map(identity).sort();
  for (const [label, values] of [['disk', stored.rows], ['history', history.body], ['backup', backup.body.data.callEvents]]) {
    assert.deepEqual(values.map(identity).sort(), keys, label + ' exact durable event identities');
    assert.equal(new Set(values.map(identity)).size, values.length, label + ' identities are unique');
  }
  assert.equal((await f.get('/api/storage')).body.files['call-events.jsonl'].records, expected.length);
}
async function restartAndCheck(f, expected) {
  await f.stop(); await f.start();
  await persisted(f, expected);
}

test('R5-CTI-01 partial restore retries preserve every committed identity through backup and restart', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start();
  const events = [event('partial-first'), event('partial-second')];
  mark(f, 'partial-append');
  assert.equal((await f.post('/api/storage/restore', { callEvents: events })).status, 500);
  const written = JSON.parse(fs.readFileSync(marker(f, 'wrote-partial'), 'utf8'));
  assert.ok(written.bytesWritten > 0 && written.bytesWritten < written.attemptedBytes, 'failure follows real partial bytes');
  assert.deepEqual(disk(f).rows.map(identity), account(events.slice(0, 1)).map(identity), 'complete prefix remains committed');
  const retry = await f.post('/api/storage/restore', { callEvents: events });
  assert.equal(retry.status, 200);
  assert.deepEqual({ imported: retry.body.imported, duplicates: retry.body.duplicates, total: retry.body.total }, { imported: 1, duplicates: 1, total: 2 });
  await persisted(f, account(events));
  await restartAndCheck(f, account(events));
  assert.equal((await f.post('/api/storage/restore', { callEvents: events })).body.imported, 0);
});

test('R5-CTI-01 failed append reconciles complete disk records before returning an error', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start();
  const events = [event('committed-before-error'), event('incomplete-before-error')];
  mark(f, 'partial-append');
  assert.equal((await f.post('/api/storage/restore', { callEvents: events })).status, 500);
  await persisted(f, account(events.slice(0, 1)), { allowInvalid: true });
});

test('R5-CTI-01 stream redelivery recovers an actual partial append without phantom success', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const call = event('partial-stream');
  mark(f, 'partial-append');
  f.send('one', 'calls', call);
  await eventually(() => f.logs().includes('Synthetic ENOSPC after actual history append'));
  assert.ok(JSON.parse(fs.readFileSync(marker(f, 'wrote-partial'), 'utf8')).bytesWritten > 0);
  assert.deepEqual((await f.get('/api/history')).body, [], 'failed incomplete event is not retained in memory');
  f.send('one', 'calls', call);
  await eventually(async () => (await f.get('/api/storage')).body.files['call-events.jsonl'].records === 1);
  await persisted(f, account([call]));
  await restartAndCheck(f, account([call]));
});

test('R5-CTI-01 complete stream bytes followed by an error remain disk-authoritative on redelivery', async t => {
  for (const mode of ['complete-no-lf', 'complete']) await t.test(mode, async t => {
    const f = await fixture(t, { credentials: true, preload });
    await f.start(); await eventually(() => f.mock.streams.size === 2);
    const call = event('committed-stream-' + mode);
    mark(f, 'partial-append', mode);
    f.send('one', 'calls', call);
    await eventually(() => f.logs().includes('Synthetic ENOSPC after actual history append'));
    f.send('one', 'calls', call);
    await sleep(80);
    await persisted(f, account([call]));
    assert.equal((await f.post('/api/storage/restore', { callEvents: [event('after-' + mode)] })).status, 200);
    await restartAndCheck(f, account([call, event('after-' + mode)]));
  });
});

test('R5-CTI-01 valid final JSONL record survives a following restore with and without final LF', async t => {
  for (const suffix of ['', '\n']) await t.test(suffix ? 'LF control' : 'no LF regression', async t => {
    const f = await fixture(t, { preload });
    const first = { ...event('existing-tail'), label: 'Synthetic ünicode tail' }, next = event('next-record');
    fs.writeFileSync(historyFile(f), JSON.stringify(first) + suffix);
    await f.start();
    assert.equal((await f.get('/api/history')).body.length, 1);
    assert.equal((await f.post('/api/storage/restore', { callEvents: [next] })).status, 200);
    await persisted(f, [first, next]);
    assert.deepEqual(disk(f).rows[0], first, 'valid tail fields are preserved');
    await restartAndCheck(f, [first, next]);
  });
});

test('R5-CTI-01 corrupt trailing bytes are discarded at the last newline without altering earlier records', async t => {
  const f = await fixture(t, { preload });
  const first = event('before-corrupt-tail'), next = event('after-corrupt-tail');
  fs.writeFileSync(historyFile(f), JSON.stringify(first) + '\n{"uuid":"incomplete');
  await f.start();
  assert.equal((await f.post('/api/storage/restore', { callEvents: [next] })).status, 200);
  await persisted(f, [first, next]);
  assert.equal(disk(f).raw, [first, next].map(JSON.stringify).join('\n') + '\n');
  await restartAndCheck(f, [first, next]);
});

test('R5-CTI-01 concurrent restores and stream events still share one persistence queue', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const client = await connectedHistoryClient(f.base); t.after(() => client.close());
  const shared = event('overlap-shared');
  const unique = Array.from({ length: 4 }, (_, i) => event('overlap-' + i));
  const live = [shared, event('live-states', 'ring'), event('live-states', 'answer'), event('live-states')];
  mark(f, 'hold-read');
  const pending = unique.map(call => f.post('/api/storage/restore', { callEvents: [shared, call, shared] }));
  await held(f, 'read');
  for (const call of live) f.send('one', 'calls', call);
  await eventually(() => client.frames.filter(frame => frame.type === 'call').length === live.length);
  assert.deepEqual((await f.get('/api/history')).body, [], 'queued live events are not committed history');
  clear(f, 'hold-read');
  assert.deepEqual((await Promise.all(pending)).map(result => result.status), [200, 200, 200, 200]);
  const expected = account([shared, ...unique, ...live.slice(1)]);
  await persisted(f, expected);
  await restartAndCheck(f, expected);
});

test('R5-CTI-01 failures before bytes preserve waiting stream events and permit restore retry', async t => {
  for (const operation of ['read', 'append']) await t.test(operation, async t => {
    const f = await fixture(t, { credentials: true, preload });
    await f.start(); await eventually(() => f.mock.streams.size === 2);
    const client = await connectedHistoryClient(f.base); t.after(() => client.close());
    const restored = event('prewrite-' + operation), live = event('waiting-' + operation);
    mark(f, 'hold-' + operation); mark(f, 'fail-' + operation);
    const pending = f.post('/api/storage/restore', { callEvents: [restored] });
    await held(f, operation);
    f.send('one', 'calls', live);
    await eventually(() => client.frames.some(frame => frame.type === 'call' && frame.call?.uuid === live.uuid));
    assert.deepEqual((await f.get('/api/history')).body, [], 'waiting live events stay outside committed history');
    clear(f, 'hold-' + operation);
    assert.equal((await pending).status, 500);
    assert.equal((await f.post('/api/storage/restore', { callEvents: [restored] })).status, 200);
    await persisted(f, account([restored, live]));
    await restartAndCheck(f, account([restored, live]));
  });
});
