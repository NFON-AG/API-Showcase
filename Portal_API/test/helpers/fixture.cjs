const fs=require('node:fs');const os=require('node:os');const path=require('node:path');const http=require('node:http');const {spawn}=require('node:child_process');const {once}=require('node:events');
const root=path.resolve(__dirname,'../..');
async function stop(child){if(child&&child.exitCode===null){const ended=once(child,'exit');child.kill();await ended;}}
async function fixture(t,options={}){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'portal-lifecycle-'));fs.mkdirSync(path.join(dir,'src'));
 for(const file of ['server.js','messages.cjs','server-safety.cjs'])fs.copyFileSync(path.join(root,'src',file),path.join(dir,'src',file));fs.copyFileSync(path.join(root,'i18n-messages.json'),path.join(dir,'i18n-messages.json'));
 if(options.envText) {options.envFile=path.join(dir,"fixture.env");fs.writeFileSync(options.envFile,options.envText);}
 if(options.public) {fs.cpSync(path.join(root,'public'),path.join(dir,'public'),{recursive:true});const messages={...JSON.parse(fs.readFileSync(path.join(root,'../shared/i18n-messages.json'),'utf8')),...JSON.parse(fs.readFileSync(path.join(root,'i18n-messages.json'),'utf8'))};fs.writeFileSync(path.join(dir,'public/messages.js'),'window.NFON_MESSAGES='+JSON.stringify(messages)+';');}
 const guard=path.join(__dirname,'egress.cjs');
 const mock=spawn(process.execPath,['--require',guard,path.join(__dirname,'provider.mjs'),'0'],{env:{PATH:process.env.PATH,HOME:dir,TEST_PROVIDER_PORT:'0',...options.providerEnv},stdio:['ignore','pipe','pipe']});
 let mockPort=0;let mockOutput='';mock.stdout.on('data',chunk=>{mockOutput+=chunk;mockPort=Number(mockOutput.match(/MOCK_PORT=(\d+)/)?.[1]||0);});
 let child;let appPort;let status;let output='';
 t.after(async()=>{await stop(child);await stop(mock);fs.rmSync(dir,{recursive:true,force:true});});
 const deadline=Date.now()+5000;while(!mockPort&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));if(!mockPort)throw Error('Mock did not start');
 const provider=`http://127.0.0.1:${mockPort}`;
 async function control(route,body){return (await fetch(provider+'/__mock/'+route,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();}
 await control('config',{dids:4,customers:1,userTimeControl:false,...options.provider});
 async function start(){
  const reservation=http.createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');appPort=reservation.address().port;await new Promise(r=>reservation.close(r));
  child=spawn(process.execPath,['--require',guard,'src/server.js'],{cwd:dir,env:{PATH:process.env.PATH,HOME:dir,NFON_SHOWCASE_CONFIG_DIR:path.join(dir,'config'),Portal_API_ENV_FILE:options.envFile||'',PORTAL_DATA_DIR:path.join(dir,'data'),PORTAL_SECRET_FILE:path.join(dir,'missing'),NFON_SECRET_FILE:path.join(dir,'missing'),PORTAL_BASE_URL:provider,PORTAL_API_KEY_ID:'retest-portal-key',PORTAL_API_KEY_SECRET:'retest-portal-secret',PORTAL_CUSTOMER_ACCOUNT:'K9001',PORTAL_ENABLE_LIVE_WRITES:'true',HOST:'127.0.0.1',PORT:String(appPort),TEST_PROVIDER_PORT:String(mockPort),...options.env},stdio:['ignore','pipe','pipe']});
  child.stderr.on('data',chunk=>output+=chunk);child.stdout.on('data',chunk=>output+=chunk);
  status=null;const until=Date.now()+5000;while(Date.now()<until){if(child.exitCode!==null)throw Error('App exited: '+output);try{status=await(await fetch(`http://127.0.0.1:${appPort}/api/status`)).json();break;}catch{}await new Promise(r=>setTimeout(r,20));}if(!status)throw Error('App startup failed: '+output);
 }
 await start();
 async function request(route,body,method=body===undefined?'GET':'POST'){
  const response=await fetch(`http://127.0.0.1:${appPort}${route}`,{method,headers:{'Content-Type':'application/json','X-CSRF-Token':status.settings.csrfToken,'X-Portal-Context':status.settings.writeContext},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result={status:response.status,body:await response.json()};
  // Only an intentional login/account change adopts the new preparation context.
  if(response.ok&&['/api/settings/customer','/api/settings/browser-login'].includes(route)&&result.body.settings)status.settings=result.body.settings;
  return result;
 }
 return {request,control,dir,get port(){return appPort;},get output(){return output;},async restart(){await stop(child);await start();},snapshot(){const file=fs.readdirSync(path.join(dir,'data')).find(f=>/^daynight-/.test(f));return file?JSON.parse(fs.readFileSync(path.join(dir,'data',file),'utf8')):null;}};
}
// Mutation regression suites explicitly enter a write session over the same HTTP route as Setup.
// A restart intentionally does not repeat this opt-in.
async function writeFixture(t,options={}) {
 const app=await fixture(t,options);
 const settings=(await app.request('/api/status')).body.settings;
 if(settings.configured&&settings.liveWritesPermitted&&!settings.liveWritesLocked) {
  const result=await app.request('/api/settings/live-writes',{enabled:true});
  if(result.status!==200||!result.body.settings.liveWritesEnabled)throw Error('Test session opt-in failed');
 }
 return app;
}
module.exports={fixture,writeFixture};
