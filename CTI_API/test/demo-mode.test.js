const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const root=path.resolve(__dirname,'../..');
const source=fs.readFileSync(path.join(root,'CTI_API/public/app.js'),'utf8');
const demo=fs.readFileSync(path.join(root,'docs/demo-runtime.js'),'utf8');

test('CTI live pages expose a keyboard-operable Demo switch and load its runtime before the client',()=>{
 for(const page of ['index','analytics','setup']){
  const html=fs.readFileSync(path.join(root,'CTI_API/public',page+'.html'),'utf8');
  assert.match(html,/<input[^>]+id="demo-toggle"[^>]+type="checkbox"/);
  assert.match(html,/<script[^>]+src="\/demo-runtime\.js[^"\n]*"[^>]+data-nfon-optional-demo="cti"/);
  assert.ok(html.indexOf('/demo-runtime.js')<html.indexOf('/app.js'));
 }
});

function runtime(query){
 let requests=0;
 const originalFetch=()=>{requests++;throw Error('No network permitted');};
 const NativeEvents=class{};
 const window={NFON_PHONE:require('../public/phone-number.js'),location:{href:'http://example.test/analytics.html'+query,pathname:'/analytics.html'},fetch:originalFetch,EventSource:NativeEvents,setInterval(){},setTimeout(){},addEventListener(){}};
 const document={currentScript:{dataset:{nfonOptionalDemo:'cti'}},body:{dataset:{}},readyState:'loading',head:{appendChild(){}},createElement(){return {dataset:{}};},getElementById(){return null;},addEventListener(){}};
 vm.runInNewContext(demo,{window,document,URL,Response,EventTarget,MessageEvent,Event,Date,Math,Blob,MutationObserver:class{observe(){}}});
 return {window,document,originalFetch,NativeEvents,requests:()=>requests};
}
test('CTI optional demo runtime leaves live fetch and streams completely untouched',()=>{
 for(const query of ['', '?demo=0','?demo=false']){const r=runtime(query);assert.equal(r.window.NFON_WEB_ONLY_DEMO,undefined);assert.equal(r.window.fetch,r.originalFetch);assert.equal(r.window.EventSource,r.NativeEvents);assert.equal(r.document.body.dataset.nfonApp,undefined);}
});
test('CTI explicitly selected demo supplies isolated history, status and call actions with no network',async()=>{
 const r=runtime('?demo=1');assert.equal(r.window.NFON_LOCAL_DEMO,true);assert.equal(r.window.NFON_WEB_ONLY_DEMO,true);
 const status=await (await r.window.fetch('/api/status')).json();assert.equal(status.demo,true);
 const history=await(await r.window.fetch('/api/history')).json();assert.ok(history.length>20);
 const calls=await(await r.window.fetch('/api/calls',{method:'POST',body:JSON.stringify({extension:'201',callee:'+4900000000'})})).json();assert.equal(calls.ok,true);assert.equal(r.requests(),0);
});

test('CTI Demo switch changes only mode, preserves location preferences, and survives internal navigation',()=>{
 const handlers={},control={checked:false,addEventListener(name,fn){handlers[name]=fn;}},label={hidden:false};
 let destination;
 const document={getElementById(id){return id==='demo-toggle'?control:id==='demo-control'?label:null;},querySelectorAll(){return [];},addEventListener(name,fn){handlers['document:'+name]=fn;},documentElement:{lang:'en'},body:{classList:{add(){},remove(){}}}};
 const window={NFON_LOCAL_DEMO:false,NFON_I18N:{message(){return '';},getLanguage(){return 'en';}},location:{protocol:'http:',href:'http://example.test/analytics.html?theme=classic&lang=fi&cockpit=http%3A%2F%2Fexample.test%3A3090%2F#history',pathname:'/analytics.html',assign(url){destination=url;}},addEventListener(name,fn){handlers['window:'+name]=fn;}};
 const sandbox={window,document,localStorage:{getItem(){return null;}},Intl,Date,URL,URLSearchParams,Blob,Map,setTimeout,clearTimeout,fetch(){throw Error('No network');}};
 vm.createContext(sandbox);vm.runInContext(source.replace(/\nstartApp\(\);\s*$/,''),sandbox);
 delete handlers['window:pageshow']; // This unit probe observes only the mode listener; the browser checks stream recovery.
 vm.runInContext('installDemoMode()',sandbox);
 assert.equal(control.checked,false);control.checked=true;handlers.change();let url=new URL(destination);assert.equal(url.searchParams.get('demo'),'1');assert.equal(url.searchParams.get('theme'),'classic');assert.equal(url.searchParams.get('lang'),'fi');assert.equal(url.hash,'#history');assert.equal(url.searchParams.get('cockpit'),'http://example.test:3090/');
 // A new page is the isolation boundary: no live state is reused.
 window.NFON_LOCAL_DEMO=true;window.location.href=destination;vm.runInContext('installDemoMode()',sandbox);assert.equal(control.checked,true);
 const link={href:'http://example.test/setup.html?theme=classic&lang=fi',getAttribute(){return this.href;},setAttribute(_name,value){this.href=value;},hasAttribute(){return false;}};
 handlers['document:click']({target:{closest(){return link;}}});assert.equal(new URL(link.href).searchParams.get('demo'),'1');
 control.checked=false;handlers.change();url=new URL(destination);assert.equal(url.searchParams.has('demo'),false);assert.equal(url.pathname,'/analytics.html');assert.equal(url.searchParams.get('lang'),'fi');
 handlers['window:pageshow']?.({persisted:true});assert.equal(control.checked,true,'back/forward cache restores the switch to the page data source');
});
