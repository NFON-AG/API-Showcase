const assert = require('node:assert/strict');
const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const test = require('node:test');

async function listen(handler) {
  const server = http.createServer(handler); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  return { server, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` };
}
async function freePort() { const fixture = await listen((_, res) => res.end()); const port = fixture.port; await new Promise(resolve => fixture.server.close(resolve)); return port; }
async function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfon-cockpit-'));
  const cwd = path.join(dir, 'landing'); fs.mkdirSync(path.join(cwd, 'src'), { recursive: true }); fs.mkdirSync(path.join(cwd, 'public'));
  for (const file of ['server.js', 'server-safety.cjs']) fs.copyFileSync(path.join(__dirname, '../src', file), path.join(cwd, 'src', file));
  fs.writeFileSync(path.join(cwd, 'public/index.html'), '<!doctype html><title>Fixture</title>');
  fs.writeFileSync(path.join(cwd, 'public/app.js'), '/* fixture */');
  const mock = await listen((req, res) => {
    if (options.health) return options.health(req, res);
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ appId: 'cti', ok: true, credentialsConfigured: true, streams: { calls: { connected: true }, states: { connected: true } } }));
  });
  const servicePort = await freePort();
  const app = path.join(dir, 'CTI_API/src'); fs.mkdirSync(app, { recursive: true });
  fs.copyFileSync(path.join(__dirname, '../src/server-safety.cjs'), path.join(app, 'server-safety.cjs'));
  fs.writeFileSync(path.join(app, 'server.js'), options.childSource || `const http=require('node:http');const {guardRequest}=require('./server-safety.cjs');http.createServer((req,res)=>{if(!guardRequest(req,res))return;res.setHeader('content-type','application/json');res.end(JSON.stringify({appId:'cti',ok:true,credentialsConfigured:true,streams:{calls:{connected:true},states:{connected:true}},inherited:!!process.env.PORTAL_API_SECRET}));}).listen(+process.env.PORT,'127.0.0.1');`);
  const port = await freePort(); const base = `http://127.0.0.1:${port}`;
  const configDir = path.join(dir, 'config'); fs.mkdirSync(configDir);
  let child; let stderr = '';
  const start = async () => {
    child = spawn(process.execPath, ['src/server.js'], { cwd, env: { PATH: process.env.PATH, HOME: dir, PORT: String(port), LANDING_HOST: '127.0.0.1', LANDING_ENABLE_SERVICE_CONTROL: options.control === false ? 'false' : 'true', NFON_SHOWCASE_CONFIG_DIR: configDir, CTI_UPSTREAM: options.child ? `http://127.0.0.1:${servicePort}` : mock.url, PORTAL_UPSTREAM: mock.url, CORE_HISTORY_UPSTREAM: mock.url, PORTAL_API_SECRET: 'fixture-sentinel', ...(options.env || {}) }, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', data => { stderr += data; });
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error(stderr);
      try { if ((await fetch(base + '/')).ok) return; } catch {}
      await new Promise(resolve => setTimeout(resolve, 30));
    }
    throw new Error('Cockpit failed to start: ' + stderr);
  };
  const stop = async () => { if (child && child.exitCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } };
  t.after(async () => {
    await stop();
    try {
      const owned = JSON.parse(fs.readFileSync(path.join(configDir, 'landing-services.json'))).cti;
      if (owned) await fetch(owned.upstream + '/api/_service', { method: 'DELETE', headers: { 'X-NFON-Service-Token': owned.token }, signal: AbortSignal.timeout(1000) });
    } catch {}
    await new Promise(resolve => mock.server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true });
  });
  await start();
  const status = async () => (await fetch(base + '/api/status')).json();
  const action = async (id, command, body, token) => fetch(base + `/api/services/${id}/${command}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token ?? (await status()).csrfToken }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { base, port, status, action, configDir, mock, stop, start, servicePort, cwd };
}
function raw(port, requestPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ hostname: '127.0.0.1', port, path: requestPath, headers }, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body })); }); req.on('error', reject);
  });
}

test('CSRF, Host and malformed request boundaries survive hostile input', async t => {
  const f = await fixture(t);
  assert.equal((await f.action('cti', 'start', undefined, '')).status, 403);
  assert.equal((await f.action('cti', 'upstream', { upstream: f.mock.url }, 'wrong')).status, 403);
  for (const host of ['attacker.example:' + f.port, '[', 'localhost:1', 'localhost@attacker.example']) assert.equal((await raw(f.port, '/api/status', { Host: host })).status, 403);
  for (const url of ['/%', '/%00.js', '/%ED%A0%80', '//evil.example/']) assert.equal((await raw(f.port, url)).status, 400);
  assert.equal((await raw(f.port, '/api/unknown')).status, 404);
  assert.equal((await raw(f.port, '/missing')).status, 404);
  const good = await raw(f.port, '/'); assert.equal(good.status, 200); assert.equal(good.headers['x-frame-options'], 'DENY'); assert.equal(good.headers['x-content-type-options'], 'nosniff'); assert.match(good.headers['content-security-policy'], /frame-ancestors 'none'/);
});

test('gateway constrains redirect origin and carries navigation preferences', async t => {
  const f = await fixture(t);
  for (const route of ['cti', 'portal', 'call-history']) {
    const r = await fetch(f.base + `/${route}//evil.example/a?theme=classic&lang=de`, { redirect: 'manual' });
    assert.equal(r.status, 302); const url = new URL(r.headers.get('location'));
    assert.equal(url.origin, f.mock.url); assert.equal(url.searchParams.get('lang'), 'de'); assert.equal(url.searchParams.get('theme'), 'classic'); assert.equal(url.searchParams.get('cockpit'), f.base + '/');
  }
});

test('upstream configuration validates, persists, resets and limits request bodies', async t => {
  const f = await fixture(t);
  for (const value of ['not a url', 'ftp://example.com', 'https://user:secret@example.com']) assert.equal((await f.action('cti', 'upstream', { upstream: value })).status, 400);
  const target = `http://127.0.0.1:${await freePort()}`; assert.equal((await f.action('cti', 'upstream', { upstream: target + '/ignored' })).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.configDir, 'landing-upstreams.json'))).cti, target);
  assert.equal((await f.action('cti', 'upstream', { upstream: '' })).status, 200); assert.equal((await f.status()).services.cti.upstream, f.mock.url);
  assert.equal((await f.action('missing', 'upstream', { upstream: target })).status, 404);
  assert.equal((await f.action('cti', 'upstream', { upstream: 'x'.repeat(20000) })).status, 413);
  assert.equal((await fetch(f.base + '/app.js?v=hash')).headers.get('cache-control'), 'public, max-age=31536000, immutable');
});

test('R4-SHARED-02 invalid upstream body types preserve the saved override', async t => {
  const f = await fixture(t);
  const target = `http://localhost:${f.mock.port}`;
  const filename = path.join(f.configDir, 'landing-upstreams.json');
  const post = async body => fetch(f.base + '/api/services/cti/upstream', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': (await f.status()).csrfToken },
    body: JSON.stringify(body),
  });
  for (const [name, body] of [
    ['number', 17], ['boolean', true], ['string', 'primitive'], ['array', []], ['null', null],
    ['numeric field', { upstream: 17 }], ['boolean field', { upstream: false }],
    ['array field', { upstream: [target] }], ['object field', { upstream: {} }], ['null field', { upstream: null }],
  ]) await t.test(name, async () => {
    assert.equal((await post({ upstream: target })).status, 200);
    const before = fs.readFileSync(filename, 'utf8');
    const response = await post(body);
    const actual = { status: response.status, persisted: fs.readFileSync(filename, 'utf8'), upstream: (await f.status()).services.cti.upstream };
    assert.deepEqual(actual, { status: 400, persisted: before, upstream: target });
  });
  assert.equal((await post({ upstream: target + '/path' })).status, 200);
  assert.equal((await f.status()).services.cti.upstream, target);
  assert.equal((await post({ upstream: '' })).status, 200, 'explicit empty string remains the supported reset');
  assert.equal((await f.status()).services.cti.upstream, f.mock.url);
  // Preserve the existing missing-field reset contract; the confirmed defect is type coercion.
  assert.equal((await post({ upstream: target })).status, 200);
  assert.equal((await post({})).status, 200);
  assert.equal((await f.status()).services.cti.upstream, f.mock.url);
});

test('health verifies app identity and warns about failures', async t => {
  const f = await fixture(t); const data = await f.status(); assert.equal(data.services.cti.health, 'online'); assert.equal(data.services.portal.health, 'warning');
  const g = await fixture(t, { health: (_, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ appId: 'portal', ok: false, connection: { state: 'unavailable' } })); } });
  assert.equal((await g.status()).services.portal.health, 'warning');
});

test('health rejects redirects and bounded oversized responses', async t => {
  const huge = await fixture(t, { health: (_, res) => { res.setHeader('content-type', 'application/json'); res.end(' '.repeat(300000)); } });
  assert.notEqual((await huge.status()).services.cti.health, 'online');
  const redirect = await fixture(t, { health: (_, res) => { res.writeHead(302, { Location: 'http://invalid.example' }); res.end(); } });
  assert.notEqual((await redirect.status()).services.cti.health, 'online');
});

test('rejected streaming non-JSON health responses close their sockets after every poll',async t=>{
  const active=new Set();
  const f=await fixture(t,{health:(req,res)=>{active.add(req.socket);req.socket.once('close',()=>active.delete(req.socket));res.writeHead(200,{'content-type':'text/html'});res.write('<html>');}});
  for(let i=0;i<3;i++) await f.status();
  for(let i=0;i<50&&active.size;i++) await new Promise(r=>setTimeout(r,10));
  assert.equal(active.size,0);
});

test('service ownership survives cockpit restart and parallel starts are serialized', async t => {
  const f = await fixture(t, { child: true }); const token = (await f.status()).csrfToken;
  const responses = await Promise.all([f.action('cti', 'start', undefined, token), f.action('cti', 'start', undefined, token)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [202, 409]);
  for (let i = 0; i < 60; i++) { if ((await f.status()).services.cti.health === 'online') break; await new Promise(r => setTimeout(r, 30)); }
  assert.equal((await f.status()).services.cti.health, 'online');
  assert.equal((await (await fetch(`http://127.0.0.1:${f.servicePort}/api/status`)).json()).inherited, false);
  await f.stop(); await f.start(); assert.equal((await f.status()).services.cti.managed, true);
  assert.equal((await f.action('cti', 'upstream', { upstream: f.mock.url })).status, 200);
  assert.equal((await f.status()).services.cti.managed, false, 'an old owner record does not make a new upstream managed');
  const absent=`http://127.0.0.1:${await freePort()}`;
  assert.equal((await f.action('cti','upstream',{upstream:absent})).status,200);
  assert.equal((await f.action('cti','start')).status,409,'an old managed child cannot be reported as starting on a different address');
  assert.equal((await f.action('cti', 'upstream', { upstream: '' })).status, 200);
  assert.equal((await f.status()).services.cti.managed, true);
  assert.equal((await f.action('cti', 'stop')).status, 202);
});

test('disabled service control and unowned services cannot be stopped', async t => {
  const f = await fixture(t, { control: false }); assert.equal((await f.status()).serviceControl, false); assert.equal((await f.action('cti', 'start')).status, 403);
  const g = await fixture(t); assert.equal((await g.action('cti', 'stop')).status, 409);
});

test('persisted ownership must be proven by the running service, not its public appId', async t => {
  const f = await fixture(t);
  await f.stop();
  fs.writeFileSync(path.join(f.configDir,'landing-services.json'), JSON.stringify({ cti:{ upstream:f.mock.url, pid:process.pid, token:'f'.repeat(64), startedAt:new Date(0).toISOString() } }));
  await f.start();
  assert.equal((await f.status()).services.cti.managed, false);
  assert.equal((await f.action('cti','stop')).status,409);
});

test('slow status after a cockpit restart never replaces a live child ownership record', async t => {
  const f = await fixture(t,{child:true,childSource:`const http=require('node:http');const {guardRequest}=require('./server-safety.cjs');http.createServer((req,res)=>{if(!guardRequest(req,res))return;setTimeout(()=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({appId:'cti',ok:true}));},1800);}).listen(+process.env.PORT,process.env.HOST);`});
  assert.equal((await f.action('cti','start')).status,202);
  const filename=path.join(f.configDir,'landing-services.json');
  const initial=JSON.parse(fs.readFileSync(filename)).cti;
  await f.stop();
  fs.writeFileSync(filename,JSON.stringify({cti:{...initial,startedAt:new Date(0).toISOString()}}));
  await f.start();
  for(let i=0;i<2;i++) {
    assert.equal((await f.action('cti','start')).status,202);
    const after=JSON.parse(fs.readFileSync(filename)).cti;
    assert.equal(after.pid,initial.pid);
    assert.equal(after.token,initial.token);
  }
  assert.equal((await f.action('cti','stop')).status,202);
});

test('failed child startup exposes a stable reason instead of raw process output', async t => {
  const f=await fixture(t,{child:true,childSource:`console.error('EADDRINUSE synthetic-private-log');process.exit(1);`});
  assert.equal((await f.action('cti','start')).status,202);
  let service;
  for(let i=0;i<50;i++){service=(await f.status()).services.cti;if(service.startError)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(service.startError,'port-in-use');
  assert.doesNotMatch(JSON.stringify(service),/synthetic-private-log/);
});

test('an IPv6 upstream starts an IPv6 child and retains ownership on repeated starts', async t => {
  const f = await fixture(t, { child:true, childSource:`const http=require('node:http');const {guardRequest}=require('./server-safety.cjs');http.createServer((req,res)=>{if(!guardRequest(req,res))return;res.setHeader('content-type','application/json');res.end(JSON.stringify({appId:'cti',ok:true,credentialsConfigured:true,streams:{calls:{connected:true},states:{connected:true}},host:process.env.HOST}));}).listen(+process.env.PORT,process.env.HOST);` });
  const target = `http://[::1]:${f.servicePort}`;
  assert.equal((await f.action('cti','upstream',{upstream:target})).status,200);
  assert.equal((await f.action('cti','start')).status,202);
  let status;
  for (let i=0;i<60;i++) { status=(await f.status()).services.cti; if(status.health==='online') break; await new Promise(r=>setTimeout(r,30)); }
  assert.equal(status.health,'online'); assert.equal(status.managed,true);
  assert.equal((await (await fetch(target+'/api/status')).json()).host,'::1');
  const owner=JSON.parse(fs.readFileSync(path.join(f.configDir,'landing-services.json'))).cti;
  assert.equal((await f.action('cti','start')).status,200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.configDir,'landing-services.json'))).cti,owner);
  assert.equal((await f.action('cti','stop')).status,202);
});

test('a recycled PID with no service proof cannot be adopted or stopped', async t => {
  const f=await fixture(t,{child:true}); await f.stop();
  const filename=path.join(f.configDir,'landing-services.json');
  const owner={upstream:`http://127.0.0.1:${f.servicePort}`,pid:process.pid,token:'a'.repeat(64),startedAt:new Date(0).toISOString()};
  fs.writeFileSync(filename,JSON.stringify({cti:owner})); await f.start();
  assert.equal((await f.action('cti','stop')).status,409);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename)).cti,owner);
  assert.equal((await f.status()).services.cti.managed,false);
});

test('static routes reject outside symlinks and overly long URLs without leaking paths',async t=>{
  const f=await fixture(t);
  const outside=path.join(f.configDir,'private.txt');fs.writeFileSync(outside,'private-sentinel');
  fs.symlinkSync(outside,path.join(f.cwd,'public','escape.txt'));
  const response=await raw(f.port,'/escape.txt');assert.equal(response.status,403);assert.doesNotMatch(response.body,/private-sentinel|private.txt/);
  assert.equal((await raw(f.port,'/'+'x'.repeat(8192))).status,414);
  assert.equal((await raw(f.port,'/'+'x'.repeat(500))).status,404);
  assert.equal((await raw(f.port,'/crm-demo/fallback')).headers['x-frame-options'],'DENY');
});

test('child environment preserves explicit runtime and app config, not sibling secrets',async t=>{
  const f=await fixture(t,{child:true,env:{NODE_OPTIONS:'--no-warnings',CTI_API_ENV_FILE:'/tmp/synthetic-cti.env',CTI_DATA_DIR:'/tmp/synthetic-cti-data',CallHistory_API_ENV_FILE:'/tmp/foreign.env'},childSource:`const http=require('node:http');const {guardRequest}=require('./server-safety.cjs');http.createServer((req,res)=>{if(!guardRequest(req,res))return;res.setHeader('content-type','application/json');res.end(JSON.stringify({appId:'cti',ok:true,node:process.env.NODE_OPTIONS,envFile:process.env.CTI_API_ENV_FILE,dataDir:process.env.CTI_DATA_DIR,foreign:process.env.CallHistory_API_ENV_FILE,sibling:process.env.PORTAL_API_SECRET}));}).listen(+process.env.PORT,process.env.HOST);`});
  await f.action('cti','start');let data;
  for(let i=0;i<50;i++){try{data=await(await fetch(`http://127.0.0.1:${f.servicePort}/api/status`)).json();break;}catch{await new Promise(r=>setTimeout(r,20));}}
  assert.equal(data.node,'--no-warnings');assert.equal(data.envFile,'/tmp/synthetic-cti.env');assert.equal(data.dataDir,'/tmp/synthetic-cti-data');assert.equal(data.foreign,undefined);assert.equal(data.sibling,undefined);
  await f.action('cti','stop');
});

test('repeated unfinished JSON responses meet a total deadline and close sockets', {timeout:45000}, async t => {
  const sockets = new Set();
  const f = await fixture(t,{health:(req,res)=>{sockets.add(req.socket);req.socket.once('close',()=>sockets.delete(req.socket));res.writeHead(200,{'content-type':'application/json'});res.write('{"appId":"cti",');}});
  for(let i=0;i<18;i++) {
    const before=Date.now(); const result=await f.status();
    assert.ok(Date.now()-before<3000,'total response deadline');
    assert.equal(result.services.cti.reason,'invalid-response');
    assert.equal(result.services.cti.detailKey,'landing.invalidResponse');
  }
  for(let i=0;i<50&&sockets.size;i++) await new Promise(r=>setTimeout(r,10));
  assert.equal(sockets.size,0);
});

test('a successful service health check clears an earlier child start error', async t => {
  const f=await fixture(t,{child:true,childSource:`console.error('EADDRINUSE');process.exit(1);`});
  await f.action('cti','start');
  for(let i=0;i<50&&!(await f.status()).services.cti.startError;i++) await new Promise(r=>setTimeout(r,20));
  assert.equal((await f.status()).services.cti.startError,'port-in-use');
  await f.action('cti','upstream',{upstream:f.mock.url});
  const recovered=(await f.status()).services.cti;
  assert.equal(recovered.health,'online'); assert.equal(recovered.startError,'');
});

test('normal start recovers stale ownership without signaling a recycled PID',async t=>{
  const f=await fixture(t,{child:true}); await f.stop();
  const filename=path.join(f.configDir,'landing-services.json');
  fs.writeFileSync(filename,JSON.stringify({cti:{upstream:`http://127.0.0.1:${f.servicePort}`,pid:process.pid,token:'b'.repeat(64)}}));
  await f.start(); assert.equal((await f.status()).services.cti.staleOwnership,true);
  assert.equal((await f.action('cti','start')).status,202);
  for(let i=0;i<50&&!(await f.status()).services.cti.managed;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal((await f.status()).services.cti.managed,true);
  const owner=JSON.parse(fs.readFileSync(filename)).cti;
  assert.notEqual(owner.pid,process.pid);
  assert.notEqual(owner.token,'b'.repeat(64));
  assert.doesNotThrow(()=>process.kill(process.pid,0),'the unrelated process remains alive');
  assert.equal((await f.action('cti','forget')).status,404,'manual recovery route is retired');
  assert.deepEqual(JSON.parse(fs.readFileSync(filename)).cti,owner);
  assert.equal((await f.action('cti','stop')).status,202);
});

test('the previous managed service remains stoppable after changing its address',async t=>{
  const f=await fixture(t,{child:true}); await f.action('cti','start');
  for(let i=0;i<50&&!(await f.status()).services.cti.managed;i++)await new Promise(r=>setTimeout(r,20));
  await f.action('cti','upstream',{upstream:f.mock.url});
  assert.equal((await f.status()).services.cti.managedElsewhere,true);
  assert.equal((await f.action('cti','stop')).status,202);
  assert.equal((await fetch(f.mock.url)).status,200,'the new unowned service is untouched');
});

test('automatic recovery preserves local-only controls after an upstream change',async t=>{
  const f=await fixture(t,{child:true}); await f.stop();
  const filename=path.join(f.configDir,'landing-services.json');
  fs.writeFileSync(filename,JSON.stringify({cti:{upstream:`http://127.0.0.1:${f.servicePort}`,pid:process.pid,token:'c'.repeat(64)}}));
  await f.start();
  const newAddress=`https://127.0.0.1:${await freePort()}`;
  assert.equal((await f.action('cti','upstream',{upstream:newAddress})).status,200);
  assert.equal((await f.status()).services.cti.staleOwnership,true);
  assert.equal((await f.action('cti','start')).status,403);
  assert.equal(JSON.parse(fs.readFileSync(filename)).cti.token,'c'.repeat(64));
  assert.equal((await f.status()).services.cti.upstream,newAddress);
  assert.equal((await f.action('cti','upstream',{upstream:''})).status,200);
  assert.equal((await f.action('cti','start')).status,202);
  for(let i=0;i<50&&!(await f.status()).services.cti.managed;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal((await f.status()).services.cti.managed,true);
  assert.doesNotThrow(()=>process.kill(process.pid,0),'the recycled PID is never signaled');
  assert.equal((await f.action('cti','stop')).status,202);
});

test('automatic recovery retains unverifiable ownership at an occupied previous address',async t=>{
  const f=await fixture(t,{child:true}); await f.stop();
  const filename=path.join(f.configDir,'landing-services.json');
  const previous={upstream:f.mock.url,pid:process.pid,token:'d'.repeat(64)};
  fs.writeFileSync(filename,JSON.stringify({cti:previous}));
  await f.start();
  const response=await f.action('cti','start');
  assert.equal(response.status,409);
  assert.deepEqual(JSON.parse(fs.readFileSync(filename)).cti,previous);
  assert.equal((await fetch(f.mock.url)).status,200,'the unowned listener is untouched');
  assert.equal((await f.status()).services.cti.managed,false);
});

test('normal start never spawns over an occupied address with a silent health endpoint',async t=>{
  const f=await fixture(t,{health:(_req,_res)=>{}});
  const response=await f.action('cti','start');
  assert.equal(response.status,409);
  assert.equal((await response.json()).errorKey,'landing.unexpectedService');
  assert.equal(fs.existsSync(path.join(f.configDir,'landing-services.json')),false);
  assert.equal(f.mock.server.listening,true);
});

test('invalid health never claims app availability or successful startup',async t=>{
  const f=await fixture(t,{health:(_,res)=>res.end('<html>other service</html>')});
  const result=(await f.status()).services.cti;
  assert.equal(result.reason,'invalid-response'); assert.doesNotMatch(result.detail,/App available/);
  const start=await f.action('cti','start'); assert.equal(start.status,409);
  assert.equal((await start.json()).errorKey,'landing.unexpectedService');
});

test('JSON null health is an invalid service response and never starts a child',async t=>{
  const f=await fixture(t,{health:(_,res)=>{res.setHeader('content-type','application/json');res.end('null');}});
  const service=(await f.status()).services.cti;
  assert.equal(service.httpStatus,200);
  assert.equal(service.health,'warning');
  assert.equal(service.reason,'unexpected-service');
  const response=await f.action('cti','start');
  assert.equal(response.status,409);
  assert.equal((await response.json()).errorKey,'landing.unexpectedService');
  assert.equal(fs.existsSync(path.join(f.configDir,'landing-services.json')),false,'no child ownership is created');
});

test('a confirmed running child reports a later exit separately from failed startup',async t=>{
  const f=await fixture(t,{child:true});
  assert.equal((await f.action('cti','start')).status,202);
  for(let i=0;i<60&&!(await f.status()).services.cti.managed;i++)await new Promise(r=>setTimeout(r,20));
  assert.equal((await f.status()).services.cti.managed,true);
  const owner=JSON.parse(fs.readFileSync(path.join(f.configDir,'landing-services.json'))).cti;
  assert.equal((await f.action('cti','start')).status,200);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.configDir,'landing-services.json'))).cti,owner);
  process.kill(owner.pid,'SIGTERM');
  let service;
  for(let i=0;i<60;i++){service=(await f.status()).services.cti;if(service.startError)break;await new Promise(r=>setTimeout(r,20));}
  assert.equal(service.startError,'service-exited');
  assert.equal(service.managed,false);
});

test('duplicate environment keys fail startup with a concise safe configuration message',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfon-cockpit-env-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'src'));
  for(const file of ['server.js','server-safety.cjs'])fs.copyFileSync(path.join(__dirname,'../src',file),path.join(dir,'src',file));
  const sentinel=['synthetic','not-a-real','credential'].join('-');
  fs.writeFileSync(path.join(dir,'.env'),'DUPLICATE='+sentinel+'\nDUPLICATE='+sentinel+'\n');
  const result=spawnSync(process.execPath,['src/server.js'],{cwd:dir,env:{HOME:dir,NFON_SHOWCASE_CONFIG_DIR:path.join(dir,'config')},encoding:'utf8'});
  assert.equal(result.status,1);
  assert.equal(result.stderr.trim(),'Cockpit configuration error: Duplicate environment key: DUPLICATE on lines 1 and 2');
  assert.ok(!result.stderr.includes(sentinel));
  assert.equal(result.stdout,'');
});
