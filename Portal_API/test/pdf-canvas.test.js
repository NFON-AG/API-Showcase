const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { clientRenderer } = require('./helpers/client-render.cjs');

function designerModel() {
  const rootStyle = { getPropertyValue: name => ({ '--nfon-blue': '#3200c8', '--text': '#000000', '--muted': '#525354', '--line': '#e6e9eb' })[name] || '' };
  const graphNodes = [{ id: 'start', type: 'DID', title: 'Incoming call', locked: true, x: 20, y: 20 }, { id: 'target', type: 'EXTENSION', title: 'Support', targetNumber: '100', x: 300, y: 300 }];
  const nodes = graphNodes.map(node => ({ dataset: { nodeId: node.id }, style: { left: `${node.x}px`, top: `${node.y}px` }, offsetWidth: 220, offsetHeight: 140,
    computed: { borderTopColor: '#3200c8', borderLeftColor: '#e6e9eb', backgroundColor: '#ffffff', color: '#000000' },
    querySelector: selector => ({ '.node-type': { textContent: node.type, computed: { color: '#525354' } }, '.node-title': { textContent: node.title, computed: { color: '#000000' } } })[selector] || null,
    querySelectorAll: () => [] }));
  const grid = { computed: { backgroundImage: 'radial-gradient(circle, rgba(92, 106, 102, 0.35) 1.2px, rgba(0, 0, 0, 0) 1.4px)', backgroundSize: '24px 24px', backgroundPositionX: '0px', backgroundPositionY: '0px' } };
  const arrow = { style: { left: '260px', top: '260px', getPropertyValue: () => '90deg' }, offsetWidth: 28, offsetHeight: 28,
    computed: { backgroundColor: 'rgb(255, 255, 255)', borderColor: 'rgb(139, 123, 183)', color: 'rgb(82, 96, 93)', borderTopWidth: '1px' } };
  const canvas = { computed: { backgroundColor: 'rgb(251, 252, 252)' }, querySelector: selector => selector === '.flow-world-wrap' ? grid : null,
    querySelectorAll: selector => selector === '.flow-node' ? nodes : selector === '.flow-insert.is-arrow' ? [arrow] : [] };
  const ui = clientRenderer('en', { getComputedStyle: element => element.computed || rootStyle, canvas });
  ui.evaluate(`document.documentElement={dataset:{nfonTheme:'admin-portal'}};state.flowZoom=1;state.overview={inventory:{dids:[{id:'did',name:'Synthetic'}]}};state.selectedDidId='did';state.flow={nodes:${JSON.stringify(graphNodes)},edges:[{from:'start',to:'target'}]};`);
  return JSON.parse(ui.evaluate('JSON.stringify(flowPdfModel(canvas))'));
}

function render(model) {
  const directory = path.join(__dirname, '../public/pdf');
  const context = vm.createContext({ window: { jspdf: require(path.join(directory, 'jspdf.umd.min.js')) }, Uint8Array });
  for (const file of ['pangram-font.js', 'callflow-pdf.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context);
  const bytes = Buffer.from(context.window.NfonCallflowPdf.create(model));
  const streams = [...bytes.toString('latin1').matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)].flatMap(match => {
    try { const stream = zlib.inflateSync(Buffer.from(match[1], 'latin1')).toString(); return stream.includes('BT') ? [stream] : []; } catch { return []; }
  });
  return { bytes, streams };
}

test('PDF snapshot includes the displayed dot grid and midpoint direction markers', () => {
  const model = designerModel();
  assert.equal(model.canvas.background, 'rgb(251, 252, 252)');
  assert.deepEqual(model.canvas.grid, { color: 'rgba(92, 106, 102, 0.35)', radius: 1.2, stepX: 24, stepY: 24, originX: 12, originY: 12 });
  assert.deepEqual(model.arrows, [{ x: 260, y: 260, width: 28, height: 28, angle: 90, background: 'rgb(255, 255, 255)', borderColor: 'rgb(139, 123, 183)', color: 'rgb(82, 96, 93)', borderWidth: 1 }]);
});

test('actual PDF paints the grid behind cards and the visible direction circle on the connection', () => {
  const model = designerModel();
  model.labels = [{ x: 30, y: 30, text: 'Open' }];
  model.borderColor = '#123456';
  const before = JSON.stringify(model);
  const { bytes, streams } = render(model), overview = streams[0];
  assert.match(overview, /0\.98 0\.99 0\.99 rg/, 'canvas background must be painted');
  assert.match(overview, /0\.77 0\.79 0\.78 rg/, 'translucent designer dots must be composited over the canvas');
  assert.ok((overview.match(/ c\n/g) || []).length > 400, 'visible grid dots must be vector circles');
  assert.doesNotMatch(overview, /re\nS\nW/, 'grid clipping must not paint a spurious frame');
  assert.match(overview, /0\.55 0\.48 0\.72 RG/, 'midpoint circle keeps its designer border');
  assert.match(overview, /0\.32 0\.38 0\.36 RG/, 'direction glyph keeps its designer color');
  assert.ok(overview.indexOf('0.55 0.48 0.72 RG') < overview.indexOf('0.9 0.91 0.92 RG'), 'direction markers stay behind cards, as in the designer');
  assert.ok(overview.indexOf('0.07 0.2 0.34 RG') < overview.indexOf('0.9 0.91 0.92 RG'), 'branch labels also stay behind cards');
  assert.equal(JSON.stringify(model), before);
  assert.doesNotMatch(bytes.toString('latin1'), /\/Subtype \/Image/);
});
