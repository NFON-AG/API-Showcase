const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../src/server.js'), 'utf8');

function harness(t, options = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'portal-audit-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = [];
  const members = new Map([['queue', ['201', '202']], ['skill', ['201', '202']]]);
  const state = { memberError: false, failedCollection: '', repeatedPage: false, total: 40, ...options };
  const item = (href, fields = {}) => ({ href, ...fields });
  const context = vm.createContext({
    require(name) {
      if (name === "./messages.cjs") return require("../src/messages.cjs");
      if (name === "./server-safety.cjs") return require('../src/server-safety.cjs');
      if (name === 'fs') return { ...fs, existsSync: () => false };
      return require(name);
    },
    process: { cwd: () => directory, env: { NFON_SHOWCASE_CONFIG_DIR: directory, PORTAL_DATA_DIR: directory, PORTAL_API_KEY_ID: 'fixture', PORTAL_API_KEY_SECRET: 'fixture-secret', PORTAL_CUSTOMER_ACCOUNT: 'TEST', PORTAL_BASE_URL: 'https://portal.invalid', PORTAL_ENABLE_LIVE_WRITES: 'true' } },
    Buffer, URL, Date, console, AbortSignal, setTimeout,
    async fetch(url, request) {
      assert.equal(url.origin, 'https://portal.invalid', 'no external endpoint');
      calls.push({ path: url.pathname, search: url.search, method: request.method, body: request.body && JSON.parse(request.body) });
      if (state.delay && url.pathname.endsWith('/devices')) await state.delay;
      if (state.failedCollection && url.pathname.endsWith('/' + state.failedCollection)) return new Response('Failure', { status: 503 });
      const memberMatch = url.pathname.match(/\/(queue|skill)-services\/\d+\/members(?:\/(\d+))?$/);
      if (memberMatch) {
        const kind = memberMatch[1];
        if (request.method === 'GET' && state.memberError) return new Response('<svg onload=alert(1)>', { status: 503 });
        if (request.method === 'DELETE') members.set(kind, members.get(kind).filter(number => number !== memberMatch[2]));
        if (request.method === 'POST') members.get(kind).push(JSON.parse(request.body).links[0].href.split('/').pop());
        return Response.json({ items: members.get(kind).map(number => item(url.pathname + '/' + number, { extensionNumber: number, enabled: true })), total: members.get(kind).length });
      }
      if (request.method !== 'GET') return new Response(null, { status: 204 });
      let items = [];
      if (url.pathname.endsWith('/phone-extensions')) items = Array.from({ length: state.total }, (_, i) => item('/api/customers/TEST/targets/phone-extensions/' + (201+i), { extensionNumber: String(201+i), displayName: 'Person ' + i }));
      if (url.pathname.endsWith('/queue-services')) items = [item(url.pathname + '/500', { serviceNumber: '500', displayName: 'Queue' })];
      if (url.pathname.endsWith('/skill-services')) items = [item(url.pathname + '/600', { serviceNumber: '600', displayName: 'Skill' })];
      if (url.pathname === '/api/customers/') items = Array.from({ length: 24 }, (_, i) => item('/api/customers/K' + i, { externalIdentifier: 'K' + i, displayName: 'Customer ' + i }));
      const offset = state.repeatedPage ? 0 : Number(url.searchParams.get('_offset') || 0);
      const size = Number(url.searchParams.get('_pagesize') || 16);
      return Response.json({ collection: { items: items.slice(offset, offset + size), total: items.length } });
    },
  });
  vm.runInContext(source.slice(0, source.indexOf('const server = http.createServer')), context);
  // These function-level mutation tests model an explicitly enabled session.
  vm.runInContext('runtimeSettings.liveWritesEnabled = true', context);
  return { calls, members, state, context, run: code => vm.runInContext(code, context) };
}

test('routing localization: compact DIDs keep missing destinations empty and provider names literal', t => {
  const h = harness(t);
  assert.equal(h.run('compactDid({didNumber:"+441234"},0).value'), '');
  assert.equal(h.run('compactDid({didNumber:"+441234",destinationExtensionNumber:"200"},0).value'), '200');
  for (const name of ['Abrechnung', 'kein Ziel erkannt']) {
    h.context.providerName = name;
    assert.equal(h.run('compactDid({didNumber:"+441234",destinationDisplayName:providerName},0).value'), name);
  }
});

test('routing localization: unrecognized target href keeps its label empty, known names remain literal', t => {
  const h = harness(t);
  assert.equal(h.run('targetPreviewFromHref("/api/customers/TEST/targets/unsupported/9").label'), '');
  assert.equal(h.run('targetPreviewFromHref("/api/customers/TEST/targets/phone-extensions/200",{extensions:[{id:"200",number:"200",name:"kein Ziel erkannt"}]}).label'), 'kein Ziel erkannt');
});

test('P-K1: collections and customers load beyond the default 16 entries without a 250-item cut-off', async t => {
  const h = harness(t, { total: 340 });
  const overview = await h.run('loadOverview()');
  assert.equal(overview.inventory.extensions.length, 340);
  assert.equal(overview.connection.state, 'connected');
  assert.ok(h.calls.some(call => call.search.includes('_offset=316')));
  const customers = await h.run('listPortalCustomers()');
  assert.ok(customers.customers.some(customer => customer.account === 'K23'));
});

test('P-K1: repeated or failed pages cannot produce a ready inventory or destructive plan', async t => {
  const h = harness(t, { repeatedPage: true });
  const overview = await h.run('loadOverview()');
  assert.equal(overview.connection.state, 'partial');
  assert.equal(overview.endpoints.extensions.ok, false);
  assert.throws(() => h.run('buildDaynightGatewayPreview({})'), /Complete live inventory/);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
});

test('P-K2/P-K3: stale revisions and member-load failures abort before every write', async t => {
  const h = harness(t);
  await h.run('loadOverview()');
  const groups = await h.run('loadServiceGroups()');
  h.context.payload = { account: 'TEST', services: [{ kind: 'queue', serviceNumber: '500', baseRevision: groups.queues[0].memberRevision, add: [{ extensionNumber: '203' }], remove: [], update: [] }] };
  h.members.get('queue').push('230');
  await assert.rejects(h.run('applyServiceGroupChanges(payload)'), /changed since this draft/);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  h.state.memberError = true;
  await assert.rejects(h.run('applyServiceGroupChanges(payload)'), /could not be loaded/);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
});

test('P-K2: explicit additions touch only the selected group; a failed later group prevents all writes', async t => {
  const h = harness(t);
  await h.run('loadOverview()');
  const groups = await h.run('loadServiceGroups()');
  h.context.payload = { account: 'TEST', services: [{ kind: 'queue', serviceNumber: '500', baseRevision: groups.queues[0].memberRevision, add: [{ extensionNumber: '203' }], remove: [], update: [] }] };
  h.context.bad = { ...h.context.payload, services: [...h.context.payload.services, { kind: 'skill', serviceNumber: '600', baseRevision: 'old', add: [], remove: ['201'], update: [] }] };
  await assert.rejects(h.run('applyServiceGroupChanges(bad)'), /changed since this draft/);
  assert.equal(h.calls.filter(call => call.method !== 'GET').length, 0);
  await h.run('applyServiceGroupChanges(payload)');
  assert.deepEqual(h.members.get('queue'), ['201','202','203']);
  assert.deepEqual(h.members.get('skill'), ['201','202']);
  assert.deepEqual(h.calls.filter(call => call.method !== 'GET').map(call => call.method), ['POST']);
});

test('P-H1/P-M5: arbitrary upstream HTML is not returned; rejected login never changes credentials', async t => {
  const h = harness(t);
  h.state.memberError = true;
  const result = await h.run('safePortalCall("members", "/api/customers/TEST/targets/queue-services/500/members")');
  assert.doesNotMatch(result.error, /svg|onload|alert/);
  await assert.rejects(h.run('applyBrowserLogin({baseUrl:"http://127.0.0.1:1",apiKeyId:"bad",apiKeySecret:"bad",customerAccount:"OTHER"})'));
  assert.equal(h.run('config.customerAccount'), 'TEST');
  assert.equal(h.run('config.apiKeyId'), 'fixture');
});

test('P-H2: delayed account A data cannot populate account B cache', async t => {
  const h = harness(t);
  let release;
  h.state.delay = new Promise(resolve => { release = resolve; });
  const old = h.run('loadOverview()');
  h.run('config.customerAccount = "OTHER"; clearPortalCache()');
  release();
  await assert.rejects(old, /Account changed/);
  assert.equal(h.run('cache.overview'), null);
});

test('P-H3/P-M8: strict time windows reject malformed/localized/24:00 inputs and preserve INHERIT', t => {
  const h = harness(t);
  for (const hours of ['täglich 08:00-17:00','Lun-Ven 08:00-17:00','Mon-Fri 8-17','Mon-Fri 24:00-17:00','Mon-Fri 08:60-17:00']) {
    h.context.hours = hours;
    assert.throws(() => h.run('parseTimeWindow(hours)'), error => error.status === 400);
  }
  const window = h.run('parseTimeWindow("Mon-Fri 08:00-17:00")');
  assert.equal(window.fromDay, 'MONDAY'); assert.equal(window.toTimeOfDay, '05:00 PM');
  assert.equal(h.run('timeZoneHref("INHERIT")'), 'INHERIT');
});

test('P-H4: number normalization never infers a country and sync sends documented fields only', t => {
  const h = harness(t);
  for (const phone of ['201','020 1234567','0044 20 12345678','+48 22 1234567']) {
    h.context.phone = phone;
    assert.equal(Boolean(h.run('normalizeSyncPhone(phone)')), phone.startsWith('+') || phone.startsWith('00'));
  }
  const contact = h.run('compactGoogleContactForSync({firstName:"Anna",name:"Kowalska",phones:["+48 22 1234567"]},0)');
  assert.equal(contact.name, 'Anna Kowalska');
  h.context.contact = contact;
  assert.deepEqual(Array.from(h.run('buildPhonebookEntryBody(contact,contact.phones[0]).data.map(field=>field.name)')), ['displayName','displayNumber']);
});

test('P-H5/P-M7: routing uses one documented atomic PUT, rejects foreign customer targets before a write', async t => {
  const h = harness(t);
  const result = h.run('buildCallflowUpdate({did:{name:"+48221234560",href:"/api/customers/TEST/dids/0048.22.123456-0",destinationType:"PHONEEXTENSION",destinationExtension:"201"},target:{type:"QUEUE",routeNumber:"345"}})');
  assert.equal(result.operations.length, 1);
  assert.equal(result.method, 'PUT');
  assert.equal(result.endpoint, '/api/customers/TEST/dids/0048.22.123456-0/destination');
  assert.equal(result.body.links[0].rel, 'destination');
  await assert.rejects(h.run('portalFetch("/api/customers/OTHER/phone-books",{method:"POST",body:{}})'), error => error.status === 403);
  assert.throws(() => h.run('buildCallflowUpdate({did:{name:"123",href:"/api/customers/TEST/dids/123"},target:{type:"QUEUE",href:"/api/customers/OTHER/targets/queue-services/500"}})'), error => error.status === 403);
  assert.equal(h.calls.length, 0);
});

test('P-K4/P-M12: names and references are checked; snapshots cannot cross accounts', async t => {
  const h = harness(t);
  assert.equal(h.run('isManagedDaynightTimeControl({name:"TN Zentrale"})'), false);
  assert.equal(h.run('isManagedDaynightTimeControl({name:"TN +49 89 12345-0"})'), true);
  assert.equal(h.run('timeControlReferenced({serviceNumber:"700",href:"/api/customers/TEST/targets/time-control-services/700"},{dids:[{destinationType:"TIMECONTROL",destinationServiceNumber:"700"}]})'), true);
  await h.run('saveDaynightSnapshot({entries:[]})');
  assert.equal((await h.run('readDaynightSnapshot()')).customer, 'TEST');
  h.run('config.customerAccount="OTHER"');
  assert.equal(await h.run('readDaynightSnapshot()'), null);
});

test('P-H6: runtime cannot bypass the server opt-in or hard lock', t => {
  const h = harness(t);
  h.run('config.liveWritesPermitted=false; runtimeSettings.liveWritesEnabled=true');
  assert.equal(h.run('areLiveWritesEnabled()'), false);
  h.run('config.liveWritesPermitted=true; config.liveWritesLocked=true');
  assert.equal(h.run('areLiveWritesEnabled()'), false);
});

test('ownership requires recorded href and name; an account switch clears ownership', t => {
  const h = harness(t);
  h.run('cache.managedTimeControls=[{href:"/api/customers/TEST/targets/time-control-services/700",name:"TN +49 89 12345-0"}]');
  assert.equal(h.run('ownedDaynightTimeControl({href:"/api/customers/TEST/targets/time-control-services/700",name:"TN +49 89 12345-0"})'),true);
  assert.equal(h.run('ownedDaynightTimeControl({href:"/api/customers/TEST/targets/time-control-services/701",name:"TN +49 89 12345-0"})'),false);
  assert.equal(h.run('ownedDaynightTimeControl({href:"/api/customers/OTHER/targets/time-control-services/700",name:"TN +49 89 12345-0"})'),false);
  h.run('clearPortalCache()'); assert.equal(h.run('cache.managedTimeControls.length'),0);
});

test('invalid contact uploads fail before storage, while explicit international phone values remain valid', async t => {
  const h = harness(t);
  for (const contacts of [[null],[42],[{}],[{phones:['201']}]]) {
    h.context.upload={contacts};await assert.rejects(h.run('saveUploadedGoogleContacts(upload)'),error=>error.status===400);
  }
  assert.equal(h.run('compactGoogleContactForSync({name:"Example",phones:[{value:"+44 20 12345678",normalized:"442012345678"}]},0).phones[0].normalized'),'442012345678');
});

test('429 respects Retry-After without retrying writes; unsupported discovery results are cached', async t => {
  const h = harness(t);let requests=0;
  h.context.fetch=async()=>{requests++;return new Response('rate limit',{status:429,headers:{'Retry-After':'60'}});};
  await assert.rejects(h.run('portalFetch("/api/version")'),error=>error.status===429);
  await assert.rejects(h.run('portalFetch("/api/version")'),error=>error.status===429); assert.equal(requests,1);
  h.run('clearPortalCache()');requests=0;
  h.context.fetch=async()=>{requests++;return new Response('missing',{status:404});};
  await h.run('firstAvailablePortalCall("optional",["/api/one","/api/two"])');
  await h.run('firstAvailablePortalCall("optional",["/api/one","/api/two"])');assert.equal(requests,2);
});

test('an atomic routing failure leaves the previous destination intact without DELETE', async t => {
  const h=harness(t),calls=[];let destination='201';
  h.context.fetch=async(url,request)=>{calls.push(request.method);if(request.method==='DELETE')destination='';return new Response('rejected',{status:400});};
  await assert.rejects(h.run('portalFetch("/api/customers/TEST/dids/0048.22.123456-0/destination",{method:"PUT",body:{links:[{rel:"destination",href:"/api/customers/TEST/targets/phone-extensions/202"}]}})'),error=>error.status===400);
  assert.deepEqual(calls,['PUT']);assert.equal(destination,'201');
});

test('server response message keys exclude API inventory values', () => {
  const {messageDescriptor,responseMessages}=require('../src/messages.cjs');
  const description=messageDescriptor('Live-Schreiben ist fuer diese Sitzung aktiviert.');
  assert.equal(description.key,'portal.server.liveWritesAreEnabledForThisSession');
  const payload=responseMessages({message:'Live-Schreiben ist fuer diese Sitzung aktiviert.',inventory:{items:[{name:'Abrechnung',error:'Live-Schreiben ist fuer diese Sitzung aktiviert.'}]},error:'Malformed URL'},400);
  assert.equal(payload.messageKey,description.key);assert.equal(payload.errorKey,'portal.error.url');assert.equal(payload.error,'Malformed URL');
  assert.equal(messageDescriptor('Unmapped synthetic cause 7492'),null);
  assert.equal(payload.inventory.items[0].name,'Abrechnung');assert.equal(payload.inventory.items[0].errorKey,undefined);
});

test('day/night batch rollback restores completed destinations using PUT only', async t => {
  const h=harness(t);h.context.operations=[];
  h.run(`cache.overview={inventory:{}};loadOverview=async()=>cache.overview;
    const first={ok:true,did:{name:"First"},gateway:{name:"Gateway 1"},gatewayExists:true,routeOperations:[{action:"route-did-to-gateway",method:"PUT",endpoint:"/api/customers/TEST/dids/1/destination"}],restorePlan:{action:"restore-original-routing",method:"PUT",endpoint:"/api/customers/TEST/dids/1/destination"}};
    const second={...first,did:{name:"Second"},routeOperations:[{action:"route-did-to-gateway",method:"PUT",endpoint:"/api/customers/TEST/dids/2/destination"}]};
    buildDaynightGatewayPreview=()=>({ok:true,entries:[first,second]});saveDaynightSnapshot=async()=>({});
    runPortalOperation=async operation=>{operations.push(operation);if(operation.endpoint.endsWith("/2/destination"))throw httpError(500,"fixture failure");return {status:204};};
    runRollbackOperations=async ops=>{operations.push(...ops);};`);
  const result=await h.run('applyDaynightGatewayRouting({})');assert.equal(result.ok,false);
  assert.deepEqual(Array.from(h.context.operations,o=>o.method),['PUT','PUT','PUT']);
  assert.equal(h.context.operations[2].action,'restore-original-routing');
});

test('partial creation persists ownership only for successful resources, retaining earlier ownership', async t => {
  const h=harness(t);
  h.context.plan={entries:[{gateway:{href:'/api/customers/TEST/targets/time-control-services/700',name:'TN +44 20 12345-0'}},{gateway:{href:'/api/customers/TEST/targets/time-control-services/701',name:'TN +44 20 12345-1'}}]};
  h.context.result={ok:false,results:[{ok:true,action:'create-daynight-gateway',gateway:'TN +44 20 12345-0',href:'/api/customers/TEST/targets/time-control-services/700'},{ok:false,action:'create-daynight-gateway',gateway:'TN +44 20 12345-1'}]};
  await h.run('saveDaynightSnapshot(plan,result)');
  assert.deepEqual(Array.from((await h.run('readDaynightSnapshot()')).ownedTimeControls,item=>item.href),['/api/customers/TEST/targets/time-control-services/700']);
  await h.run('saveDaynightSnapshot({entries:[]})');
  assert.equal((await h.run('readDaynightSnapshot()')).ownedTimeControls.length,1);
});
