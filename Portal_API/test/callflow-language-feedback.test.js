const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { translateMarkup } = require('./helpers/translation-dom.cjs');

const root = path.resolve(__dirname, '..');
const catalog = JSON.parse(fs.readFileSync(path.join(root, 'i18n-messages.json'), 'utf8'));
const languages = Object.keys(catalog['portal.incomingCall']);
const message = (key, language, params = {}) => catalog[key][language].replace(/\{(\w+)\}/g, (_, name) => params[name]);

function client() {
  let language = 'en';
  const listeners = new Map(), storage = new Map();
  const feedback = { innerHTML: '' }, canvas = { innerHTML: '', clientWidth: 1000, dataset: {}, closest: () => null }, nodes = [], edges = [];
  const context = vm.createContext({
    window: { location: { hash: '' }, addEventListener() {}, NFON_I18N: {
      getLanguage: () => language,
      message: (key, params) => message(key, language, params),
    } },
    document: {
      querySelector: selector => selector === '#flow-feedback' ? feedback : selector === '#callflow-canvas' ? canvas : null,
      querySelectorAll: selector => selector === '[data-node-id]' ? nodes : selector === '[data-insert-from][data-insert-to]' ? edges : [],
      addEventListener: (name, handler) => listeners.set(name, [...(listeners.get(name) || []), handler]),
    },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    Date, Intl, URL, console,
  });
  const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  vm.runInContext(source.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ''), context);
  const run = code => vm.runInContext(code, context);
  run(`state.loading=false; state.view='callflow'; state.overview={account:'TEST',settings:{configured:true},
    inventory:{dids:[{id:'did',name:'+4412340',trunkNumber:'Incoming call',destinationType:'PHONEEXTENSION',destinationExtension:'201',destinationName:'Local draft deleted'}],extensions:[]}};
    state.selectedDidId='did'; state.flow=buildFlowForDid(selectedDid(),getOverview());`);
  return { run, feedback, canvas, nodes, edges, setLanguage(value) { language = value; for (const handler of listeners.get('nfon:language-change') || []) handler({ detail: { language: value } }); } };
}

test('deleting a local draft keeps its feedback translated through subsequent language changes', () => {
  const app = client();
  app.run('saveCurrentFlowDraft(false); clearCurrentFlowDraft(); reloadCurrentFlowWithoutDraft(); renderFlowFeedback();');
  assert.match(app.feedback.innerHTML, /Local draft deleted/);
  for (const language of [...languages, 'en']) {
    app.setLanguage(language);
    const dom = translateMarkup(app.feedback.innerHTML, language, catalog);
    assert.equal(dom.elements.find(element => element.tagName === 'STRONG').textContent, catalog['portal.localDraftDeleted'][language], language);
    assert.ok(dom.root.textContent.includes(catalog['portal.theLiveStateIsTheStartingPointAgain'][language]), language);
  }
  assert.equal(app.run('Object.keys(readStoredFlowDrafts()).length'), 0);
});

test('language changes refresh inbound detail and connection labels in place while preserving real names', () => {
  const app = client();
  const title = { textContent: app.run('state.flow.nodes[0].title') };
  const detail = { textContent: app.run('flowNodeDetail(state.flow.nodes[0])') };
  const dock = translateMarkup(app.run('renderNodeDock(state.flow.nodes[0])'), 'en', catalog).elements.find(element => element.tagName === 'BUTTON');
  app.nodes.push({ dataset: { nodeId: 'inbound' }, querySelector: selector => ({ '.node-title': title, '.node-detail': detail, '[data-node-dock]': dock })[selector] || null });
  for (const language of [...languages, 'en']) {
    app.setLanguage(language);
    assert.equal(title.textContent, catalog['portal.incomingCall'][language], language);
    assert.equal(detail.textContent, message('portal.viaTrunkValue', language, { p0: 'Incoming call' }), language);
    assert.equal(dock.getAttribute('aria-label'), message('portal.dragConnectionFromValue', language, { p1: title.textContent }), language);
    assert.equal(app.run('state.flow.nodes[1].title'), 'Local draft deleted', 'real extension name is untouched');
    assert.equal(app.run('state.flow.nodes[0].subtitle'), '+4412340');
  }
});

test('unkeyed authored feedback titles remain literal even when they match a system message', () => {
  const app = client();
  app.run(`state.flowFeedback={ok:true,title:'Local draft deleted',message:'Customer-authored note'};renderFlowFeedback();`);
  app.setLanguage('de');
  const dom = translateMarkup(app.feedback.innerHTML, 'de', catalog);
  assert.equal(dom.elements.find(element => element.tagName === 'STRONG').textContent, 'Local draft deleted');
});

test('language changes refresh generated time-control metadata and details without editing schedules or resource names', () => {
  const app = client();
  app.run(`state.flow.nodes.push({id:'time',type:'TIMECONTROL',title:'Business hours',routeNumber:'1',targetNumber:'7201',config:{portalMode:'existing',hours:'Mo-Fr 09:00-18:00'}})`);
  const detail = { textContent: app.run('flowNodeDetail(state.flow.nodes[2])') };
  const number = { textContent: app.run('flowNodeNumberMeta(state.flow.nodes[2])') };
  app.nodes.push({ dataset: { nodeId: 'time' }, querySelector: selector => ({ '.node-detail': detail, '.node-number-meta': number })[selector] || null });
  for (const language of [...languages, 'en']) {
    app.setLanguage(language);
    assert.equal(detail.textContent, catalog['portal.insideOutside'][language], language);
    assert.equal(number.textContent, message('portal.extensionValue', language, { p0: '7201' }) + ' · ' + message('portal.serviceValue', language, { number: '1' }), language);
    assert.equal(app.run('state.flow.nodes[2].title'), 'Business hours');
    assert.equal(app.run('state.flow.nodes[2].config.hours'), 'Mo-Fr 09:00-18:00');
  }
});

test('rendered connection controls follow renamed system endpoints across language changes', () => {
  const app = client();
  app.run('renderCallflow()');
  const markup = translateMarkup(app.canvas.innerHTML, 'en', catalog);
  const edge = markup.elements.find(element => element.hasAttribute('data-insert-from'));
  assert.ok(edge, 'the production renderer creates a connection control');
  edge.dataset = { insertFrom: edge.getAttribute('data-insert-from'), insertTo: edge.getAttribute('data-insert-to') };
  app.edges.push(edge);
  for (const language of [...languages, 'en']) {
    app.setLanguage(language);
    assert.equal(edge.getAttribute('aria-label'), message('portal.insertStepBetweenValueAndValue', language, { p7: catalog['portal.incomingCall'][language], p8: 'Local draft deleted' }), language);
  }
});
