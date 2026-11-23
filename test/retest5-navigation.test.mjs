import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const demo=fs.readFileSync(new URL('../docs/demo-runtime.js',import.meta.url),'utf8');
// Expose the existing async initializer without running unrelated layout code.
const appearance=fs.readFileSync(new URL('../shared/appearance.js',import.meta.url),'utf8')
 .replace('window.NFON_APPEARANCE = { getTheme:', 'window.NFON_APPEARANCE = { configureHomeLinks, getTheme:');

async function page(query,saved,cockpitUrl){
 let requests=0;
 const home={href:'http://127.0.0.1:3010/',hidden:false};
 const document={currentScript:{dataset:{nfonOptionalDemo:'cti'},src:'http://127.0.0.1:41011/demo-runtime.js'},body:{dataset:{}},documentElement:{dataset:{}},readyState:'loading',head:{appendChild(){}},createElement(){return {dataset:{}};},getElementById(){return null;},addEventListener(){},querySelectorAll(selector){return selector==='a.home-icon-button'?[home]:[];}};
 const context=vm.createContext({document,location:new URL('http://127.0.0.1:41011/'+query),URL,Response,EventTarget,MessageEvent,Event,Date,Math,Blob,MutationObserver:class{observe(){}},setInterval(){},setTimeout(){},addEventListener(){},matchMedia(){return {matches:false,addEventListener(){}};},localStorage:{getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)},fetch:async()=>{requests++;return new Response(JSON.stringify({cockpitUrl}));}});
 context.window=context;
 vm.runInContext(demo,context);vm.runInContext(appearance,context);
 await context.NFON_APPEARANCE.configureHomeLinks();
 return {home,requests,context};
}

test('server-discovered Cockpit Home survives selecting CTI Demo without live requests',async()=>{
 const saved=new Map(),cockpit='http://127.0.0.1:41012/';
 const live=await page('?theme=classic&lang=fi',saved,cockpit);
 assert.equal(live.home.hidden,false);assert.equal(live.requests,1);
 const selectedDemo=await page('?theme=classic&lang=fi&demo=1',saved,cockpit);
 assert.equal(selectedDemo.context.NFON_LOCAL_DEMO,true);
 assert.equal(selectedDemo.requests,0,'Demo must not request live UI configuration');
 assert.equal(selectedDemo.home.hidden,false,'the discovered Home target must survive the fresh Demo context');
 const target=new URL(selectedDemo.home.href);
 assert.equal(target.origin,new URL(cockpit).origin);
 assert.equal(target.searchParams.get('theme'),'classic');assert.equal(target.searchParams.get('lang'),'fi');
 assert.equal(selectedDemo.context.NFON_APPEARANCE.getCockpitUrl(),cockpit);
});

test('unrelated or credential-bearing discovered Cockpit targets are not retained',async()=>{
 for(const cockpit of ['https://unrelated.example/','http://user:sample@127.0.0.1:41012/']){
  const saved=new Map(),live=await page('',saved,cockpit);
  assert.equal(live.home.hidden,true);assert.equal(saved.has('nfon-showcase-cockpit-url'),false);
 }
});
