const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Run the whole production client, except the automatic startup requests. Only
// the host DOM/network/clipboard are replaced; copy, cache and invalidation are real.
function client() {
  const nodes = new Map(), requests = [], clipboard = [];
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { value: '', innerHTML: '', textContent: '', hidden: false,
      dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {},
      getAttribute() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; }, addEventListener() {} });
    return nodes.get(selector);
  };
  const context = vm.createContext({ document: { documentElement: { dataset: {}, lang: 'en' }, querySelector: element,
    querySelectorAll: () => [], getElementById: id => element('#' + id), addEventListener() {}, activeElement: null },
    window: { location: new URL('http://127.0.0.1:49998/'), addEventListener() {},
      NFON_I18N: { getLanguage: () => 'en', message: () => '', refresh() {} } },
    localStorage: { getItem() { return null; }, setItem() {} },
    navigator: { clipboard: { async writeText(text) { clipboard.push(text); } } },
    Intl, Map, URL, URLSearchParams, FormData, AbortSignal, setTimeout, clearTimeout, console,
    fetch: url => new Promise((resolve, reject) => requests.push({ url, reject,
      resolve: (body, status = 200) => resolve({ ok: status < 400, status, json: async () => body }) })) });
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  assert.match(source, /bindEvents\(\);\s*loadAll\(\);\s*$/);
  vm.runInContext(source.replace(/bindEvents\(\);\s*loadAll\(\);\s*$/, ''), context);
  const run = code => vm.runInContext(code, context);
  const seed = () => run(`state.demoMode=false; state.status={configured:true,authenticated:true};
    state.calls=[{id:'call',transcriptId:'transcript',source:'callhistory-live',startedAt:'2026-10-24T10:00:00Z',
    direction:'inbound',outcome:'answered',durationSeconds:30,from:{name:'Literal Caller',number:'100'},to:{name:'Agent',number:'200'}}];
    state.rawCalls=state.calls; state.selectedCallId='call';`);
  seed();
  return { run, seed, requests, clipboard };
}
const transcript = { ok: true, source: 'callhistory-live', summary: 'Exact summary', text: 'Literal live transcript' };

test('R6-HIST-01: current live copy preserves exact content and source cache; cached summary needs no request', async () => {
  const app = client();
  const pending = app.run(`copyCallPart('call','transcript')`);
  assert.equal(app.requests.length, 1);
  assert.equal(app.requests[0].url, '/api/transcripts/transcript?mode=live');
  app.requests.shift().resolve(transcript);
  await pending;
  assert.match(app.clipboard[0], /Literal live transcript/);
  assert.equal(app.run('state.transcriptCache.has("live:transcript")'), true);
  await app.run(`copyCallPart('call','summary')`);
  assert.match(app.clipboard[1], /Exact summary/);
  assert.equal(app.requests.length, 0);
});

for (const [name, invalidate] of [
  ['live to demo', 'state.demoMode=true;clearCallData()'],
  ['live to demo to live ABA with the same call id', 'state.demoMode=true;clearCallData();state.demoMode=false;clearCallData()'],
  ['logout after response was issued', 'clearCallData();state.status={configured:true,authenticated:false}'],
  ['call-data clear without a mode change', 'clearCallData()'],
]) {
  test(`R6-HIST-01: copy discards an old response after ${name}`, async () => {
    const app = client();
    const pending = app.run(`copyCallPart('call','all')`);
    const request = app.requests.shift();
    app.run(invalidate);
    if (name.includes('ABA')) app.seed();
    request.resolve(transcript);
    const result = await pending;
    assert.equal(app.run('state.transcriptCache.size'), 0, 'A response from the old source/session must not repopulate any cache');
    assert.deepEqual(app.clipboard, [], 'No old content may be sent to the clipboard');
    assert.equal(result, false, 'A cancelled copy must not produce the normal success toast');
  });
}

test('R6-HIST-01: a rejected old response after invalidation is cancelled rather than surfaced in the new view', async () => {
  const app = client();
  const pending = app.run(`copyCallPart('call','all')`);
  app.run('clearCallData()');
  app.requests.shift().reject(new Error('Old request failed'));
  assert.equal(await pending, false);
  assert.deepEqual(app.clipboard, []);
});

test('R6-HIST-01: authentication failure invalidates a pending copy even if status becomes authenticated again', async () => {
  const app = client();
  const pending = app.run(`copyCallPart('call','all')`);
  const oldCopy = app.requests.shift();
  const rejectedRequest = app.run(`apiJson('/api/transcripts/other?mode=live')`);
  app.requests.shift().resolve({ error: 'Login with NFON is required for live transcript details' }, 401);
  await assert.rejects(rejectedRequest, /Login with NFON/);
  assert.equal(app.run('state.status.authenticated'), false);
  app.run('state.status={configured:true,authenticated:true}');
  oldCopy.resolve(transcript);
  assert.equal(await pending, false);
  assert.equal(app.run('state.transcriptCache.size'), 0);
  assert.deepEqual(app.clipboard, []);
});

for (const [name, invalidate] of [
  ['demo switch', 'state.demoMode=true;clearCallData()'],
  ['live to demo to live ABA', 'state.demoMode=true;clearCallData();state.demoMode=false;clearCallData()'],
  ['same-mode session clear', 'clearCallData()'],
]) {
  test(`R6-HIST-01: a late copy 401 after ${name} preserves the new authentication and cache`, async () => {
    const app = client();
    const pending = app.run(`copyCallPart('call','all')`);
    const oldCopy = app.requests.shift();
    app.run(invalidate);
    app.run(`state.status={configured:true,authenticated:true,account:'New context'};
      state.transcriptCache.set(transcriptCacheKey('new-transcript'),{text:'Current cached transcript'});`);
    const expectedCache = app.run('JSON.stringify([...state.transcriptCache.entries()])');
    oldCopy.resolve({ error: 'Login with NFON is required for live transcript details' }, 401);
    assert.equal(await pending, false);
    assert.equal(app.run('state.status.authenticated'), true, 'An old request cannot sign out the current context');
    assert.equal(app.run('state.status.account'), 'New context');
    assert.equal(app.run('JSON.stringify([...state.transcriptCache.entries()])'), expectedCache, 'An old request cannot clear new cached data');
    assert.deepEqual(app.clipboard, []);
  });
}

test('R6-HIST-01 control: a current failed copy still reports its error', async () => {
  const app = client();
  const pending = app.run(`copyCallPart('call','all')`);
  app.requests.shift().reject(new Error('Current request failed'));
  await assert.rejects(pending, /Current request failed/);
  assert.equal(app.run('state.transcriptCache.size'), 0);
});

test('R6-HIST-01 control: a current authentication failure still reports the login error', async () => {
  const app = client();
  const pending = app.run(`copyCallPart('call','all')`);
  app.requests.shift().resolve({ error: 'Login with NFON is required for live transcript details' }, 401);
  await assert.rejects(pending, /Login with NFON/);
  assert.equal(app.run('state.status.authenticated'), false);
  assert.deepEqual(app.clipboard, []);
});

test('R6-HIST-01 control: detail-loader invalidation still discards the old response', async () => {
  const app = client();
  const pending = app.run('loadSelectedTranscript()');
  app.run('state.demoMode=true;clearCallData()');
  app.requests.shift().resolve(transcript);
  await pending;
  assert.equal(app.run('state.transcript'), null);
  assert.equal(app.run('state.transcriptCache.size'), 0);
});
