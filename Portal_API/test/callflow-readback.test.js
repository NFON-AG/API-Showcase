const assert = require('node:assert/strict');
const test = require('node:test');
const { writeFixture } = require('./helpers/fixture.cjs');
const { clientRenderer } = require('./helpers/client-render.cjs');

const target = (id, type, routeNumber, config = {}) => ({ id, type, title: id, ...(type === 'DID' ? { locked: true } : {}),
  ...(routeNumber !== undefined ? { routeNumber, targetNumber: routeNumber } : {}), config });
const edge = (from, to, branchField) => ({ from, to, ...(branchField ? { branchField } : {}) });
function renderer() {
  const ui = clientRenderer('en');
  for (const selector of ['#callflow-canvas', '.flow-menu-launcher']) {
    ui.element(selector).getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });
  }
  return ui;
}

test('created IVR preserves every configured key and Skill timeout through fresh overview and client reload', async t => {
  const app = await writeFixture(t);
  const initial = (await app.request('/api/overview')).body;
  const targets = [
    target('queue', 'QUEUE', '500', { portalMode: 'existing' }),
    target('skill', 'SKILL', '600', { portalMode: 'existing' }),
    target('extension', 'PHONEEXTENSION', '203'),
    target('ivr', 'IVR', '1', { portalMode: 'existing' }),
    target('hours', 'TIMECONTROL', '0', { portalMode: 'existing' }),
    target('end', 'HANGUP', 'HANGUP'),
  ];
  const keys = targets.map((_, index) => String(index + 1));
  targets.find(node => node.id === 'ivr').title = initial.inventory.ivrs.find(ivr => ivr.serviceNumber === '1').name;
  const flow = {
    nodes: [target('inbound', 'DID'), target('menu', 'IVR', undefined,
      { portalMode: 'new', announcement: 'Announcement 0', ivrKeys: keys, timeoutSeconds: 20 }), ...targets],
    edges: [edge('inbound', 'menu'), ...targets.map((node, index) => edge('menu', node.id, `key${index + 1}Target`)), edge('menu', 'skill', 'timeoutTarget')],
  };
  const applied = await app.request('/api/callflow/apply', { did: initial.inventory.dids[0], flow, commit: true });
  assert.equal(applied.body.applied, true, JSON.stringify(applied));
  const routeNumber = applied.body.target.routeNumber;
  const writes = await app.control('writes');
  const assignments = writes.filter(write => write.path.endsWith(`/ivr-services/${routeNumber}/key-assignments`)).map(write => JSON.parse(write.body));
  assert.deepEqual(assignments.map(body => String(body.data.find(field => field.name === 'number').value)), keys, 'provider received all key assignments');
  assert.ok(assignments[1].links.find(link => link.rel === 'target').href.endsWith('/skill-services/600'));
  const overview = (await app.request('/api/overview')).body;
  const menu = overview.inventory.ivrs.find(ivr => ivr.serviceNumber === routeNumber);
  assert.deepEqual(menu.keyRoutes.map(route => [route.number, route.target.type, route.target.routeNumber]),
    targets.map((node, index) => [keys[index], node.type, node.routeNumber]));
  assert.equal(menu.timeoutTarget.type, 'SKILL');
  assert.equal(menu.timeoutTarget.routeNumber, '600');
  const ui = renderer();
  ui.evaluate(`state.overview=${JSON.stringify(overview)};state.flow=buildFlowForDid(state.overview.inventory.dids[0],state.overview);`);
  const reloaded = JSON.parse(ui.evaluate('JSON.stringify(state.flow.nodes.find(node=>node.id==="target").config)'));
  assert.deepEqual(reloaded.ivrKeys, keys);
  for (const [index, node] of targets.entries()) {
    assert.equal(reloaded[`key${index + 1}Target`].type, node.type);
    assert.equal(reloaded[`key${index + 1}Target`].routeNumber, node.routeNumber);
  }
  assert.equal(reloaded.timeoutTarget.type, 'SKILL');
  ui.evaluate('materializeBranchNodes(state.flow)');
  const reloadedFlow = JSON.parse(ui.evaluate('JSON.stringify(state.flow)'));
  await app.control('clearlog');
  const repeat = await app.request('/api/callflow/apply', { did: overview.inventory.dids[0], flow: reloadedFlow, commit: true });
  assert.equal(repeat.body.applied, true, JSON.stringify(repeat));
  assert.deepEqual(await app.control('writes'), [], 'unchanged roundtrip Apply remains a no-op');
});

for (const [hours, fromTime, toTime] of [
  ['Mon-Fri 09:00-18:00', '09:00 AM', '06:00 PM'],
  ['Fri-Mon 22:00-06:00', '10:00 PM', '06:00 AM'],
  ['Mon 12:00-00:00', '12:00 PM', '12:00 AM'],
]) test(`created time control displays ${hours} after provider and client reload`, async t => {
  const app = await writeFixture(t);
  const initial = (await app.request('/api/overview')).body;
  const flow = {
    nodes: [target('inbound', 'DID'), target('hours', 'TIMECONTROL', undefined, { portalMode: 'new', hours }),
      target('open', 'PHONEEXTENSION', '203'), target('closed', 'HANGUP', 'HANGUP')],
    edges: [edge('inbound', 'hours'), edge('hours', 'open', 'openTarget'), edge('hours', 'closed', 'closedTarget')],
  };
  const applied = await app.request('/api/callflow/apply', { did: initial.inventory.dids[0], flow, commit: true });
  assert.equal(applied.body.applied, true, JSON.stringify(applied));
  const created = (await app.control('state')).tcs.find(control => control.serviceNumber === applied.body.target.routeNumber);
  assert.equal(created.data.fromTimeOfDay, fromTime);
  assert.equal(created.data.toTimeOfDay, toTime);
  const overview = (await app.request('/api/overview')).body;
  const control = overview.inventory.timeControls.find(item => item.serviceNumber === created.serviceNumber);
  assert.equal(control.hours, hours);
  const ui = renderer();
  ui.evaluate(`state.overview=${JSON.stringify(overview)};state.flow=buildFlowForDid(state.overview.inventory.dids[0],state.overview);ensureNodeConfig(state.flow.nodes[1]);`);
  assert.equal(ui.evaluate('state.flow.nodes[1].config.hours'), hours);
  assert.equal(ui.evaluate('flowNodeSubtitle(state.flow.nodes[1])'), hours);
  ui.evaluate(`applyTargetToNode(state.flow.nodes[1],JSON.parse(targetOptions().find(option=>option.kind==='TIMECONTROL'&&JSON.parse(option.value).targetNumber===${JSON.stringify(control.value)}).value));ensureNodeConfig(state.flow.nodes[1]);`);
  assert.equal(ui.evaluate('state.flow.nodes[1].config.hours'), hours, 'selecting an existing time control uses the same verified schedule');
  ui.evaluate('materializeBranchNodes(state.flow)');
  const reloadedFlow = JSON.parse(ui.evaluate('JSON.stringify(state.flow)'));
  await app.control('clearlog');
  const repeat = await app.request('/api/callflow/apply', { did: overview.inventory.dids[0], flow: reloadedFlow, commit: true });
  assert.equal(repeat.body.applied, true, JSON.stringify(repeat));
  assert.deepEqual(await app.control('writes'), []);
});

test('existing time control without schedule never invents the new-form default', () => {
  const ui = renderer();
  ui.evaluate(`state.overview={inventory:{timeControls:[{serviceNumber:'0',extensionNumber:'7200',name:'Hours'}]}};
    state.flow={nodes:[flowTargetFromApiTarget({type:'TIMECONTROL',routeNumber:'0',title:'Hours'})],edges:[]};
    ensureNodeConfig(state.flow.nodes[0]);`);
  assert.equal(ui.evaluate('state.flow.nodes[0].config.hours || ""'), '');
  assert.doesNotMatch(ui.evaluate('flowNodeSubtitle(state.flow.nodes[0])'), /08:00|17:00/);
  assert.equal(ui.evaluate('flowNodeDefaultMetadata("TIMECONTROL")["config.hours"].value'), 'Mon-Fri 08:00-17:00', 'new-step default is retained');
});
