'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, client, until } = require('./helpers/retest7-session.cjs');

const literal = 'Original customer text <literal>\nČeský obsah — do not translate';
const settle = promise => promise.then(value => ({ value }), error => ({ error: error.message }));
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function click(app, selectors) {
  const target = { closest: selector => selectors[selector] || null };
  app.events.get('document:click')({ target });
}
async function select(app, id) {
  app.run(`setSelectedCall(${JSON.stringify(id)})`);
  await until(() => app.snapshot().transcript !== null, 'selected detail delivered');
}

test('HIST-01: an older delayed copy cannot replace a newer successful copy in the same session', async t => {
  const server = await fixture(t); await server.login('User-A'); const app = await client(server);
  const held = app.hold('/api/transcripts/old-', 200);
  const older = settle(app.run("copyCallPart('old-call','transcript')"));
  await held.started.promise;
  assert.equal(await app.run("copyCallPart('current-call','transcript')"), true);
  const latest = app.clipboard.at(-1); const count = app.clipboard.length;
  held.release.resolve();
  assert.deepEqual(await older, { value: false });
  assert.equal(app.clipboard.length, count, 'Discard before invoking clipboard, not only before success toast');
  assert.equal(app.clipboard.at(-1), latest);
});

test('HIST-01: changing selection while a copy waits leaves the clipboard untouched without a second copy', async t => {
  const server = await fixture(t); await server.login('User-A'); const app = await client(server);
  const held = app.hold('/api/transcripts/old-', 200);
  const older = settle(app.run("copyCallPart('old-call','transcript')")); await held.started.promise;
  await select(app, 'current-call');
  held.release.resolve();
  assert.deepEqual(await older, { value: false });
  assert.deepEqual(app.clipboard, []);
});

test('HIST-01: selection A to B to A does not resurrect a pending copy', async t => {
  const server = await fixture(t); await server.login('User-A'); const app = await client(server);
  const firstDetail = app.hold('/api/transcripts/old-', 200);
  app.run("setSelectedCall('old-call')"); await firstDetail.started.promise;
  assert.equal(app.run('state.selectedCallId'), 'old-call');
  const held = app.hold('/api/transcripts/old-', 200);
  const older = settle(app.run("copyCallPart('old-call','transcript')")); await held.started.promise;
  await select(app, 'current-call'); await select(app, 'old-call');
  assert.equal(app.run('state.selectedCallId'), 'old-call', 'The final selection is exactly the initial selection');
  firstDetail.release.resolve(); held.release.resolve();
  assert.deepEqual(await older, { value: false });
  assert.deepEqual(app.clipboard, []);
});

for (const fails of [false, true]) {
  test(`HIST-01: native clipboard writes remain ordered when the first write ${fails ? 'fails' : 'completes'} late`, async t => {
    const first = { started: deferred(), release: deferred() }; let writes = 0;
    t.after(() => first.release.resolve());
    const server = await fixture(t, { detail: id => ({ id, text: 'Original content ' + id }) }); await server.login('User-A');
    const app = await client(server, { async writeClipboard() {
      if (++writes === 1) { first.started.resolve(); await first.release.promise; if (fails) throw new Error('Native clipboard rejected earlier write'); }
    } });
    const older = settle(app.run("copyCallPart('old-call','transcript')")); await first.started.promise;
    const newer = settle(app.run("copyCallPart('current-call','transcript')"));
    await until(() => server.hits.some(hit => hit.path?.includes('/records/current-')), 'newer content retrieved');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 1, 'A second native write must wait until the accepted first write settles');
    first.release.resolve();
    assert.deepEqual(await older, { value: false });
    assert.deepEqual(await newer, { value: true });
    assert.equal(writes, 2);
    assert.match(app.clipboard.at(-1), /Original content current-/);
  });
}

for (const outcome of [401, 500, 'network']) {
  test(`HIST-01: late ${outcome} from superseded copy does not report an action error`, async t => {
    const server = await fixture(t); await server.login('User-A'); const app = await client(server);
    const held = app.hold('/api/transcripts/old-', outcome);
    const older = settle(app.run("copyCallPart('old-call','transcript')")); await held.started.promise;
    assert.equal(await app.run("copyCallPart('current-call','transcript')"), true);
    const previous = [...app.clipboard]; held.release.resolve();
    assert.deepEqual(await older, { value: false });
    assert.deepEqual(app.clipboard, previous);
    assert.equal(app.snapshot().status.authenticated, true, 'Superseded action errors must not invalidate current authentication');
  });
}

for (const summary of [undefined, '', '   ']) {
  test(`HIST-02: missing summary (${JSON.stringify(summary)}) is unavailable in both views and cannot copy UI text`, async t => {
    const server = await fixture(t, { detail: id => ({ id, text: literal, ...(summary === undefined ? {} : { summary }) }) });
    await server.login('User-A'); const app = await client(server); await select(app, 'current-call');
    assert.doesNotMatch(app.element('#call-detail').innerHTML, /data-copy-kind="summary"/);
    click(app, { '[data-view]': { dataset: { view: 'transcripts' } } });
    await until(() => !app.run('state.loading'), 'transcript view');
    const row = { dataset: { callId: 'current-call' }, closest: selector => selector === '.transcript-list' ? {} : null };
    click(app, { '[data-call-id]': row });
    await until(() => app.snapshot().transcript !== null, 'transcript selection');
    assert.doesNotMatch(app.element('#transcript-grid').innerHTML, /data-copy-kind="summary"/);
    const rejected = await settle(app.run("copyCallPart('current-call','summary')"));
    assert.equal(rejected.value === true, false, 'Missing content must not report successful copying');
    assert.deepEqual(app.clipboard, [], 'Existing clipboard contents would otherwise be overwritten');
    assert.equal(await app.run("copyCallPart('current-call','transcript')"), true);
    assert.equal(app.clipboard.at(-1), literal);
  });
}

test('HIST-02 control: actual summary and transcript remain literal and independently copyable', async t => {
  const summary = 'A provider summary <literal> — Zusammenfassung';
  const server = await fixture(t, { detail: id => ({ id, text: literal, summary }) });
  await server.login('User-A'); const app = await client(server); await select(app, 'current-call');
  assert.match(app.element('#call-detail').innerHTML, /data-copy-kind="summary"/);
  assert.equal(await app.run("copyCallPart('current-call','summary')"), true);
  assert.equal(app.clipboard.at(-1), summary);
  assert.equal(await app.run("copyCallPart('current-call','transcript')"), true);
  assert.equal(app.clipboard.at(-1), literal);
});

test('HIST-02: the copy handler itself rejects absent summary without overwriting existing clipboard content', async t => {
  const server = await fixture(t, { detail: id => ({ id, text: literal }) });
  await server.login('User-A'); const app = await client(server);
  app.clipboard.push('Previous clipboard content');
  const result = await settle(app.run("copyCallPart('current-call','summary')"));
  assert.equal(result.value === true, false);
  assert.deepEqual(app.clipboard, ['Previous clipboard content']);
});

test('HIST-03: explicit Refresh retries a cached unavailable detail with the same transcript ID', async t => {
  let ready = false;
  const server = await fixture(t, { detail: id => ({ id, transcription: ready
    ? { available: true, transcript: [{ event: 'speech', source: 'caller', text: literal }] }
    : { available: false, transcript: [] } }) });
  await server.login('User-A'); const app = await client(server); await select(app, 'current-call');
  assert.equal(app.snapshot().transcript.available, false);
  const before = server.hits.filter(hit => hit.path?.includes('/records/current-')).length;
  ready = true; await app.refresh();
  const after = server.hits.filter(hit => hit.path?.includes('/records/current-')).length;
  assert.equal(after, before + 1, 'Explicit Refresh must request the detail, not only the list');
  assert.equal(app.snapshot().transcript.available, true);
  assert.match(app.run('callTranscriptText(selectedCall())'), /Original customer text/);
  assert.match(app.element('#call-detail').innerHTML, /Original customer text/);
});

test('HIST-03 control: ordinary navigation reuses a successful detail without unnecessary provider polling', async t => {
  const server = await fixture(t); await server.login('User-A'); const app = await client(server);
  await select(app, 'current-call');
  const before = server.hits.filter(hit => hit.path?.includes('/records/current-')).length;
  await select(app, 'shared-call'); await select(app, 'current-call');
  assert.equal(server.hits.filter(hit => hit.path?.includes('/records/current-')).length, before);
  assert.equal(await app.run("copyCallPart('current-call','transcript')"), true);
  assert.match(app.clipboard.at(-1), /SYNTHETIC TRANSCRIPT User-A/);
});
