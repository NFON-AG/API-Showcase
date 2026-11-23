const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const test=require('node:test');
const file=path.resolve(__dirname,'../src/server.js');
const source=fs.readFileSync(file,'utf8').replace(/bootstrap\(\)\.catch\([\s\S]*$/, '');
function server(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cti-oauth-unit-'));fs.writeFileSync(path.join(dir,'empty.env'),'');
 t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));let requests=[];let responseOverride;
 const context=vm.createContext({require:createRequire(file),Buffer,URL,URLSearchParams,AbortController,AbortSignal,TextDecoder,console,process:{cwd:()=>dir,env:{CTI_API_ENV_FILE:path.join(dir,'empty.env'),NFON_SHOWCASE_CONFIG_DIR:path.join(dir,'config'),CTI_DATA_DIR:dir}},setTimeout:(fn,ms)=>({unref(){}}),clearTimeout(){},fetch:async(url,options)=>{
 requests.push({url:String(url),options});
 if(responseOverride)return responseOverride(url,options);
 if(String(url).endsWith('/token'))return new Response(JSON.stringify({access_token:'synthetic',refresh_token:'synthetic-refresh'}));
 if(String(url).includes('people.googleapis.com'))return new Response(JSON.stringify({connections:[]}));
 if(String(url).endsWith('/revoke'))return new Response('');
 throw Error('Unexpected network request');
 }});vm.runInContext(source,context);return{dir,requests,set:(key,value)=>context[key]=value,respond:fn=>responseOverride=fn,run:s=>vm.runInContext(s,context)};
}
test('Google OAuth state is required, expires, is consumed before token exchange and cannot replay concurrently',async t=>{
 const f=server(t);const stateFile=path.join(f.dir,'google-oauth-state.json');
 function put(state,time){fs.writeFileSync(stateFile,JSON.stringify({state,createdAt:time}))}
 put('expired',new Date(Date.now()-11*60_000).toISOString());
 await assert.rejects(f.run(`handleGoogleCallback(new URL('http://localhost/auth/google/callback?state=expired&code=example'))`),/invalid or expired/);assert.equal(f.requests.length,0);
 put('current',new Date().toISOString());
 await assert.rejects(f.run(`handleGoogleCallback(new URL('http://localhost/auth/google/callback?state=wrong&error=denied'))`),/invalid or expired/);assert.equal(f.requests.length,0);assert.ok(fs.existsSync(stateFile));
 const results=await Promise.allSettled([f.run(`handleGoogleCallback(new URL('http://localhost/auth/google/callback?state=current&code=one'))`),f.run(`handleGoogleCallback(new URL('http://localhost/auth/google/callback?state=current&code=two'))`)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.requests.filter(r=>r.url.endsWith('/token')).length,1);assert.equal(fs.existsSync(stateFile),false);
 await assert.rejects(f.run(`handleGoogleCallback(new URL('http://localhost/auth/google/callback?state=current&code=three'))`),/invalid or expired/);
 await f.run('disconnectGoogle()');assert.equal(f.requests.filter(r=>r.url.endsWith('/revoke')).length,1);assert.equal(f.run('googlePublicStatus().connected'),false);
});

test('unsolicited OAuth errors cannot change connected status; nonlocal OAuth is refused',async t=>{
 const f=server(t);f.run('appState.google.lastError="previous"');
 fs.mkdirSync(path.join(f.dir,'public'));fs.writeFileSync(path.join(f.dir,'public/index.html'),'<title>fixture</title>');
 // Execute the real HTTP callback handler with a deliberately unauthenticated error URL.
 // Values are only harness input, never part of the application's browser state.
 f.run(`this.reqForTest = {method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{}}; this.resForTest={writeHead(n){this.code=n},end(){}}`);
 await f.run(`handleAuth(reqForTest,resForTest,new URL('http://localhost/auth/google/callback?error=attacker'))`);
 assert.equal(f.run('appState.google.lastError'),'previous');assert.equal(f.requests.length,0);
 f.run(`reqForTest.socket.remoteAddress='192.0.2.1'`);await f.run(`handleAuth(reqForTest,resForTest,new URL('http://localhost/auth/google/start'))`);assert.equal(f.run('resForTest.code'),403);
});

test('Google photo proxy restricts hosts, drops bearer credentials and derives MIME from safe image bytes',async t=>{
 const f=server(t);f.run(`appState.google.accessToken=['must','not','forward'].join('-');this.photoReq={headers:{}};this.photoRes={writeHead(status,headers){this.status=status;this.headers=headers},end(body){this.body=body}}`);
 for(const url of ['https://evil.googleusercontent.com/photo','http://lh3.googleusercontent.com/photo','https://lh3.googleusercontent.com@evil.example/photo']){
  f.run(`appState.google.contacts=[{id:'photo',photoUrl:${JSON.stringify(url)}}]`);
  await assert.rejects(f.run(`sendContactPhoto(photoReq,photoRes,'photo')`),/could not be loaded/);
 }
 assert.equal(f.requests.length,0);
 f.run(`appState.google.contacts=[{id:'photo',photoUrl:'https://lh3.googleusercontent.com/photo'}]`);
 f.respond(()=>new Response('<html>active content</html>',{headers:{'content-type':'image/png'}}));
 await assert.rejects(f.run(`sendContactPhoto(photoReq,photoRes,'photo')`),/not found/);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jR1sAAAAASUVORK5CYII=','base64');
 f.respond(()=>new Response(png,{headers:{'content-type':'text/html'}}));
 await f.run(`sendContactPhoto(photoReq,photoRes,'photo')`);
 assert.equal(f.run(`photoRes.status`),200);assert.equal(f.run(`photoRes.headers['Content-Type']`),'image/png');assert.equal(f.run(`photoRes.headers['X-Content-Type-Options']`),'nosniff');
 for(const req of f.requests){assert.equal(req.options.headers?.Authorization,undefined);assert.equal(req.options.redirect,'error');}
 f.respond(()=>new Response(png,{headers:{'content-length':String(1024*1024+1)}}));
 await assert.rejects(f.run(`sendContactPhoto(photoReq,photoRes,'photo')`),/could not be loaded/);
});

test('Google callback restores validated local theme/language without sending them to Google',async t=>{
 const f=server(t);f.run(`config.googleClientId='fixture';config.googleClientSecret='fixture';this.oauthReq={method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}};this.oauthRes={writeHead(status,headers){this.status=status;this.headers=headers},end(){}}`);
 const provider=new URL(await f.run(`googleAuthUrl(new URLSearchParams('theme=classic&lang=de&returnTo=https://invalid.example&token=ignored'))`));
 assert.equal(provider.searchParams.has('theme'),false);assert.equal(provider.searchParams.has('lang'),false);
 const saved=JSON.parse(fs.readFileSync(path.join(f.dir,'google-oauth-state.json'),'utf8'));assert.equal(saved.theme,'classic');assert.equal(saved.lang,'de');assert.equal(saved.returnTo,undefined);
 await f.run(`handleAuth(oauthReq,oauthRes,new URL('http://localhost/auth/google/callback?code=fixture&state=${provider.searchParams.get('state')}'))`);
 assert.equal(f.run(`oauthRes.headers.Location`),'/?google=connected&theme=classic&lang=de');
 const second=new URL(await f.run(`googleAuthUrl(new URLSearchParams('theme=classic&lang=fi'))`));
 await f.run(`handleAuth(oauthReq,oauthRes,new URL('http://localhost/auth/google/callback?error=denied&state=${second.searchParams.get('state')}'))`);
 assert.equal(f.run(`oauthRes.headers.Location`),'/?google=error&theme=classic&lang=fi');
 const third=new URL(await f.run(`googleAuthUrl(new URLSearchParams('theme=invalid&lang=xx'))`));
 await f.run(`handleAuth(oauthReq,oauthRes,new URL('http://localhost/auth/google/callback?code=fixture&state=${third.searchParams.get('state')}'))`);
 assert.equal(f.run(`oauthRes.headers.Location`),'/?google=connected');
});

test('R-CTI-8 local disconnect removes credentials and cache even if provider revocation fails',async t=>{
 for(const outcome of ['offline','503']){const f=server(t);f.run(`appState.google.accessToken='token';appState.google.refreshToken='refresh';appState.google.connected=true;appState.google.contacts=[{id:'private'}]`);
 for(const name of ['google-token.json','google-contacts.json'])fs.writeFileSync(path.join(f.dir,name),'{}');
 f.respond(()=>{if(outcome==='offline')throw Error('offline');return new Response('',{status:503})});
 await f.run('disconnectGoogle()');assert.equal(f.run('googlePublicStatus().connected'),false);assert.equal(f.run('appState.google.contacts.length'),0);assert.equal(f.run('appState.google.accessToken'),'');assert.equal(f.run('appState.google.lastError'),'Google token revocation failed');
 for(const name of ['google-token.json','google-contacts.json'])assert.equal(fs.existsSync(path.join(f.dir,name)),false);
 }
});

test('R-CTI-5 resource auth rejection backs off exponentially until a protected request succeeds',async t=>{
 const f=server(t);f.run(`config.username='fixture';config.password='fixture';this.clock=100000;Date.now=()=>clock`);let token=0;let denied=true;
 f.respond(url=>String(url).endsWith('/login')?new Response(JSON.stringify({'access-token':'fixture-'+(++token),'refresh-token':'refresh'})):new Response('{}',{status:denied?401:200}));
 for(const delay of [30000,60000,120000]){
  const response=await f.run(`nfonFetch('/extensions/phone/data')`);assert.equal(response.status,401);assert.equal(f.run('tokens.nextAttemptAt-clock'),delay);
  const count=f.requests.length;await assert.rejects(f.run(`nfonFetch('/extensions/phone/data')`),/temporarily delayed/);assert.equal(f.requests.length,count);
  f.run(`clock += ${delay}`);
 }
 denied=false;assert.equal((await f.run(`nfonFetch('/extensions/phone/data')`)).status,200);assert.equal(f.run('tokens.failures'),0);assert.equal(f.run('tokens.lastError'),null);
});

test('R3-CTI-01 persistent non-auth stream failures back off, recover, and stop cleanly',async t=>{
 for(const status of [403,503])await t.test(String(status),async t=>{
  const f=server(t),timers=[];let healthy=false;
  f.set('setTimeout',(fn,ms)=>{const timer={fn,ms,unref(){}};timers.push(timer);return timer});
  f.set('clearTimeout',timer=>{if(timer)timer.cleared=true});
  f.run("tokens.accessToken=['stream','fixture'].join('-');tokens.accessExpiresAt=Date.now()+3600000;this.delivered=[]");
  f.respond(()=>healthy?{ok:true,status:200,body:{getReader(){let sent=false;return {async read(){if(sent)return {done:true};sent=true;return {done:false,value:Buffer.from('data: {"extension":"21","line":"idle"}\n\n')}}}}}}:new Response('{}',{status}));
  f.run("this.stopTestStream=startNfonStream('states','/extensions/phone/states',event=>delivered.push(event))");
  for(const delay of [1500,3000,6000,12000,24000,30000,30000]){
   await new Promise(setImmediate);
   const retry=timers.filter(timer=>!timer.cleared).at(-1);assert.equal(retry.ms,delay);assert.equal(f.run('tokens.failures'),0);
   retry.cleared=true;retry.fn();
  }
  await new Promise(setImmediate);healthy=true;
  const retry=timers.filter(timer=>!timer.cleared).at(-1);retry.cleared=true;retry.fn();await new Promise(setImmediate);
  assert.equal(f.run('delivered.length'),1);
  assert.equal(timers.filter(timer=>!timer.cleared).at(-1).ms,1500,'a received event resets transport backoff');
  const count=f.requests.length;f.run('stopTestStream()');assert.ok(timers.filter(timer=>!timer.cleared).length===0);
  retry.fn();await new Promise(setImmediate);assert.equal(f.requests.length,count,'stopped streams cannot reconnect');
 });
});

function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return{promise,resolve}}
test('R2-CTI-03 disconnect invalidates delayed People bodies and token refreshes before persistence',async t=>{
 for(const phase of ['contacts','refresh','callback'])await t.test(phase,async t=>{
  const f=server(t),started=deferred(),release=deferred();
  f.run(`Object.assign(appState.google,{accessToken:'old-access',refreshToken:'old-refresh',connected:true,expiresAt:${phase==='contacts'?Date.now()+3600000:0}})`);
  for(const name of ['google-token.json','google-contacts.json'])fs.writeFileSync(path.join(f.dir,name),'{}');
  if(phase==='callback')fs.writeFileSync(path.join(f.dir,'google-oauth-state.json'),JSON.stringify({state:'race',createdAt:new Date().toISOString()}));
  f.respond(async url=>{
   if(String(url).endsWith('/revoke'))return new Response('');
   if((phase==='contacts'&&String(url).includes('people.googleapis.com'))||(phase!=='contacts'&&String(url).endsWith('/token'))){
    started.resolve();return{ok:true,text:async()=>{await release.promise;return JSON.stringify(phase==='contacts'?{connections:[{resourceName:'people/stale',names:[{displayName:'Stale'}],phoneNumbers:[{value:'+49301234567'}]}]}:{access_token:'late-access',refresh_token:'late-refresh'})}};
   }throw Error('Unexpected request '+url);
  });
  const old=f.run(phase==='callback'?`handleGoogleCallback(new URL('http://localhost/auth/google/callback?state=race&code=fixture'))`:'syncGoogleContacts()');
  await started.promise;await f.run('disconnectGoogle()');release.resolve();await assert.rejects(old,/connection changed/);
  assert.equal(f.run('googlePublicStatus().connected'),false);assert.equal(f.run('googlePublicStatus().contacts'),0);assert.equal(f.run('appState.google.accessToken'),'');assert.equal(f.run('appState.google.lastError'),null);
  for(const name of ['google-token.json','google-contacts.json'])assert.equal(fs.existsSync(path.join(f.dir,name)),false,name);
  assert.equal(f.run(`findContactByPhone('+49301234567')`),null);
 });
});

test('R2-CTI-03 parallel token refresh is single-flight; disconnect removes an already-started disk write',async t=>{
 const f=server(t),started=deferred(),release=deferred();
 f.run(`Object.assign(appState.google,{refreshToken:'refresh',connected:true})`);
 f.respond(async url=>{if(String(url).endsWith('/token')){started.resolve();await release.promise;return new Response(JSON.stringify({access_token:'one'}))}if(String(url).endsWith('/revoke'))return new Response('');throw Error('Unexpected')});
 const calls=[f.run('getGoogleAccessToken()'),f.run('getGoogleAccessToken()')];await started.promise;release.resolve();assert.deepEqual(await Promise.all(calls),['one','one']);assert.equal(f.requests.filter(r=>r.url.endsWith('/token')).length,1);
 // Hold a persistence operation after it passed the generation check, exactly where async disk IO yields.
 const disk=deferred(),written=deferred();f.run('this.originalWrite=writePrivateJson');
 f.set('writeHook',async()=>{written.resolve();await disk.promise;});
 f.run('writePrivateJson = async (...args) => { await this.writeHook(); return originalWrite(...args); }');
 const writing=f.run('saveGoogleToken({access_token:"stored",refresh_token:"stored-refresh"})');
 await written.promise;const disconnect=f.run('disconnectGoogle()');disk.resolve();
 await assert.rejects(writing,/connection changed/);await disconnect;
 assert.equal(fs.existsSync(path.join(f.dir,'google-token.json')),false);
});

test('R2-CTI-01 an old-token 401 cannot revoke the newly accepted token',async t=>{
 const f=server(t);f.run(`tokens.accessToken='new';tokens.accessExpiresAt=Date.now()+3600000;tokens.rejectResource('old')`);
 assert.equal(f.run('tokens.accessToken'),'new');assert.equal(f.run('tokens.nextAttemptAt'),0);
});
test('R2-I18N-10 OAuth preserves a validated cockpit across loopback origin changes, never as redirect target',async t=>{
 const f=server(t);f.run(`config.googleClientId='fixture';config.googleClientSecret='fixture';config.googleRedirectUri='http://localhost:4841/auth/google/callback'`);
 const cockpit='http://127.0.0.1:4842/?theme=classic&lang=fi#api-cards';
 const provider=new URL(await f.run(`googleAuthUrl(new URLSearchParams({cockpit:${JSON.stringify(cockpit)},lang:'fi'}),'http://127.0.0.1:4841')`));
 assert.equal(provider.searchParams.has('cockpit'),false);assert.equal(provider.searchParams.get('redirect_uri'),'http://localhost:4841/auth/google/callback');
 const result=await f.run(`handleGoogleCallback(new URL('http://localhost:4841/auth/google/callback?code=fixture&state=${provider.searchParams.get('state')}'))`);
 const url=new URL(f.run(`googleReturnPath(${JSON.stringify(result)},'connected')`),'http://localhost:4841');assert.equal(url.pathname,'/');assert.equal(url.searchParams.get('cockpit'),'http://127.0.0.1:4842/?theme=classic&lang=fi');
 for(const cockpit of ['https://evil.example/','http://user:'+['pass','word'].join('')+'@localhost:4842/','file:///tmp/index.html','javascript:alert(1)'])assert.equal(f.run(`googlePresentation(new URLSearchParams({cockpit:${JSON.stringify(cockpit)}})).cockpit`),undefined);
});

test('R2-CTI-03 disconnect also removes an OAuth start whose state write was already underway',async t=>{
 const f=server(t),started=deferred(),release=deferred();
 f.run("config.googleClientId='fixture';config.googleClientSecret='fixture';this.originalWrite=writePrivateJson");
 f.set('writeHook',async()=>{started.resolve();await release.promise;});
 f.run('writePrivateJson=async(...args)=>{await this.writeHook();return originalWrite(...args)}');
 const auth=f.run('googleAuthUrl()');await started.promise;const disconnect=f.run('disconnectGoogle()');release.resolve();
 await assert.rejects(auth,/connection changed/);await disconnect;assert.equal(fs.existsSync(path.join(f.dir,'google-oauth-state.json')),false);assert.equal(f.requests.length,0);
});
