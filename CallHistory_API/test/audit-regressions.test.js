const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

async function start(t, mode, overrides = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-audit-'));
  fs.cpSync(path.join(__dirname, '../src'), path.join(temp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(temp, '.env'), '');
  fs.mkdirSync(path.join(temp, 'data'));
  const capture = path.join(temp, 'requests.jsonl');
  if (['refresh', 'invalid-grant', 'logout-race', 'mid-page-401', 'transcript-401', 'transcript-twice-401', 'transcript-refresh-fail'].includes(mode)) fs.writeFileSync(path.join(temp, 'data/callhistory-token.json'), JSON.stringify({ accessToken: 'expired', refreshToken: 'rotating-old', expiresAt: mode.startsWith('transcript-') || mode === 'mid-page-401' ? Date.now() + 3600000 : 1 }));
  fs.writeFileSync(path.join(temp, 'mock.cjs'), `
    const fs = require('node:fs');
    const mode = ${JSON.stringify(mode)};
    let refreshes = 0;
    if (mode === 'midnight') { const RealDate=Date; const fixed=new RealDate('2026-10-17T00:05:00').getTime(); globalThis.Date=class extends RealDate { constructor(...args){super(...(args.length?args:[fixed]))} static now(){return fixed} }; }

    if (mode === 'expired-state') { const realNow=Date.now; Date.now=()=>realNow()+(fs.existsSync('clock-advance') ? 601000 : 0); }
    globalThis.fetch = async (input, options={}) => {
      const url = new URL(input);
      fs.appendFileSync(${JSON.stringify(capture)}, JSON.stringify({url:String(url),body:String(options.body||''),authorization:options.headers?.Authorization})+'\\n');
      const respond = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
      if (url.pathname === '/token') {
        refreshes++;
        await new Promise(resolve => setTimeout(resolve, 100));
        if (mode === 'transcript-refresh-fail') return respond({error:'temporary'},503);
        if (mode === 'invalid-grant' || (mode === 'refresh' && refreshes > 1)) return respond({error:'invalid_grant'},400);
        return respond({access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});
      }
      if (url.pathname.includes('/records/transcript-')) {
        if (mode === 'transcript-twice-401' || options.headers.Authorization !== 'Bearer new-access') return respond({error:'expired'},401);
        return respond({uuid:'transcript-one', transcription:{available:true,summary:'Original summary',transcript:[]}});
      }
      if (Number(url.searchParams.get('offset')) >= 20 && mode.startsWith('followup-')) {
        if (mode.startsWith('followup-broken-auth-')) return new Response(new ReadableStream({start(controller){controller.error(new Error('Broken response body'));}}), {status:Number(mode.slice(-3))});
        if (mode === 'followup-null-record') return respond([null, {uuid:'late-record',created:'2026-10-17T10:00:00Z'}]);
        if (mode === 'followup-array-record') return respond([[]]);
        if (mode === 'followup-timeout') return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}));
        if (mode === 'followup-204') return new Response(null,{status:204});
        if (mode === 'followup-empty-body') return new Response('');
        return respond({error:'upstream'},mode === 'followup-404' ? 404 : mode === 'followup-403' ? 403 : 503);
      }
      if (mode === 'mid-page-401' && Number(url.searchParams.get('offset')) >= 40 && options.headers.Authorization !== 'Bearer new-access') return respond({error:'expired'},401);
      if (mode === 'slow-pages') await new Promise((resolve,reject) => { const timer=setTimeout(resolve,120); options.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal.reason);},{once:true}); });
      if (mode === 'unauthorized') return respond({error:'expired'},401);
      if (mode === 'unexpected') return respond({error:'not-a-list'});
      if (mode === 'null-record') return respond([null]);
      if (mode === 'timeout') return new Promise((resolve,reject) => options.signal.addEventListener('abort',()=>reject(options.signal.reason)));
      const total = mode.startsWith('followup-') || ['paging','repeated-page','capped','bad-total','mid-page-401','slow-pages','tiny-pages'].includes(mode) ? 75 : 6;
      let records = Array.from({length:total},(_,index)=>({
        uuid:'record-'+index, created:'2026-10-17T10:00:00Z', duration:120, status:index===4?'voicemail':'answered',direction:'inbound',
        caller:{name:'Müller Abrechnung GmbH',number:'+49 (89) 1234'}, callee:{name:'Alice Agent',number:'200'},
        history:[{callee:{name:'Sales',number:'500', [index%2 ? 'service' : 'destination_type']:'queue'}}],
        transcription:{available:index!==2,summary:'A summary',transcript:[]}
      }));
      if (mode === 'invalid-dates') { records[3].created='not-a-date'; delete records[5].created; records[2].created=1792231200; }
      if (mode === 'unknown-enums') { records[0].status='abandoned'; records[1].status='no_answer'; records[2].status='connected'; records[0].direction='sideways'; records[0].history=[]; records[0].caller.service='queue'; }
      if (mode === 'null-hop') records[0].history=[null,{callee:{name:'Support',service:'queue'}}];
      const offset = mode==='repeated-page'?0:Number(url.searchParams.get('offset'));
      const size=mode==='tiny-pages'?1:['capped','bad-total'].includes(mode)?Math.min(10,Number(url.searchParams.get('limit'))):Number(url.searchParams.get('limit')||100);
      const page=records.slice(offset,offset+size); return respond(mode==='bad-total'?{items:page,total:5}:page);
    };
  `);
  const reserving = net.createServer(); reserving.listen(0,'127.0.0.1'); await once(reserving,'listening');
  const port = reserving.address().port; await new Promise(resolve=>reserving.close(resolve));
  const child = spawn(process.execPath,['--require',path.join(temp,'mock.cjs'),'src/server.js'],{
    cwd:temp,env:{ PATH:process.env.PATH, HOME:temp, HOST:'127.0.0.1', PORT:String(port),
      NFON_SHOWCASE_CONFIG_DIR:path.join(temp,'empty-config'), CALLHISTORY_DATA_DIR:path.join(temp,'data'),
      CALLHISTORY_CLIENT_ID:'synthetic-client', CALLHISTORY_API_BASE_URL:'https://mock.invalid/history',
      CALLHISTORY_TOKEN_URL:'https://mock.invalid/token', CALLHISTORY_AUTH_URL:'https://mock.invalid/auth',
      CALLHISTORY_ACCESS_TOKEN:['refresh','invalid-grant','logout-race','mid-page-401','transcript-401','transcript-twice-401','transcript-refresh-fail'].includes(mode)?'':'synthetic-token',
      CALLHISTORY_LIMIT:'20', CALLHISTORY_TIMEOUT_MS:'250', ...overrides },stdio:'ignore'
  });
  t.after(async()=>{ if(child.exitCode===null && child.signalCode===null){const done=once(child,'exit');child.kill();await done;}fs.rmSync(temp,{recursive:true,force:true}); });
  const base='http://127.0.0.1:'+port;
  for(let attempt=0;attempt<80;attempt++){try { if((await fetch(base+'/api/status')).ok) break; }catch{} await new Promise(resolve=>setTimeout(resolve,25));}
  const request=async(route,options={})=>{const response=await fetch(base+route,options);return {response,body:await response.json()};};
  const status=async()=> (await request('/api/status')).body;
  const calls='/api/calls?mode=live&start=2026-10-17T00:00:00Z&end=2026-10-18T00:00:00Z';
  return {base,request,status,calls,advanceClock:()=>fs.writeFileSync(path.join(temp,'clock-advance'),''),requests:()=>fs.existsSync(capture)?fs.readFileSync(capture,'utf8').trim().split('\n').map(JSON.parse):[],
    async post(route,body={}){return request(route,{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':(await status()).csrfToken},body:JSON.stringify(body)});}};
}

test('CH-H1/M1/M2: all pages load; queue is routing metadata; pending transcription is unavailable',async t=>{
  const app=await start(t,'paging');const {body,response}=await app.request(app.calls);
  assert.equal(response.status,200);assert.equal(body.calls.length,75);assert.equal(body.pagination.complete,true);
  assert.deepEqual(app.requests().map(row=>new URL(row.url).searchParams.get('offset')),['0','20','40','60','75']);
  assert.ok(body.calls.every(call=>call.queue.name==='Sales' && call.user.name==='Alice Agent'));
  assert.equal(body.calls[2].transcriptId,'');assert.equal(body.calls[2].transcriptionAvailable,false);
  assert.equal(body.calls[0].transcriptId,'record-0');
  assert.equal(body.invalidRecords,0);
  assert.equal(body.calls[4].outcome,'unknown');
});

test('CH-H1: configured upper bound and upstream ignoring offset are visibly partial',async t=>{
  for(const [mode,env] of [['paging',{CALLHISTORY_MAX_RECORDS:'30'}],['repeated-page',{}]]){
    await t.test(mode,async child=>{const app=await start(child,mode,env);const {body}=await app.request(app.calls);assert.equal(body.pagination.complete,false);assert.equal(body.calls.length,mode==='paging'?30:20);assert.equal(app.requests().length,2);});
  }
});

test('CH-M3: formatted phone and digit-only searches match the same live records',async t=>{
  const app=await start(t,'paging');
  for(const party of ['+49 89 1234','49891234','(89) 1234','089 1234','(089) 1234','0049 89 1234','+49 (0)89 1234']){const {body}=await app.request(app.calls+'&party='+encodeURIComponent(party));assert.equal(body.calls.length,75);}
});

test('unexpected successful payload and stalled upstream fail explicitly',async t=>{
  for(const mode of ['unexpected','null-record','timeout'])await t.test(mode,async child=>{const app=await start(child,mode);const {response,body}=await app.request(app.calls);assert.equal(response.status,502);assert.equal(body.source,'callhistory-live');assert.equal(body.calls,undefined);});
});

test('CH-M4: invalid grant and upstream 401 expire the session and expose sign-in state',async t=>{
  for(const mode of ['invalid-grant','unauthorized'])await t.test(mode,async child=>{const app=await start(child,mode);const {response}=await app.request(app.calls);assert.equal(response.status,401);assert.equal((await app.status()).authenticated,false);assert.equal((await app.request(app.calls)).response.status,401);});
});

test('CH-M5: explicit logout disables environment-token access until a new session',async t=>{
  const app=await start(t,'paging');assert.equal((await app.status()).authenticated,true);assert.equal((await app.post('/api/auth/logout')).response.status,200);assert.equal((await app.status()).authenticated,false);assert.equal((await app.request(app.calls)).response.status,401);assert.equal(app.requests().length,0);
});

test('CH-M6: concurrent requests share one rotating-token refresh',async t=>{
  const app=await start(t,'refresh');const results=await Promise.all([app.request(app.calls),app.request(app.calls),app.request(app.calls)]);
  assert.ok(results.every(result=>result.response.status===200));assert.equal(app.requests().filter(row=>new URL(row.url).pathname==='/token').length,1);assert.ok(app.requests().filter(row=>new URL(row.url).pathname!=='/token').every(row=>row.authorization==='Bearer new-access'));
});

test('CH-M6: logout while refreshing cannot restore a session',async t=>{
  const app=await start(t,'logout-race');const pending=app.request(app.calls);
  for(let n=0;n<40&&!app.requests().length;n++)await new Promise(resolve=>setTimeout(resolve,5));
  await app.post('/api/auth/logout');assert.equal((await pending).response.status,401);assert.equal((await app.status()).authenticated,false);
});

test('CH-M7: browser redirect URI never expands read origins',async t=>{
  const app=await start(t,'paging');await app.post('/api/settings/browser-login',{clientId:'new-client',redirectUri:'https://untrusted.invalid/callback'});
  const {response}=await app.request('/api/status',{headers:{Origin:'https://untrusted.invalid'}});assert.equal(response.status,403);
});

test('independent OAuth tabs retain single-use PKCE state; errors return to setup',async t=>{
  const app=await start(t,'paging');
  const begin=async()=>new URL((await fetch(app.base+'/auth/login',{redirect:'manual'})).headers.get('location')).searchParams.get('state');
  const a=await begin(),b=await begin();assert.notEqual(a,b);
  for(const state of [a,b]){const response=await fetch(app.base+'/auth/call-history/callback?code=fake&state='+state,{redirect:'manual'});assert.equal(response.headers.get('location'),'/?auth=connected');}
  const replay=await fetch(app.base+'/auth/call-history/callback?code=fake&state='+a,{redirect:'manual'});assert.equal(replay.headers.get('location'),'/?auth=failed');
});


test('paging does not claim completeness when a short final page exceeds the configured cap',async t=>{
  const app=await start(t,'paging',{CALLHISTORY_MAX_RECORDS:'70'});
  const {body}=await app.request(app.calls);assert.equal(body.calls.length,70);assert.equal(body.pagination.complete,false);
});


test('OAuth round trip keeps validated language/theme across localhost and 127 origins',async t=>{
  const app=await start(t,'paging');
  for (const [query,expected] of [['theme=classic&lang=fi','&theme=classic&lang=fi'],['theme=https://foreign.invalid&lang=invalid','']]) {
    const loginResponse=await fetch(app.base+'/auth/login?'+query,{redirect:'manual'});
    const auth=new URL(loginResponse.headers.get('location'));
    assert.equal(auth.searchParams.has('theme'),false,'presentation preferences stay server-side, away from IdP');
    const callback=await fetch(app.base+'/auth/call-history/callback?state='+auth.searchParams.get('state')+'&code=fake',{headers:{Host:'localhost:'+new URL(app.base).port},redirect:'manual'});
    assert.equal(callback.headers.get('location'),'/?auth=connected'+expected);
  }
  const loginResponse=await fetch(app.base+'/auth/login?theme=classic&lang=de',{redirect:'manual'});
  const auth=new URL(loginResponse.headers.get('location'));
  const failure=await fetch(app.base+'/auth/call-history/callback?state='+auth.searchParams.get('state')+'&error=access_denied',{redirect:'manual'});
  assert.equal(failure.headers.get('location'),'/?auth=failed&theme=classic&lang=de');
});


test('R-HIST-02: capped pages and incorrect totals cannot claim a truncated list is complete', async t => {
  for (const mode of ['capped','bad-total']) await t.test(mode, async t => {
    const app=await start(t,mode); const {body}=await app.request(app.calls);
    assert.equal(body.calls.length,75); assert.equal(body.pagination.complete,true);
    assert.deepEqual(app.requests().map(row=>new URL(row.url).searchParams.get('offset')),['0','10','20','30','40','50','60','70','75']);
  });
});
test('R-HIST-10/14: malformed history hops are skipped and undated records excluded explicitly',async t=>{
  const hops=await start(t,'null-hop'); const result=await hops.request(hops.calls);
  assert.equal(result.response.status,200);assert.equal(result.body.calls[0].queue.name,'Support');
  const dates=await start(t,'invalid-dates');const {body}=await dates.request(dates.calls);
  assert.equal(body.calls.length,4);assert.equal(body.invalidRecords,2);assert.ok(body.calls.every(call=>call.startedAt));
  assert.equal(body.pagination.complete,true,'date quality is independent of paging completeness');
  assert.equal(body.calls.find(call=>call.id==='record-2').startedAt,'2026-10-17T10:00:00.000Z');
});
test('R-HIST-15: mid-page 401 refreshes once and retries the same offset',async t=>{
  const app=await start(t,'mid-page-401');const {body,response}=await app.request(app.calls);
  assert.equal(response.status,200);assert.equal(body.calls.length,75);assert.equal((await app.status()).authenticated,true);
  assert.equal(app.requests().filter(row=>new URL(row.url).pathname==='/token').length,1);
  assert.deepEqual(app.requests().filter(row=>new URL(row.url).pathname!=='/token').map(row=>new URL(row.url).searchParams.get('offset')),['0','20','40','40','60','75']);
});
test('R-HIST-23: total paging deadline returns an explicit partial result',async t=>{
  const app=await start(t,'slow-pages',{CALLHISTORY_PAGING_BUDGET_MS:'300'});const before=Date.now();const {body,response}=await app.request(app.calls);
  assert.equal(response.status,200);assert.ok(body.calls.length>0&&body.calls.length<75);assert.equal(body.pagination.complete,false);
  assert.ok(Date.now()-before<900,'request is bounded across pages');
});


test('R-HIST-19: expired known OAuth state preserves only validated presentation preferences',async t=>{
  const app=await start(t,'expired-state');
  const response=await fetch(app.base+'/auth/login?theme=classic&lang=de',{redirect:'manual'});
  const state=new URL(response.headers.get('location')).searchParams.get('state');
  app.advanceClock();
  const result=await fetch(app.base+'/auth/call-history/callback?state='+state+'&code=synthetic',{redirect:'manual'});
  assert.equal(result.headers.get('location'),'/?auth=failed&theme=classic&lang=de');
  assert.equal(app.requests().length,0,'expired state never exchanges a code');
  const replay=await fetch(app.base+'/auth/call-history/callback?state='+state+'&code=synthetic',{redirect:'manual'});
  assert.equal(replay.headers.get('location'),'/?auth=failed');
});
test('provider enum additions remain unknown while explicit caller queue metadata is recognized',async t=>{
  const app=await start(t,'unknown-enums'); const {body}=await app.request(app.calls);
  assert.deepEqual(body.calls.slice(0,3).map(call=>call.outcome),['unknown','unknown','unknown']);
  assert.equal(body.calls[0].direction,'unknown');
  assert.equal(body.calls[0].queue.name,'Müller Abrechnung GmbH');
});

test('R-HIST-20: server demo at 00:05 does not collapse future business calls onto midnight',async t=>{
  const app=await start(t,'midnight');
  const {body,response}=await app.request('/api/calls?mode=demo&start=2026-10-17T00:00:00&end=2026-10-18T00:00:00');
  assert.equal(response.status,200);assert.equal(body.calls.length,0);
  const previous=await app.request('/api/calls?mode=demo&start=2026-10-16T00:00:00&end=2026-10-17T00:00:00');
  assert.equal(previous.body.calls.length,20);
  assert.equal(new Set(previous.body.calls.map(call=>call.startedAt)).size,20);
});


test('R2-HIST-04/05: failed follow-up pages preserve records but never claim completion', async t => {
  for (const mode of ['followup-timeout','followup-204','followup-404','followup-empty-body','followup-503','followup-null-record','followup-array-record']) await t.test(mode, async child => {
    const app = await start(child, mode); const {response, body} = await app.request(app.calls);
    assert.equal(response.status,200); assert.equal(body.calls.length,20); assert.equal(body.pagination.complete,false);
    assert.equal((await app.status()).authenticated,true); assert.equal(app.requests().length,2);
  });
});
test('R2-HIST-06: small provider pages cannot exhaust the service with unbounded requests', async t => {
  const app = await start(t,'tiny-pages',{CALLHISTORY_MAX_REQUESTS:'5'});
  const {response,body}=await app.request(app.calls);
  assert.equal(response.status,200); assert.equal(body.calls.length,5); assert.equal(body.pagination.complete,false);
  assert.equal(app.requests().length,5);
});
test('R3-HIST-01: follow-up authorization failure still discards the partial response', async t => {
  const app = await start(t, 'followup-403');
  const { response, body } = await app.request(app.calls);
  assert.equal(response.status, 502);
  assert.equal(body.calls, undefined);
  assert.equal(app.requests().length, 2);
});
test('R3-HIST-01 countercheck: unreadable authorization bodies cannot produce partial success', async t => {
  for (const status of [401, 403]) await t.test(String(status), async child => {
    const app = await start(child, 'followup-broken-auth-' + status);
    const result = await app.request(app.calls);
    assert.equal(result.response.status, status === 401 ? 401 : 502);
    assert.equal(result.body.calls, undefined);
    assert.equal(app.requests().length, 2);
    assert.equal((await app.status()).authenticated, status !== 401);
  });
});
test('R3-HIST-03: valid request and page-size boundaries retain their exact meaning', async t => {
  const bounded = await start(t, 'paging', { CALLHISTORY_MAX_REQUESTS: '1' });
  const partial = await bounded.request(bounded.calls);
  assert.equal(partial.response.status, 200);
  assert.equal(partial.body.calls.length, 20);
  assert.equal(partial.body.pagination.complete, false);
  assert.equal(bounded.requests().length, 1);
  const largePage = await start(t, 'paging', { CALLHISTORY_LIMIT: '500', CALLHISTORY_MAX_REQUESTS: '1000' });
  const complete = await largePage.request(largePage.calls);
  assert.equal(complete.response.status, 200);
  assert.equal(complete.body.calls.length, 75);
  assert.equal(complete.body.pagination.complete, true);
  assert.equal(new URL(largePage.requests()[0].url).searchParams.get('limit'), '500');
});
test('R2-HIST-07: concurrent transcript 401s share refresh and retain the original content',async t=>{
  const app=await start(t,'transcript-401');
  const results=await Promise.all([app.request('/api/transcripts/transcript-one'),app.request('/api/transcripts/transcript-two')]);
  assert.ok(results.every(result=>result.response.status===200 && result.body.summary==='Original summary'));
  assert.equal(app.requests().filter(row=>new URL(row.url).pathname==='/token').length,1);
  assert.equal((await app.status()).authenticated,true);
});
test('R2-HIST-07: repeated unauthorized detail expires the session, temporary refresh failure does not',async t=>{
  for(const [mode,status,authenticated] of [['transcript-twice-401',401,false],['transcript-refresh-fail',502,true]]) await t.test(mode,async child=>{
    const app=await start(child,mode); const result=await app.request('/api/transcripts/transcript-one');
    assert.equal(result.response.status,status);assert.equal((await app.status()).authenticated,authenticated);
    assert.equal(app.requests().filter(row=>new URL(row.url).pathname==='/token').length,1);
  });
});


test('R2-I18N-10: OAuth keeps a validated cockpit link on the fixed return page, never at the identity provider',async t=>{
  const app=await start(t,'paging');
  for(const [cockpit,expected] of [['http://localhost:4999/apps?theme=classic#cards','http://localhost:4999/apps?theme=classic'],['http://[::1]:4999/','http://[::1]:4999/'],['https://attacker.invalid/',''],['http://user:pass@localhost:4999/',''],['javascript:alert(1)','']]){
    const response=await fetch(app.base+'/auth/login?lang=fi&cockpit='+encodeURIComponent(cockpit),{redirect:'manual'});
    const upstream=new URL(response.headers.get('location'));assert.equal(upstream.searchParams.has('cockpit'),false);
    const callback=await fetch(app.base+'/auth/call-history/callback?state='+upstream.searchParams.get('state')+'&error=access_denied',{redirect:'manual'});
    const location=callback.headers.get('location'); assert.ok(location.startsWith('/?auth=failed'));
    assert.equal(new URL(location,app.base).searchParams.get('cockpit')||'',expected);
  }
});
