'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, client, until } = require('./helpers/retest7-session.cjs');

const summary = 'SYNTHETIC summary for selected call <literal> — unchanged';
const settle = promise => promise.then(value => ({ value }), error => ({ error: error.message }));
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
function click(app, selectors) {
  app.events.get('document:click')({ target: { closest: selector => selectors[selector] || null } });
}
function filter(app, selector, value) {
  app.element(selector).value = value;
  app.events.get(selector + ':change')();
}
async function pendingCopy(t, { view = 'history', outcome = 200, detailOutcome = 200 } = {}) {
  const server = await fixture(t, { detail: id => ({ id, text: 'SYNTHETIC transcript ' + id, summary }) });
  await server.login('User-A');
  const app = await client(server);
  // Use the actual filter/selection handlers. Excluding the plain row also makes
  // restoring the filter select exactly A, exposing the A -> none -> A race.
  const detail = app.hold('/api/transcripts/current-', detailOutcome);
  t.after(() => detail.release.resolve());
  if (view === 'transcripts') click(app, { '[data-view]': { dataset: { view } } });
  else filter(app, '#transcript-filter', 'with');
  const row = { dataset: { callId: 'current-call' }, closest: selector => view === 'transcripts' && selector === '.transcript-list' ? {} : null };
  click(app, { '[data-call-id]': row });
  await detail.started.promise;
  const held = app.hold('/api/transcripts/current-', outcome);
  t.after(() => held.release.resolve());
  const copy = settle(app.run("copyCallPart('current-call', 'summary')"));
  await held.started.promise;
  return { server, app, detail, held, copy };
}

for (const view of ['history', 'transcripts']) {
  test(`HIST-01 filter (${view}): removal invalidates pending summary before clipboard write`, async t => {
    const { app, detail, held, copy } = await pendingCopy(t, { view });
    filter(app, '#direction-filter', 'outbound');
    assert.equal(app.snapshot().calls.length, 0, 'The real local filter removes all selectable calls');
    assert.equal(app.run('selectedCall()'), null);
    detail.release.resolve(); held.release.resolve();
    assert.deepEqual(await copy, { value: false });
    assert.deepEqual(app.clipboard, []);
    assert.equal(app.run('state.selectedCallId'), '');
    assert.equal(app.run('state.selectedTranscriptCallId'), '');
    assert.equal(app.snapshot().status.authenticated, true);
  });
}

test('HIST-01 filter: restoring A after removal cannot resurrect its pending summary', async t => {
  const { app, detail, held, copy } = await pendingCopy(t);
  filter(app, '#direction-filter', 'outbound');
  assert.equal(app.run('selectedCall()'), null);
  filter(app, '#direction-filter', 'inbound');
  assert.equal(app.run('selectedCall()?.id'), 'current-call', 'The final selection really is A again');
  detail.release.resolve(); held.release.resolve();
  assert.deepEqual(await copy, { value: false });
  assert.deepEqual(app.clipboard, []);
});

for (const outcome of [401, 500, 'network']) {
  test(`HIST-01 filter: a removed selection's late ${outcome} cannot invalidate authentication or report a copy error`, async t => {
    const { app, detail, held, copy } = await pendingCopy(t, { outcome });
    filter(app, '#direction-filter', 'outbound');
    detail.release.resolve(); held.release.resolve();
    assert.deepEqual(await copy, { value: false }, 'A discarded action must not reach the copy handler error/toast paths');
    assert.equal(app.snapshot().status.authenticated, true);
    assert.equal(app.snapshot().error, '');
    assert.deepEqual(app.clipboard, []);
  });
}

test('HIST-01 filter: the removed selection detail cannot invalidate authentication with a stale 401', async t => {
  const { app, detail, held, copy } = await pendingCopy(t, { detailOutcome: 401 });
  filter(app, '#direction-filter', 'outbound');
  detail.release.resolve(); await detail.finished.promise;
  await new Promise(resolve => setImmediate(resolve));
  held.release.resolve();
  assert.deepEqual(await copy, { value: false });
  assert.equal(app.snapshot().status.authenticated, true, 'Both outstanding requests belong to the removed selection');
  assert.deepEqual(app.clipboard, []);
});

test('HIST-01 filter: queued second write is discarded before native invocation when its selection disappears', async t => {
  const first = { started: deferred(), release: deferred() }; let nativeWrites = 0;
  t.after(() => first.release.resolve());
  const server = await fixture(t, { detail: id => ({ id, text: 'SYNTHETIC transcript', summary }) });
  await server.login('User-A');
  const app = await client(server, { async writeClipboard() {
    nativeWrites += 1;
    if (nativeWrites === 1) { first.started.resolve(); await first.release.promise; }
  } });
  click(app, { '[data-call-id]': { dataset: { callId: 'current-call' }, closest: () => null } });
  await until(() => app.snapshot().transcript !== null, 'selected detail');
  const older = settle(app.run("copyCallPart('current-call', 'transcript')"));
  await first.started.promise;
  const queued = settle(app.run("copyCallPart('current-call', 'summary')"));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(nativeWrites, 1, 'Second intent is queued, not accepted by the native clipboard');
  filter(app, '#direction-filter', 'outbound');
  assert.equal(app.run('selectedCall()'), null);
  first.release.resolve();
  assert.deepEqual(await older, { value: false });
  assert.deepEqual(await queued, { value: false });
  assert.equal(nativeWrites, 1, 'An already accepted write may settle; no new stale write may start');
  assert.deepEqual(app.clipboard, ['SYNTHETIC transcript']);
});

test('HIST-01 filter control: a filter retaining the selection preserves its pending summary', async t => {
  const { app, detail, held, copy } = await pendingCopy(t);
  filter(app, '#direction-filter', 'inbound');
  assert.equal(app.run('selectedCall()?.id'), 'current-call');
  detail.release.resolve(); held.release.resolve();
  assert.deepEqual(await copy, { value: true });
  assert.deepEqual(app.clipboard, [summary]);
});

test('HIST-01 filter control: ordinary summary copying remains literal and successful', async t => {
  const { app, detail, held, copy } = await pendingCopy(t);
  detail.release.resolve(); held.release.resolve();
  assert.deepEqual(await copy, { value: true });
  assert.deepEqual(app.clipboard, [summary]);
});
