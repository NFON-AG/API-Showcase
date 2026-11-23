const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/fixture.cjs');
const { clientRenderer } = require('./helpers/client-render.cjs');

const previewRoute = '/api/daynight/gateway-preview';
const createRoute = '/api/daynight/gateways/apply';
const routingRoute = '/api/daynight/gateway-routing/apply';
const nightTarget = { type: 'PHONEEXTENSION', routeNumber: '239', number: '239', title: 'Synthetic night target' };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function setup(t, environment = {}) {
  const app = await fixture(t, {
    provider: { customers: 3 },
    providerEnv: { MOCK_KEY_ID: 'example-portal-key', MOCK_SECRET: 'example-portal-secret' },
    env: Object.assign(environment, { PORTAL_API_KEY_ID: 'example-portal-key', PORTAL_API_KEY_SECRET: 'example-portal-secret' }),
  });
  const requests = [];
  const storage = new Map();
  const clickHandlers = [];
  let heldResponse;
  let failedRoute;
  const ui = clientRenderer('en', {
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: (name, handler) => { if (name === 'click') clickHandlers.push(handler); } },
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body });
      if (failedRoute === url) return new Response(JSON.stringify({ ok: false, error: 'Synthetic opt-in failure' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
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
  run('window.confirm = () => { throw new Error("Unexpected duplicate native confirmation"); }');
  await run('loadOverview()');
  assert.equal(run('state.error'), '');
  await run('setLiveWritesEnabled(true)');
  run(`state.profileTargetValue = parsedDaynightTargetOptions().find(({target}) => target.type === 'PHONEEXTENSION' && target.routeNumber === '239').option.value`);
  function hold(url) {
    assert.equal(heldResponse, undefined);
    const held = { url, ready: deferred(), release: deferred() }; heldResponse = held;
    t.after(() => held.release.resolve());
    return held;
  }
  function clickDaynightAction(action) {
    const target = { tagName: 'BUTTON', dataset: { daynightModeAction: action }, closest: selector => selector === '[data-daynight-mode-action]' ? target : null };
    for (const handler of clickHandlers) handler({ target, preventDefault() {}, stopPropagation() {} });
  }
  return { app, run, requests, hold, clickDaynightAction, fail: url => { failedRoute = url; } };
}

test('one-click night setup prepares, verifies, and activates with one context and no duplicate confirmation', async t => {
  const { app, run, requests } = await setup(t);
  const context = run('state.overview.settings.writeContext');
  assert.equal(run('readProfile("standard")'), null);
  assert.equal(await run('prepareAndActivateNightMode()'), true, run('JSON.stringify(state.daynightModeModal)'));
  const routes = requests.filter(item => item.url.startsWith('/api/daynight/')).map(item => item.url);
  const created = routes.indexOf(createRoute);
  const routed = routes.indexOf(routingRoute);
  assert(created > routes.indexOf(previewRoute), 'Preview must precede creation');
  assert(routes.slice(created + 1, routed).includes(previewRoute), 'Creation must be verified before routing');
  assert(routed > created);
  assert(requests.filter(item => item.url.startsWith('/api/daynight/')).every(item => item.headers['X-Portal-Context'] === context));
  assert.equal(run('state.daynightActive'), true);
  assert.equal(run('readProfile("standard").dids.length'), 4, 'Day routing is saved automatically');
  const after = await app.control('state?account=K9001');
  assert(after.dids.every(item => item.dest.type === 'TIMECONTROL'));
});

test('one-click night setup stops before routing when gateway creation fails', async t => {
  const { app, run, requests } = await setup(t);
  await app.control('patch', { writeFail: { path: '/time-control-services$', method: 'POST', nth: 1, status: 500 } });
  assert.equal(await run('prepareAndActivateNightMode()'), false);
  assert(requests.some(item => item.url === createRoute));
  assert(!requests.some(item => item.url === routingRoute));
  assert.equal(run('state.daynightActive'), false);
  assert((await app.control('state?account=K9001')).dids.every(item => item.dest.type === 'PHONEEXTENSION'));
});

test('one-click night setup stops when its preparation context changes', async t => {
  const { app, run, requests, hold } = await setup(t);
  const held = hold(previewRoute);
  const pending = run('prepareAndActivateNightMode()');
  await held.ready.promise;
  const changed = await app.request('/api/settings/customer', { customerAccount: 'K9002' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  await run('loadOverview()');
  await run('setLiveWritesEnabled(true)');
  held.release.resolve();
  assert.equal(await pending, false);
  assert(!requests.some(item => item.url === createRoute || item.url === routingRoute));
  assert.deepEqual(await app.control('writes'), []);
});

test('one-click night setup skips creation for prepared gateways', async t => {
  const { app, run, requests } = await setup(t);
  assert.equal((await app.request(createRoute, { nightTarget })).status, 200);
  await run('loadOverview()');
  requests.length = 0;
  assert.equal(await run('prepareAndActivateNightMode()'), true);
  assert(requests.some(item => item.url === previewRoute));
  assert(!requests.some(item => item.url === createRoute));
  assert.equal(requests.filter(item => item.url === routingRoute).length, 1);
  assert.equal(run('state.daynightActive'), true);
});

test('one-click night setup is idempotent when night routing is already active', async t => {
  const { app, run, requests } = await setup(t);
  assert.equal((await app.request(createRoute, { nightTarget })).status, 200);
  assert.equal((await app.request(routingRoute, { nightTarget })).status, 200);
  await run('loadOverview()');
  assert.equal(run('state.daynightActive'), true);
  requests.length = 0;
  await app.control('clearlog', {});
  assert.equal(await run('prepareAndActivateNightMode()'), true);
  assert.deepEqual(requests, []);
  assert.deepEqual(await app.control('writes'), []);
});

test('one-click night setup stops when the selected night target changes during preview', async t => {
  const { app, run, requests, hold } = await setup(t);
  const held = hold(previewRoute);
  const pending = run('prepareAndActivateNightMode()');
  await held.ready.promise;
  run(`state.profileTargetValue = parsedDaynightTargetOptions().find(({target}) => target.type === 'PHONEEXTENSION' && target.routeNumber === '238').option.value`);
  held.release.resolve();
  assert.equal(await pending, false);
  assert(!requests.some(item => item.url === createRoute || item.url === routingRoute));
  assert.deepEqual(await app.control('writes'), []);
});

test('explicit one-click night setup opts in to session writes and activates with the captured context', async t => {
  const { app, run, requests } = await setup(t);
  await run('setLiveWritesEnabled(false)');
  const context = run('state.overview.settings.writeContext');
  assert.equal(run('portalLiveWritesEnabled()'), false);
  assert.doesNotMatch(run('daynightSetupActionMarkup()'), /id="prepare-and-activate-night-mode"[^>]*\bdisabled\b/, 'The explicit setup button remains available when session writes are off');
  requests.length = 0;
  assert.equal(await run('prepareAndActivateNightMode()'), true);
  const optIn = requests.filter(item => item.url === '/api/settings/live-writes');
  assert.equal(optIn.length, 1);
  assert.deepEqual(JSON.parse(optIn[0].body), { enabled: true });
  assert.equal(optIn[0].headers['X-Portal-Context'], context);
  assert(requests.indexOf(optIn[0]) < requests.findIndex(item => item.url === createRoute));
  assert(requests.filter(item => item.url.startsWith('/api/daynight/')).every(item => item.headers['X-Portal-Context'] === context));
  assert.equal(run('state.daynightActive'), true);
  assert((await app.control('state?account=K9001')).dids.every(item => item.dest.type === 'TIMECONTROL'));
});

test('one-click night setup stops all preparation when explicit session opt-in fails', async t => {
  const { app, run, requests, fail } = await setup(t);
  await run('setLiveWritesEnabled(false)');
  requests.length = 0;
  fail('/api/settings/live-writes');
  assert.equal(await run('prepareAndActivateNightMode()'), false);
  assert.equal(requests.filter(item => item.url === '/api/settings/live-writes').length, 1);
  assert(!requests.some(item => item.url.startsWith('/api/daynight/')));
  assert.equal(run('portalLiveWritesEnabled()'), false);
  assert.deepEqual(await app.control('writes'), []);
});

test('one-click night setup cannot carry a delayed session opt-in across an account change', { timeout: 10000 }, async t => {
  const { app, run, requests, hold } = await setup(t);
  await run('setLiveWritesEnabled(false)');
  requests.length = 0;
  const context = run('state.overview.settings.writeContext');
  const held = hold('/api/settings/live-writes');
  const pending = run('prepareAndActivateNightMode()');
  await held.ready.promise;
  const changed = await app.request('/api/settings/customer', { customerAccount: 'K9002' });
  assert.equal(changed.status, 200, JSON.stringify(changed.body));
  await run('loadOverview()');
  held.release.resolve();
  assert.equal(await pending, false);
  assert.equal(run('state.overview.account'), 'K9002');
  assert.equal(run('portalLiveWritesEnabled()'), false);
  assert.notEqual(run('state.overview.settings.writeContext'), context);
  assert.equal(requests.find(item => item.url === '/api/settings/live-writes').headers['X-Portal-Context'], context);
  assert(!requests.some(item => item.url.startsWith('/api/daynight/')));
  assert.deepEqual(await app.control('writes'), []);
});

test('one-click night setup preserves the hard write lock without requesting session opt-in', async t => {
  const { app, run, requests } = await setup(t);
  run('state.overview.settings.liveWritesLocked = true');
  requests.length = 0;
  assert.equal(await run('prepareAndActivateNightMode()'), false);
  assert(!requests.some(item => item.url === '/api/settings/live-writes' || item.url.startsWith('/api/daynight/')));
  assert.deepEqual(await app.control('writes'), []);
});

test('one-click night setup creates a selected announcement target before preparing routing', { timeout: 10000 }, async t => {
  const { app, run, requests } = await setup(t);
  run(`state.profileTargetValue = daynightTargetOptions().find(option => option.kind === 'NEW_NIGHT_TARGET').value;
    state.daynightAnnouncementName = 'Announcement 0';
    state.daynightAnnouncementDisplayName = 'Synthetic one-click night announcement';
    state.daynightAnnouncementDisplayNameEdited = true;
    state.daynightAnnouncementAfterValue = JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239'});`);
  assert.equal(await run('prepareAndActivateNightMode()'), true, JSON.stringify({ requests: requests.map(item => item.url), state: run('JSON.stringify({modal:state.daynightModeModal,preview:state.daynightGatewayPreview,target:state.profileTargetValue})') }));
  const routes = requests.map(item => item.url);
  const planned = routes.indexOf('/api/daynight/announcement-target/plan');
  const announced = routes.indexOf('/api/daynight/announcement-target/apply');
  assert(planned >= 0 && announced > planned);
  assert(routes.indexOf(createRoute) > announced);
  assert(routes.indexOf(routingRoute) > routes.indexOf(createRoute));
  assert.equal(run('state.daynightActive'), true);
  assert.equal(run('uiDialog.open && uiDialog.showCancel'), false, 'No intermediate confirmation is left open');
  assert.equal((await app.control('state?account=K9001')).ivrs.length, 2);
});

test('one-click night setup updates outdated gateways before activating the new night target', async t => {
  const { app, run, requests } = await setup(t);
  assert.equal((await app.request(createRoute, { nightTarget: { ...nightTarget, routeNumber: '238', number: '238' } })).status, 200);
  await run('loadOverview()');
  await run('previewDaynightGateway()');
  assert.equal(run('state.daynightGatewayPreview.summary.gatewaysToUpdate'), 4);
  assert.equal(run('daynightActivationReady()'), false, 'Outdated gateways are not ready for the selected night target');
  requests.length = 0;
  assert.equal(await run('prepareAndActivateNightMode()'), true);
  assert.equal(requests.filter(item => item.url === createRoute).length, 1);
  assert.equal(requests.filter(item => item.url === routingRoute).length, 1);
  const after = await app.control('state?account=K9001');
  assert(after.tcs.filter(item => item.serviceNumber !== '0').every(item => item.denied.endsWith('/239')));
});

test('header day-mode confirmation restores routing without a second native confirmation', { timeout: 10000 }, async t => {
  const { app, run, requests, clickDaynightAction } = await setup(t);
  assert.equal(await run('prepareAndActivateNightMode()'), true);
  await run('toggleDaynightMode(false)');
  assert.equal(run('state.daynightModeModal.mode'), 'confirm-day');
  requests.length = 0;
  clickDaynightAction('activate-day');
  const deadline = Date.now() + 3000;
  while (run('state.daynightActive || state.daynightGatewayResetLoading') && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(run('state.daynightActive'), false);
  assert.equal(run('state.daynightGatewayResetLoading'), false);
  assert.equal(requests.filter(item => item.url === '/api/daynight/restore').length, 1);
  const after = await app.control('state?account=K9001');
  assert(after.dids.every(item => item.dest.type === 'PHONEEXTENSION'));
  assert.equal(after.tcs.length, 5, 'Prepared gateways are retained for the next activation');
});

async function nightWithSessionOff(t, environment = {}) {
  const env = await setup(t, environment);
  assert.equal(await env.run('prepareAndActivateNightMode()'), true);
  await env.run('setLiveWritesEnabled(false)');
  assert.equal(env.run('state.daynightActive'), true);
  assert.equal(env.run('portalLiveWritesEnabled()'), false);
  await env.app.control('clearlog', {});
  env.requests.length = 0;
  return env;
}
async function settle(check) {
  const deadline = Date.now() + 5000;
  while (!check()) { assert(Date.now() < deadline, 'Day/night operation did not settle'); await new Promise(resolve=>setTimeout(resolve,10)); }
}

test('session-off header restores day routing through its one existing confirmation', async t => {
  const {app,run,requests,clickDaynightAction}=await nightWithSessionOff(t);
  await run('toggleDaynightMode(false)');
  assert.equal(run('state.daynightModeModal.mode'),'confirm-day');
  assert.deepEqual(requests,[]);
  clickDaynightAction('activate-day');
  await settle(()=>run('!state.daynightActive && !state.daynightGatewayResetLoading'));
  assert.deepEqual(requests.filter(item=>item.method==='POST').map(item=>item.url),['/api/settings/live-writes','/api/daynight/restore','/api/daynight/gateway-preview']);
  assert.equal(run('uiDialog.open && uiDialog.showCancel'),false,'No extra app confirmation');
  assert((await app.control('state')).dids.every(did=>did.dest.type==='PHONEEXTENSION'));
});

test('session-off header Cancel keeps night routing and session writes off', async t => {
  const {app,run,requests,clickDaynightAction}=await nightWithSessionOff(t);
  await run('toggleDaynightMode(false)');assert.equal(run('state.daynightModeModal.mode'),'confirm-day');
  clickDaynightAction('close');
  assert.deepEqual(requests,[]);assert.deepEqual(await app.control('writes'),[]);
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled,false);
});

test('session-off restore reports opt-in failure and retains night routing', async t => {
  const {app,run,requests,fail}=await nightWithSessionOff(t);
  fail('/api/settings/live-writes');
  assert.equal(await run('restoreDaynightRouting({fromHeaderSwitch:true,skipConfirm:true})'),false);
  assert(requests.some(item=>item.url==='/api/settings/live-writes'));
  assert(!requests.some(item=>item.url==='/api/daynight/restore'));
  assert.match(run('state.daynightModeModal.message'),/Synthetic opt-in failure/);
  assert.equal(run('state.daynightActive'),true);assert.deepEqual(await app.control('writes'),[]);
});

for(const refresh of [false,true]) test(`session-off restore cannot cross an account change (refresh ${refresh})`,async t=>{
  const {app,run,requests,hold}=await nightWithSessionOff(t);
  const held=hold('/api/settings/live-writes');
  const pending=run('restoreDaynightRouting({fromHeaderSwitch:true,skipConfirm:true})');
  await Promise.race([held.ready.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('Restore did not request session opt-in')),1500))]);
  assert.equal((await app.request('/api/settings/customer',{customerAccount:'K9002'})).status,200);
  if(refresh) await run('loadOverview()');
  held.release.resolve();await pending;
  assert.deepEqual(await app.control('writes'),[]);
  assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled,false);
  if(refresh) assert(!requests.some(item=>item.url==='/api/daynight/restore'));
});

test('session-off restore respects a hard read-only server after restart',async t=>{
  const environment={};const {app,run,requests}=await nightWithSessionOff(t,environment);
  environment.PORTAL_DISABLE_LIVE_WRITES='true';await app.restart();await run('loadOverview()');
  assert.equal(run('state.overview.settings.liveWritesLocked'),true);assert.equal(run('state.daynightActive'),true);
  requests.length=0;await run('toggleDaynightMode(false)');
  assert.notEqual(run('state.daynightModeModal.mode'),'confirm-day');
  assert.equal(await run('restoreDaynightRouting({fromHeaderSwitch:true,skipConfirm:true})'),false);
  assert(!requests.some(item=>item.url==='/api/settings/live-writes'||item.url==='/api/daynight/restore'));
  assert.deepEqual(await app.control('writes'),[]);
});

test('session-off announcement-target creation uses its existing confirmation without Setup',async t=>{
  const {app,run,requests}=await setup(t);
  run(`state.daynightUseAnnouncement=true;state.daynightAnnouncementName='Announcement 0';state.daynightAnnouncementDisplayName='Direct announcement';state.daynightAnnouncementDisplayNameEdited=true;state.daynightAnnouncementAfterValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239'});`);
  await run('planDaynightAnnouncementTarget()');assert.equal(run('state.daynightGatewayPreview.ok'),true);
  await run('setLiveWritesEnabled(false)');requests.length=0;
  const pending=run('applyDaynightAnnouncementTarget()');
  assert.equal(run('uiDialog.open && uiDialog.showCancel'),true);
  assert.deepEqual(requests,[]);run('closeUiDialog(true)');await pending;
  assert.deepEqual(requests.filter(item=>item.method==='POST').map(item=>item.url),['/api/settings/live-writes','/api/daynight/announcement-target/apply']);
  assert.equal((await app.control('state')).ivrs.length,2);
});
