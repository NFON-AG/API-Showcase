const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');

const directory = path.join(__dirname, '../public/pdf');
const context = vm.createContext({ window: { jspdf: require(path.join(directory, 'jspdf.umd.min.js')) }, Uint8Array });
for (const file of ['pangram-font.js', 'callflow-pdf.js']) vm.runInContext(fs.readFileSync(path.join(directory, file), 'utf8'), context);
const create = model => Buffer.from(context.window.NfonCallflowPdf.create(model));
const model = () => ({
  overviewTitle: 'Flow overview', detailsTitle: 'Routing details', continued: 'Continued', number: '+49 89 123',
  bounds: { left: 0, top: 0, width: 400, height: 400 },
  nodes: [{ x: 60, y: 60, width: 220, height: 120, title: 'Zoë Müller / Łódź / Český', type: 'Extension', metadata: ['Extension 200'] }],
  edges: [], labels: [],
  details: [{ title: 'Zoë Müller / Łódź / Český', type: 'Extension', metadata: ['Extension 200'], rows: [], hasMembers: false }],
});
test('PDF is a real single-page vector document and leaves the export snapshot unchanged', () => {
  const data = model(), before = JSON.stringify(data), bytes = create(data);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(bytes.toString('latin1'), /\/Type \/Pages[\s\S]*?\/Count 1\b/);
  assert.doesNotMatch(bytes.toString('latin1'), /\/Subtype \/Image/);
  assert.equal(JSON.stringify(data), before);
});
test('Large member lists produce multiple pages without shrinking their text', () => {
  const data = model();
  data.details[0].hasMembers = true;
  data.details[0].rows = Array.from({ length: 150 }, (_, index) => `Member ${index} · extension ${200 + index}`);
  const bytes = create(data).toString('latin1');
  assert(Number(bytes.match(/\/Type \/Pages[\s\S]*?\/Count (\d+)/)?.[1]) > 3);
  assert.doesNotMatch(bytes, /\/Subtype \/Image/);
});
test('Unsupported characters fail explicitly rather than disappearing from the PDF', () => {
  const data = model(); data.nodes[0].title = 'Support 😀';
  assert.throws(() => create(data), error => error.code === 'PDF_FONT_CHARACTER');
});
test('Invalid geometry is rejected instead of downloading a corrupt document', () => {
  const data = model(); data.bounds.width = NaN;
  assert.throws(() => create(data), /Invalid diagram bounds/);
  const edge = model(); edge.edges = [{ points: [0, 1, 2] }];
  assert.throws(() => create(edge), /Invalid diagram edge/);
});
test('The pinned PDF library matches the verified upstream distribution', () => {
  assert.equal(createHash('sha256').update(fs.readFileSync(path.join(directory, 'jspdf.umd.min.js'))).digest('hex'), 'e6551fcdc32f09d6853b2c5126d18d01d9447e0da618a41a11ebeee0f6c20d54');
});
