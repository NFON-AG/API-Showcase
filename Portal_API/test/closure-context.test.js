const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/fixture.cjs');

async function snapshot(app) { return (await app.request('/api/overview')).body; }
function payload(view) { return { did: view.inventory.dids[0], target: { type: 'PHONEEXTENSION', routeNumber: '239', number: '239' }, commit: true }; }
async function apply(app, view, context = view.settings.writeContext) {
  const status = (await app.request('/api/status')).body;
  const response = await fetch(`http://127.0.0.1:${app.port}/api/callflow/apply`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': status.settings.csrfToken,
      ...(context ? { 'X-Portal-Context': context } : {}) }, body: JSON.stringify(payload(view)),
  });
  return { status: response.status, body: await response.json() };
}
async function changeAccount(app, account) {
  const status = (await app.request('/api/status')).body;
  const result = await app.request('/api/settings/browser-login', { baseUrl: status.baseUrl,
    apiKeyId: 'retest-portal-key', apiKeySecret: 'retest-portal-secret', customerAccount: account });
  assert.equal(result.status, 200);
  assert.equal(result.body.settings.liveWritesEnabled, false);
  assert.equal((await app.request('/api/settings/live-writes', { enabled: true })).status, 200);
}
for (const sequence of [['K9002'], ['K9002', 'K9001'], ['K9001']]) {
  test(`PORT-01: prepared context rejects a stale tab after ${sequence.join(' then ')}`, async t => {
    const app = await fixture(t, { provider: { customers: 3 } });
    const before = await snapshot(app);
    for (const account of sequence) await changeAccount(app, account);
    const response = await apply(app, before);
    assert.equal(response.status, 409, JSON.stringify(response));
    assert.equal((await app.control('writes')).length, 0, 'stale context cannot issue a provider mutation');
  });
}
test('PORT-01: missing context is rejected, explicitly current context remains usable', async t => {
  const app = await fixture(t);
  const before = await snapshot(app);
  await app.request('/api/settings/live-writes', { enabled: true });
  assert.equal((await apply(app, before, '')).status, 409);
  assert.equal((await app.control('writes')).length, 0);
  const current = await snapshot(app);
  assert.equal(typeof current.settings.writeContext, 'string');
  assert.ok(current.settings.writeContext.length > 20);
  assert.equal((await apply(app, current)).status, 200);
  assert.equal((await app.control('writes')).length, 1);
});
test('PORT-01: a process restart invalidates an otherwise matching prepared context', async t => {
  const app = await fixture(t); const before = await snapshot(app);
  await app.restart(); await app.request('/api/settings/live-writes', { enabled: true });
  assert.equal((await apply(app, before)).status, 409);
  assert.equal((await app.control('writes')).length, 0);
});

test('PORT-01: stale or missing contexts block every account-bound mutation, including write opt-in and local mapping', async t => {
 const app=await fixture(t,{provider:{customers:3}});const before=await snapshot(app);await changeAccount(app,'K9002');
 const routes=['/api/settings/live-writes','/api/callflow/apply','/api/callflow/bulk-apply','/api/service-groups/apply','/api/daynight/preview','/api/daynight/apply','/api/daynight/reset','/api/phonebook-sync/mapping','/api/phonebook-sync/upload','/api/phonebook-sync/apply'];
 const status=(await app.request('/api/status')).body;
 for(const context of ['',before.settings.writeContext])for(const route of routes){
  const response=await fetch(`http://127.0.0.1:${app.port}${route}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':status.settings.csrfToken,...(context?{'X-Portal-Context':context}:{})},body:JSON.stringify({enabled:true,commit:true})});
  assert.equal(response.status,409,route);assert.match((await response.json()).error,/Account changed/);
 }
 assert.equal((await app.control('writes')).length,0);
 assert.equal((await app.request('/api/status')).body.settings.writeContext,status.settings.writeContext,'read-only status does not rotate the context');
});
