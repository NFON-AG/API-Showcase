const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "i18n-messages.json"), "utf8"));
const {fixture,writeFixture}=require("./helpers/fixture.cjs");

function frontend(file, language = "en") {
  const storage = new Map();
  const listeners = new Map();
  const context = vm.createContext({
    window: { NFON_WEB_ONLY_DEMO: file.startsWith("../docs/"), location: { hash: "" }, addEventListener() {}, NFON_I18N: { getLanguage: () => language, message: (key, params = {}) => (catalog[key]?.[language] || "").replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match) } },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]) },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    Date, Intl, URL, console,
  });
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ""), context);
  const run = code => vm.runInContext(code, context);
  const renderInspector = run("renderFlowHelper");
  // The rendering boundary still executes the real graph rebuild. Storage remains real (in memory).
  run(`renderCallflow=()=>buildVisibleFlowGraph(state.flow);render=()=>buildVisibleFlowGraph(state.flow);renderFlowHelper=()=>{};
    state.overview={account:"TEST",settings:{configured:true},inventory:{trunks:[{id:"/api/customers/TEST/trunks/10",name:"fixture-trunk"}],dids:[{id:"did",trunkNumber:"fixture-trunk",name:"+4912340",href:"/api/customers/TEST/trunks/10/inbound-trunk-numbers/100",trunkHref:"/api/customers/TEST/trunks/10",didExtension:"0",destinationType:"PHONEEXTENSION",destinationExtension:"201"}]}};state.selectedDidId="did";`);
  const dispatch = (name, event) => (listeners.get(name) || []).forEach(callback => callback(event));
  return { run, context, storage, dispatch, renderInspector, setLanguage(value) { const previousLanguage = language; language = value; dispatch("nfon:language-change", { detail: { language, previousLanguage } }); } };
}

// Full client entrypoints are complemented by actual Chrome actions in the browser regression script.
for (const type of ["QUEUE", "SKILL", "IVR", "TIMECONTROL"]) test(`CF-01 converting extension 500 to new ${type} clears inherited identity`, () => {
 const app=frontend("public/app.js");app.context.nextType=type;
 app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"destination",type:"PHONEEXTENSION",title:"Extension 500",subtitle:"Extension 500",targetNumber:"500",routeNumber:"500",href:"/api/customers/TEST/targets/phone-extensions/500",config:{portalMode:"existing"}}],edges:[{from:"inbound",to:"destination"}]};state.selectedNodeId="destination";updateNodeField("type",nextType)`);
 const node=JSON.parse(app.run('JSON.stringify(selectedNode())'));assert.equal(node.config.portalMode,"new");assert.ok(!node.routeNumber&&!node.targetNumber&&!node.href,"new source must have no inherited resource identity");
});
for(const mode of ["new","existing"])test(`CF-03 directly connected ${mode} Skill is valid`,()=>{
 const app=frontend("public/app.js");app.context.mode=mode;app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"skill",type:"SKILL",title:"Support",routeNumber:mode==="existing"?"600":"",config:{portalMode:mode}}],edges:[{from:"inbound",to:"skill"}]};stageFlowPlan({silent:true})`);assert.equal(app.run('validateFlowDetails().ok'),true);assert.ok(app.run('state.actionPlan.applyPayload'));
});
test("CF-04 standalone Announcement is blocked before live confirmation",()=>{
 const app=frontend("public/app.js");app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"announcement",type:"ANNOUNCEMENT",title:"Welcome",config:{announcement:"Announcement 0"}},{id:"end",type:"HANGUP",title:"Hang up"}],edges:[{from:"inbound",to:"announcement"},{from:"announcement",to:"end",branchField:"afterTarget"}]};stageFlowPlan({silent:true})`);assert.equal(app.run('validateFlowDetails().ok'),false);assert.equal(app.run('validateFlowDetails().liveCapable'),false);assert.equal(app.run('state.actionPlan.applyPayload'),null);
});
test("CF-05 client time-window acceptance agrees with actual server parser",()=>{
 const app=frontend("public/app.js");const source=fs.readFileSync(path.join(root,"src/server.js"),"utf8");const parse=vm.createContext({httpError:(status,message)=>Object.assign(new Error(message),{status})});
 const begin=source.indexOf('function nfonDay('),end=source.indexOf('\n}',source.indexOf('function parseTimeWindow('))+2;vm.runInContext(source.slice(begin,end),parse);
 for(const value of ["Mon-Fri 08:00-17:00","Monday-Friday 8:00-17:00","Sat-Sun 00:00-23:59","Fri-Mon 22:00-06:00","Mo-Fr 08:00-17:00","Montag-Freitag 08:00-17:00","Tu-Th 08:00-17:00","Mon 24:00-17:00","Fri 12:60-13:00","bad"]){app.context.value=value;parse.value=value;let accepted=true;try{vm.runInContext('parseTimeWindow(value)',parse)}catch{accepted=false}assert.equal(app.run('validTimeWindow(value)'),accepted,value);}
});
const node=(id,type,config={},route)=>({id,type,title:`Regression ${id}`,config,...(route?{routeNumber:route,targetNumber:route}:{})});
const edge=(from,to,branchField)=>({from,to,...(branchField?{branchField}:{})});
function graph(type){const step=node("destination",type,{portalMode:"new",...(type==="TIMECONTROL"?{hours:"Mon-Fri 08:00-17:00"}:{}),...(type==="IVR"?{announcement:"Announcement 0",ivrKeys:["1"],timeoutSeconds:20}:{})});const nodes=[{id:"inbound",type:"DID",title:"Incoming call",locked:true},step],edges=[edge("inbound",step.id)];if(["TIMECONTROL","IVR"].includes(type)){nodes.push(node("extension","PHONEEXTENSION",{},"239"),node("hangup","HANGUP"));edges.push(edge(step.id,"extension",type==="IVR"?"key1Target":"openTarget"),edge(step.id,"hangup",type==="IVR"?"timeoutTarget":"closedTarget"));}return {nodes,edges};}
async function payload(app,type){const overview=(await app.request('/api/overview')).body;return {did:overview.inventory.dids[0],flow:graph(type)}}
for(const type of ["QUEUE","SKILL","IVR","TIMECONTROL"])test(`CF-02 ${type} Apply binds actual provider identity and repeat creates nothing`,async t=>{
 const app=await writeFixture(t,{provider:type==="TIMECONTROL"?{assignTcOffset:40}:{}}),request=await payload(app,type);const preview=await app.request('/api/callflow/apply',request);assert.equal(preview.status,200);assert.deepEqual(await app.control('writes'),[]);
 const first=await app.request('/api/callflow/apply',{...request,commit:true});assert.equal(first.body.applied,true,JSON.stringify(first));const route=first.body.target.routeNumber,bound=first.body.flow.nodes.find(n=>n.id==="destination");assert.equal(bound.routeNumber,route,"response flow must bind returned provider route");assert.equal(bound.config.portalMode,"existing");assert.ok(bound.href?.endsWith('/'+route));if(type==="TIMECONTROL")assert.notEqual(route,preview.body.target.routeNumber);
 const overview=(await app.request('/api/overview')).body;await app.control('clearlog');const repeat=await app.request('/api/callflow/apply',{did:overview.inventory.dids[0],flow:first.body.flow,commit:true});assert.equal(repeat.body.applied,true,JSON.stringify(repeat));assert.deepEqual(await app.control('writes'),[],"unchanged second Apply must not write");
});
test("created Queue stays selected with a derived name before unchanged repeat Apply", async t => {
 const app=await writeFixture(t),request=await payload(app,"QUEUE");
 const created=(await app.request('/api/callflow/apply',{...request,commit:true})).body;
 assert.equal(created.applied,true,JSON.stringify(created));
 const overview=(await app.request('/api/overview')).body;
 const ui=frontend("public/app.js"),panel={innerHTML:""};
 ui.context.created=created;ui.context.overview=overview;
 ui.context.document.querySelector=selector=>selector==="#flow-helper"?panel:null;
 ui.run('state.overview=overview;state.flow=created.flow;state.selectedNodeId="destination";state.selectedDidId=overview.inventory.dids[0].id;state.inspectorOpen=true');
 const selected=ui.run('currentTargetValue(selectedNode())');
 assert.ok(selected,"the newly created Portal resource must remain selected");
 assert.equal(JSON.parse(selected).routeNumber,created.target.routeNumber);
 assert.equal(ui.run('usesDerivedTargetName(selectedNode())'),true);
 ui.renderInspector();
 assert.match(panel.innerHTML,/<input\b[^>]*data-node-field="title"[^>]*\bdisabled\b/);
 const selectedOption=panel.innerHTML.match(/<option\b[^>]*value="([^"<>]+)"[^>]*\sselected\s+data-i18n-ignore[^>]*>/);
 assert.ok(selectedOption,"resource selector must mark an actual target selected");
 assert.equal(JSON.parse(selectedOption[1].replaceAll('&quot;','"').replaceAll('&amp;','&')).routeNumber,created.target.routeNumber);
 await app.control('clearlog');
 const repeated=(await app.request('/api/callflow/apply',{did:overview.inventory.dids[0],flow:JSON.parse(ui.run('JSON.stringify(state.flow)')),commit:true})).body;
 assert.equal(repeated.applied,true,JSON.stringify(repeated));
 assert.deepEqual(await app.control('writes'),[],"opening the correctly selected inspector must not create or rewrite resources");
 assert.equal((await app.request('/api/overview')).body.inventory.queues.find(queue=>String(queue.serviceNumber)===created.target.routeNumber).name,request.flow.nodes[1].title);
});
test("target selection uses typed routes including zero and canonical href fallback",()=>{
 const ui=frontend("public/app.js");
 const selected=(left,right)=>{ui.context.left=left;ui.context.right=right;return ui.run('targetOptionSelected(JSON.stringify(left),JSON.stringify(right))')};
 for(const [type,collection]of [["QUEUE","queue-services"],["SKILL","skill-services"],["PHONEEXTENSION","phone-extensions"],["IVR","ivr-services"],["TIMECONTROL","time-control-services"],["VOICEMAIL","voicemail-services"],["FRONTDESK","frontdesk-services"]]){
  assert.equal(selected({type,routeNumber:0},{type,routeNumber:"0",href:`https://portal.invalid/api/customers/TEST/targets/${collection}/0`}),true,type+": same route despite optional absolute href");
  assert.equal(selected({type,routeNumber:"0"},{type,routeNumber:"1"}),false,type+": distinct routes");
  assert.equal(selected({type,routeNumber:"0"},{type:"ANNOUNCEMENT",routeNumber:"0"}),false,type+": announcement is not a routing target");
  assert.equal(selected({type,href:`/api/customers/TEST/targets/${collection}/0`},{type,href:`https://portal.invalid/api/customers/TEST/targets/${collection}/0`}),true,type+": canonical href fallback");
  assert.equal(selected({type,routeNumber:"0",href:`/api/customers/TEST/targets/${collection}/0`},{type,targetNumber:"7100",href:`https://portal.invalid/api/customers/TEST/targets/${collection}/0`}),true,type+": identical href must not depend on an internal extension alias");
  assert.equal(selected({type,routeNumber:"0",href:`/api/customers/TEST/targets/${collection}/0`},{type,routeNumber:"0",href:`/api/customers/OTHER/targets/${collection}/0`}),false,type+": different explicit resources must stay distinct");
 }
 assert.equal(selected({type:"QUEUE",routeNumber:"500"},{type:"SKILL",routeNumber:"500"}),false);
 assert.equal(selected({type:"PHONE",routeNumber:"200"},{type:"PHONEEXTENSION",routeNumber:"200"}),true);
 assert.equal(selected({type:"QUEUE",title:"New A"},{type:"QUEUE",title:"New B"}),false);
 assert.equal(selected({type:"ANNOUNCEMENT",href:"/api/customers/TEST/announcements/A"},{type:"ANNOUNCEMENT",href:"/api/customers/TEST/announcements/B"}),false);
});
test("unchanged saved profile keeps unassigned and Hangup DIDs as no-ops",()=>{
 const ui=frontend("public/app.js");
 ui.run('state.overview.inventory.dids=[{id:"empty",name:"Unassigned"},{id:"end",name:"End call",destinationType:"HANGUP"}];');
 assert.deepEqual(JSON.parse(ui.run('JSON.stringify(buildChangesFromProfile(buildProfileSnapshot("standard")))')),[]);
});
test("existing Queue routing Apply does not claim newly created targets", async t => {
 const app=await writeFixture(t),request=await payload(app,"QUEUE");
 Object.assign(request.flow.nodes[1],{routeNumber:"500",targetNumber:"500",config:{portalMode:"existing",timeoutSeconds:35}});
 request.flow.nodes.push(node("timeout-extension","PHONEEXTENSION",{},"202"));
 request.flow.edges.push(edge("destination","timeout-extension","timeoutTarget"));
 const result=await app.request('/api/callflow/apply',{...request,commit:true});
 assert.equal(result.body.applied,true,JSON.stringify(result));
 const writes=await app.control('writes');
 assert.ok(writes.some(write=>write.method==="PUT"&&write.path.endsWith('/queue-services/500/timeout')));
 assert.ok(writes.some(write=>write.method==="PUT"&&write.path.endsWith('/destination')));
 assert.ok(!writes.some(write=>write.method==="POST"&&/\/(queue|skill|ivr|time-control)-services$/.test(write.path)),"no resource was created");
 assert.equal(result.body.titleKey,"portal.callflowApplied");
 assert.equal(result.body.messageKey,"portal.server.callflowAndRoutingUpdated");
 assert.equal(result.body.message,"Callflow settings and number routing updated.");
 for (const language of ["en","de","fr","es","it"]) {
  const ui=frontend("public/app.js",language);
  ui.context.result=JSON.parse(JSON.stringify(result.body));
  const localized=JSON.parse(ui.run('JSON.stringify(localizeResponseMessages(result))'));
  assert.equal(localized.title,catalog["portal.callflowApplied"][language],language);
  assert.equal(localized.message,catalog["portal.server.callflowAndRoutingUpdated"][language],language);
  assert.equal(ui.run("isExpectedNoopFlowResult(result)"),false,language);
 }
});
test("repeated Queue timeout Apply reports a callflow update without inventing a voice dialog", async t => {
 const app=await writeFixture(t),request=await payload(app,"QUEUE");
 request.flow.nodes[1].config.timeoutSeconds=35;
 request.flow.nodes.push(node("timeout-extension","PHONEEXTENSION",{},"202"));
 request.flow.edges.push(edge("destination","timeout-extension","timeoutTarget"));
 const first=await app.request('/api/callflow/apply',{...request,commit:true});
 assert.equal(first.body.applied,true,JSON.stringify(first));
 const overview=(await app.request('/api/overview')).body;
 const repeated=await app.request('/api/callflow/apply',{did:overview.inventory.dids[0],flow:first.body.flow,commit:true});
 assert.equal(repeated.body.applied,true,JSON.stringify(repeated));
 assert.equal(repeated.body.target.type,"QUEUE");
 assert.equal(repeated.body.titleKey,"portal.callflowApplied");
 assert.equal(repeated.body.messageKey,"portal.server.callflowUpdatedNumberUnchanged");
 assert.equal(repeated.body.message,"Callflow updated. The number routing is unchanged.");
 for (const language of ["en","de","fr","es","it"]) {
  const ui=frontend("public/app.js",language);
  ui.context.result=JSON.parse(JSON.stringify(repeated.body));
  const localized=JSON.parse(ui.run('JSON.stringify(localizeResponseMessages(result))'));
  assert.equal(localized.title,catalog["portal.callflowApplied"][language],language);
  assert.equal(localized.message,catalog["portal.server.callflowUpdatedNumberUnchanged"][language],language);
  assert.equal(ui.run("isExpectedNoopFlowResult(result)"),false,language+": a settings update is not a no-op");
  assert.doesNotMatch(localized.message,/voice dialog|Sprachdialog|menu vocal|menú de voz|menu vocale/i,language);
 }
});
for(const hard of [false,true])test(`CF-02 safety ${hard?"hard read-only":"session off"} stays read-only`,async t=>{const app=await fixture(t,{env:hard?{PORTAL_DISABLE_LIVE_WRITES:"true"}:{}}),request=await payload(app,"QUEUE"),result=await app.request('/api/callflow/apply',{...request,commit:true});assert.equal(result.body.applied,false);assert.deepEqual(await app.control('writes'),[])});
test("CF-02 create failure preserves error and draft identity",async t=>{const app=await writeFixture(t,{provider:{writeFail:{path:'/queue-services$',method:'POST',nth:1,status:500}}}),request=await payload(app,"QUEUE"),result=await app.request('/api/callflow/apply',{...request,commit:true});assert.equal(result.body.applied,false);assert.equal(result.body.ok,false);assert.equal(result.body.flow.nodes.find(n=>n.id==="destination").routeNumber,undefined);assert.equal(result.body.flow.nodes.find(n=>n.id==="destination").config.portalMode,"new");assert.equal((await app.control('state')).queues.length,2)});
test("synthetic IVR fixture persists keys and timeout readback",async t=>{const app=await writeFixture(t),request=await payload(app,"IVR");const first=await app.request('/api/callflow/apply',{...request,commit:true});assert.equal(first.body.applied,true);const overview=(await app.request('/api/overview')).body;const ivr=overview.inventory.ivrs.find(i=>String(i.serviceNumber)===first.body.target.routeNumber);assert.ok(ivr);assert.equal(ivr.keyRoutes[0].target.routeNumber,"239");assert.equal(ivr.timeoutTarget.type,"HANGUP")});
for(const [type,collision] of [["QUEUE","500"],["SKILL","600"]])test(`CF-01 server never routes inherited colliding ${type} identity marked new`,async t=>{
 const app=await writeFixture(t),request=await payload(app,type);Object.assign(request.flow.nodes[1],{routeNumber:collision,targetNumber:collision});const result=await app.request('/api/callflow/apply',{...request,commit:true});const did=(await app.control('state')).dids[0];assert.notEqual(did.dest.service,collision,"new-mode stale identity must not route an unrelated existing resource");if(result.body.applied)assert.ok((await app.control('writes')).some(w=>w.method==="POST"));else assert.deepEqual(await app.control('writes'),[]);
});
test("CF-02 every nested newly created resource is rebound before repeated Apply",async t=>{
 const app=await writeFixture(t),request=await payload(app,"TIMECONTROL"),flow=request.flow;
 flow.nodes.push(node("menu","IVR",{portalMode:"new",announcement:"Announcement 0",ivrKeys:["1","2"]}),node("queue","QUEUE",{portalMode:"new"}),node("skill","SKILL",{portalMode:"new"}));flow.edges.find(e=>e.branchField==="openTarget").to="menu";flow.edges.push(edge("menu","queue","key1Target"),edge("menu","skill","key2Target"),edge("menu","hangup","timeoutTarget"));
 const first=await app.request('/api/callflow/apply',{...request,commit:true});assert.equal(first.body.applied,true,JSON.stringify(first));const provider=await app.control('state');
 for(const [id,ids]of [["destination",provider.tcs.map(n=>n.serviceNumber)],["menu",provider.ivrs],["queue",provider.queues],["skill",provider.skills]]){const bound=first.body.flow.nodes.find(n=>n.id===id);assert.equal(bound.config.portalMode,"existing",id);assert.ok(ids.includes(bound.routeNumber),`${id} has actual provider identity`);}
 const overview=(await app.request('/api/overview')).body;await app.control('clearlog');const repeat=await app.request('/api/callflow/apply',{did:overview.inventory.dids[0],flow:first.body.flow,commit:true});assert.equal(repeat.body.applied,true,JSON.stringify(repeat));assert.deepEqual(await app.control('writes'),[]);
});
test("CF-02 DID failure rolls back created resource without binding the failed draft",async t=>{
 const app=await writeFixture(t,{provider:{writeFail:{path:'/dids/.*/destination$',method:'PUT',nth:1,status:500}}}),request=await payload(app,"TIMECONTROL"),before=await app.control('state');const result=await app.request('/api/callflow/apply',{...request,commit:true}),after=await app.control('state');assert.equal(result.body.applied,false);assert.equal(result.body.rolledBack,true);assert.equal(result.body.flow.nodes.find(n=>n.id==="destination").config.portalMode,"new");assert.equal(result.body.flow.nodes.find(n=>n.id==="destination").routeNumber,undefined);assert.deepEqual(after.tcs,before.tcs);assert.deepEqual(after.dids,before.dids);
});
test("CF-01 existing Queue Source=new clears href and subtitle identity too",()=>{
 const app=frontend("public/app.js");app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"destination",type:"QUEUE",title:"Queue 0",subtitle:"Queue 500",targetNumber:"500",routeNumber:"500",href:"/api/customers/TEST/targets/queue-services/500",config:{portalMode:"existing"}}],edges:[{from:"inbound",to:"destination"}]};state.selectedNodeId="destination";updateNodeConfig("portalMode","new")`);const node=JSON.parse(app.run('JSON.stringify(selectedNode())'));assert.equal(node.config.portalMode,"new");assert.ok(!node.routeNumber&&!node.targetNumber&&!node.href);assert.equal(node.subtitle,"");
});

// Independent browser review reproduced this through the announcement selector.
test("CF-01 numeric announcement names never identify an existing IVR in new mode", async t => {
 const app = await writeFixture(t, {provider:{getResponse:{path:'/announcements$',body:{href:'/api/customers/K9001/announcements',offset:0,total:1,size:1,links:[],items:[{href:'/api/customers/K9001/announcements/ANN1',data:[{name:'displayName',value:'Announcement 1'},{name:'type',value:'GENERAL_ANNOUNCEMENT'}],links:[]}]}}}});
 const request=await payload(app,"IVR"),step=request.flow.nodes[1];
 step.title="Independent distinct new IVR";step.subtitle="Announcement 1";step.config.announcement="Announcement 1";
 request.flow.nodes.find(n=>n.id==="extension").routeNumber="200";request.flow.nodes.find(n=>n.id==="extension").targetNumber="200";
 const result=await app.request('/api/callflow/apply',{...request,commit:true});
 assert.equal(result.body.applied,true,JSON.stringify(result));
 const writes=await app.control('writes');
 assert.ok(writes.some(w=>w.method==="POST"&&w.path.endsWith('/ivr-services')),"new mode must create an IVR despite numeric announcement text");
 assert.ok(!writes.some(w=>w.method==="PUT"&&w.path.endsWith('/ivr-services/1')),"the unrelated existing IVR must never be renamed");
 assert.notEqual((await app.control('state')).dids[0].dest.service,"1");
});
test("CF-01 new resources never infer an existing route from descriptive subtitle text", async t => {
 const app=await writeFixture(t),request=await payload(app,"QUEUE");request.flow.nodes[1].subtitle="Announcement 500";
 const result=await app.request('/api/callflow/apply',{...request,commit:true});
 assert.equal(result.body.applied,true,JSON.stringify(result));
 assert.ok((await app.control('writes')).some(w=>w.method==="POST"&&w.path.endsWith('/queue-services')));
 assert.notEqual((await app.control('state')).dids[0].dest.service,"500");
});
