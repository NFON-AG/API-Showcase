const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/fixture.cjs');
const { clientRenderer } = require('./helpers/client-render.cjs');

async function setup(t, provider = {}, type = 'QUEUE') {
  const app = await fixture(t, { provider: { queueMembers: 3, ...provider } });
  const requests = [], storage = new Map();
  const ui = clientRenderer('en', {
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', body: options.body && JSON.parse(options.body) });
      return fetch(`http://127.0.0.1:${app.port}${url}`, options);
    },
  });
  for (const selector of ['#callflow-canvas', '.flow-menu-launcher']) {
    ui.element(selector).getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });
  }
  const run = ui.evaluate;
  await run('loadOverview()'); await run('loadServiceGroups({quiet:true})');
  assert.equal(run('state.error'), '');
  run(`state.view='callflow';state.selectedNodeId=flowStartNode().id;
    applyTargetSelection(targetOptions().find(option=>option.kind==='${type}'&&JSON.parse(option.value).routeNumber==='${type==='SKILL'?'600':'500'}').value);`);
  function connect(number) {
    run(`state.flow.nodes.push({id:'add-${number}',type:'PHONEEXTENSION',title:'Extension ${number}',targetNumber:'${number}',routeNumber:'${number}',floating:true,x:400,y:400});
      applyServiceMembershipConnection(flowStartNode(),state.flow.nodes.find(node=>node.id==='add-${number}'));`);
  }
  async function apply() {
    const pending = run('stageAndApplyFlowPlan()');
    assert.equal(run('uiDialog.open && uiDialog.showCancel'), true);
    run('closeUiDialog(true)'); await pending;
  }
  requests.length = 0;
  return { app, run, requests, connect, apply };
}

test('Designer connection Apply saves used Queue membership and routing while preserving unrelated drafts', async t => {
  const {app,run,requests,connect,apply}=await setup(t);
  run('addServiceMembers("queue","501",["238"]);state.serviceCreateDrafts={queues:{displayName:"Unrelated form",extensionNumber:"999"}}');
  const unrelated=run('JSON.stringify(state.serviceDraft.queues["501"])');
  connect('207');
  assert.equal(run('state.serviceDraft.queues["500"].members.length'),4);
  await apply();
  const provider=await app.control('state');
  assert.ok(provider.members.queue['500'].includes('207'),'Apply must persist the connected extension');
  assert.ok(!provider.members.queue['501'].includes('238'),'unrelated service must remain untouched');
  assert.equal(provider.dids[0].dest.service,'500');
  assert.equal(run('JSON.stringify(state.serviceDraft.queues["501"])'),unrelated);
  assert.equal(run('state.serviceCreateDrafts.queues.displayName'),'Unrelated form');
  assert.equal(run('membershipDelta(state.serviceDraft.queues["500"]).add.length'),0);
  assert.deepEqual(requests.filter(item=>item.method==='POST').map(item=>item.url),['/api/settings/live-writes','/api/service-groups/apply','/api/callflow/apply']);
  const membershipRequest=requests.find(item=>item.url==='/api/service-groups/apply');
  assert.deepEqual(membershipRequest.body.services.map(service=>service.serviceNumber),['500']);
  requests.length=0;await app.control('clearlog');await apply();
  assert.equal(requests.filter(item=>item.url==='/api/service-groups/apply').length,0,'unchanged repeat Apply must not resubmit membership');
  assert.ok(!(await app.control('writes')).some(write=>write.path.includes('/members')));
});

test('failed membership write prevents routing and preserves the intended connection', async t => {
  const {app,run,requests,connect,apply}=await setup(t,{writeFail:{path:'/queue-services/500/members$',method:'POST',nth:1,status:503}});
  const before=(await app.control('state')).dids;
  connect('207');await apply();
  assert.equal(run('state.actionPlan.applied'),false);
  assert.ok(requests.some(item=>item.url==='/api/service-groups/apply'));
  assert.ok(!requests.some(item=>item.url==='/api/callflow/apply'));
  assert.deepEqual((await app.control('state')).dids,before);
  assert.equal(run('membershipDelta(state.serviceDraft.queues["500"]).add[0].extensionNumber'),'207');
  await app.control('patch',{writeFail:null});await apply();
  assert.ok((await app.control('state')).members.queue['500'].includes('207'));
  assert.equal(run('state.flowFeedback.ok'),true);
});

test('partial membership failure retains remaining intent and retry does not duplicate the completed member', async t => {
  const {app,run,requests,connect,apply}=await setup(t,{writeFail:{path:'/queue-services/500/members$',method:'POST',nth:2,status:503}});
  connect('207');connect('208');await apply();
  assert.equal(run('state.actionPlan.applied'),false);
  assert.match(run('state.actionPlan.message'),/Completed: 1\. Failed: 1\. Not attempted: 0\./);
  assert.ok(!requests.some(item=>item.url==='/api/callflow/apply'));
  assert.deepEqual(JSON.parse(run('JSON.stringify(membershipDelta(state.serviceDraft.queues["500"]).add.map(member=>member.extensionNumber))')),['208']);
  await app.control('patch',{writeFail:null});await app.control('clearlog');requests.length=0;
  await apply();
  const memberWrites=(await app.control('writes')).filter(write=>write.method==='POST'&&write.path.endsWith('/members'));
  assert.equal(memberWrites.length,1,'retry must only send the unfinished addition');
  assert.deepEqual((await app.control('state')).members.queue['500'],['200','201','202','207','208']);
  assert.equal(run('state.flowFeedback.ok'),true);
});

test('routing failure after membership success keeps the membership result and retries only routing', async t => {
  const {app,run,requests,connect,apply}=await setup(t,{writeFail:{path:'/dids/.*/destination$',method:'PUT',nth:1,status:503}});
  connect('207');await apply();
  assert.equal(run('state.actionPlan.applied'),false);
  assert.ok((await app.control('state')).members.queue['500'].includes('207'));
  assert.equal(run('membershipDelta(state.serviceDraft.queues["500"]).add.length'),0);
  await app.control('patch',{writeFail:null});requests.length=0;
  await apply();
  assert.ok(!requests.some(item=>item.url==='/api/service-groups/apply'));
  assert.equal((await app.control('state')).dids[0].dest.service,'500');
});

test('floating and removed service nodes never pull unrelated pending memberships into Apply', async t=>{
  const {app,run,requests,connect,apply}=await setup(t);
  run('addServiceMembers("queue","501",["238"]);state.flow.nodes.push({id:"floating-queue",type:"QUEUE",title:"Floating Queue",routeNumber:"501",targetNumber:"501",floating:true,config:{portalMode:"existing"}})');
  connect('207');await apply();
  assert.deepEqual(requests.find(item=>item.url==='/api/service-groups/apply').body.services.map(service=>service.serviceNumber),['500']);
  assert.ok(!(await app.control('state')).members.queue['501'].includes('238'));
  run('state.selectedNodeId=flowStartNode().id;applyTargetSelection(targetOptions().find(option=>option.kind==="PHONEEXTENSION"&&JSON.parse(option.value).routeNumber==="239").value);addServiceMembers("queue","500",["208"])');
  requests.length=0;await apply();
  assert.ok(!requests.some(item=>item.url==='/api/service-groups/apply'));
  assert.ok(!(await app.control('state')).members.queue['500'].includes('208'));
  assert.equal(run('membershipDelta(state.serviceDraft.queues["500"]).add[0].extensionNumber'),'208');
});

test('a second Apply click during confirmation does not duplicate membership or routing writes',async t=>{
  const {app,run,requests,connect}=await setup(t);connect('207');
  const first=run('stageAndApplyFlowPlan()');const second=run('stageAndApplyFlowPlan()');
  run('closeUiDialog(true)');await Promise.all([first,second]);
  assert.equal(requests.filter(item=>item.url==='/api/service-groups/apply').length,1);
  assert.equal(requests.filter(item=>item.url==='/api/callflow/apply').length,1);
  assert.equal((await app.control('writes')).filter(write=>write.method==='POST'&&write.path.endsWith('/members')).length,1);
});

test('Designer removal applies the removed Queue member to the provider',async t=>{
  const {app,run,apply}=await setup(t);
  run('ensureServiceNodeExpanded(flowStartNode().id);removeServiceMemberFlowNode(buildVisibleFlowGraph(state.flow).nodes.find(node=>node.memberNode&&node.memberKey==="200"))');
  assert.deepEqual(JSON.parse(run('JSON.stringify(membershipDelta(state.serviceDraft.queues["500"]).remove)')),['200']);
  await apply();
  assert.deepEqual((await app.control('state')).members.queue['500'],['201','202']);
  assert.equal(run('membershipDelta(state.serviceDraft.queues["500"]).remove.length'),0);
});

test('Designer Skill membership uses the same coordinated Apply path',async t=>{
  const {app,run,requests,connect,apply}=await setup(t,{skillMembers:3},'SKILL');
  connect('207');await apply();
  assert.ok((await app.control('state')).members.skill['600'].includes('207'));
  assert.equal((await app.control('state')).dids[0].dest.type,'SKILL');
  assert.equal(requests.find(item=>item.url==='/api/service-groups/apply').body.services[0].kind,'skill');
  assert.equal(run('membershipDelta(state.serviceDraft.skills["600"]).add.length'),0);
});

test('a new resource sharing an existing Queue name never applies that existing Queue draft',async t=>{
  const {app,run,requests,apply}=await setup(t);
  run('addServiceMembers("queue","500",["207"]);state.selectedNodeId=flowStartNode().id;updateNodeConfig("portalMode","new")');
  await apply();
  assert.ok(!requests.some(item=>item.url==='/api/service-groups/apply'));
  assert.ok(!(await app.control('state')).members.queue['500'].includes('207'));
  assert.equal(run('membershipDelta(state.serviceDraft.queues["500"]).add[0].extensionNumber'),'207');
});

test('a newly created Queue accepts the next palette connection as membership without reloading',async t=>{
  const {app,run,requests,apply}=await setup(t);
  run('addServiceMembers("queue","501",["238"]);state.selectedNodeId=flowStartNode().id;updateNodeConfig("portalMode","new");updateNodeField("title","Final Queue")');
  const unrelated=run('JSON.stringify(state.serviceDraft.queues["501"])');
  await apply();
  assert.equal(run('flowStartNode().routeNumber'),'700');
  run('state.flow.nodes.push({id:"palette207",type:"PHONEEXTENSION",title:"Extension207",targetNumber:"207",routeNumber:"207",floating:true,x:400,y:400});connectFlowNodes("palette207",flowStartNode().id)');
  assert.equal(run('state.serviceDraft.queues["700"]?.members?.some(member=>member.extensionNumber==="207")'),true,'the next connection must be a member of the freshly created Queue');
  assert.equal(run('state.flow.edges.some(edge=>edge.to==="palette207"||edge.from==="palette207")'),false,'member assignment must not become a routing edge');
  assert.equal(run('JSON.stringify(state.serviceDraft.queues["501"])'),unrelated);
  requests.length=0;await apply();
  assert.deepEqual((await app.control('state')).members.queue['700'],['207']);
  assert.ok(!(await app.control('state')).members.queue['501'].includes('238'));
  assert.deepEqual(requests.find(item=>item.url==='/api/service-groups/apply').body.services.map(service=>service.serviceNumber),['700']);
});
