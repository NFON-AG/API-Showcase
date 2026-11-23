const assert = require('node:assert/strict');
const test = require('node:test');
const { clientRenderer } = require('./helpers/client-render.cjs');

const resources = [
  { type: 'QUEUE', collection: 'queues', key: 'portal.queueValue', number: '500', label: 'Queue 500' },
  { type: 'SKILL', collection: 'skills', key: 'portal.skillGroupValue', number: '600', label: 'Skill group 600' },
];

for (const resource of resources) test(`generated ${resource.type} subtitles follow the selected language without changing real names`, () => {
  const source = clientRenderer('en');
  const target = { type: resource.type, title: resource.label, subtitle: resource.label, routeNumber: resource.number, targetNumber: resource.number };
  const node = JSON.parse(source.evaluate(`JSON.stringify(flowTargetFromApiTarget(${JSON.stringify(target)}))`));
  for (const language of Object.keys(source.catalog[resource.key])) {
    const ui = clientRenderer(language);
    ui.evaluate(`state.flow={nodes:[${JSON.stringify(node)}],edges:[]}`);
    assert.equal(ui.evaluate('flowNodeSubtitle(state.flow.nodes[0])'), ui.catalog[resource.key][language].replace('{p0}', resource.number), language);
    assert.equal(ui.evaluate('state.flow.nodes[0].title'), resource.label, 'provider name stays literal even when it matches a generated label');
    ui.evaluate('clearFlowNodeDefault(state.flow.nodes[0],"subtitle")');
    assert.equal(ui.evaluate('flowNodeSubtitle(state.flow.nodes[0])'), resource.label, 'explicitly edited subtitle is no longer translated');
  }
});

test('existing Queue and Skill selector choices preserve generated subtitle metadata while authored text stays literal', () => {
  const source = clientRenderer('en');
  const inventory = Object.fromEntries(resources.map(resource => [resource.collection, [{ name: 'Provider name', serviceNumber: resource.number, extensionNumber: resource.number }]]));
  for (const dids of [[], resources.map(resource => ({ value: 'Provider name', destinationName: 'Provider name', destinationType: resource.type, destinationExtension: resource.number, destinationServiceNumber: resource.number }))]) {
    source.evaluate(`state.overview={inventory:${JSON.stringify({ ...inventory, dids })}}`);
    for (const resource of resources) {
      const choice = source.evaluate(`targetOptions().find(option=>option.kind==='${resource.type}').value`);
      const ui = clientRenderer('de');
      ui.evaluate(`state.flow={nodes:[{id:'target'}],edges:[]};applyTargetToNode(state.flow.nodes[0],${choice})`);
      assert.equal(ui.evaluate('flowNodeSubtitle(state.flow.nodes[0])'), ui.catalog[resource.key].de.replace('{p0}', resource.number), `${resource.type}: ${dids.length ? 'routed DID option' : 'inventory option'}`);
      assert.equal(ui.evaluate('state.flow.nodes[0].title'), 'Provider name');
    }
  }
  const ui = clientRenderer('de');
  ui.evaluate(`state.flow={nodes:[flowTargetFromApiTarget({type:'SKILL',title:'Skill group 600',subtitle:'Priority support',targetNumber:'600',routeNumber:'600'}),{type:'TIMECONTROL',subtitle:'Authored time note',config:{hours:'Mon-Fri 09:00-18:00'}}],edges:[]}`);
  assert.equal(ui.evaluate('flowNodeSubtitle(state.flow.nodes[0])'), 'Priority support');
  assert.equal(ui.evaluate('state.flow.nodes[0].title'), 'Skill group 600');
  assert.equal(ui.evaluate('flowNodeSubtitle(state.flow.nodes[1])'), 'Mon-Fri 09:00-18:00');
});
