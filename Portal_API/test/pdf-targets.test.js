const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { clientRenderer } = require('./helpers/client-render.cjs');
const { translateMarkup } = require('./helpers/translation-dom.cjs');

// Real client rendering with a controlled layout/computed-style boundary.
function designer(kinds = ['QUEUE'], expanded = false, memberCount = 2) {
  let catalog, elements = [], html = '', failStyles = false;
  const descendants = node => (node.children || []).flatMap(child => child.nodeType === 1 ? [child, ...descendants(child)] : []);
  const matches = (element, selector) => selector.split(',').some(part => {
    const included = part.match(/^\s*\.([\w-]+)/)?.[1];
    const excluded = part.match(/:not\(\.([\w-]+)\)/)?.[1];
    const classes = (element.getAttribute('class') || '').split(/\s+/);
    return included && classes.includes(included) && (!excluded || !classes.includes(excluded));
  });
  function prepare(element) {
    const style = Object.fromEntries((element.getAttribute('style') || '').split(';').flatMap(part => {
      const match = part.match(/^\s*([^:]+):(.*)$/); return match ? [[match[1], match[2]]] : [];
    }));
    element.style = { ...style, getPropertyValue: name => style[name] || '' };
    element.dataset = { nodeId: element.getAttribute('data-node-id') };
    element.offsetWidth = matches(element, '.flow-insert') ? 28 : 230;
    element.offsetHeight = matches(element, '.flow-insert') ? 28 : matches(element, '.is-service-member') ? 127 : 160;
    element.querySelectorAll = selector => descendants(element).filter(item => matches(item, selector));
    element.querySelector = selector => element.querySelectorAll(selector)[0] || null;
    return element;
  }
  const canvas = { dataset: {}, scrollLeft: 19, scrollTop: 27, clientWidth: 500,
    closest: () => null,
    get innerHTML() { return html; },
    set innerHTML(value) { html = value; elements = translateMarkup(value, 'en', catalog || {}).elements.map(prepare); },
    querySelectorAll: selector => elements.filter(element => matches(element, selector)),
    querySelector: selector => elements.find(element => matches(element, selector)) || null,
  };
  const rootStyle = { getPropertyValue: name => ({ '--nfon-blue': '#3200c8', '--accent': '#00d981', '--text': '#000000', '--muted': '#525354', '--line': '#e6e9eb' })[name] || '' };
  const ui = clientRenderer('en', { canvas, getComputedStyle: (element, pseudo) => {
    if (failStyles) throw new Error('Style capture failed');
    if (pseudo) return { backgroundImage: 'radial-gradient(circle, rgba(92, 106, 102, 0.35) 1.2px, transparent 1.4px)', backgroundSize: '24px 24px' };
    if (element === canvas) return { backgroundColor: 'rgb(251, 252, 252)' };
    if (!element.getAttribute) return rootStyle;
    return { borderTopColor: matches(element, '.is-service-member') ? '#00e682' : '#3200c8', borderLeftColor: '#e6e9eb', backgroundColor: '#ffffff', color: '#525354', borderColor: '#8b7bb7', borderTopWidth: '1px' };
  } });
  catalog = ui.catalog;
  ui.element('#callflow-canvas');
  const services = kinds.map((kind, index) => ({ id: `service-${index}`, type: kind, title: `${kind} team`, targetNumber: String(300 + index), routeNumber: String(index), x: 22 + index * 30, y: 42,
    config: { portalMode: 'existing' }, memberCount, memberTargets: Array.from({ length: memberCount }, (_, memberIndex) => memberIndex === 0
      ? { number: '100', name: 'Shared Agent' }
      : { number: String(200 + memberIndex + index * 20), name: `Zoë Müller ${memberIndex - 1 + index}` }) }));
  const nodes = [{ id: 'inbound', type: 'DID', title: 'Incoming call', locked: true, x: 20, y: 10 }, ...services];
  ui.evaluate(`document.documentElement={dataset:{nfonTheme:'admin-portal'}};document.querySelector=selector=>selector==='#callflow-canvas'?canvas:null;document.querySelectorAll=selector=>selector==='#callflow-canvas .flow-node'?canvas.querySelectorAll('.flow-node'):[];state.loading=false;state.overview={inventory:{dids:[{id:'did',name:'Synthetic'}]}};state.selectedDidId='did';state.view='callflow';state.flowZoom=.8;state.flow={nodes:${JSON.stringify(nodes)},edges:${JSON.stringify(services.map(node => ({ from: 'inbound', to: node.id })))} };state.expandedServiceNodeIds=${JSON.stringify(expanded ? services.map(node => node.id) : [])};renderCallflow();`);
  // Existing UI render may initialize member layouts. Snapshot the actual pre-export state.
  ui.evaluate('const originalFlow=state.flow;const originalExpanded=state.expandedServiceNodeIds;');
  return { ui, canvas, setFailure: value => { failStyles = value; }, capture: () => JSON.parse(ui.evaluate('JSON.stringify(captureFlowPdfModel(canvas))')),
    before: () => ({ state: ui.evaluate('JSON.stringify(state)'), html: canvas.innerHTML, scrollLeft: canvas.scrollLeft, scrollTop: canvas.scrollTop, initialDid: canvas.dataset.initialDid }),
  };
}

for (const kind of ['QUEUE', 'SKILL', 'GROUP']) for (const expanded of [false, true]) test(`PDF includes every ${kind} target once when designer targets are ${expanded ? 'expanded' : 'collapsed'}`, () => {
  const fixture = designer([kind], expanded), before = fixture.before(), model = fixture.capture();
  assert.equal(model.nodes.length, 4);
  assert.equal(model.edges.length, 3);
  assert.equal(new Set(model.nodes.map(node => node.id)).size, 4);
  assert.deepEqual(model.nodes.filter(node => node.id.includes('-member-')).map(node => [node.title, node.metadata[0]]), [['Shared Agent', 'Extension 100'], ['Zoë Müller 0', 'Extension 201']]);
  assert.equal(model.details.length, 2);
  assert.equal(model.details[1].rows.length, 2);
  assert.deepEqual(fixture.before(), before);
  assert.equal(fixture.ui.evaluate('state.flow===originalFlow&&state.expandedServiceNodeIds===originalExpanded'), true);
});

test('PDF retains one connected target instance per service when services share a member', () => {
  const fixture = designer(['QUEUE', 'SKILL']), model = fixture.capture();
  assert.equal(model.nodes.length, 7);
  assert.equal(model.edges.length, 6);
  assert.equal(model.nodes.filter(node => node.title === 'Shared Agent').length, 2);
  for (const service of ['service-0', 'service-1']) {
    assert(model.nodes.some(node => node.id === `${service}-member-100`));
  }
});

test('PDF capture failure restores the exact draft and collapsed designer', () => {
  const fixture = designer(), before = fixture.before();
  fixture.setFailure(true);
  assert.throws(() => fixture.capture(), /Style capture failed/);
  assert.deepEqual(fixture.before(), before);
  assert.equal(fixture.ui.evaluate('state.flow===originalFlow&&state.expandedServiceNodeIds===originalExpanded'), true);
});

test('PDF shows known target names when no extension numbers are available', () => {
  const fixture = designer();
  fixture.ui.evaluate("Object.assign(state.flow.nodes[1],{memberTargets:[],memberNames:['Named target A','Named target B']});renderCallflow();");
  const model = fixture.capture();
  const targets = model.nodes.filter(node => node.id.includes('-member-'));
  assert.deepEqual(targets.map(node => node.title), ['Named target A', 'Named target B']);
  assert.deepEqual(targets.map(node => node.metadata[0]), ['Extension', 'Extension']);
  assert.equal(model.edges.length, 3);
});

test('PDF overview bounds include all eight targets and the real serializer preserves the snapshot', () => {
  const fixture = designer(['QUEUE'], false, 8), model = fixture.capture();
  assert.equal(model.nodes.length, 10);
  assert.equal(model.edges.length, 9);
  for (const node of model.nodes) {
    assert(node.x >= model.bounds.left && node.y >= model.bounds.top);
    assert(node.x + node.width <= model.bounds.left + model.bounds.width);
    assert(node.y + node.height <= model.bounds.top + model.bounds.height);
  }
  const directory = path.join(__dirname, '../public/pdf');
  const context = vm.createContext({ window: { jspdf: require(path.join(directory, 'jspdf.umd.min.js')) }, Uint8Array });
  for (const file of ['pangram-font.js', 'callflow-pdf.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context);
  const before = JSON.stringify(model), bytes = Buffer.from(context.window.NfonCallflowPdf.create(model));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.doesNotMatch(bytes.toString('latin1'), /\/Subtype \/Image/);
  assert.equal(JSON.stringify(model), before);
});

module.exports = { designer };
