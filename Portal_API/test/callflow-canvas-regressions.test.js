const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function frontend() {
  const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '../i18n-messages.json')));
  const windowEvents = new Map(), documentEvents = new Map();
  let tick = 1000;
  class Clock extends Date { static now() { return ++tick; } }
  const context = vm.createContext({
    window: { location: { hash: '' }, addEventListener: (type, fn) => windowEvents.set(type, [...(windowEvents.get(type) || []), fn]), NFON_I18N: { getLanguage: () => 'en', message: (key, params = {}) => (catalog[key]?.en || '').replace(/\{(\w+)\}/g, (value, name) => params[name] ?? value) } },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: (type, fn) => documentEvents.set(type, [...(documentEvents.get(type) || []), fn]) },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, Date: Clock, URL, Intl, console,
  });
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  vm.runInContext(source.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ''), context);
  const run = code => vm.runInContext(code, context);
  run(`render=()=>{};renderCallflow=()=>{};renderFlowHelper=()=>{};renderFlowFeedback=()=>{};
    state.flow={nodes:[{id:'inbound',type:'DID',title:'Incoming',locked:true,x:20,y:30},{id:'target',type:'PHONEEXTENSION',title:'Destination',targetNumber:'200',routeNumber:'200',x:20,y:50}],edges:[{from:'inbound',to:'target'}]};`);
  return { run, dispatchWindow: (type, event = {}) => (windowEvents.get(type) || []).forEach(fn => fn(event)), dispatchDocument: (type, event = {}) => (documentEvents.get(type) || []).forEach(fn => fn(event)), boxes: () => JSON.parse(run('JSON.stringify(buildVisibleFlowGraph(state.flow).nodes.map(n=>({id:n.id,...nodeWorldBox(n)})))')) };
}
function assertNoOverlap(boxes) {
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert(!(a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y), `${a.id} overlaps ${b.id}`);
  }
}
test('CF-09: inserting a connected step reserves enough space for all cards', () => {
  const app = frontend(); app.run(`addFlowNode('inbound','target')`);
  assertNoOverlap(app.boxes());
  assert.equal(app.run('state.flow.edges.length'), 2);
});
test('CF-09: repeated palette insertion never puts distinct nodes on top of each other', () => {
  const app = frontend();
  app.run(`for(let i=0;i<5;i++)addPaletteNodeToCanvas({type:'PHONEEXTENSION',title:'Extension '+i,targetNumber:String(201+i)}, {x:160,y:160});`);
  assert.equal(app.run('state.flow.nodes.length'), 7);
  assertNoOverlap(app.boxes());
});
test('CF-09: expanding members reserves space around existing nodes and other members', () => {
  const app = frontend();
  app.run(`state.flow.nodes.find(n=>n.id==='target').x=38;state.flow.nodes.push({id:'queue',type:'QUEUE',title:'Queue',x:10,y:54,floating:true,config:{portalMode:'existing'},memberTargets:Array.from({length:20},(_,i)=>({name:'Ext '+i,number:String(200+i)}))});state.expandedServiceNodeIds=['queue'];`);
  const boxes = app.boxes(); assert.equal(boxes.length, 23); assertNoOverlap(boxes);
});
test('CF-08/CF-14: panning the viewport never relocates saved or restored graph coordinates', () => {
  const app = frontend();
  const before = app.run('JSON.stringify(state.flow.nodes.map(n=>({id:n.id,x:n.x,y:n.y})))');
  const boxes = app.boxes();
  app.run(`flowMenuSafeAreaWorld=()=>({left:200,right:1400,top:0,bottom:700});sanitizeFlowPositions(state.flow);`);
  assert.equal(app.run('JSON.stringify(state.flow.nodes.map(n=>({id:n.id,x:n.x,y:n.y})))'), before);
  assert.deepEqual(app.boxes(), boxes);
});

test('A toolbar above the canvas does not displace cards in a scrolled diagram', () => {
  const app = frontend();
  app.run(`document.querySelector=selector=>selector==='#callflow-canvas'
    ? {scrollLeft:0,scrollTop:500,getBoundingClientRect:()=>({left:0,right:1000,top:300,bottom:900,width:1000})}
    : selector==='.flow-menu-launcher'
      ? {getBoundingClientRect:()=>({left:0,right:1000,top:250,bottom:300,width:1000})} : null;`);
  const requested = app.run('JSON.stringify({x:300/FLOW_WORLD_WIDTH*100,y:500/FLOW_POSITION_HEIGHT*100})');
  assert.equal(app.run('JSON.stringify(safeFlowPosition(300/FLOW_WORLD_WIDTH*100,500/FLOW_POSITION_HEIGHT*100))'), requested);
});

function menuGeometry() {
  const app = frontend();
  app.run(`window.innerHeight=844;
    globalThis.outerClip={parentElement:null,clientTop:2,clientHeight:698,overflowY:'hidden',getBoundingClientRect:()=>({top:120})};
    globalThis.innerClip={parentElement:outerClip,clientTop:1,clientHeight:600,overflowY:'auto',getBoundingClientRect:()=>({top:300})};
    globalThis.visibleParent={parentElement:innerClip,overflowY:'visible',getBoundingClientRect:()=>({top:530,bottom:560})};
    globalThis.menuTop=542;
    globalThis.menu={hidden:false,parentElement:visibleParent,style:{},getBoundingClientRect:()=>({top:menuTop})};
    globalThis.getComputedStyle=element=>({overflowY:element.overflowY});
    document.querySelector=selector=>selector==='#flow-did-menu'?menu:null;`);
  return app;
}

test('DID menu fits the smallest actual clipping ancestor rather than a fixed viewport offset', () => {
  const app = menuGeometry();
  app.run('fitFlowDidMenu()');
  assert.equal(app.run('menu.style.maxHeight'), '270px', 'Clipping border at 820 minus menu top 542 and 8px gap');
  app.run("outerClip.overflowY='visible';fitFlowDidMenu()");
  assert.equal(app.run('menu.style.maxHeight'), '294px', 'Visible overflow must not introduce a false clipping boundary');
});

test('DID menu updates its available height when the viewport resizes or its ancestor scrolls', () => {
  const app = menuGeometry();
  app.run('window.innerHeight=700');
  app.dispatchWindow('resize');
  assert.equal(app.run('menu.style.maxHeight'), '150px');
  app.run('menuTop=400');
  app.dispatchDocument('scroll');
  assert.equal(app.run('menu.style.maxHeight'), '292px');
});

test('DID menu respects the visual viewport, keeps its normal cap, and ignores a closed menu', () => {
  const app = menuGeometry();
  app.run('window.visualViewport={offsetTop:20,height:650};fitFlowDidMenu()');
  assert.equal(app.run('menu.style.maxHeight'), '120px');
  app.run('window.visualViewport.height=1000;menuTop=200;fitFlowDidMenu()');
  assert.equal(app.run('menu.style.maxHeight'), '360px');
  app.run('menu.hidden=true;menuTop=700;fitFlowDidMenu()');
  assert.equal(app.run('menu.style.maxHeight'), '360px');
});
