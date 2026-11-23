const assert=require('node:assert/strict');const test=require('node:test');const {writeFixture:fixture}=require('./helpers/fixture.cjs');
const night=(routeNumber='239')=>({nightTarget:{type:'PHONEEXTENSION',routeNumber,title:'Night destination'}});
const destinations=state=>Object.fromEntries(state.dids.map(d=>[d.id,d.dest&&`${d.dest.type}:${d.dest.service||d.dest.ext}`]));
test('R01: repeating night mode never replaces the original day routing, including restart',async t=>{
 const app=await fixture(t);const original=destinations(await app.control('state?account=K9001'));
 assert.equal((await app.request('/api/daynight/gateways/apply',night())).status,200);
 assert.equal((await app.request('/api/daynight/gateway-routing/apply',night())).status,200);
 const restore=app.snapshot().entries.map(e=>e.restorePlan);
 await app.restart();
 assert.equal((await app.request('/api/status')).body.settings.liveWritesEnabled,false);
 assert.equal((await app.request('/api/settings/live-writes',{enabled:true})).status,200);
 const repeated=await app.request('/api/daynight/gateway-routing/apply',night());assert.ok([200,409].includes(repeated.status));
 assert.deepEqual(app.snapshot().entries.map(e=>e.restorePlan),restore,'original snapshot remains immutable while night routing is active');
 assert.equal((await app.request('/api/daynight/restore',{})).status,200);
 assert.deepEqual(destinations(await app.control('state?account=K9001')),original);
});
for(const action of ['recreate','change-target','new-number'])test('R01: active night routing rejects unsafe '+action+' and restores original day targets',async t=>{
 const app=await fixture(t);const original=destinations(await app.control('state?account=K9001'));
 await app.request('/api/daynight/gateways/apply',night());await app.request('/api/daynight/gateway-routing/apply',night());const restore=app.snapshot().entries.map(e=>e.restorePlan);
 if(action==='new-number')await app.control('mutate',{addDid:'0049.89.777-0',ext:'220'});
 const response=await app.request('/api/daynight/gateways/apply',night(action==='change-target'?'238':'239'));assert.equal(response.status,409);assert.deepEqual(app.snapshot().entries.map(e=>e.restorePlan),restore);
 const overview=(await app.request('/api/overview')).body;assert.equal(overview.daynight.active,true);assert.match(overview.daynight.nightTarget.href,/239$/);
 assert.equal((await app.request('/api/daynight/restore',{})).status,200);const after=destinations(await app.control('state?account=K9001'));for(const [id,target]of Object.entries(original))assert.equal(after[id],target);if(action==='new-number')assert.equal(after['0049.89.777-0'],'PHONEEXTENSION:220');
});
test('R02: twelve gateways reset without prefix-ID collisions and ownership is pruned',async t=>{
 const app=await fixture(t,{provider:{dids:12}});const original=destinations(await app.control('state?account=K9001'));
 assert.equal((await app.request('/api/daynight/gateways/apply',night())).status,200);assert.equal((await app.request('/api/daynight/gateway-routing/apply',night())).status,200);const result=await app.request('/api/daynight/reset',{});assert.equal(result.status,200,JSON.stringify(result.body));assert.deepEqual(destinations(await app.control('state?account=K9001')),original);assert.equal(app.snapshot().ownedTimeControls.length,0);
});
test('R14: routing failure restores previously updated time-control destinations as well as DIDs',async t=>{
 const app=await fixture(t);await app.request('/api/daynight/gateways/apply',night());const before=await app.control('state?account=K9001');await app.control('patch',{writeFail:{path:'/dids/.+/destination$',method:'PUT',nth:2,status:500}});
 const result=await app.request('/api/daynight/gateway-routing/apply',night());assert.equal(result.status,502);assert.equal(result.body.rolledBack,true);const after=await app.control('state?account=K9001');assert.deepEqual(destinations(after),destinations(before));assert.deepEqual(after.tcs.map(t=>[t.serviceNumber,t.allowed,t.denied]),before.tcs.map(t=>[t.serviceNumber,t.allowed,t.denied]));assert.equal(app.snapshot().routingActive,false);
});
test('R17: collections without total or next are read to an empty page',async t=>{
 const app=await fixture(t,{provider:{paging:{extensions:'noTotal'}}});const r=await app.request('/api/overview');assert.equal(r.body.counts.extensions,40);assert.equal(r.body.endpoints.extensions.complete,true);
});
test('R17: endless next is bounded at one hundred pages and blocks writes',async t=>{
 const app=await fixture(t,{provider:{paging:{extensions:'endlessNext'}}});const r=await app.request('/api/overview');assert.equal(r.body.endpoints.extensions.ok,false);const log=await app.control('log');assert.ok(log.filter(e=>/phone-extensions(?:\?|$)/.test(e.path)).length<=100);assert.equal((await app.control('writes')).length,0);
});
test('R20: null, primitive and array bodies return 400 before writes',async t=>{
 const app=await fixture(t);for(const body of [null,[],42,'value']){const r=await app.request('/api/service-groups/apply',body);assert.equal(r.status,400,JSON.stringify(r));assert.doesNotMatch(JSON.stringify(r.body),/TypeError|Cannot read/);}assert.equal((await app.control('writes')).length,0);
});
test('R18: ownership uses actual IDs; GET preserves the persisted recovery snapshot',async t=>{
 const app=await fixture(t,{provider:{assignTcOffset:100}});const result=await app.request('/api/daynight/gateways/apply',night());assert.equal(result.status,200,JSON.stringify(result.body));assert.equal(app.snapshot().ownedTimeControls.length,4);assert.ok(app.snapshot().ownedTimeControls.every(item=>Number(item.href.split('/').pop())>=100));const href=app.snapshot().ownedTimeControls[0].href;await app.control('mutate',{removeTc:href.split('/').pop()});const before=app.snapshot();await app.request('/api/overview');assert.deepEqual(app.snapshot(),before,'overview is read-only even when the provider removes a resource');
});
for(const unreadable of [false,true])test('R19: '+(unreadable?'unreadable references':'queue references')+' block reset before writes',async t=>{
 const app=await fixture(t);await app.request('/api/daynight/gateways/apply',night());await app.request('/api/daynight/gateway-routing/apply',night());const href=app.snapshot().ownedTimeControls[0].href;await app.control('patch',unreadable?{getFail:'queue-services/500/timeout$'}:{routingReference:href});await app.control('clearlog',{});assert.equal((await app.request('/api/daynight/reset',{})).status,409);assert.equal((await app.control('writes')).length,0);
});
for(const syntax of ['PORTAL_DISABLE_LIVE_WRITES=true#lock','export PORTAL_DISABLE_LIVE_WRITES=true','PORTAL_DISABLE_LIVE_WRITES="true" #lock'])test('R06: hard lock accepts '+syntax,async t=>{
 const app=await fixture(t,{envText:syntax});assert.equal((await app.request('/api/status')).body.settings.liveWritesLocked,true);assert.equal((await app.request('/api/daynight/gateways/apply',night())).status,423);assert.equal((await app.control('writes')).length,0);
});
for(const invalid of ['treu',''])test('R06: invalid boolean '+JSON.stringify(invalid)+' fails startup',async t=>{await assert.rejects(fixture(t,{env:{PORTAL_DISABLE_LIVE_WRITES:invalid}}),/PORTAL_DISABLE_LIVE_WRITES/);});
test('R10: foreign IVR continuation is rejected before creation',async t=>{
 const app=await fixture(t);const r=await app.request('/api/daynight/announcement-target/apply',{announcementName:'Announcement 0',displayName:'Night target',afterTarget:{href:'/api/customers/OTHER/targets/phone-extensions/200'}});assert.equal(r.status,403,JSON.stringify(r));assert.equal((await app.control('writes')).length,0);
});
test('R10: timeout failure removes the actual new IVR',async t=>{
 const app=await fixture(t);const before=await app.control('state?account=K9001');await app.control('patch',{writeFail:{path:'ivr-services/.+/timeout$',method:'PUT',nth:1,status:500}});const r=await app.request('/api/daynight/announcement-target/apply',{announcementName:'Announcement 0',displayName:'Night target',afterTarget:{type:'PHONEEXTENSION',routeNumber:'239'}});assert.equal(r.status,502,JSON.stringify(r));assert.equal(r.body.rolledBack,true);assert.equal((await app.control('writes')).filter(w=>w.method==='DELETE').length,1);assert.deepEqual((await app.control('state?account=K9001')).ivrs,before.ivrs);
});
test('R11: bulk rollback ignores client-supplied prior destinations',async t=>{
 const app=await fixture(t);const overview=(await app.request('/api/overview')).body;const before=destinations(await app.control('state?account=K9001'));const changes=overview.inventory.dids.slice(0,2).map(did=>({did:{...did,destinationType:'PHONEEXTENSION',destinationExtension:'205'},target:{type:'PHONEEXTENSION',number:'239',routeNumber:'239',title:'Night'}}));await app.control('patch',{writeFail:{path:'/dids/.+/destination$',method:'PUT',nth:2,status:500}});const r=await app.request('/api/callflow/bulk-apply',{changes,commit:true});assert.equal(r.body.ok,false);assert.deepEqual(destinations(await app.control('state?account=K9001')),before);
});
test('R12: partial member failure reports every operation state',async t=>{
 const app=await fixture(t);const groups=(await app.request('/api/service-groups')).body;const service=groups.queues.find(q=>q.serviceNumber==='500');await app.control('patch',{writeFail:{path:'/queue-services/500/members/',method:'DELETE',nth:2,status:500}});const r=await app.request('/api/service-groups/apply',{account:'K9001',services:[{kind:'queue',serviceNumber:'500',baseRevision:service.memberRevision,add:[],update:[],remove:['200','201','202']}]});assert.equal(r.body.ok,false);assert.equal(r.body.completed.length,1);assert.equal(r.body.failed.method,'DELETE');assert.equal(r.body.notAttempted.length,1);const state=await app.control('state?account=K9001');assert.ok(!state.members.queue['500'].includes('200'));assert.ok(state.members.queue['500'].includes('201'));
});
test('R04: ambiguous day abbreviations fail before creating controls',async t=>{
 const app=await fixture(t);const target={type:'PHONEEXTENSION',routeNumber:'239'};for(const day of ['Di','Do','So']){const r=await app.request('/api/resources/timeControls',{displayName:'Hours',fromDay:day,toDay:'FRIDAY',fromTime:'08:00',toTime:'17:00',openTarget:target,closedTarget:target});assert.equal(r.status,400,JSON.stringify(r));assert.equal(r.body.errorKey,'portal.error.dayFormat');}assert.equal((await app.control('writes')).length,0);
});
test('R05: full names are not prefixed twice and extension suffixes are rejected',async t=>{
 const app=await fixture(t);assert.equal((await app.request('/api/phonebook-sync/upload',{contacts:[{firstName:'Anna',lastName:'Becker',name:'Anna Becker',phones:'+49301234567 ext 12'}]})).status,400);
 assert.equal((await app.request('/api/phonebook-sync/upload',{contacts:[{firstName:'Anna',lastName:'Becker',name:'Anna Becker',phones:'+49301234567'}]})).status,200);const r=await app.request('/api/phonebook-sync/preview',{});assert.doesNotMatch(JSON.stringify(r.body),/Anna Anna/);assert.match(JSON.stringify(r.body),/Anna Becker/);
});
test('R07: dynamic preview messages use an explicit complete key',async t=>{
 const app=await fixture(t);const r=await app.request('/api/daynight/gateway-preview',night());assert.equal(r.status,200);assert.ok(r.body.messageKey);assert.match(r.body.messageKey,/portal.server/);assert.ok(Object.values(r.body.messageParams).every(v=>typeof v==='number'||!String(v).includes('Rufnummer')));const {messageDescriptor}=require('../src/messages.cjs');assert.equal(messageDescriptor('20 von 20 Rufnummern sind fuer eine Zeitsteuerungs-Migration eindeutig bewertbar.'),null);assert.equal(messageDescriptor('Lager bearbeiten'),null);
});


test('R06: quoted hash text is not reinterpreted as an env comment that enables writes', async t => {
 await assert.rejects(fixture(t,{envText:'PORTAL_DISABLE_LIVE_WRITES="false#literal"\n',env:{PORTAL_DISABLE_LIVE_WRITES:undefined}}),/Invalid boolean.*PORTAL_DISABLE_LIVE_WRITES|PORTAL_DISABLE_LIVE_WRITES.*boolean/);
});

test('static serving enforces realpath containment and response headers including SPA fallback',async t=>{
 const fs=require('node:fs');const path=require('node:path');const app=await fixture(t,{public:true});
 fs.writeFileSync(path.join(app.dir,'outside.txt'),'PRIVATE-FIXTURE-CONTENT');fs.symlinkSync(path.join(app.dir,'outside.txt'),path.join(app.dir,'public','escape.txt'));
 fs.writeFileSync(path.join(app.dir,'public','inside.txt'),'PUBLIC-FIXTURE-CONTENT');fs.symlinkSync(path.join(app.dir,'public','inside.txt'),path.join(app.dir,'public','inside-link.txt'));
 const get=name=>fetch('http://127.0.0.1:'+app.port+name);
 const escaped=await get('/escape.txt');assert.equal(escaped.status,403);assert.doesNotMatch(await escaped.text(),/PRIVATE-FIXTURE/);
 const inside=await get('/inside-link.txt');assert.equal(inside.status,200);assert.equal(await inside.text(),'PUBLIC-FIXTURE-CONTENT');
 const fallback=await get('/client-view');assert.equal(fallback.status,200);assert.equal(fallback.headers.get('x-content-type-options'),'nosniff');assert.match(fallback.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.match(await fallback.text(),/NFON/);
});
