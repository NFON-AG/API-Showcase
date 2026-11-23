const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const http=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');

async function fixture(t){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfon-r5-cockpit-'));
 const config=path.join(dir,'config');fs.mkdirSync(config);
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({appId:'cti',credentialsConfigured:true,streams:{calls:{connected:true},states:{connected:true}}}));});
 server.listen(0,'127.0.0.1');await once(server,'listening');const target='http://127.0.0.1:'+server.address().port;
 const probe=http.createServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const port=probe.address().port;await new Promise(r=>probe.close(r));
 const hook=path.join(dir,'io.cjs');
 fs.writeFileSync(hook,`const fs=require('node:fs'),p=fs.promises,path=require('node:path');const dir=${JSON.stringify(dir)};let held=false;
 const original=p.writeFile.bind(p);p.writeFile=async function(file,...args){if(path.basename(String(file)).startsWith('landing-upstreams.json')){if(fs.existsSync(path.join(dir,'fail')))throw Object.assign(new Error('fixture disk failure'),{code:'EACCES'});if(fs.existsSync(path.join(dir,'hold'))&&!held){held=true;fs.writeFileSync(path.join(dir,'reached'),'');while(fs.existsSync(path.join(dir,'hold')))await new Promise(r=>setTimeout(r,10));}}return original(file,...args)};
 const rename=p.rename.bind(p);p.rename=async function(a,b){const upstream=path.basename(String(b))==='landing-upstreams.json';if(upstream&&fs.existsSync(path.join(dir,'rename-fail')))throw Object.assign(new Error('fixture rename failure'),{code:'EACCES'});const result=await rename(a,b);if(upstream&&fs.existsSync(path.join(dir,'revoke-after-commit')))fs.chmodSync(path.dirname(String(b)),0);return result};`);
 let child,logs='';const base='http://127.0.0.1:'+port;
 async function start(){child=spawn(process.execPath,['--require',hook,path.resolve(__dirname,'../src/server.js')],{cwd:dir,env:{PATH:process.env.PATH,HOME:dir,NFON_SHOWCASE_CONFIG_DIR:config,PORT:String(port),LANDING_HOST:'127.0.0.1',LANDING_ENABLE_SERVICE_CONTROL:'true',CTI_UPSTREAM:target,PORTAL_UPSTREAM:target,CORE_HISTORY_UPSTREAM:target},stdio:['ignore','pipe','pipe']});child.stderr.on('data',d=>logs+=d);for(let i=0;i<100;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/status')).ok)return;}catch{}await new Promise(r=>setTimeout(r,20));}throw Error('start timeout '+logs);}
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill();await done;}}
 t.after(async()=>{fs.rmSync(path.join(dir,'hold'),{force:true});await stop();server.closeAllConnections();await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});});
 await start();const status=async()=>(await fetch(base+'/api/status')).json();const token=(await status()).csrfToken;
 return {dir,config,target,start,stop,status,post:(id,upstream)=>fetch(base+'/api/services/'+id+'/upstream',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':token},body:JSON.stringify({upstream})})};
}

test('R5-COCKPIT-01 failed save preserves effective and persisted upstream and recovers',async t=>{
 const f=await fixture(t),a=f.target.replace('127.0.0.1','localhost');
 assert.equal((await f.post('cti',a)).status,200);
 const file=path.join(f.config,'landing-upstreams.json'),before=fs.readFileSync(file,'utf8');
 fs.writeFileSync(path.join(f.dir,'fail'),'');
 assert.equal((await f.post('cti',f.target)).status,500);
 assert.equal((await f.status()).services.cti.upstream,a,'failed save must not change runtime');
 assert.equal(fs.readFileSync(file,'utf8'),before,'failed save must preserve disk');
 fs.unlinkSync(path.join(f.dir,'fail'));
 assert.equal((await f.post('cti',f.target)).status,200);await f.stop();await f.start();assert.equal((await f.status()).services.cti.upstream,f.target);
});

test('R5-COCKPIT-01 pending save is invisible and concurrent changes survive restart',async t=>{
 const f=await fixture(t),next=f.target.replace('127.0.0.1','localhost');
 fs.writeFileSync(path.join(f.dir,'hold'),'');
 const first=f.post('cti',next);
 for(let i=0;i<100&&!fs.existsSync(path.join(f.dir,'reached'));i++)await new Promise(r=>setTimeout(r,10));
 assert.ok(fs.existsSync(path.join(f.dir,'reached')));
 const second=f.post('portal',next);
 try{assert.equal((await f.status()).services.cti.upstream,f.target,'uncommitted value must not be effective');}
 finally{fs.unlinkSync(path.join(f.dir,'hold'));await Promise.all([first,second]);}
 const disk=JSON.parse(fs.readFileSync(path.join(f.config,'landing-upstreams.json'),'utf8'));assert.equal(disk.cti,next);assert.equal(disk.portal,next);
 await f.stop();await f.start();const s=await f.status();assert.equal(s.services.cti.upstream,next);assert.equal(s.services.portal.upstream,next);
});

test('R5-COCKPIT-01 failed atomic rename preserves old disk and runtime',async t=>{
 const f=await fixture(t),a=f.target.replace('127.0.0.1','localhost');
 assert.equal((await f.post('cti',a)).status,200);const file=path.join(f.config,'landing-upstreams.json'),before=fs.readFileSync(file,'utf8');
 fs.writeFileSync(path.join(f.dir,'rename-fail'),'');assert.equal((await f.post('cti',f.target)).status,500);
 assert.equal((await f.status()).services.cti.upstream,a);assert.equal(fs.readFileSync(file,'utf8'),before);
 assert.deepEqual(fs.readdirSync(f.config),['landing-upstreams.json'],'temporary file cleaned after failure');
});

test('R5-COCKPIT-01 successful rename commits even when directory access is then revoked',async t=>{
 const f=await fixture(t),previous=f.target.replace('127.0.0.1','localhost');
 assert.equal((await f.post('cti',previous)).status,200);
 fs.writeFileSync(path.join(f.dir,'revoke-after-commit'),'');
 let response;
 try{response=await f.post('cti',f.target);}
 finally{fs.chmodSync(f.config,0o700);fs.rmSync(path.join(f.dir,'revoke-after-commit'),{force:true});}
 assert.equal(response.status,200,'cleanup must not turn a committed rename into a failed save');
 assert.equal((await f.status()).services.cti.upstream,f.target);
 assert.equal(JSON.parse(fs.readFileSync(path.join(f.config,'landing-upstreams.json'))).cti,f.target);
 assert.deepEqual(fs.readdirSync(f.config),['landing-upstreams.json']);
 await f.stop();await f.start();assert.equal((await f.status()).services.cti.upstream,f.target);
});
