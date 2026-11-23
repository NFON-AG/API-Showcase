const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

// Real mutation functions and storage; rendering is a boundary, exercised in the browser suite.
const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n-messages.json'), 'utf8'));
function app(language = 'en') {
  const storage = new Map();
  const elements = new Map();
  const context = vm.createContext({
    window: { location: { hash: '#callflow' }, addEventListener() {}, NFON_I18N: {
      getLanguage: () => language,
      message: (key, params = {}) => (catalog[key]?.[language] || '').replace(/\{(\w+)\}/g, (s, key) => Object.hasOwn(params, key) ? String(params[key]) : s),
    } },
    document: { querySelector: key => elements.get(key) || null, querySelectorAll: () => [], addEventListener() {} },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    Date: class extends Date { static tick = Date.now(); static now() { return ++this.tick; } }, Intl, URL, console,
  });
  const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  vm.runInContext(source.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ''), context);
  const run = source => vm.runInContext(source, context);
  run(`renderCallflow=()=>buildVisibleFlowGraph(state.flow);render=()=>buildVisibleFlowGraph(state.flow);renderFlowHelper=()=>{};renderServices=()=>{};
    state.loading=false;state.overview={account:'TEST',settings:{configured:true},inventory:{trunks:[],dids:[{id:'did',name:'+4912340',destinationType:'PHONEEXTENSION',destinationExtension:'200'}],extensions:[],queues:[],skills:[],ivrs:[],timeControls:[]}};state.selectedDidId='did';state.flow=buildFlowForDid(selectedDid(),state.overview);state.selectedNodeId='target';buildVisibleFlowGraph(state.flow);`);
  return { run, elements, json: expression => JSON.parse(run(`JSON.stringify(${expression})`)) };
}
const topology = app => app.json('({nodes:state.flow.nodes.map(n=>({id:n.id,type:n.type,title:n.title,config:n.config||{},targetNumber:n.targetNumber||"",routeNumber:n.routeNumber||"",x:n.x,y:n.y})),edges:state.flow.edges})');
const target = JSON.stringify({type:'PHONEEXTENSION',title:'Extension 239',targetNumber:'239',routeNumber:'239'});

test('CF-08: inserting on an edge is one reversible action', () => {
  const a=app(); const before=topology(a); a.run('addFlowNode("inbound","target");undoFlowChange()'); assert.deepEqual(topology(a),before);
});

test('CF-08: add, connect, undo connection, undo insertion preserve each intermediate state', () => {
  const a=app(); const original=topology(a);
  a.run(`addPaletteNodeToCanvas(${target},{x:200,y:200})`); const added=topology(a);
  a.run('connectFlowNodes("inbound",state.selectedNodeId);undoFlowChange()');
  assert.deepEqual(topology(a),added,'first Undo restores only the connection');
  a.run('undoFlowChange()'); assert.deepEqual(topology(a),original,'second Undo removes insertion');
});

for(const [name,setup,change] of [
  ['type', '', 'updateNodeField("type","TIMECONTROL")'],
  ['name', '', 'updateNodeField("title","Edited name")'],
  ['hours', 'updateNodeField("type","TIMECONTROL");flowUndoHistory.length=0;', 'updateNodeConfig("hours","Mon-Fri 09:00-18:00")'],
  ['branch target', 'updateNodeField("type","TIMECONTROL");flowUndoHistory.length=0;', `updateNodeTargetConfig("openTarget",${JSON.stringify(target)})`],
  ['IVR key', 'updateNodeField("type","IVR");flowUndoHistory.length=0;', 'addIvrKey("target")'],
  ['bulk target', 'addFlowNode("inbound","target");state.selectedNodeIds=state.flow.nodes.filter(n=>!n.locked).map(n=>n.id);flowUndoHistory.length=0;', `applyBulkTargetSelection(${JSON.stringify(target)})`],
]) test(`CF-08: Undo restores ${name} edit`,()=>{
  const a=app();a.run(setup);const before=topology(a);a.run(change);assert.notDeepEqual(topology(a),before,'fixture action changes draft');a.run('undoFlowChange()');assert.deepEqual(topology(a),before);
});

test('CF-08: history restores the selected DID without consuming another DID history',()=>{
  const a=app();a.run('state.overview.inventory.dids.push({id:"other",name:"+4912341",destinationType:"PHONEEXTENSION",destinationExtension:"201"})');const before=topology(a);a.run('addPaletteNodeToCanvas({type:"PHONEEXTENSION",title:"A",targetNumber:"201"},{x:200,y:200});state.selectedDidId="other";addPaletteNodeToCanvas({type:"PHONEEXTENSION",title:"B",targetNumber:"202"},{x:400,y:200});state.selectedDidId="did";undoFlowChange()');assert.deepEqual(topology(a),before);
});

for(const [language,keyWord,ofWord] of [['en','Key','of'],['de','Taste','von'],['fr','Touche','sur'],['it','Tasto','di'],['es','Tecla','de'],['nl','Toets','van'],['pl','Klawisz','z'],['pt','Tecla','de'],['cs','Klávesa','z'],['da','Tast','af'],['fi','Näppäin','/'],['sv','Knapp','av']]) {
  test(`CF-16: dynamic inspector labels follow ${language}`,()=>{
    const a=app(language);a.run('updateNodeField("type","IVR");addIvrKey("target")');
    const html=a.run('renderNodeConfiguration(selectedNode())');
    // Key label is already a shared catalog phrase; its existing locale is authoritative.
    const keyLabel=catalog['portal.keyValue'][language].replace('{p0}','3');
    assert.ok(html.includes(`>${keyLabel}\n`),`expected a form label for ${keyLabel}`);
    const bulk=a.run('renderBulkFlowHelper([{id:"a",title:"A"},{id:"b",title:"B",locked:true}])');
    assert.ok(bulk.includes(language === "fi" ? "1/2" : `1 ${ofWord} 2`),`expected localized editable count in ${language}`);
  });
}

for(const [name,setup,expected] of [
  ['loading','state.loading=true;state.overview=null;state.flow=null;',/loading/i],
  ['failed','state.loading=false;state.error="Fixture unavailable";state.overview=null;state.flow=null;',/unavailable|failed|error/i],
  ['empty','state.overview.inventory.dids=[];state.selectedDidId="";state.flow=buildFlowForDid(null,state.overview);',/no numbers|no phone numbers/i],
]) test(`CF-15: ${name} feedback cannot claim live state loaded`,()=>{
  const a=app();a.run(setup);const feedback={};a.elements.set('#flow-feedback',feedback);a.run('renderFlowFeedback()');assert.doesNotMatch(feedback.innerHTML,/Live state loaded/);assert.match(feedback.innerHTML,expected);
});

test('CF-15: empty inventory has no invented incoming-call route',()=>{const a=app();a.run('state.overview.inventory.dids=[]');const flow=a.json('buildFlowForDid(null,state.overview)');assert.equal(flow?.nodes?.length||0,0);assert.equal(flow?.edges?.length||0,0);});

function membershipApp() {
  const a=app();a.run(`state.serviceGroups={account:'TEST',queues:[{serviceNumber:'500',name:'Queue 0',memberRevision:'revision-1',members:[{extensionNumber:'200',name:'Ext 0',type:'PHONE'},{extensionNumber:'201',name:'Ext 1',type:'PHONE'}]}],skills:[]};state.overview.inventory.queues=state.serviceGroups.queues;state.overview.inventory.extensions=[{number:'200',name:'Ext 0'},{number:'201',name:'Ext 1'},{number:'202',name:'Ext 2'}];state.serviceDraft=buildServiceDraft();addPaletteNodeToCanvas({type:'QUEUE',title:'Queue 0',routeNumber:'500',targetNumber:'500',config:{portalMode:'existing'}},{x:700,y:700});state.expandedServiceNodeIds=[state.selectedNodeId];buildVisibleFlowGraph(state.flow);flowUndoHistory.length=0;`);return a;
}
test('CF-08: membership Undo preserves later independent Service edits and their own Undo',()=>{
  const a=membershipApp();a.run(`state.selectedNodeId=buildVisibleFlowGraph(state.flow).nodes.find(n=>n.memberNode&&n.memberKey==='200').id;deleteSelectedNode();state.view='services';addServiceMembers('queue','500',['202']);state.view='callflow';undoFlowChange();`);
  assert.deepEqual(a.json('state.serviceDraft.queues["500"].members.map(m=>m.extensionNumber)'),['200','201','202'],'Callflow undo retains independent Service addition');
  a.run('state.view="services";undoServiceDraftChange()');
  assert.deepEqual(a.json('state.serviceDraft.queues["500"].members.map(m=>m.extensionNumber)'),['200','201'],'Service undo does not replay the reverted Callflow deletion');
});
test('CF-08: undoing a non-membership flow action preserves independent service changes',()=>{
  const a=membershipApp();a.run('addFlowNode("inbound","target");state.view="services";addServiceMembers("queue","500",["202"]);state.view="callflow";undoFlowChange()');assert.deepEqual(a.json('state.serviceDraft.queues["500"].members.map(m=>m.extensionNumber)'),['200','201','202']);
});

test('CF-08: connecting an extension to a queue is a single membership-and-canvas transaction',()=>{
  const a=membershipApp();a.run('var queueId=state.selectedNodeId;addPaletteNodeToCanvas({type:"PHONEEXTENSION",title:"Ext 2",targetNumber:"202",routeNumber:"202"},{x:500,y:500});var extensionId=state.selectedNodeId;');const before=topology(a),members=a.json('state.serviceDraft');
  a.run('connectFlowNodes(queueId,extensionId)');assert.ok(a.json('state.serviceDraft.queues["500"].members.map(m=>m.extensionNumber)').includes('202'));
  a.run('undoFlowChange()');assert.deepEqual(topology(a),before,'Undo restores the independent extension card');assert.deepEqual(a.json('state.serviceDraft'),members,'Undo also restores membership');
});

test('CF-08: Undo restores a removed branch target',()=>{
  const a=app();a.run(`updateNodeField('type','TIMECONTROL');updateNodeTargetConfig('openTarget',${JSON.stringify(target)});flowUndoHistory.length=0;`);const before=topology(a);a.run('updateNodeTargetConfig("openTarget","");undoFlowChange()');assert.deepEqual(topology(a),before);
});

test('CF-08: repeated unchanged field values do not consume an Undo step',()=>{
  const a=app();a.run('updateNodeField("title","Renamed");var count=flowUndoHistory.length;updateNodeField("title","Renamed")');assert.equal(a.run('flowUndoHistory.length'),a.run('count'));a.run('undoFlowChange()');assert.notEqual(a.run('state.flow.nodes.find(n=>n.id==="target").title'),'Renamed');
});
