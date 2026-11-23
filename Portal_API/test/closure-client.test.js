const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n-messages.json'), 'utf8'));
function client(language = 'en', storage = new Map()) {
  const context = vm.createContext({ window: { location: { hash: '#callflow' }, addEventListener() {}, NFON_I18N: {
    getLanguage: () => language, message: (key, params = {}) => (catalog[key]?.[language] || '').replace(/\{(\w+)\}/g, (s,k) => Object.hasOwn(params,k) ? String(params[k]) : s),
  } }, document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k,v) => storage.set(k,v), removeItem: k => storage.delete(k) },
    Date, Intl, URL, console });
  const source = fs.readFileSync(path.join(root,'public/app.js'),'utf8');
  vm.runInContext(source.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);\s*$/, ''),context);
  const run = source => vm.runInContext(source,context);
  const view = { account:'K9001', syncedAt:'2026-11-04T09:00:00.000Z', settings:{configured:true}, inventory:{
    dids:[{id:'did',name:'Test DID',destinationType:'IVR',destinationExtension:'500',destinationServiceNumber:'1',destinationName:'Existing Voice Dialog'}],
    trunks:[], queues:[], skills:[], announcements:[],
    extensions:[{id:'200',number:'200',name:'Providername bleibt',href:'/api/customers/K9001/targets/phone-extensions/200'}],
    ivrs:[{id:'1',serviceNumber:'1',extensionNumber:'500',name:'Existing Voice Dialog',announcement:'Announcement',timeoutSeconds:'10',
      keyRoutes:[{number:'1',target:{type:'PHONEEXTENSION',targetNumber:'200',routeNumber:'200',title:'Providername bleibt'}}],
      timeoutTarget:{type:'HANGUP',routeNumber:'HANGUP',targetNumber:'HANGUP',title:'Auflegen',subtitle:'Anruf beenden'}}],
    timeControls:[{id:'9',serviceNumber:'9',extensionNumber:'900',name:'Existing opening hours',
      dayTargetHref:'/api/customers/K9001/targets/phone-extensions/200', nightTargetHref:'/api/customers/K9001/targets/HANGUP',
      timezoneHref:'/api/timezones/Europe/Berlin', evaluationStrategy:'AUTO', routingBody:{data:[],links:[]}}],
  }};
  run(`state.overview=${JSON.stringify(view)}; state.selectedDidId='did'; state.loading=false;
    globalThis.originalRenderFlowFeedback=renderFlowFeedback;renderFlowFeedback=()=>{};renderFlowPlan=()=>{};state.flow=buildFlowForDid(selectedDid(),state.overview);`);
  return { run, storage, json: text => JSON.parse(run(`JSON.stringify(${text})`)) };
}
test('PORT-02: provider refresh with identical content preserves a saved IVR draft across reload',()=>{
  const a=client();a.run(`state.flow.nodes.push({id:'local',type:'PHONEEXTENSION',targetNumber:'239',routeNumber:'239',title:'Unfinished local draft'});saveCurrentFlowDraft(false)`);
  const b=client('en',a.storage);b.run(`state.overview.syncedAt='2099-01-01T00:00:00.000Z';state.flow=applyStoredFlowDraft(buildFlowForDid(selectedDid(),state.overview),selectedDid())`);
  assert.ok(b.json('state.flow.nodes').some(n=>n.title==='Unfinished local draft'));
});
test('PORT-02: changed provider routing opens the current flow and keeps the previous draft available',()=>{
  const a=client();a.run(`state.flow.nodes.push({id:'local',type:'PHONEEXTENSION',targetNumber:'239',routeNumber:'239',title:'Unfinished local draft'});saveCurrentFlowDraft(false)`);
  const b=client('en',a.storage);b.run(`state.overview.inventory.ivrs[0].keyRoutes[0].target.targetNumber='238';state.overview.inventory.ivrs[0].keyRoutes[0].target.routeNumber='238';state.flow=applyStoredFlowDraft(buildFlowForDid(selectedDid(),state.overview),selectedDid())`);
  assert.ok(!b.json('state.flow.nodes').some(n=>n.title==='Unfinished local draft'),'the current routing is the starting point');
  assert.ok(b.json('state.flow.previousDraft.flow.nodes').some(n=>n.title==='Unfinished local draft'),'local work remains accessible');
  assert.equal(b.run('Boolean(state.flow.providerConflict)'),false);
  assert.equal(b.run('state.flow.nodes.find(n=>n.type==="IVR").config.key1Target.targetNumber'),'238');
  assert.equal(b.run('readStoredFlowDrafts()[flowDraftKey()].flow.nodes.some(n=>n.id==="local")'),true,'opening must not discard the previous draft');
});
test('PORT-03: existing time control materializes inside and outside provider routes',()=>{
 const a=client();a.run(`Object.assign(state.overview.inventory.dids[0],{destinationType:'TIMECONTROL',destinationExtension:'900',destinationServiceNumber:'9',destinationName:'Existing opening hours'});state.flow=buildFlowForDid(selectedDid(),state.overview);buildVisibleFlowGraph(state.flow)`);
 const nodes=a.json('state.flow.nodes');assert.ok(nodes.some(n=>n.type==='PHONEEXTENSION'&&n.targetNumber==='200'));
 assert.ok(nodes.some(n=>n.type==='HANGUP'));
});
for(const language of Object.keys(catalog['portal.hangUp'])) test(`PORT-04/05: existing IVR branches and generated Hang up follow ${language}`,()=>{
 const a=client(language);const target=a.json(`flowTargetFromApiTarget({type:'IVR',routeNumber:'1',targetNumber:'500',title:'Existing Voice Dialog'})`);
 assert.equal(target.config?.portalMode,'existing');assert.deepEqual(target.config?.ivrKeys,['1']);
 assert.equal(target.config?.key1Target?.title,'Providername bleibt');
 assert.equal(target.config?.timeoutTarget?.title,catalog['portal.hangUp'][language]);
 assert.equal(target.config?.timeoutTarget?.subtitle,catalog['portal.endCall'][language]);
});

for(const language of Object.keys(catalog['portal.hangUp'])) test(`PORT-04: generated HANGUP is localized independently of nested IVR in ${language}`,()=>{
 const a=client(language);const target=a.json(`flowTargetFromApiTarget({type:'HANGUP',routeNumber:'HANGUP',title:'Auflegen',subtitle:'Anruf beenden'})`);
 assert.equal(target.title,catalog['portal.hangUp'][language]);
 assert.equal(target.subtitle,catalog['portal.endCall'][language]);
});

test('PORT-02: previous draft survives new current-routing edits and can be restored explicitly',()=>{
 const a=client();a.run('saveCurrentFlowDraft(false)');
 const b=client('fr',a.storage);b.run(`state.overview.inventory.extensions.push({id:'999',number:'999',name:'Unrelated'});state.flow=applyStoredFlowDraft(buildFlowForDid(selectedDid(),state.overview),selectedDid())`);
 assert.equal(b.run('Boolean(state.flow.previousDraft)'),false,'unrelated inventory/language does not change routing');
 b.run(`state.overview.inventory.ivrs[0].timeoutSeconds='99';state.flow=applyStoredFlowDraft(buildFlowForDid(selectedDid(),state.overview),selectedDid());saveCurrentFlowDraft(false)`);
 assert.equal(b.run('state.flow.nodes.find(n=>n.type==="IVR").config.timeoutSeconds'),'99');
 const c=client('en',b.storage);c.run(`state.overview.inventory.ivrs[0].timeoutSeconds='99';state.flow=applyStoredFlowDraft(buildFlowForDid(selectedDid(),state.overview),selectedDid())`);
 assert.equal(c.run('Boolean(state.flow.providerConflict)'),false);
 assert.ok(c.run('Boolean(state.flow.previousDraft)'));
 const currentRevision=c.run('state.flow.providerRevision');
 c.run('restorePreviousFlowDraft()');
 assert.equal(c.run('state.flow.nodes.find(n=>n.type==="IVR").config.timeoutSeconds'),'10');
 assert.equal(c.run('state.flow.providerRevision'),currentRevision,'explicit restoration is a draft against the current provider state');
 assert.equal(c.run('Boolean(state.flow.previousDraft)'),false);
});
test('opening Callflow refreshes the current inventory once, without reload or a confirmation',()=>{
 const a=client();a.run(`state.view='overview';state.loading=false;globalThis.refreshes=0;loadOverview=()=>{refreshes++;state.loading=true};renderView=()=>{};renderCallflow=()=>{};globalThis.requestAnimationFrame=fn=>fn();setView('callflow');setView('callflow')`);
 assert.equal(a.run('refreshes'),1);
});
test('PORT-03/05: existing IVR and time-control references terminate cycles without phantom branches',()=>{
 const a=client();a.run(`state.overview.inventory.ivrs[0].keyRoutes[0].target={type:'TIMECONTROL',routeNumber:'9',targetNumber:'900'};state.overview.inventory.timeControls[0].dayTarget={type:'IVR',routeNumber:'1',targetNumber:'500'};state.flow=buildFlowForDid(selectedDid(),state.overview);buildVisibleFlowGraph(state.flow)`);
 const nodes=a.json('state.flow.nodes');
 assert.ok(nodes.length>=5&&nodes.length<10);
 assert.ok(nodes.every(node=>node.type!=='PLACEHOLDER'));
 assert.equal(nodes.filter(node=>node.type==='IVR').length,2);
});
test('PORT-05: a missing existing IVR detail is an opaque existing reference, never an invented menu',()=>{
 const a=client();const target=a.json(`flowTargetFromApiTarget({type:'IVR',routeNumber:'999',targetNumber:'599',title:'Existing unavailable menu'})`);
 assert.equal(target.config.portalMode,'existing');assert.deepEqual(target.config.ivrKeys,[]);
});
test('PORT-01: CSRF retrieval cannot silently replace the displayed write context',async()=>{
 const a=client();
 await a.run(`state.overview.settings.writeContext='displayed-A';
   ensureCsrfToken=async()=>{state.overview.settings.writeContext='later-B';state.csrfToken='csrf'};
   globalThis.capturedHeaders=null;globalThis.fetch=async(url,options)=>{capturedHeaders=options.headers;return {ok:true,json:async()=>({ok:true})}};
   fetchJson('/api/callflow/apply',{method:'POST',body:'{}'})`);
 assert.equal(a.run('capturedHeaders["X-Portal-Context"]'),'displayed-A');
});

test('PORT-02: Delete local draft remains visible after a blocked conflict Apply',()=>{
 const a=client();a.run(`globalThis.clearButton={hidden:true};globalThis.feedback={};
   document.querySelector=selector=>selector==='#clear-flow-draft'?clearButton:selector==='#flow-feedback'?feedback:null;
   state.view='callflow';state.flow.providerConflict=true;state.flow.draftUpdatedAt='2026-11-04T09:00:00Z';
   state.actionPlan={context:'callflow',ok:false};originalRenderFlowFeedback()`);
 assert.equal(a.run('clearButton.hidden'),false);
});

test('successful actions release the dialog and announce the result without an acknowledgement',()=>{
 const a=client();a.run(`globalThis.notice={hidden:true,setAttribute(name){if(name==='hidden')this.hidden=true}};
   document.querySelector=selector=>selector==='#action-notice'?notice:null;renderUiDialog=()=>{};
   globalThis.clearTimeout=()=>{};globalThis.setTimeout=fn=>{globalThis.expireNotice=fn;return 1};
   globalThis.progress=showUiProgress({title:'Applying',message:'Work'});
   progress.success({title:'Applied <draft>',message:'Saved & ready'})`);
 assert.equal(a.run('uiDialog.open'),false);
 assert.equal(a.run('uiDialog.pending'),false);
 assert.equal(a.run('notice.hidden'),false);
 assert.match(a.run('notice.innerHTML'),/Applied &lt;draft&gt;/);
 a.run('expireNotice()');assert.equal(a.run('notice.hidden'),true);
 a.run(`progress.error({title:'Could not apply',message:'Provider rejected the change'})`);
 assert.equal(a.run('uiDialog.open'),true);assert.equal(a.run('uiDialog.type'),'error');
});
