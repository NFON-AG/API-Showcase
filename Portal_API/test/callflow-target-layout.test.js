const test = require('node:test');
const assert = require('node:assert/strict');
const { clientRenderer } = require('./helpers/client-render.cjs');

function fixture({ count = 8, x = 509, y = 342, obstacle = false, saved = null, second = false } = {}) {
  const ui = clientRenderer('en');
  const queue = { id: 'queue', type: 'QUEUE', title: 'Queue', x: x / 1320 * 100, y: y / 820 * 100,
    config: { portalMode: 'existing', ...(saved ? { memberLayouts: { '100': saved } } : {}) },
    memberTargets: Array.from({ length: count }, (_, i) => ({ number: String(100 + i), name: `Target ${i + 1}` })) };
  const nodes = [{ id: 'inbound', type: 'DID', title: 'Incoming', locked: true, x: 299 / 1320 * 100, y: 66 / 820 * 100 }, queue];
  if (obstacle) nodes.push({ id: 'obstacle', type: 'PHONEEXTENSION', title: 'Existing target', targetNumber: '999', x: 850 / 1320 * 100, y: 350 / 820 * 100, floating: true });
  if (second) nodes.push({ ...queue, id: 'skill', type: 'SKILL', title: 'Skill', y: (y + 250) / 820 * 100, floating: true, config: { portalMode: 'existing' } });
  ui.evaluate(`state.flow={nodes:${JSON.stringify(nodes)},edges:[{from:'inbound',to:'queue'}]};
    state.expandedServiceNodeIds=['queue'${second ? ", 'skill'" : ''}];
    document.querySelector=()=>null;
    document.querySelectorAll=()=>state.flow.nodes.map(n=>({dataset:{nodeId:n.id},offsetWidth:230,offsetHeight:n.id==='inbound'?161:223}));`);
  const graph = () => JSON.parse(ui.evaluate(`JSON.stringify(buildVisibleFlowGraph(state.flow).nodes.map(n=>({...n,px:n.x/100*1320,py:n.y/100*820})))`));
  return { ui, graph };
}
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < .01, `${actual} != ${expected}`); }
function noOverlap(nodes) {
  const boxes = nodes.map(n => ({ ...n, w: 230, h: n.memberNode ? 128 : n.id === 'inbound' ? 161 : 223 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    assert.ok(!(a.px < b.px + b.w && a.px + a.w > b.px && a.py < b.py + b.h && a.py + a.h > b.py), `${a.id} overlaps ${b.id}`);
  }
}
test('eight targets form symmetric banks around their service with four aligned rows', () => {
  const f = fixture(), all = f.graph(), targets = all.filter(n => n.memberNode);
  assert.equal(targets.length, 8);
  assert.equal(new Set(targets.map(n => n.px.toFixed(3))).size, 2);
  assert.equal(new Set(targets.map(n => n.py.toFixed(3))).size, 4);
  for (let i = 0; i < 8; i += 2) {
    close(targets[i].py, targets[i + 1].py);
    close((targets[i].px + targets[i + 1].px + 230) / 2, 509 + 115);
    assert.ok(targets[i].px + 230 < 509);
    assert.ok(targets[i + 1].px > 509 + 230);
  }
  for (let i = 2; i < 8; i += 2) close(targets[i].py - targets[i - 2].py, 160);
  close((targets[0].py + targets[7].py + 128) / 2, 342 + 223 / 2);
  noOverlap(all);
  assert.deepEqual(f.graph(), all, 'repeated expansion keeps the same positions');
});
test('odd target count balances both banks; top boundary preserves all distinct rows', () => {
  const f = fixture({ count: 5, y: 28 }), targets = f.graph().filter(n => n.memberNode);
  close(targets[4].px, targets[0].px);
  assert.ok(targets[0].py >= 28);
  close(targets[2].py - targets[0].py, 160);
  close(targets[4].py - targets[2].py, 160);
  noOverlap(targets);
});
test('tight space uses one ordered right-hand column instead of scattering targets', () => {
  const before = fixture().graph().filter(n => n.memberNode);
  const all = fixture({ obstacle: true }).graph(), after = all.filter(n => n.memberNode);
  assert.ok(after[0].px > before[0].px);
  assert.equal(new Set(after.map(n => n.px.toFixed(3))).size, 1);
  after.slice(1).forEach((n, i) => close(n.py - after[i].py, 160));
  noOverlap(all);
});
for (const sourceX of [509, 290]) test(`target connections avoid other cards with service at x=${sourceX}`, () => {
  const f = fixture({ x: sourceX }), all = f.graph(), targets = all.filter(n => n.memberNode);
  const parent = { x: sourceX, y: 342, width: 230, height: 223, centerX: sourceX + 115, centerY: 453.5 };
  for (const target of targets) {
    const box = { x: target.px, y: target.py, width: 230, height: 128, centerX: target.px + 115, centerY: target.py + 64 };
    const edge = JSON.parse(f.ui.evaluate(`JSON.stringify(buildVisibleFlowGraph(state.flow).edges.find(edge=>edge.to===${JSON.stringify(target.id)}))`));
    const curve = JSON.parse(f.ui.evaluate(`JSON.stringify(flowConnectionCurve(${JSON.stringify(parent)},${JSON.stringify(box)},${JSON.stringify(edge.memberSidePorts ?? edge.virtual)}))`));
    for (let i = 1; i < 200; i++) {
      const t = i / 200, u = 1 - t;
      const x = u*u*u*curve.fromPoint.x + 3*u*u*t*curve.c1.x + 3*u*t*t*curve.c2.x + t*t*t*curve.toPoint.x;
      const y = u*u*u*curve.fromPoint.y + 3*u*u*t*curve.c1.y + 3*u*t*t*curve.c2.y + t*t*t*curve.toPoint.y;
      for (const other of targets.filter(n => n.id !== target.id)) assert.ok(!(x > other.px && x < other.px + 230 && y > other.py && y < other.py + 128), `${target.id} crosses ${other.id}`);
    }
  }
});
test('actual eight-target geometry keeps every member connection clear of the incoming-call card', () => {
  const f = fixture({ x: 508.7109375, y: 342.1015625 });
  f.ui.evaluate('state.flow.nodes[0].x=299.021/1320*100;state.flow.nodes[0].y=66.4968/820*100;');
  const all = f.graph();
  const boxes = all.map(n => ({ ...n, x: n.px, y: n.py, width: 230, height: n.memberNode ? 127 : n.id === 'inbound' ? 161 : 223,
    centerX: n.px + 115, centerY: n.py + (n.memberNode ? 127 : n.id === 'inbound' ? 161 : 223) / 2 }));
  const from = boxes.find(n => n.id === 'queue');
  for (const target of boxes.filter(n => n.memberNode)) {
    const edge = JSON.parse(f.ui.evaluate(`JSON.stringify(buildVisibleFlowGraph(state.flow).edges.find(edge=>edge.to===${JSON.stringify(target.id)}))`));
    const curve = JSON.parse(f.ui.evaluate(`JSON.stringify(flowConnectionCurve(${JSON.stringify(from)},${JSON.stringify(target)},${JSON.stringify(edge.memberSidePorts ?? edge.virtual)}))`));
    for (let i = 1; i < 400; i++) {
      const t=i/400,u=1-t;
      const x=u*u*u*curve.fromPoint.x+3*u*u*t*curve.c1.x+3*u*t*t*curve.c2.x+t*t*t*curve.toPoint.x;
      const y=u*u*u*curve.fromPoint.y+3*u*u*t*curve.c1.y+3*u*t*t*curve.c2.y+t*t*t*curve.toPoint.y;
      for (const other of boxes.filter(n=>n.id!==target.id&&n.id!=='queue')) assert.ok(!(x>other.x&&x<other.x+other.width&&y>other.y&&y<other.y+other.height), `${target.id} crosses ${other.id}`);
    }
  }
});
test('manually positioned targets directly above or below keep the normal vertical connection', () => {
  const f = fixture(), from = { x: 500, y: 400, width: 230, height: 223, centerX: 615, centerY: 511.5 };
  for (const y of [100, 800]) {
    const to = { x: 520, y, width: 230, height: 128, centerX: 635, centerY: y + 64 };
    const expression = `flowConnectionCurve(${JSON.stringify(from)},${JSON.stringify(to)}`;
    assert.deepEqual(JSON.parse(f.ui.evaluate(`JSON.stringify(${expression},true))`)), JSON.parse(f.ui.evaluate(`JSON.stringify(${expression}))`)));
  }
});
test('explicitly moved target positions survive while other service blocks remain separate', () => {
  const saved = { x: 200, y: 150 }, f = fixture({ saved, second: true }), all = f.graph();
  const moved = all.find(n => n.id === 'queue-member-100');
  assert.deepEqual({ x: moved.x, y: moved.y }, saved);
  assert.equal(all.filter(n => n.memberNode).length, 16);
  noOverlap(all);
});
