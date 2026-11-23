const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/fixture.cjs');
const { clientRenderer } = require('./helpers/client-render.cjs');
const fixtureOptions = {
  provider: { customers: 3 },
  providerEnv: { MOCK_KEY_ID: 'example-portal-key', MOCK_SECRET: 'example-portal-secret' },
  env: { PORTAL_API_KEY_ID: 'example-portal-key', PORTAL_API_KEY_SECRET: 'example-portal-secret' },
};
const row = { extensionNumber: '888', displayName: 'Prepared for account A', mailboxPin: '1234' };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function setup(t) {
  const app = await fixture(t, fixtureOptions);
  const requests = [];
  let pendingResponse;
  const ui = clientRenderer('en', {
    // The complete client uses real HTTP. Only the transport delivery can be held.
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', headers: options.headers, body: options.body });
      const response = await fetch(`http://127.0.0.1:${app.port}${url}`, options);
      if (pendingResponse?.url === url) {
        const held = pendingResponse; pendingResponse = null;
        held.ready.resolve(); await held.release.promise;
      }
      return response;
    },
    FormData: class { constructor(values) { this.values = values; } entries() { return Object.entries(this.values); } },
  });
  const run = ui.evaluate;
  await run('loadOverview()');
  assert.equal(run('state.error'), '');
  async function login(account) {
    const status = (await app.request('/api/status')).body;
    await run(`applyBrowserLogin(${JSON.stringify({ baseUrl: status.baseUrl, apiKeyId: fixtureOptions.env.PORTAL_API_KEY_ID, apiKeySecret: fixtureOptions.env.PORTAL_API_KEY_SECRET, customerAccount: account })})`);
    assert.equal(run('state.browserLoginFeedback.ok'), true);
    assert.equal(run('state.overview.account'), account);
    assert.equal(run('state.overview.settings.liveWritesEnabled'), false);
    await run('setLiveWritesEnabled(true)');
    assert.equal(run('state.overview.settings.liveWritesEnabled'), true);
  }
  async function prepare(number = '888', name = row.displayName) {
    run(`state.extensionBatchRows = [${JSON.stringify({ ...row, extensionNumber: number, displayName: name })}]`);
    await run('planExtensionBatch()');
    assert.equal(run('state.extensionBatchPlan.ok'), true);
  }
  function hold(url) {
    assert.equal(pendingResponse, undefined);
    const held = { url, ready: deferred(), release: deferred() }; pendingResponse = held;
    t.after(() => held.release.resolve());
    return held;
  }
  return { app, ui, run, requests, login, prepare, hold };
}
for (const sequence of [['K9002'], ['K9002', 'K9001'], ['K9001']]) {
  test(`PORT-01 batch preparation expires after browser login ${sequence.join(' → ')}`, async t => {
    const { app, run, login, prepare } = await setup(t);
    await prepare();
    for (const account of sequence) await login(account);
    assert.equal(run('Boolean(state.extensionBatchPlan?.ok)'), false, 'A checked plan must not survive a session change');
    assert.equal(run('state.extensionBatchRows.some(row => row.displayName === "Prepared for account A")'), false, 'Account data is cleared');
    const applying = run('applyExtensionBatch()'); run('closeUiDialog(true)'); await applying;
    assert.deepEqual(await app.control('writes'), []);
  });
}
for (const sequence of [['K9002'], ['K9002', 'K9001'], ['K9001']]) {
  test(`PORT-01 pending batch confirmation cannot migrate after ${sequence.join(' → ')}`, async t => {
    const { app, run, login, prepare } = await setup(t);
    await run('setLiveWritesEnabled(true)'); await prepare();
    const applying = run('applyExtensionBatch()');
    assert.equal(run('uiDialog.showCancel && uiDialog.open'), true);
    for (const account of sequence) await login(account);
    await prepare('889', 'Current session batch');
    run('closeUiDialog(true)'); await applying;
    assert.deepEqual(await app.control('writes'), [], 'The old confirmation must never apply the new session or new payload');
    assert.equal(run('state.extensionBatchPlan.entries[0].displayName'), 'Current session batch');
  });
}
test('PORT-01 batch confirmation keeps the checked payload immutable and editing requires recheck', async t => {
  const { app, run, prepare } = await setup(t);
  await run('setLiveWritesEnabled(true)'); await prepare();
  const applying = run('applyExtensionBatch()');
  run(`setExtensionBatchField({dataset:{extensionBatchRow:'0'}},'displayName','Edited after confirmation opened')`);
  run('closeUiDialog(true)'); await applying;
  assert.deepEqual(await app.control('writes'), [], 'An edited unchecked row cannot be submitted by an earlier confirmation');
  await run('planExtensionBatch()');
  const current = run('applyExtensionBatch()'); run('closeUiDialog(true)'); await current;
  assert.equal((await app.control('state?account=K9001')).ext, 41);
  const overview = (await app.request('/api/overview')).body;
  assert.equal(overview.inventory.extensions.find(item => item.number === '888').name, 'Edited after confirmation opened');
});
test('PORT-01 current checked batch applies with its original preparation context', async t => {
  const { app, run, requests, prepare } = await setup(t);
  await run('setLiveWritesEnabled(true)'); await prepare();
  const prepared = run('state.overview.settings.writeContext');
  const applying = run('applyExtensionBatch()'); run('closeUiDialog(true)'); await applying;
  assert.equal((await app.control('state?account=K9001')).ext, 41);
  const request = requests.find(item => item.url === '/api/extensions/batch/apply');
  assert.equal(request.headers['X-Portal-Context'], prepared);
  assert.equal(JSON.parse(request.body).rows[0].displayName, row.displayName);
  assert.equal(run('state.extensionBatchPlan.applied'), true);
});
for (const change of ['login', 'edit', 'newer-plan']) test(`PORT-01 late batch plan cannot overwrite ${change}`, async t => {
  const { app, run, login, prepare, hold } = await setup(t);
  run(`state.extensionBatchRows = [${JSON.stringify(row)}]`);
  const delayed = hold('/api/extensions/batch/plan');
  const oldPlan = run('planExtensionBatch()'); await delayed.ready.promise;
  if (change === 'login') await login('K9002');
  run(`setExtensionBatchField({dataset:{extensionBatchRow:'0'}},'displayName','New draft')`);
  if (change !== 'edit') await prepare('889', 'Current plan');
  delayed.release.resolve(); await oldPlan;
  if (change === 'edit') assert.equal(run('state.extensionBatchPlan'), null);
  else assert.equal(run('state.extensionBatchPlan.entries[0].displayName'), 'Current plan');
  assert.equal(run('state.extensionBatchLoading'), false);
  assert.deepEqual(await app.control('writes'), []);
});
for (const mode of ['customer', 'same-account-login']) test(`PORT-01 HTTP rejects batch context after ${mode}, current context still succeeds`, async t => {
  const app = await fixture(t, fixtureOptions);
  const original = (await app.request('/api/status')).body;
  assert.equal((await app.request('/api/extensions/batch/plan', { rows: [row] })).body.ok, true);
  if (mode === 'customer') assert.equal((await app.request('/api/settings/customer', { customerAccount: 'K9002' })).status, 200);
  else assert.equal((await app.request('/api/settings/browser-login', { baseUrl: original.baseUrl, apiKeyId: 'example-portal-key', apiKeySecret: 'example-portal-secret', customerAccount: 'K9001' })).status, 200);
  await app.request('/api/settings/live-writes', { enabled: true });
  const response = await fetch(`http://127.0.0.1:${app.port}/api/extensions/batch/apply`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': original.settings.csrfToken, 'X-Portal-Context': original.settings.writeContext }, body: JSON.stringify({ rows: [row] }) });
  assert.equal(response.status, 409); assert.deepEqual(await app.control('writes'), []);
  assert.equal((await app.request('/api/extensions/batch/plan', { rows: [row] })).body.ok, true);
  assert.equal((await app.request('/api/extensions/batch/apply', { rows: [row] })).status, 200);
});
test('PORT-01 a refreshed account never upgrades an existing checked batch context', async t => {
  const { app, run, prepare } = await setup(t);
  await run('setLiveWritesEnabled(true)'); await prepare();
  assert.equal((await app.request('/api/settings/customer', { customerAccount: 'K9002' })).status, 200);
  await run('loadOverview();'); await run('setLiveWritesEnabled(true)');
  const applying = run('applyExtensionBatch()'); run('closeUiDialog(true)'); await applying;
  assert.deepEqual(await app.control('writes'), []);
});
test('PORT-01 late batch apply completion cannot replace the new account plan', async t => {
  const { app, run, prepare, login, hold } = await setup(t);
  await run('setLiveWritesEnabled(true)'); await prepare();
  const delayed = hold('/api/extensions/batch/apply');
  const applying = run('applyExtensionBatch()'); run('closeUiDialog(true)'); await delayed.ready.promise;
  await login('K9002'); await prepare('889', 'New account plan');
  delayed.release.resolve(); await applying;
  assert.equal(run('state.extensionBatchPlan.entries[0].displayName'), 'New account plan');
  assert.equal(run('state.overview.account'), 'K9002');
  assert.equal((await app.control('state?account=K9001')).ext, 41, 'Already submitted A operation completes in A');
  assert.equal((await app.control('state?account=K9002')).ext, 40);
});
for (const operation of ['deleteResource', 'applyDaynightAnnouncementTarget']) {
  for (const sequence of [['K9002'], ['K9002', 'K9001'], ['K9001']]) test(`PORT-01 ${operation} confirmation expires after ${sequence.join(' → ')}`, async t => {
    const { app, run, login } = await setup(t);
    await run('setLiveWritesEnabled(true)');
    run(`state.daynightAnnouncementName='Announcement 0'; state.daynightAnnouncementDisplayName='Prepared under A'; state.daynightAnnouncementDisplayNameEdited=true; state.daynightAnnouncementAfterValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239'});`);
    const pending = run(operation === 'deleteResource' ? `deleteResource('queues','501')` : 'applyDaynightAnnouncementTarget()');
    assert.equal(run('uiDialog.open && uiDialog.showCancel'), true);
    for (const account of sequence) await login(account);
    run('closeUiDialog(true)'); await pending;
    assert.deepEqual(await app.control('writes'), []);
  });
}
test('PORT-01 pending profile confirmation cannot apply a replacement plan in a new session', async t => {
  const { app, run, login } = await setup(t);
  await run('setLiveWritesEnabled(true)');
  const stage = `stageProfilePlan('Prepared profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`;
  await run(stage); assert.equal(run('state.actionPlan.ok'), true);
  const pending = run('applyProfilePlan()');
  await login('K9002'); await run(stage);
  run('closeUiDialog(true)'); await pending;
  assert.deepEqual(await app.control('writes'), []);
});
test('PORT-01 late profile plan does not replace a new session plan', async t => {
  const { app, run, login, hold } = await setup(t);
  const delayed = hold('/api/callflow/bulk-apply');
  const pending = run(`stageProfilePlan('Old profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`);
  await delayed.ready.promise; await login('K9002');
  await run(`stageProfilePlan('Current profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'238',number:'238'}}], '')`);
  delayed.release.resolve(); await pending;
  assert.equal(run('state.actionPlan.profileName'), 'Current profile');
  assert.deepEqual(await app.control('writes'), []);
});
for (const operation of ['deleteResource', 'applyDaynightAnnouncementTarget', 'applyProfilePlan']) test(`PORT-01 current-session ${operation} remains usable`, async t => {
  const { app, run, requests } = await setup(t);
  await run('setLiveWritesEnabled(true)');
  const context = run('state.overview.settings.writeContext');
  if (operation === 'applyDaynightAnnouncementTarget') run(`state.daynightAnnouncementName='Announcement 0';state.daynightAnnouncementDisplayName='Current announcement';state.daynightAnnouncementDisplayNameEdited=true;state.daynightAnnouncementAfterValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239'});`);
  if (operation === 'applyProfilePlan') await run(`stageProfilePlan('Current profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`);
  const pending = run(operation === 'deleteResource' ? `deleteResource('queues','501')` : operation + '()');
  run('closeUiDialog(true)'); await pending;
  const writes = await app.control('writes'); assert(writes.length > 0);
  assert(writes.every(item => item.path.includes('/K9001/')));
  const provider = await app.control('state?account=K9001');
  if (operation === 'deleteResource') assert.equal(provider.queues.includes('501'), false);
  if (operation === 'applyDaynightAnnouncementTarget') assert.equal(provider.ivrs.length, 2);
  if (operation === 'applyProfilePlan') assert.equal(provider.dids[0].dest.ext, '239');
  assert.equal(run('uiDialog.type'), 'success');
  const mutation = requests.findLast(item => item.method !== 'GET' && !item.url.startsWith('/api/settings/'));
  assert.equal(mutation.headers['X-Portal-Context'], context);
});
test('PORT-01 a late profile apply response preserves the new account plan', async t => {
  const { app, run, login, hold } = await setup(t);
  await run('setLiveWritesEnabled(true)');
  const stage = name => `stageProfilePlan('${name}', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`;
  await run(stage('Old profile'));
  const delayed = hold('/api/callflow/bulk-apply');
  const pending = run('applyProfilePlan()'); run('closeUiDialog(true)'); await delayed.ready.promise;
  await login('K9002'); await run(stage('New profile'));
  delayed.release.resolve(); await pending;
  assert.equal(run('state.actionPlan.profileName'), 'New profile');
  assert.equal((await app.control('state?account=K9002')).dids[0].dest.ext, '200');
});
test('PORT-01 a failed current profile apply remains visible and retryable', async t => {
  const { app, run } = await setup(t);
  await run('setLiveWritesEnabled(true)');
  await run(`stageProfilePlan('Current profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`);
  await app.control('patch', { writeFail: { path: '/destination$', method: 'PUT', nth: 1, status: 500 } });
  const pending = run('applyProfilePlan()'); run('closeUiDialog(true)'); await pending;
  assert.equal(run('state.actionPlan.ok'), false);
  assert.equal(run('uiDialog.type'), 'error');
  assert.equal((await app.control('state?account=K9001')).dids[0].dest.ext, '200');
});
test('PORT-01 late gateway preview cannot replace a new account preview', async t => {
  const { app, run, login, hold } = await setup(t);
  const target = `state.profileTargetValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239',number:'239',title:'Synthetic target'})`;
  run(target); const delayed = hold('/api/daynight/gateway-preview');
  const pending = run('previewDaynightGateway()'); await delayed.ready.promise;
  await login('K9002'); run(target); await run('previewDaynightGateway()');
  const current = run('JSON.stringify(state.daynightGatewayPreview)');
  delayed.release.resolve(); await pending;
  assert.equal(run('JSON.stringify(state.daynightGatewayPreview)'), current);
  assert.deepEqual(await app.control('writes'), []);
});
test('PORT-01 late phonebook preview cannot replace a new account plan', async t => {
  const { app, run, login, hold } = await setup(t);
  run(`state.phonebookManualRows=[{firstName:'Synthetic',name:'Prepared A',phone:'+4930123456'}];state.phonebookManualDirty=true`);
  const delayed = hold('/api/phonebook-sync/preview');
  const pending = run('stagePhonebookSync()'); await delayed.ready.promise;
  await login('K9002');
  await run(`stageProfilePlan('Current B profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`);
  const current = run('JSON.stringify(state.actionPlan)');
  delayed.release.resolve(); await pending;
  assert.equal(run('JSON.stringify(state.actionPlan)'), current);
  assert.deepEqual(await app.control('writes'), []);
});
test('PORT-01 current phonebook comparison still applies its prepared contacts', async t => {
  const { app, run, requests } = await setup(t);
  await run('setLiveWritesEnabled(true)');
  const context = run('state.overview.settings.writeContext');
  run(`state.phonebookManualRows=[{firstName:'Synthetic',name:'Current contact',phone:'+4930123456'}];state.phonebookManualDirty=true`);
  await run('stagePhonebookSync()'); assert.equal(run('state.actionPlan.ok'), true);
  await run('applyPhonebookSync()');
  assert.equal((await app.control('state?account=K9001')).pb.length, 31);
  assert.equal(requests.find(item => item.url === '/api/phonebook-sync/apply').headers['X-Portal-Context'], context);
});
test('PORT-01 a delayed manual upload cannot repopulate a new login or continue its preview', async t => {
  const { app, run, requests, login, hold } = await setup(t);
  run(`state.phonebookManualRows=[{firstName:'Synthetic',name:'Old A contact',phone:'+4930123456'}];state.phonebookManualDirty=true`);
  const delayed = hold('/api/phonebook-sync/upload');
  const pending = run('stagePhonebookSync()'); await delayed.ready.promise;
  await login('K9002'); const context = run('state.overview.settings.writeContext');
  delayed.release.resolve(); await pending;
  assert.equal(run('state.overview.settings.writeContext'), context);
  assert.equal(run('state.phonebookManualRows.length'), 0);
  assert.equal(requests.filter(item => item.url === '/api/phonebook-sync/preview').length, 0);
  assert.deepEqual(await app.control('writes'), []);
});
for (const refreshed of [false, true]) test(`PORT-01 gateway prepared context ${refreshed ? 'cannot migrate after Refresh' : 'remains usable'}`, async t => {
  const { app, run } = await setup(t);
  run('window.confirm=()=>{throw new Error("Unexpected native confirmation")}');
  await run('setLiveWritesEnabled(true)');
  run(`state.profileTargetValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239',number:'239',title:'Synthetic target'})`);
  await run('previewDaynightGateway()'); assert.equal(run('state.daynightGatewayPreview.ok'), true);
  if (refreshed) {
    assert.equal((await app.request('/api/settings/customer', { customerAccount: 'K9002' })).status, 200);
    await run('loadOverview()'); await run('setLiveWritesEnabled(true)');
  }
  const pending = run('applyDaynightGateways()');
  if (!refreshed) { assert.equal(run('uiDialog.open && uiDialog.showCancel'), true); run('closeUiDialog(true)'); }
  await pending;
  const writes = await app.control('writes');
  if (refreshed) assert.deepEqual(writes, []);
  else {
    assert(writes.length > 0); assert(writes.every(item => item.path.includes('/K9001/')));
    assert.equal((await app.control('state?account=K9001')).tcs.length, 5);
    assert.equal(run('state.daynightGatewayPreview.ok'), true);
  }
});
test('PORT-01 late generic extension preview leaves the current prepared plan intact', async t => {
  const { run, login, hold } = await setup(t);
  const delayed = hold('/api/demo/create-extension');
  const pending = run(`submitAction({extensionNumber:'888',displayName:'Old extension'},'/api/demo/create-extension')`);
  await delayed.ready.promise; await login('K9002');
  await run(`stageProfilePlan('Current B profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`);
  const current = run('JSON.stringify(state.actionPlan)');
  delayed.release.resolve(); await pending;
  assert.equal(run('JSON.stringify(state.actionPlan)'), current);
});
test('PORT-01 another current-session plan does not leave phonebook comparison loading', async t => {
  const { run, hold } = await setup(t);
  run(`state.phonebookManualRows=[{firstName:'Synthetic',name:'Current contact',phone:'+4930123456'}];state.phonebookManualDirty=true`);
  const delayed = hold('/api/phonebook-sync/preview');
  const pending = run('stagePhonebookSync()'); await delayed.ready.promise;
  await run(`stageProfilePlan('Current profile', [{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}], '')`);
  delayed.release.resolve(); await pending;
  assert.equal(run('state.actionPlan.profileName'), 'Current profile');
  assert.equal(run('state.phonebookSyncLoading'), false);
  await run('stagePhonebookSync()'); assert.equal(run('state.actionPlan.type'), 'phonebook-sync');
  assert.equal(run('state.phonebookSyncLoading'), false);
});
