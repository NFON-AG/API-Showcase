'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixture, eventually, sleep } = require('./helpers/fixture.cjs');
const { connectedHistoryClient } = require('./helpers/connected-history-client.cjs');
const preload = [path.join(__dirname, 'helpers/history-partial-io.cjs')];
const event = (uuid, state = 'hangup', second = 0) => ({ uuid, state, extension: '21', direction: 'inbound', updated: `2026-10-24T10:00:0${second}Z` });
const identity = row => JSON.stringify([row.account || '', row.uuid, row.state, row.updated || row.receivedAt || '']);
const keys = rows => Array.from(rows, identity).sort();
const mark = (f, name, text = 'test') => fs.writeFileSync(path.join(f.dir, 'data/.' + name), text);
async function clientFor(t, f) {
  const client = await connectedHistoryClient(f.base); t.after(() => client.close());
  await eventually(() => client.frames.some(frame => frame.type === 'snapshot'));
  return client;
}
async function inspect(f, client, expected) {
  const backup = (await f.get('/api/storage/backup')).body.data.callEvents;
  await sleep(100); // allow a compensating frame after the queue has settled
  const server = (await f.get('/api/history')).body;
  const wanted = keys(expected.map(row => ({ ...row, account: 'K1' })));
  assert.deepEqual(keys(server), wanted, 'server history exact identities');
  assert.deepEqual(keys(backup), wanted, 'backup exact identities');
  const clientRows = keys(client.get('state.history'));
  const exported = JSON.parse(JSON.stringify(await client.get('exportRows()')));
  const wantedExport = [...new Set(expected.map(row => row.uuid))].sort().map(uuid => ({ uuid, events: expected.filter(row => row.uuid === uuid).length }));
  const actualExport = exported.map(row => ({ uuid: row['Call ID'], events: row.Events })).sort((a,b) => a.uuid.localeCompare(b.uuid));
  return { clientRows, wanted, actualExport, wantedExport };
}

for (const mode of ['healthy', 'before-byte', 'partial', 'complete', 'complete-no-lf']) {
  test(`R7-CTI-01 real SSE client reconciles ${mode} append with history, backup and exports`, async t => {
    const f = await fixture(t, { credentials: true, preload });
    await f.start(); await eventually(() => f.mock.streams.size === 2);
    const client = await clientFor(t, f), call = event('connected-' + mode);
    if (mode === 'before-byte') mark(f, 'fail-append');
    else if (mode !== 'healthy') mark(f, 'partial-append', mode);
    f.send('one', 'calls', call);
    await eventually(() => client.frames.some(frame => frame.call?.uuid === call.uuid));
    if (mode !== 'healthy') await eventually(() => f.logs().includes('Could not persist call event:'));
    const expected = ['before-byte', 'partial'].includes(mode) ? [] : [call];
    const failed = await inspect(f, client, expected);
    // Keep checking recovery even when the settled client observation is wrong.
    f.send('one', 'calls', call);
    await eventually(async () => (await f.get('/api/storage/backup')).body.data.callEvents.length === 1);
    const next = event('recovery-' + mode, 'hangup', 1); f.send('one', 'calls', next);
    await eventually(() => client.frames.some(frame => frame.call?.uuid === next.uuid));
    const recovered = await inspect(f, client, [call, next]);
    assert.deepEqual(recovered.clientRows, recovered.wanted, 'same client recovers without a refresh');
    assert.deepEqual(recovered.actualExport, recovered.wantedExport, 'exports recover with exact event counts');
    const fresh = await clientFor(t, f), loaded = await inspect(f, fresh, [call, next]);
    assert.deepEqual(loaded.clientRows, loaded.wanted, 'fresh snapshot agrees after recovery');
    assert.deepEqual(failed.clientRows, failed.wanted, 'settled connected client history agrees without manual refresh');
    assert.deepEqual(failed.actualExport, failed.wantedExport, 'settled export rows agree with durable history');
  });
}

test('R7-CTI-01 live ring and hangup reach the client before held history append completes', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const client = await clientFor(t, f), ring = event('realtime-held', 'ring', 2), hangup = event('realtime-held', 'hangup', 3);
  mark(f, 'hold-append');
  f.send('one', 'calls', ring);
  await eventually(() => fs.existsSync(path.join(f.dir, 'data/.entered-append')));
  await eventually(() => client.get('state.activeCalls.some(call => call.uuid === "realtime-held")'));
  f.send('one', 'calls', hangup);
  await eventually(() => client.get('!state.activeCalls.some(call => call.uuid === "realtime-held")'));
  assert.equal(fs.existsSync(path.join(f.dir, 'data/.hold-append')), true);
  fs.rmSync(path.join(f.dir, 'data/.hold-append'));
  const result = await inspect(f, client, [ring, hangup]);
  assert.deepEqual(result.clientRows, result.wanted);
  assert.deepEqual(result.actualExport, result.wantedExport);
});

test('R7-CTI-01 held writes reserve duplicate identities without exposing pending history to connected or fresh clients', async t => {
  const f = await fixture(t, { credentials: true, preload });
  await f.start(); await eventually(() => f.mock.streams.size === 2);
  const client = await clientFor(t, f), ring = event('pending-is-not-history', 'ring', 4);
  mark(f, 'hold-append'); f.send('one', 'calls', ring);
  await eventually(() => fs.existsSync(path.join(f.dir, 'data/.entered-append')));
  await eventually(() => client.get('state.activeCalls.length === 1'));
  const fresh = await clientFor(t, f);
  const pending = {
    connected: keys(client.get('state.history')), fresh: keys(fresh.get('state.history')),
    history: keys((await f.get('/api/history')).body), snapshot: keys((await f.get('/api/snapshot')).body.history),
    exportRows: JSON.parse(JSON.stringify(await client.get('exportRows()'))),
  };
  f.send('one', 'calls', ring); f.send('one', 'calls', ring);
  await sleep(80);
  const realtimeFrames = client.frames.filter(frame => frame.type === 'call' && frame.call?.uuid === ring.uuid).length;
  fs.rmSync(path.join(f.dir, 'data/.hold-append'));
  const result = await inspect(f, client, [ring]);
  assert.deepEqual(result.clientRows, result.wanted, 'single pending identity commits once');
  assert.deepEqual(result.actualExport, result.wantedExport);
  assert.equal(realtimeFrames, 1, 'duplicate pending identities do not replay the live call');
  assert.deepEqual(pending, { connected: [], fresh: [], history: [], snapshot: [], exportRows: [] }, 'pending append is absent from every history surface');
});
