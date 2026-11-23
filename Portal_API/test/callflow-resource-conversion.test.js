const assert = require('node:assert/strict');
const test = require('node:test');
const {fixture}=require('./helpers/fixture.cjs');
const {clientRenderer}=require('./helpers/client-render.cjs');

for (const type of ['QUEUE','SKILL']) for (const source of ['extension type edit','existing resource source edit']) {
  test(`${source} creates a new ${type} through the normal Designer Apply`,async t=>{
    const app=await fixture(t),requests=[],storage=new Map();
    const ui=clientRenderer('en',{
      localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:key=>storage.delete(key)},
      fetch:async(url,options={})=>{requests.push({url,method:options.method||'GET'});return fetch(`http://127.0.0.1:${app.port}${url}`,options)},
    });
    for(const selector of ['#callflow-canvas','.flow-menu-launcher'])ui.element(selector).getBoundingClientRect=()=>({width:0,height:0,left:0,top:0,right:0,bottom:0});
    const run=ui.evaluate;await run('loadOverview()');await run('loadServiceGroups({quiet:true})');
    run('state.view="callflow";state.selectedNodeId=flowStartNode().id');
    assert.equal(run('selectedNode().isTarget'),true,'exercise the real inventory target editor');
    if(source==='extension type edit')run(`updateNodeField('type','${type}')`);
    else run(`applyTargetSelection(targetOptions().find(option=>option.kind==='${type}').value);updateNodeConfig('portalMode','new')`);
    run(`updateNodeField('title','Converted ${type}')`);
    assert.equal(run('selectedNode().config.portalMode'),'new');
    assert.equal(run('validateFlowDetails().ok'),true);
    assert.equal(run('validateFlowDetails().liveCapable'),true,'a complete create draft must be applicable, not just stored locally');
    const pending=run('stageAndApplyFlowPlan()');
    assert.equal(run('uiDialog.open&&uiDialog.showCancel'),true);run('closeUiDialog(true)');await pending;
    assert.equal(run('state.flowFeedback.ok'),true);
    const writes=await app.control('writes'),collection=type==='QUEUE'?'queue-services':'skill-services';
    assert.equal(writes.filter(write=>write.method==='POST'&&write.path.endsWith('/'+collection)).length,1);
    assert.equal((await app.control('state')).dids[0].dest.type,type);
    assert.equal(run('flowStartNode().config.portalMode'),'existing');
  });
}
