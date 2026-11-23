const assert=require('node:assert/strict');
const test=require('node:test');
const http=require('node:http');
const {fixture,eventually,sleep}=require('./helpers/fixture.cjs');
test('streams recover after browser sign-in, isolate account switches, use account UA and delta events', async(t)=>{
 const f=await fixture(t);await f.start();assert.equal(f.mock.logins,0);
 assert.equal((await f.post('/api/settings/browser-login',{kAccount:'K1',username:'one',password:'test-only'})).status,200);
 await eventually(()=>f.mock.streams.size===2);
 f.send('one','calls',{uuid:'old-call',state:'ring',extension:'21',updated:'2026-10-17T08:00:00Z'});
 await eventually(async()=> (await f.get('/api/history')).body.length===1);
 const sse=await fetch(f.base+'/api/events');const reader=sse.body.getReader();const decoder=new TextDecoder();const initial=decoder.decode((await reader.read()).value);assert.match(initial,/old-call/);
 f.send('one','calls',{uuid:'old-call',state:'answer',extension:'21',updated:'2026-10-17T08:00:05Z'});
 const delta=decoder.decode((await reader.read()).value);assert.match(delta,/"type":"call"/);assert.doesNotMatch(delta,/"history"\s*:/);await reader.cancel();
 assert.equal((await f.post('/api/settings/browser-login',{kAccount:'K2',username:'two',password:'test-only'})).status,200);
 await eventually(()=>f.mock.streams.size===2 && [...f.mock.streams.keys()].every(k=>k.startsWith('two:')));
 assert.deepEqual((await f.get('/api/history')).body,[]);assert.deepEqual((await f.get('/api/active-calls')).body,[]);
 assert.ok(f.mock.ua.some(x=>x.endsWith('(K2)')));
 f.send('two','calls',{uuid:'new-call',state:'ring',extension:'21'});await eventually(async()=> (await f.get('/api/active-calls')).body.length===1);
 f.mock.streams.get('two:/extensions/phone/calls').end();await eventually(async()=> !(await f.get('/api/active-calls')).body.length);
});

test('streams are independent of failed bootstrap REST and invalid credentials back off, then recover', async(t)=>{
 const f=await fixture(t,{credentials:true});f.mock.noExtensions=true;f.mock.unavailable=true;await f.start();
 await eventually(()=>f.mock.logins===1); await sleep(1800); assert.equal(f.mock.logins,1);
 assert.equal((await f.get('/api/status')).body.lastError,'NFON sign-in failed');
 f.mock.unavailable=false;
 await eventually(()=>f.mock.streams.size===2,35000);
 assert.equal(f.mock.logins,2);assert.equal((await f.get('/api/status')).body.lastError,null);
});

test('old restore keeps all recent events, skips corrupt JSONL lines and survives restart',async(t)=>{
 const recent=Array.from({length:1101},(_,i)=>({uuid:'recent-'+i,state:'hangup',updated:new Date(Date.UTC(2026,9,17,8,0,i)).toISOString()}));
 const f=await fixture(t,{events:recent,corrupt:true});await f.start();
 const history=(await f.get('/api/history')).body;assert.equal(history.length,1101);assert.equal(history[0].uuid,'recent-1100');
 assert.equal((await f.get('/api/storage')).body.skippedInvalidLines,1);
 const old=Array.from({length:1050},(_,i)=>({uuid:'old-'+i,state:'hangup',updated:new Date(Date.UTC(2025,2,1,8,0,i)).toISOString()}));
 assert.equal((await f.post('/api/storage/restore',{callEvents:old})).body.imported,1050);
 const after=(await f.get('/api/history')).body;assert.equal(after.length,2151);assert.equal(after[0].uuid,'recent-1100');
 await f.stop();await f.start();assert.equal((await f.get('/api/history')).body[0].uuid,'recent-1100');
 assert.equal((await f.get('/api/storage/backup')).body.data.callEvents.length,2151);
});

test('contact photos reject active content and mismatched signatures; short extension has no suffix match',async(t)=>{
 const f=await fixture(t);await f.start();
 for(const photoData of ['data:text/html;base64,'+Buffer.from('<script>alert(1)</script>').toString('base64'),'data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,'+Buffer.from('<html>bad</html>').toString('base64')]) assert.equal((await f.post('/api/local-contacts',{name:'Example',phone:'+49 12345621',photoData})).status,400);
 const photo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=';
 const created=await f.post('/api/local-contacts',{name:'Example',phone:'+49 12345621',photoData:photo});assert.equal(created.status,201);
 assert.equal((await f.get('/api/contacts/lookup?phone=21')).body.contact,null);
 assert.equal((await f.get('/api/contacts/lookup?phone=004912345621')).body.contact.name,'Example');
 const res=await fetch(f.base+'/api/contacts/photo/'+created.body.contact.id);assert.equal(res.status,200);assert.equal(res.headers.get('content-type'),'image/png');assert.equal(res.headers.get('x-content-type-options'),'nosniff');
});

test('duplicate dial is guarded; international numbers normalize safely and cancel404 stays an error',async(t)=>{
 const f=await fixture(t,{credentials:true});await f.start();await eventually(()=>f.mock.streams.size===2);
 const body={caller:'21',callee:'+49 (0)89 123456'};
 const results=await Promise.all([f.post('/api/calls',body),f.post('/api/calls',body)]);assert.deepEqual(results.map(x=>x.status).sort(),[202,409]);assert.equal(f.mock.writes,1);assert.equal(f.mock.dialBody.callee,'4989123456');
 assert.equal((await f.post('/api/calls',{caller:'21',callee:'089 123456'})).status,400);assert.equal(f.mock.writes,1);
 assert.equal((await f.post('/api/calls/missing',undefined,'DELETE')).status,404);assert.equal(f.mock.deletes,0);
 const active=(await f.get('/api/active-calls')).body[0];assert.ok(active);assert.equal((await f.post('/api/calls/'+active.uuid,undefined,'DELETE')).status,404);assert.equal(f.mock.deletes,1);assert.deepEqual((await f.get('/api/active-calls')).body,[]);
});

test('static boundaries return true404 and safe versioned caching; Host/URL cannot bypass the boundary',async(t)=>{
 const f=await fixture(t);await f.start();
 for(const route of ['/missing','/','/app.js?v=fixture']){const r=await fetch(f.base+route);assert.equal(r.status,route==='/missing'?404:200);assert.equal(r.headers.get('x-content-type-options'),'nosniff');if(route.includes('?'))assert.match(r.headers.get('cache-control'),/immutable/)}
 const status=await new Promise((resolve,reject)=>{http.get(f.base+'/api/status',{headers:{host:'evil.example:'+new URL(f.base).port}},r=>{r.resume();resolve(r.statusCode)}).on('error',reject)});assert.equal(status,403);
 assert.equal((await fetch(f.base+'/%')).status,400);assert.equal((await f.get('/api/status')).body.appId,'cti');
});

test('R-CTI-4 retries failed bootstrap and publishes recovered extensions without a page reload',async t=>{
 const f=await fixture(t,{credentials:true});f.mock.noExtensions=true;await f.start();await eventually(()=>f.mock.streams.size===2);
 const sse=await fetch(f.base+'/api/events');const reader=sse.body.getReader();await reader.read();
 f.mock.noExtensions=false;
 const received=(async()=>{let text='';while(!text.includes('"type":"extensions"')){const chunk=await reader.read();if(chunk.done)break;text+=new TextDecoder().decode(chunk.value)}return text})();
 try{const text=await Promise.race([received,sleep(6500).then(()=>{throw Error('No recovered extensions event')})]);assert.match(text,/"name":"one"/);assert.equal((await f.get('/api/status')).body.extensions,1)}finally{await reader.cancel()}
});

test('R-CTI-1 invalid provider timestamps sort by valid receive time through restore',async t=>{
 const f=await fixture(t,{events:[{uuid:'valid',state:'hangup',updated:'2026-10-16T12:00:00Z'},{uuid:'bad',state:'hangup',updated:'2013-10-27T13:01:10:00.069620809+02:00',receivedAt:'2026-10-17T12:00:00Z'}]});await f.start();
 assert.equal((await f.get('/api/history')).body[0].uuid,'bad');
 await f.post('/api/storage/restore',{callEvents:[{uuid:'unknown-date',state:'end',updated:'invalid'}]});
 assert.equal((await f.get('/api/history')).body[0].uuid,'bad');assert.equal((await f.get('/api/storage/backup')).body.data.callEvents.length,3);
});

test('R-CTI-2 explicit numbering context maps national and E164 contacts without suffix guesses',async t=>{
 const f=await fixture(t,{env:{NFON_PHONE_COUNTRY_CODE:'49',NFON_PHONE_NATIONAL_PREFIX:'0'}});await f.start();
 await f.post('/api/local-contacts',{name:'International',phone:'+49 89 1234567'});
 assert.equal((await f.get('/api/contacts/lookup?phone=0891234567')).body.contact.name,'International');
 await f.post('/api/local-contacts',{name:'National',phone:'0309876543'});
 assert.equal((await f.get('/api/contacts/lookup?phone=%2B49309876543')).body.contact.name,'National');
 for(const phone of ['21','4567','1234567'])assert.equal((await f.get('/api/contacts/lookup?phone='+phone)).body.contact,null);
 const status=(await f.get('/api/status')).body;assert.deepEqual(status.phoneNumberContext,{countryCode:'49',nationalPrefix:'0'});
});

test('R-CTI-5 resource401 applies backoff even after a successful password login',async t=>{
 for(const code of [401]){await t.test(String(code),async t=>{
  const f=await fixture(t,{credentials:true});f.mock.resourceStatus=code;await f.start();await eventually(()=>f.mock.logins===1);await sleep(2000);
  await Promise.all(Array.from({length:20},()=>f.get('/api/extensions')));
  assert.equal(f.mock.logins,1);assert.equal(f.mock.refreshes,0);const status=(await f.get('/api/status')).body;
  assert.ok(status.authRetryAt>Date.now());assert.equal(status.lastError,'NFON sign-in failed');
 })}
});

test('R-CTI-13 contact mutations invalidate revision for other connected tabs',async t=>{
 const f=await fixture(t);await f.start();const first=(await f.get('/api/status')).body.contactsRevision;
 await f.post('/api/local-contacts',{name:'Status',phone:'+49301234567'});const second=(await f.get('/api/status')).body.contactsRevision;assert.notEqual(second,first);
 await f.stop();await f.start();assert.notEqual((await f.get('/api/status')).body.contactsRevision,second);
});

test('static symlink cannot escape public files',async t=>{
 const fs=require('node:fs');const path=require('node:path');const f=await fixture(t);const outside=path.join(f.dir,'outside.txt');fs.writeFileSync(outside,'private-fixture');fs.symlinkSync(outside,path.join(f.dir,'public','escape.txt'));await f.start();
 const response=await fetch(f.base+'/escape.txt');assert.equal(response.status,403);assert.doesNotMatch(await response.text(),/private-fixture/);
});

test('CTI accepts the explicit IPv6-loopback origin while rejecting foreign origins',async t=>{
 const f=await fixture(t);await f.start();
 const allowed=await fetch(f.base+'/api/status',{headers:{Origin:'http://[::1]:'+new URL(f.base).port}});assert.equal(allowed.status,200);
 const blocked=await fetch(f.base+'/api/status',{headers:{Origin:'http://foreign.example:'+new URL(f.base).port}});assert.equal(blocked.status,403);
});

test('R2-CTI-01 action403 stays resource-specific and does not invalidate working credentials',async t=>{
 const f=await fixture(t,{credentials:true});await f.start();await eventually(()=>f.mock.streams.size===2);f.mock.actionStatus=403;
 assert.equal((await f.post('/api/calls',{caller:'21',callee:'203'})).status,403);
 for(let n=0;n<3;n++)assert.equal((await f.get('/api/extensions')).status,200);
 assert.equal(f.mock.logins,1);assert.equal(f.mock.refreshes,0);let status=(await f.get('/api/status')).body;assert.equal(status.authRetryAt,null);assert.equal(status.lastError,null);
 f.mock.actionStatus=0;const dial=await f.post('/api/calls',{caller:'21',callee:'203'});assert.equal(dial.status,202);f.mock.actionStatus=403;
 assert.equal((await f.post('/api/calls/'+dial.body.uuid,undefined,'DELETE')).status,403);
 assert.equal((await f.get('/api/extensions')).status,200);assert.equal((await f.get('/api/active-calls')).body.length,1);
});

test('R2-CTI-02 delayed dial body from a prior account cannot enter history, active calls or backup',async t=>{
 const f=await fixture(t,{credentials:true});await f.start();await eventually(()=>f.mock.streams.size===2);f.mock.holdDialBody=true;
 const dial=f.post('/api/calls',{caller:'21',callee:'+49301234567'});await eventually(()=>f.mock.releaseDial);
 assert.equal((await f.post('/api/settings/browser-login',{kAccount:'K2',username:'two',password:'test-only'})).status,200);await eventually(()=>[...f.mock.streams.keys()].every(k=>k.startsWith('two:')));
 f.mock.releaseDial();assert.equal((await dial).status,409);
 assert.deepEqual((await f.get('/api/history')).body,[]);assert.deepEqual((await f.get('/api/active-calls')).body,[]);assert.deepEqual((await f.get('/api/storage/backup')).body.data.callEvents,[]);
 f.mock.holdDialBody=false;const current=await f.post('/api/calls',{caller:'21',callee:'203'});assert.equal(current.status,202);
 // A successful dial is realtime; backup waits for the committed-history queue.
 const committed=(await f.get('/api/storage/backup')).body.data.callEvents;
 assert.deepEqual(committed.map(({uuid,account})=>({uuid,account})),[{uuid:current.body.uuid,account:'K2'}]);
 const history=(await f.get('/api/history')).body;assert.equal(history.length,1);assert.equal(history[0].uuid,current.body.uuid);assert.equal(history[0].account,'K2');
});

test('R2-CTI-08 invalid 200 bootstrap shape retries until a real array arrives',async t=>{
 const f=await fixture(t,{credentials:true});f.mock.invalidExtensions=true;f.mock.invalidStates=true;await f.start();await eventually(()=>f.mock.streams.size===2);await eventually(()=>f.mock.extensionReads>0);
 assert.equal((await f.get('/api/status')).body.extensions,0);f.mock.invalidExtensions=false;f.mock.invalidStates=false;
 await eventually(async()=> (await f.get('/api/status')).body.extensions===1,6500);assert.ok(f.mock.extensionReads>=2);assert.ok(f.mock.stateReads>=2);assert.equal((await f.get('/api/states')).body.length,1);
});

test('R2-CTI-09 local contact failures never poison Google synchronization status',async t=>{
 const f=await fixture(t);await f.start();assert.equal((await f.post('/api/local-contacts',{name:'Contact',phone:'+49301234567',photoData:'bad'})).status,400);
 assert.equal((await f.get('/api/google/status')).body.lastError,null);assert.equal((await f.post('/api/local-contacts',{name:'Contact',phone:'+49301234567'})).status,201);
 assert.equal((await f.get('/api/contacts/photo/missing')).status,404);assert.equal((await f.get('/api/google/status')).body.lastError,null);
});

test('R2-CTI-13 invalid timeouts and annotated phone numbers are rejected before upstream writes',async t=>{
 const f=await fixture(t,{credentials:true});await f.start();await eventually(()=>f.mock.streams.size===2);
 for(const timeout of ['abc',null,true,false,{},[],0,-1,121,1.5])assert.equal((await f.post('/api/calls',{caller:'21',callee:'203',timeout})).status,400);
 assert.equal((await f.post('/api/calls',{caller:'21',callee:'+49 89 1234 ext 5'})).body.error,'Use a valid international number (+ or 00) or an extension of 1–6 digits');assert.equal(f.mock.writes,0);
 assert.equal((await f.post('/api/calls',{caller:'21',callee:'203',timeout:1})).status,202);assert.equal(f.mock.dialBody.timeout,1);
 assert.equal((await f.post('/api/calls',{caller:'21',callee:'204',timeout:''})).status,202);assert.equal(f.mock.dialBody.timeout,undefined);
});

test('R3-CTI-03 dial401 broadcasts sign-in failure immediately while healthy streams stay connected',async t=>{
 const f=await fixture(t,{credentials:true});await f.start();await eventually(()=>f.mock.streams.size===2);
 const events=await fetch(f.base+'/api/events');const reader=events.body.getReader();
 try {
  const snapshot=new TextDecoder().decode((await reader.read()).value);assert.match(snapshot,/event: snapshot/);
  f.mock.actionStatus=401;
  const next=reader.read();
  assert.equal((await f.post('/api/calls',{caller:'21',callee:'203'})).status,502);
  const chunk=await Promise.race([next,sleep(1000).then(()=>{throw Error('Missing immediate authentication status event')})]);
  const text=new TextDecoder().decode(chunk.value);assert.match(text,/event: status/);assert.match(text,/"lastError":"NFON sign-in failed"/);
  const status=(await f.get('/api/status')).body;
  assert.ok(status.authRetryAt>Date.now());assert.equal(status.streams.calls.connected,true);assert.equal(status.streams.states.connected,true);
  assert.equal((await f.get('/api/extensions')).status,429);assert.equal(f.mock.logins,1);
 } finally { await reader.cancel(); }
});

test('R2-CTI-07 only four permanent browser streams; extra tabs get cached snapshots without provider calls',async t=>{
 const f=await fixture(t,{credentials:true});await f.start();await eventually(()=>f.mock.streams.size===2);const readers=[];
 try{for(let n=0;n<8;n++){const r=await fetch(f.base+'/api/events');const reader=r.body.getReader();readers.push(reader);const data=new TextDecoder().decode((await reader.read()).value);assert.match(data,n<4?/event: snapshot/:/event: polling/);if(n>=4)assert.equal((await reader.read()).done,true);}
 const reads=f.mock.extensionReads;for(let n=0;n<4;n++){const snapshot=await f.get('/api/snapshot');assert.equal(snapshot.status,200);assert.equal(snapshot.body.type,'snapshot');assert.equal(snapshot.body.extensions[0].name,'one');}assert.equal(f.mock.extensionReads,reads);
 await readers[0].cancel();await sleep(50);const next=await fetch(f.base+'/api/events');const reader=next.body.getReader();readers.push(reader);assert.match(new TextDecoder().decode((await reader.read()).value),/event: snapshot/);
 }finally{for(const reader of readers)await reader.cancel().catch(()=>{});}
});

test('R2-CTI-11 successful upstream cancel removes the pending call',async t=>{
 const f=await fixture(t,{credentials:true});f.mock.cancelStatus=204;await f.start();await eventually(()=>f.mock.streams.size===2);const dial=await f.post('/api/calls',{caller:'21',callee:'203'});assert.equal(dial.status,202);assert.equal((await f.post('/api/calls/'+dial.body.uuid,undefined,'DELETE')).status,204);assert.deepEqual((await f.get('/api/active-calls')).body,[]);assert.equal(f.mock.deletes,1);
});
