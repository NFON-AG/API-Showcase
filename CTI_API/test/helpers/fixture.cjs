const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const source = path.resolve(__dirname, '../../src/server.js');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
async function eventually(fn, timeout = 5000) {
  const deadline = Date.now() + timeout; let last;
  while (Date.now() < deadline) { try { const v = await fn(); if (v) return v; } catch (e) { last = e; } await sleep(30); }
  throw last || Error('Condition did not become true');
}
async function fixture(t, { credentials = false, events = [], corrupt = false, publicFiles = false, preload = [], env: extraEnv = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cti-audit-'));
  fs.mkdirSync(path.join(dir, 'data')); fs.mkdirSync(path.join(dir, 'public'));
  fs.writeFileSync(path.join(dir, 'public', 'index.html'), '<!doctype html><title>isolated</title>');
  fs.writeFileSync(path.join(dir, 'public', 'app.js'), '/* test */');
  if (publicFiles) fs.cpSync(path.resolve(__dirname, '../../public'), path.join(dir, 'public'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'empty.env'), '');
  if (events.length) fs.writeFileSync(path.join(dir, 'data', 'call-events.jsonl'), events.map(e=>JSON.stringify(e)).join('\n')+'\n'+(corrupt ? '{broken\n' : ''));
  const mock = { logins: 0, writes: 0, deletes: 0, ua: [], streams: new Map(), unavailable: false, noExtensions: false, dialBody: null, resourceStatus: 0, refreshes: 0 };
  const upstream = http.createServer(async (req, res) => {
    const user = req.headers.authorization?.replace('Bearer token-', '') || '';
    mock.ua.push(req.headers['user-agent']);
    if (req.url === '/login') {
      if(req.method==='PUT')mock.refreshes++;else mock.logins++;
      let data = ''; for await (const chunk of req) data += chunk;
      if (mock.unavailable) { res.writeHead(401); res.end('{}'); return; }
      const username = data ? JSON.parse(data).username : 'one';
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ 'access-token': 'token-'+username, 'refresh-token': 'refresh-'+username })); return;
    }
    if (mock.resourceStatus) {res.writeHead(mock.resourceStatus);res.end('{}');return;}
    if (req.headers.accept === 'text/event-stream') {
      res.writeHead(200, { 'content-type': 'text/event-stream' }); res.write(': connected\n\n');
      const key = user+':'+req.url; mock.streams.set(key, res);
      req.on('close', () => { if (mock.streams.get(key) === res) mock.streams.delete(key); }); return;
    }
    if (req.url === '/extensions/phone/data') { mock.extensionReads=(mock.extensionReads||0)+1;if(mock.invalidExtensions){res.end(JSON.stringify({error:'maintenance'}));return;}res.writeHead(mock.noExtensions ? 503 : 200); res.end(JSON.stringify([{ extension_number: '21', name: mock.extensionName || user }])); return; }
    if (req.url === '/extensions/phone/states') { mock.stateReads=(mock.stateReads||0)+1;if(mock.invalidStates){res.end(JSON.stringify({error:'maintenance'}));return;}res.end(JSON.stringify([{ extension: '21', presence: 'available', line: 'idle' }])); return; }
    if (req.method === 'POST' && req.url === '/extensions/phone/calls') {
      if(mock.actionStatus){res.writeHead(mock.actionStatus);res.end('{}');return;}
      mock.writes++; let data=''; for await (const chunk of req) data+=chunk; mock.dialBody=JSON.parse(data);
      await sleep(150); res.writeHead(202); res.flushHeaders();if(mock.holdDialBody)await new Promise(resolve=>mock.releaseDial=resolve);res.end(JSON.stringify({ uuid:'dial-'+mock.writes, state:'caller-dial', extension:'21' })); return;
    }
    if (req.method === 'DELETE') {mock.deletes++;const status=mock.actionStatus||mock.cancelStatus;if(status){res.writeHead(status);res.end('{}');return;}}
    res.writeHead(404); res.end('{}');
  });
  await new Promise(r=>upstream.listen(0, '127.0.0.1', r));
  const probe=http.createServer(); await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
  const base='http://127.0.0.1:'+port;
  const mockBase='http://127.0.0.1:'+upstream.address().port;
  const guard=path.join(dir,'network.cjs');fs.writeFileSync(guard, `const original=globalThis.fetch; globalThis.fetch=(url, options)=>{if(!String(url).startsWith(${JSON.stringify(mockBase+'/')})) throw Error('External fetch forbidden: '+url);return original(url,options)};`);
  const env = { PATH: process.env.PATH, HOST:'127.0.0.1', PORT:String(port), CTI_API_ENV_FILE:path.join(dir,'empty.env'), NFON_SHOWCASE_CONFIG_DIR:path.join(dir,'config'), CTI_DATA_DIR:path.join(dir,'data'), NFON_BASE_URL:mockBase, NFON_K_ACCOUNT:credentials?'K1':'', NFON_API_USERNAME:credentials?'one':'', NFON_API_PASSWORD:credentials?'test-only':'', NFON_SECRET_FILE:'', GOOGLE_CLIENT_ID:'', GOOGLE_CLIENT_SECRET:'', GOOGLE_CLIENT_SECRET_FILE:'', CTI_ALLOWED_ORIGIN:base, HOME:dir, ...extraEnv };
  let child, token, logs='';
  async function stop() { if (!child || child.exitCode !== null) return; const end=once(child,'exit');child.kill();await end;child=null; }
  async function start() { child=spawn(process.execPath,['--require',guard,...preload.flatMap(file=>['--require',file]),source],{cwd:dir,env,stdio:['ignore','pipe','pipe']}); child.stderr.on('data',b=>logs+=b); child.stdout.on('data',b=>logs+=b); await eventually(async()=>{if(child.exitCode!==null)throw Error(logs); const r=await fetch(base+'/api/status');if(!r.ok)return false;token=(await r.json()).csrfToken;return true}); }
  t.after(async()=>{await stop();upstream.closeAllConnections();for(const r of mock.streams.values())r.destroy();await new Promise(r=>upstream.close(r));fs.rmSync(dir,{recursive:true,force:true})});
  return {dir,base,mock,start,stop,async get(route){const r=await fetch(base+route);return {status:r.status,body:await r.json()}}, async post(route,body,method='POST'){const r=await fetch(base+route,{method,headers:{'content-type':'application/json','x-csrf-token':token},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:r.status===204?null:await r.json()}}, send(user, kind, event){mock.streams.get(user+':/extensions/phone/'+kind).write('data: '+JSON.stringify(event)+'\n\n')}, logs:()=>logs};
}


module.exports={fixture,eventually,sleep};
