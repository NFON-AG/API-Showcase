const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { fixture } = require('./helpers/fixture.cjs');
const { clientRenderer } = require('./helpers/client-render.cjs');

const optInRoute = '/api/settings/live-writes';
const applyRoute = '/api/callflow/apply';
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function setup(t) {
  const app = await fixture(t, { provider: { customers: 3 } });
  const requests = [];
  const listeners = new Map();
  let failedRoute;
  let heldResponse;
  const ui = clientRenderer('en', {
    document: { querySelector: () => null, querySelectorAll: () => [],
      addEventListener(type, listener) { listeners.set(type, [...(listeners.get(type) || []), listener]); } },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body });
      if (url === failedRoute) return new Response(JSON.stringify({ error: 'Synthetic opt-in failure' }), { status: 503 });
      const response = await fetch(`http://127.0.0.1:${app.port}${url}`, options);
      if (heldResponse?.url === url) {
        const held = heldResponse; heldResponse = undefined;
        held.ready.resolve(); await held.release.promise;
      }
      return response;
    },
  });
  for (const selector of ['#callflow-canvas', '.flow-menu-launcher']) {
    ui.element(selector).getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });
  }
  const run = ui.evaluate;
  await run('loadOverview()');
  assert.equal(run('state.error'), '');
  run(`state.view='callflow';state.selectedNodeId=flowStartNode().id;
    applyTargetSelection(JSON.stringify({type:'PHONEEXTENSION',title:'Target extension',targetNumber:'239',routeNumber:'239'}));`);
  assert.equal(run('validateFlowDetails().ok'), true);
  requests.length = 0;
  function hold(url) {
    const held = { url, ready: deferred(), release: deferred() }; heldResponse = held;
    t.after(() => held.release.resolve());
    return held;
  }
  function begin(entry = 'stageAndApplyFlowPlan') {
    if (entry === 'applyFlowPlan') run('stageFlowPlan({silent:true})');
    const pending = run(entry + '()');
    assert.equal(run('uiDialog.open && uiDialog.showCancel'), true, 'Apply must offer its existing confirmation');
    return { pending };
  }
  const mutations = () => requests.filter(item => item.method === 'POST');
  const click = selector => {
    const target = { closest: query => query === selector ? target : null };
    for (const listener of listeners.get('click') || []) listener({ target, preventDefault() {}, stopPropagation() {} });
  };
  return { app, run, requests, begin, hold, mutations, click, fail: url => { failedRoute = url; } };
}

for (const entry of ['stageAndApplyFlowPlan', 'applyFlowPlan']) {
  test(`${entry}: one confirmation opts in and applies the prepared callflow`, async t => {
    const { app, run, begin, mutations } = await setup(t);
    const context = run('state.overview.settings.writeContext');
    assert.equal(run('liveWritesEnabled()'), false);
    const { pending } = begin(entry);
    assert.deepEqual(mutations(), [], 'Opening confirmation must not opt in');
    assert.deepEqual(await app.control('writes'), []);
    run('closeUiDialog(true)'); await pending;
    assert.deepEqual(mutations().map(item => item.url), [optInRoute, applyRoute]);
    assert(mutations().every(item => item.headers['X-Portal-Context'] === context));
    assert.equal(JSON.parse(mutations()[0].body).enabled, true);
    assert.equal(JSON.parse(mutations()[1].body).commit, true);
    assert.equal((await app.control('state')).dids[0].dest.ext, '239');
    assert.equal(run('state.flowFeedback.ok'), true);
    assert.equal(run('uiDialog.open'), false, 'No second confirmation remains');
  });
}

test('cancelling Callflow Apply leaves session writes off and routing untouched', async t => {
  const { app, run, begin, mutations } = await setup(t);
  const { pending } = begin(); run('closeUiDialog(false)'); await pending;
  assert.deepEqual(mutations(), []);
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, false);
  assert.deepEqual(await app.control('writes'), []);
});

test('staging a callflow preview does not opt in and still offers Apply', async t => {
  const { app, run, mutations, click } = await setup(t);
  const html = fs.readFileSync(path.join(__dirname, '../public/index.html'), 'utf8');
  const callflow = html.slice(html.indexOf('id="view-callflow"'), html.indexOf('id="view-services"'));
  const applyControl = callflow.match(/<button\b[^>]*\bid="stage-flow"[^>]*>/)?.[0];
  assert.ok(applyControl, 'Apply must exist in the real Callflow toolbar');
  assert.doesNotMatch(applyControl, /\s(?:disabled|hidden)(?:\s|=|>)/);
  run('stageFlowPlan({silent:true});renderActionPlan()');
  assert.equal(run('state.actionPlan.ok'), true);
  assert.equal(run('state.actionPlan.context'), 'callflow');
  assert.equal(run('document.querySelector("#action-plan").hidden'), true, 'Setup must not display a Callflow plan');
  assert.equal(run('localApplyPermitted()'), true);
  assert.deepEqual(mutations(), []);
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, false);
  assert.deepEqual(await app.control('writes'), []);
  click('#stage-flow');
  assert.equal(run('uiDialog.open && uiDialog.showCancel'), true, 'The real toolbar click must reach Apply confirmation');
  run('closeUiDialog(false)');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(run('state.flowApplying'), false);
  assert.deepEqual(mutations(), []);
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, false);
  assert.deepEqual(await app.control('writes'), []);
});

test('failed session opt-in stops Callflow Apply and keeps the draft', async t => {
  const { app, run, begin, mutations, fail } = await setup(t);
  fail(optInRoute);
  const { pending } = begin(); run('closeUiDialog(true)'); await pending;
  assert.deepEqual(mutations().map(item => item.url), [optInRoute]);
  assert.equal(run('state.actionPlan.applied'), false);
  assert.match(run('state.actionPlan.message'), /Synthetic opt-in failure/);
  assert.equal(run('flowStartNode().routeNumber'), '239');
  assert.deepEqual(await app.control('writes'), []);
});

for (const setting of ['state.overview.settings.liveWritesLocked=true', 'state.overview.settings.configured=false', 'state.overview.settings.liveWritesPermitted=false', 'state.daynightActive=true']) {
  test(`Callflow Apply preserves prerequisite: ${setting}`, async t => {
    const { app, run, mutations } = await setup(t);
    run(setting); await run('stageAndApplyFlowPlan()');
    assert.equal(run('uiDialog.showCancel'), false);
    assert.deepEqual(mutations(), []);
    assert.deepEqual(await app.control('writes'), []);
  });
}

test('an account change during confirmation cannot opt in or apply the old callflow', async t => {
  const { app, run, begin, mutations } = await setup(t);
  const { pending } = begin();
  assert.equal((await app.request('/api/settings/customer', { customerAccount: 'K9002' })).status, 200);
  await run('loadOverview()'); run('closeUiDialog(true)'); await pending;
  assert.deepEqual(mutations(), []);
  assert.equal(run('state.overview.settings.liveWritesEnabled'), false);
  assert.deepEqual(await app.control('writes'), []);
});

test('a delayed opt-in response cannot apply a callflow in a replacement session', { timeout: 10000 }, async t => {
  const { app, run, begin, mutations, hold } = await setup(t);
  const held = hold(optInRoute);
  const { pending } = begin(); run('closeUiDialog(true)');
  await held.ready.promise;
  assert.equal((await app.request('/api/settings/customer', { customerAccount: 'K9002' })).status, 200);
  await run('loadOverview()');
  held.release.resolve(); await pending;
  assert.deepEqual(mutations().map(item => item.url), [optInRoute]);
  assert.equal(run('state.overview.settings.liveWritesEnabled'), false);
  assert.equal(run('state.overview.account'), 'K9002');
  assert.deepEqual(await app.control('writes'), []);
});

test('missing preparation context cannot enable session writes', async t => {
  const { app, run, mutations } = await setup(t);
  run('delete state.overview.settings.writeContext;delete state.flow.writeContext');
  const pending = run('stageAndApplyFlowPlan()');
  if (run('uiDialog.open && uiDialog.showCancel')) run('closeUiDialog(true)');
  await pending;
  assert.deepEqual(mutations(), []);
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled, false);
  assert.deepEqual(await app.control('writes'), []);
});

test('an already enabled session applies without a redundant opt-in request', async t => {
  const { app, run, begin, requests, mutations } = await setup(t);
  await run('setLiveWritesEnabled(true)'); requests.length = 0;
  const { pending } = begin(); run('closeUiDialog(true)'); await pending;
  assert.deepEqual(mutations().map(item => item.url), [applyRoute]);
  assert.equal((await app.control('state')).dids[0].dest.ext, '239');
});
