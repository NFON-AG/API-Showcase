const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { clientRenderer } = require('./helpers/client-render.cjs');

const directory = path.join(__dirname, '../public/pdf');
const context = vm.createContext({ window: { jspdf: require(path.join(directory, 'jspdf.umd.min.js')) }, Uint8Array });
for (const file of ['pangram-font.js', 'callflow-pdf.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context);
const create = model => Buffer.from(context.window.NfonCallflowPdf.create(model));
function pageStreams(bytes) {
  return [...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match => {
    try { const stream = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString(); return stream.includes('BT') ? [stream] : []; }
    catch { return []; }
  });
}

function modelFromDesigner(theme) {
  const rootStyle = { getPropertyValue: name => ({ '--nfon-blue': '#3200c8', '--accent': '#00d981', '--text': '#000000', '--muted': '#525354', '--line': '#e6e9eb' })[name] || '' };
  // Computed values correspond to the actual selected teal service card in styles.css;
  // Modern N_Blue is defined by shared/appearance.css and the brand source record.
  const nodes = [{ id: 'inbound', type: 'DID', title: 'Incoming call', locked: true, x: 20, y: 20 },
    { id: 'hours', type: 'TIMECONTROL', title: 'Office hours', routeNumber: '1', targetNumber: '7201', config: { portalMode: 'existing', hours: 'Mon-Fri 09:00-18:00' }, x: 300, y: 20 }];
  const elements = nodes.map(node => {
    const parts = { '.node-type': { textContent: node.type, color: 'rgb(82, 83, 84)' }, '.node-title': { textContent: node.title, color: 'rgb(0, 0, 0)' },
      '.node-subtitle': { textContent: node.config?.hours || '+491234', color: 'rgb(82, 83, 84)' } };
    return { dataset: { nodeId: node.id }, style: { left: `${node.x}px`, top: `${node.y}px` }, offsetWidth: 230, offsetHeight: 140,
      colors: { borderTopColor: node.id === 'hours' ? 'rgb(0, 159, 143)' : 'rgb(50, 0, 200)', borderLeftColor: 'rgb(230, 233, 235)', backgroundColor: node.id === 'hours' ? 'rgb(228, 248, 245)' : 'rgb(255, 255, 255)', color: 'rgb(0, 0, 0)' },
      querySelector: selector => parts[selector] || null, querySelectorAll: () => [parts['.node-subtitle']] };
  });
  const canvas = { querySelectorAll: selector => selector === '.flow-node' ? elements : [], querySelector: () => null };
  const ui = clientRenderer('en', { getComputedStyle: element => element.colors || (element.color ? { color: element.color } : rootStyle), canvas });
  ui.evaluate(`document.documentElement={dataset:{nfonTheme:${JSON.stringify(theme)}}};state.overview={inventory:{dids:[{id:'did',name:'Synthetic fixture'}]}};state.selectedDidId='did';state.flow={nodes:${JSON.stringify(nodes)},edges:[{from:'inbound',to:'hours'}]};`);
  return JSON.parse(ui.evaluate('JSON.stringify(flowPdfModel(canvas))'));
}

for (const theme of ['admin-portal', 'classic']) test(`PDF model preserves ${theme} designer colors, including selected card and detail accents`, () => {
  const model = modelFromDesigner(theme);
  assert.equal(model.accent, theme === 'admin-portal' ? '#3200c8' : '#00d981');
  assert.equal(model.nodes[1].background, 'rgb(228, 248, 245)');
  assert.equal(model.nodes[1].borderColor, 'rgb(230, 233, 235)');
  assert.equal(model.nodes[1].titleColor, 'rgb(0, 0, 0)');
  assert.deepEqual(model.nodes[1].metadataColors, ['rgb(82, 83, 84)']);
  assert.equal(model.details[1].accent, model.nodes[1].accent);
});

test('actual vector PDF retains card fills and per-resource accents on overview and details pages', () => {
  const model = modelFromDesigner('admin-portal');
  // Exercise serializer independently of the model-preparation assertions.
  Object.assign(model.nodes[1], { background: '#e4f8f5', borderColor: '#e6e9eb', titleColor: '#000000', typeColor: '#525354', metadataColors: ['#525354'] });
  Object.assign(model.details[1], { accent: '#009f8f', hasMembers: true, rows: Array.from({ length: 40 }, (_, i) => `Member ${i + 1}`) });
  const before = JSON.stringify(model), bytes = create(model), streams = pageStreams(bytes);
  assert.ok(streams.length > 1);
  assert.match(streams[0], /0\.89 0\.97 0\.96 rg/, 'selected teal card surface must remain in the PDF');
  assert.match(streams[0], /0\.9 0\.91 0\.92 RG/, 'card border uses the actual theme color');
  assert.match(streams[0], /0\. 0\.62 0\.56 RG/, 'teal resource accent appears in overview');
  assert.ok(streams.slice(1).some(stream => /0\. 0\.62 0\.56 RG/.test(stream)), 'resource retains its own accent in routing details');
  assert.equal(JSON.stringify(model), before);
  assert.doesNotMatch(bytes.toString('latin1'), /\/Subtype \/Image/);
});
