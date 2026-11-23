const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "i18n-messages.json"), "utf8"));
const clients = ["public/app.js", "../docs/portal/app.js"];

function frontend(file, language = "en") {
  const storage = new Map();
  const listeners = new Map();
  const context = vm.createContext({
    window: { NFON_WEB_ONLY_DEMO: file.startsWith("../docs/"), location: { hash: "" }, addEventListener() {}, NFON_I18N: { getLanguage: () => language, message: (key, params = {}) => (catalog[key]?.[language] || "").replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match) } },
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]) },
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    Date, Intl, URL, console,
  });
  const source = fs.readFileSync(path.join(root, file), "utf8");
  vm.runInContext(source.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ""), context);
  const run = code => vm.runInContext(code, context);
  // The rendering boundary still executes the real graph rebuild. Storage remains real (in memory).
  run(`renderCallflow=()=>buildVisibleFlowGraph(state.flow);render=()=>buildVisibleFlowGraph(state.flow);renderFlowHelper=()=>{};
    state.loading=false;state.overview={account:"TEST",settings:{configured:true},inventory:{trunks:[{id:"/api/customers/TEST/trunks/10",name:"fixture-trunk"}],dids:[{id:"did",trunkNumber:"fixture-trunk",name:"+4912340",href:"/api/customers/TEST/trunks/10/inbound-trunk-numbers/100",trunkHref:"/api/customers/TEST/trunks/10",didExtension:"0",destinationType:"PHONEEXTENSION",destinationExtension:"201"}]}};state.selectedDidId="did";`);
  const dispatch = (name, event) => (listeners.get(name) || []).forEach(callback => callback(event));
  return { run, context, storage, dispatch, setLanguage(value) { const previousLanguage = language; language = value; dispatch("nfon:language-change", { detail: { language, previousLanguage } }); } };
}

for (const file of clients) {
  test(`${file}: direct routing validation uses the connected target independently of canvas selection`, () => {
    for (const selectedNodeId of ["connected", "inbound", "", "unrelated"]) {
      const app = frontend(file);
      app.context.selectedNodeId = selectedNodeId;
      app.run(`state.flow={nodes:[
        {id:"inbound",type:"DID",title:"Incoming call",locked:true},
        {id:"connected",type:"PHONEEXTENSION",title:"Connected extension",targetNumber:"202",routeNumber:"202"},
        {id:"unrelated",type:"PHONEEXTENSION",title:"Unrelated extension",targetNumber:"203",routeNumber:"203",floating:true}
      ],edges:[{from:"inbound",to:"connected"}]};state.selectedNodeId=selectedNodeId;buildVisibleFlowGraph(state.flow);`);
      const label = `selected=${selectedNodeId || "none"}`;
      assert.equal(app.run("flowStartNode().id"), "connected", label);
      assert.equal(app.run("validateFlowDetails().ok"), true, label);
      assert.equal(app.run("validateFlowDetails().liveCapable"), true, label);
      app.run("stageFlowPlan({silent:true})");
      assert.equal(app.run("state.actionPlan.ok"), true, label);
      assert.equal(app.run("state.actionPlan.applyPayload.target.title"), "Connected extension", label);
      assert.equal(app.run("state.actionPlan.applyPayload.target.number"), "202", label);
      assert.equal(app.run("state.actionPlan.applyPayload.target.routeNumber"), "202", label);
      app.run("state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);state.selectedNodeId='';buildVisibleFlowGraph(state.flow);stageFlowPlan({silent:true})");
      assert.equal(app.run("state.actionPlan.ok"), true, `${label}: saved draft reload`);
      assert.equal(app.run("state.actionPlan.applyPayload.target.number"), "202", `${label}: saved draft reload`);
    }
  });

  test(`${file}: a missing incoming route is invalid even when a target is selected or marked as a legacy target`, () => {
    for (const legacyTarget of [false, true]) for (const selectedNodeId of ["detached", "inbound", ""]) {
      const app = frontend(file);
      app.context.legacyTarget = legacyTarget;
      app.context.selectedNodeId = selectedNodeId;
      app.run(`state.flow={nodes:[
        {id:"inbound",type:"DID",title:"Incoming call",locked:true},
        {id:"detached",type:"PHONEEXTENSION",title:"Detached extension",targetNumber:"203",routeNumber:"203",floating:true,isTarget:legacyTarget}
      ],edges:[]};state.selectedNodeId=selectedNodeId;buildVisibleFlowGraph(state.flow);`);
      const label = `legacyTarget=${legacyTarget}, selected=${selectedNodeId || "none"}`;
      assert.equal(app.run("flowStartNode()"), null, label);
      assert.equal(app.run("validateFlowDetails().ok"), false, label);
      assert.equal(app.run("validateFlowDetails().liveCapable"), false, label);
      app.run("stageFlowPlan({silent:true})");
      assert.equal(app.run("state.actionPlan.ok"), false, label);
      assert.equal(app.run("state.actionPlan.applyPayload"), null, label);
    }
  });

  test(`${file}: a detached complex step cannot replace a missing incoming route`, () => {
    for (const type of ["IVR", "TIMECONTROL", "QUEUE", "HANGUP"]) {
      const app = frontend(file);
      app.context.stepType = type;
      app.run(`state.flow={nodes:[
        {id:"inbound",type:"DID",title:"Incoming call",locked:true},
        {id:"detached",type:stepType,title:"Detached step",routeNumber:"500",floating:true,config:{portalMode:"existing",ivrKeys:[]}}
      ],edges:[]};state.selectedNodeId="detached";buildVisibleFlowGraph(state.flow);stageFlowPlan({silent:true});`);
      assert.equal(app.run("state.actionPlan.ok"), false, type);
      assert.equal(app.run("state.actionPlan.applyPayload"), null, type);
      assert.equal(app.run("validateFlowDetails().liveCapable"), false, type);
    }
  });
}

for (const file of clients) {
  test(`${file}: routing preview follows start edges and a direct connection replaces its predecessor`, () => {
    const app = frontend(file);
    app.run(`state.flow={nodes:[{id:"old",type:"PHONEEXTENSION",title:"Original",targetNumber:"201",isTarget:true},{id:"inbound",type:"DID",locked:true,title:"Incoming call"},{id:"new",type:"TIMECONTROL",title:"Unconnected time control",floating:true,config:{portalMode:"new",hours:"Mon-Fri 09:00-18:00"}}],edges:[{from:"inbound",to:"old"}]};`);
    assert.equal(app.run("flowStartNode().id"), "old");
    assert.equal(app.run("currentDraftTarget()"), "Original");
    app.run('connectFlowNodes("inbound","new")');
    assert.deepEqual(JSON.parse(app.run('JSON.stringify(state.flow.edges.filter(edge=>edge.from==="inbound").map(edge=>edge.to))')), ["new"]);
    assert.match(app.run("currentDraftTarget()"), /^Unconnected time control: inside/);
    app.run('state.flow.nodes.push({id:"a",type:"PHONEEXTENSION",title:"Alpha",targetNumber:"202",floating:true},{id:"b",type:"PHONEEXTENSION",title:"Beta",targetNumber:"203",floating:true});connectFlowNodes("new","a");connectFlowNodes("new","b");');
    assert.deepEqual(JSON.parse(app.run('JSON.stringify(state.flow.edges.filter(edge=>edge.from==="new").map(edge=>[edge.branchField,edge.to]))')), [["openTarget","a"],["closedTarget","b"]]);
    app.run('state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);materializeBranchNodes(state.flow)');
    assert.equal(app.run("flowStartNode().id"), "new");
    assert.match(app.run("currentDraftTarget()"), /inside Alpha \/ outside Beta/);
  });

  test(`${file}: nested target changes, removals and IVR keys survive rebuild and saved draft reload`, () => {
    const app = frontend(file);
    app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"menu",type:"IVR",title:"Menu",config:{portalMode:"new",ivrKeys:["1"]}}],edges:[{from:"inbound",to:"menu"}]};materializeBranchNodes(state.flow);state.selectedNodeId="menu-key1Target";updateNodeField("type","TIMECONTROL");
      updateNodeTargetConfig("openTarget",JSON.stringify({type:"PHONEEXTENSION",title:"Alpha",targetNumber:"201",routeNumber:"201"}));updateNodeConfigWithoutHelperRender("hours","Mon-Fri 09:00-18:00");updateNodeTargetConfig("openTarget",JSON.stringify({type:"PHONEEXTENSION",title:"Beta",targetNumber:"202",routeNumber:"202"}));`);
    assert.equal(app.run('branchTargetNode(selectedNode(),"openTarget").title'), "Beta");
    app.run('state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);materializeBranchNodes(state.flow)');
    assert.equal(app.run('branchTargetNode(selectedNode(),"openTarget").title'), "Beta");
    app.run('updateNodeTargetConfig("openTarget","")');
    assert.equal(app.run('isMissingFlowNode(branchTargetNode(selectedNode(),"openTarget"))'), true);
    app.run('updateNodeField("type","IVR");addIvrKey(state.selectedNodeId)');
    assert.deepEqual(JSON.parse(app.run('JSON.stringify(ivrKeyNumbers(selectedNode()))')), ["1","2","3"]);
    app.run('updateNodeTargetConfig("key3Target","");state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);materializeBranchNodes(state.flow)');
    assert.deepEqual(JSON.parse(app.run('JSON.stringify(ivrKeyNumbers(selectedNode()))')), ["1","2"]);
  });
}

function offlineServer() {
  const requests = [];
  const source = fs.readFileSync(path.join(root, "src/server.js"), "utf8");
  const context = vm.createContext({
    require(name) {
      if (name === "./messages.cjs") return require("../src/messages.cjs");
      if (name === "./server-safety.cjs") return require("../src/server-safety.cjs");
      if (name === "fs") return { ...fs, existsSync: () => false, readFileSync: () => { throw Error("Server test must not read local configuration"); } };
      return require(name);
    },
    process: { cwd: () => "/offline-portal-test", env: { PORTAL_BASE_URL: "https://offline.invalid", PORTAL_API_KEY_ID: "fixture-key", PORTAL_API_KEY_SECRET: "fixture-secret", PORTAL_CUSTOMER_ACCOUNT: "TEST", PORTAL_ENABLE_LIVE_WRITES: "true" } },
    fetch: async (url, options) => {
      assert.equal(url.hostname, "offline.invalid");
      requests.push({ path: url.pathname, method: options.method, body: options.body ? JSON.parse(options.body) : null });
      if (options.method === "GET") {
        const inventory = vm.runInContext("cache.overview.inventory", context);
        let items = [];
        if (url.pathname.endsWith("/dids")) items = [{href:"/api/customers/TEST/dids/100",didNumber:"+4912340",destinationType:"PHONEEXTENSION",destinationExtensionNumber:"201"}];
        else if (url.pathname.endsWith("/announcements")) items = inventory.announcements || [];
        else if (url.pathname.endsWith("/targets/ivr-services")) items = inventory.ivrs || [];
        return new Response(JSON.stringify({items,total:items.length,size:items.length,links:[]}), {status:200,headers:{"content-type":"application/json"}});
      }
      return new Response(options.method === "DELETE" ? null : "{}", { status: options.method === "DELETE" ? 204 : 200, headers: { "content-type": "application/json" } });
    },
    Buffer, URL, Date, console, AbortSignal,
  });
  // Execute every real server function without starting a listener or running filesystem repair.
  vm.runInContext(source.slice(0, source.indexOf("const server = http.createServer")), context);
  const run = code => vm.runInContext(code, context);
  // These function-level apply tests start after the session's explicit opt-in.
  run('runtimeSettings.liveWritesEnabled=true');
  run('cache.overview={inventory:{ivrs:[{serviceNumber:"999",extensionNumber:"999",name:"Untouched IVR",href:"/api/customers/TEST/targets/ivr-services/999"}],extensions:[],dids:[],queues:[],skills:[],timeControls:[]}};');
  return { run, context, requests };
}

test("real client plan and server preview/apply agree on the connected root; detached drafts cannot cause writes", async () => {
  for (const file of clients) {
    const app = frontend(file);
    app.run(`state.flow={nodes:[{id:"detached",type:"IVR",title:"Edited but detached IVR",routeNumber:"999",targetNumber:"999",floating:true,config:{portalMode:"existing"}},{id:"inbound",type:"DID",locked:true},{id:"connected",type:"PHONEEXTENSION",title:"Connected extension",targetNumber:"202",routeNumber:"202",isTarget:true}],edges:[{from:"inbound",to:"connected"}]};stageFlowPlan({silent:true});`);
    const payload = JSON.parse(app.run('JSON.stringify(state.actionPlan.applyPayload)'));
    assert.equal(payload.target.title, "Connected extension");
    const server = offlineServer();
    server.context.payload = payload;
    const plan = await server.run('applyCallflowChange(payload)');
    assert.equal(plan.target.title, "Connected extension");
    assert.equal(plan.target.routeNumber, "202");
    assert.equal(server.requests.length, 0);
    const applied = await server.run('applyCallflowChange({...payload,commit:true})');
    assert.equal(applied.applied, true);
    assert.equal(applied.target.routeNumber, "202");
    const writes = server.requests.filter(request => request.method !== "GET");
    assert.deepEqual(writes.map(request => request.method), ["PUT"]);
    assert.ok(writes[0].path.endsWith("/dids/100/destination"));
    assert.ok(writes[0].body.links.some(link => link.rel === "destination" && link.href.endsWith("/phone-extensions/202")));
    assert.ok(!writes.some(request => request.path.includes("999")));

  }
});

test("server resolves a legacy trunk start and rejects a disconnected incoming node", async () => {
  const server = offlineServer();
  assert.equal(server.run('getFlowStartNode({nodes:[{id:"wrong",type:"HANGUP",floating:true},{id:"inbound",type:"DID",locked:true},{id:"trunk",type:"TRUNK",locked:true},{id:"right",type:"PHONEEXTENSION"}],edges:[{from:"inbound",to:"trunk"},{from:"trunk",to:"right"}]}).id'), "right");
  server.context.payload = { did: {name:"+4912340"}, flow:{nodes:[{id:"inbound",type:"DID",locked:true},{id:"floating",type:"IVR",floating:true}],edges:[]} };
  await assert.rejects(server.run('applyCallflowChange(payload)'), /keinen Start/);
  assert.equal(server.requests.length, 0);
});

function ambiguousFlow(kind, reverse = false) {
  const flow = {
    nodes: [{ id: "inbound", type: "DID", locked: true }, { id: "a", type: "PHONEEXTENSION", title: "Alpha", targetNumber: "202", routeNumber: "202" }, { id: "b", type: "PHONEEXTENSION", title: "Beta", targetNumber: "203", routeNumber: "203" }],
    edges: [{ from: "inbound", to: "a" }, { from: "inbound", to: "b" }],
  };
  if (kind === "trunk") {
    flow.nodes.push({ id: "trunk", type: "TRUNK", locked: true });
    flow.edges = [{ from: "inbound", to: "trunk" }, { from: "trunk", to: "a" }, { from: "trunk", to: "b" }];
  } else if (kind === "duplicate") {
    flow.edges[1].to = "a";
  } else if (["ivr", "time", "direct"].includes(kind)) {
    const branchField = kind === "ivr" ? "key1Target" : kind === "time" ? "openTarget" : "";
    flow.nodes.push({ id: "step", type: kind === "ivr" ? "IVR" : kind === "time" ? "TIMECONTROL" : "PHONEEXTENSION", title: "Step", config: { portalMode: "new", hours: "Mon-Fri 09:00-18:00", ivrKeys: ["1"] } });
    flow.edges = [{ from: "inbound", to: "step" }, { from: "step", to: "a", branchField }, { from: "step", to: "b", branchField }];
  }
  if (reverse) flow.edges.reverse();
  return flow;
}

function conflictKey(kind) {
  return ["ivr", "time"].includes(kind) ? "portal.flowMultipleBranchTargets" : kind === "direct" ? "portal.flowMultipleDirectTargets" : "portal.flowMultipleStartConnections";
}

for (const file of clients) {
  test(`${file}: ambiguous saved drafts are rejected in both languages without resolving or dropping edges`, () => {
    for (const language of ["en", "de"]) for (const kind of ["start", "trunk", "duplicate", "ivr", "time", "direct"]) for (const reverse of [false, true]) {
      const app = frontend(file, language);
      const flow = ambiguousFlow(kind, reverse);
      app.context.fixture = flow;
      app.run("state.flow=clone(fixture)");
      const expected = catalog[conflictKey(kind)][language];
      assert.equal(app.run("flowStartNode()"), null, `${language}: ${kind}`);
      assert.equal(app.run("currentDraftTarget()"), expected);
      // The real reload/render path must not normalize away the conflicting draft first.
      app.run("buildVisibleFlowGraph(state.flow);stageFlowPlan({silent:true});state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);buildVisibleFlowGraph(state.flow)");
      assert.equal(app.run("state.actionPlan.ok"), false);
      assert.equal(app.run("state.actionPlan.applyPayload"), null);
      assert.equal(app.run("state.actionPlan.message"), expected);
      assert.deepEqual(JSON.parse(app.run("JSON.stringify(state.flow.edges)")), flow.edges);
    }
  });
}

const didFixture = { name: "+4912340", href: "/api/customers/TEST/trunks/10/inbound-trunk-numbers/100", trunkHref: "/api/customers/TEST/trunks/10", didExtension: "0", destinationType: "PHONEEXTENSION", destinationExtension: "201" };
const targetFixture = { type: "PHONEEXTENSION", title: "Alpha", number: "202", routeNumber: "202" };

test("server rejects ambiguous starts and repeated branches before any preview/apply request, independent of edge order", async () => {
  for (const kind of ["start", "trunk", "duplicate", "ivr", "time", "direct"]) for (const reverse of [false, true]) for (const commit of [false, true]) {
    const server = offlineServer();
    server.context.payload = { did: didFixture, target: targetFixture, flow: ambiguousFlow(kind, reverse), commit };
    await assert.rejects(server.run("applyCallflowChange(payload)"), error => error.status === 400 && error.message === catalog[conflictKey(kind)].de);
    assert.equal(server.requests.length, 0, `${kind}: commit=${commit}, reverse=${reverse}`);
  }
});

test("batch callflow planning rejects an ambiguous later draft before writing any earlier valid change", async () => {
  for (const commit of [false, true]) {
    const server = offlineServer();
    server.context.payload = { commit, changes: [
      { did: didFixture, target: targetFixture },
      { did: didFixture, target: targetFixture, flow: ambiguousFlow("start") },
    ] };
    await assert.rejects(server.run("applyBulkCallflowChange(payload)"), error => error.status === 400 && error.message === catalog[conflictKey("start")].de);
    assert.equal(server.requests.length, 0);
  }
});

function distinctBranchFlow() {
  return {
    nodes: [
      { id: "inbound", type: "DID", locked: true },
      { id: "time", type: "TIMECONTROL", title: "Test hours", config: { portalMode: "new", hours: "Mon-Fri 09:00-18:00" } },
      { id: "menu", type: "IVR", title: "Test menu", config: { portalMode: "new", ivrKeys: ["1", "2"], announcement: "Test announcement" } },
      { id: "queue", type: "QUEUE", title: "Test queue", routeNumber: "501", config: { portalMode: "existing", members: ["202", "203"] } },
      { id: "a", type: "PHONEEXTENSION", title: "Alpha", targetNumber: "202", routeNumber: "202" },
      { id: "b", type: "PHONEEXTENSION", title: "Beta", targetNumber: "203", routeNumber: "203" },
    ],
    edges: [
      { from: "inbound", to: "time" },
      { from: "time", to: "menu", branchField: "openTarget" },
      { from: "time", to: "b", branchField: "closedTarget" },
      { from: "menu", to: "queue", branchField: "key1Target" },
      { from: "menu", to: "a", branchField: "key2Target" },
      { from: "menu", to: "b", branchField: "timeoutTarget" },
      { from: "queue", to: "a", virtual: true },
      { from: "queue", to: "b", virtual: true },
    ],
  };
}

test("distinct nested time/IVR branches and virtual service memberships keep their routing payloads", async () => {
  for (const file of clients) {
    const app = frontend(file);
    app.context.fixture = distinctBranchFlow();
    app.run("state.flow=clone(fixture);stageFlowPlan({silent:true})");
    assert.equal(app.run("state.actionPlan.ok"), true);
    assert.equal(app.run("flowRoutingConflicts(state.flow).length"), 0);
    assert.deepEqual(JSON.parse(app.run('JSON.stringify(state.flow.nodes.find(node=>node.id==="queue").config.members)')), ["202", "203"]);
    assert.deepEqual(JSON.parse(app.run("JSON.stringify(state.flow.edges.map(({from,to,branchField,virtual})=>({from,to,branchField,virtual})))")), distinctBranchFlow().edges);
  }
  for (const commit of [false, true]) {
    const server = offlineServer();
    server.run('cache.overview.inventory.announcements=[{name:"Test announcement",href:"/api/customers/TEST/announcements/800"}]');
    server.context.payload = { did: didFixture, target: targetFixture, flow: distinctBranchFlow(), commit };
    const result = await server.run("applyCallflowChange(payload)");
    assert.equal(result.ok, true);
    if (!commit) {
      assert.equal(server.requests.length, 0);
      continue;
    }
    assert.equal(result.applied, true);
    const keyWrites = server.requests.filter(request => request.method === "POST" && request.path.endsWith("/key-assignments"));
    assert.deepEqual(keyWrites.map(request => [request.body.data[0].value, request.body.links[0].href]), [
      ["1", "/api/customers/TEST/targets/queue-services/501"],
      ["2", "/api/customers/TEST/targets/phone-extensions/202"],
    ]);
    const timeWrite = server.requests.find(request => request.path.endsWith("/time-control-services") && request.method === "POST");
    assert.ok(timeWrite.body.links.find(link => link.rel === "destinationIfAllowed").href.includes("/ivr-services/"));
    assert.equal(timeWrite.body.links.find(link => link.rel === "destinationIfDenied").href, "/api/customers/TEST/targets/phone-extensions/203");
    assert.ok(!server.requests.some(request => request.path.includes("/members")));
  }
});


for (const file of clients) {
  test(`${file}: correcting a connection invalidates the old failed plan immediately`, () => {
    const app = frontend(file);
    app.context.fixture = ambiguousFlow("start");
    app.run('state.flow=clone(fixture);stageFlowPlan({silent:true})');
    assert.equal(app.run("state.actionPlan.ok"), false);
    app.run('connectFlowNodes("inbound","b")');
    assert.equal(app.run("flowStartNode().id"), "b");
    assert.equal(app.run("validateFlowDetails().ok"), true);
    assert.equal(app.run("state.actionPlan"), null);
    assert.equal(app.run("state.flowFeedback"), null);
  });
}

for (const file of clients) {
  test(`${file}: assigning the first nested IVR key keeps offered empty keys and respects explicit deletions`, () => {
    const app = frontend(file);
    app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"hours",type:"TIMECONTROL",title:"Hours",config:{portalMode:"new",hours:"Mon-Fri 09:00-18:00"}}],edges:[{from:"inbound",to:"hours"}]};materializeBranchNodes(state.flow);state.selectedNodeId="hours-openTarget";updateNodeField("type","IVR");updateNodeConfig("portalMode","new");updateNodeConfig("announcement","Test announcement")`);
    assert.deepEqual(JSON.parse(app.run("JSON.stringify(ivrKeyNumbers(selectedNode()))")), ["1", "2"]);
    app.run('updateNodeTargetConfig("key1Target",JSON.stringify({type:"PHONEEXTENSION",title:"Alpha",targetNumber:"201",routeNumber:"201"}))');
    assert.deepEqual(JSON.parse(app.run("JSON.stringify(ivrKeyNumbers(selectedNode()))")), ["1", "2"]);
    assert.equal(app.run('isMissingFlowNode(branchTargetNode(selectedNode(),"key2Target"))'), true);
    assert.ok(app.run('branchTargetNode(selectedNode(),"key2Target")'));
    app.run('state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);buildVisibleFlowGraph(state.flow)');
    assert.deepEqual(JSON.parse(app.run("JSON.stringify(ivrKeyNumbers(selectedNode()))")), ["1", "2"]);
    app.run('addIvrKey(state.selectedNodeId);updateNodeTargetConfig("key2Target","")');
    assert.deepEqual(JSON.parse(app.run("JSON.stringify(ivrKeyNumbers(selectedNode()))")), ["1", "3"]);
    app.run('updateNodeTargetConfig("key1Target","");updateNodeTargetConfig("key3Target","");updateNodeConfig("announcement","Replacement announcement");state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);buildVisibleFlowGraph(state.flow)');
    assert.deepEqual(JSON.parse(app.run("JSON.stringify(ivrKeyNumbers(selectedNode()))")), []);
    assert.equal(app.run('state.flow.edges.some(edge=>edge.from===state.selectedNodeId && /^key/.test(edge.branchField||""))'), false);
  });
}

for (const file of clients) {
  test(`${file}: a nested new time control with a hangup child remains the selected IVR target`, () => {
    const app = frontend(file);
    app.run(`state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"hours",type:"TIMECONTROL",title:"Hours",config:{portalMode:"new",hours:"Mon-Fri 09:00-18:00"}}],edges:[{from:"inbound",to:"hours"}]};materializeBranchNodes(state.flow);state.selectedNodeId="hours-openTarget";updateNodeField("type","IVR");updateNodeConfig("announcement","Test announcement");addIvrKey(state.selectedNodeId);state.selectedNodeId="hours-openTarget-key3Target";updateNodeField("type","TIMECONTROL");updateNodeField("title","Nested hours");updateNodeConfig("hours","Mo-Fr 09:00-18:00");updateNodeTargetConfig("openTarget",JSON.stringify({type:"PHONEEXTENSION",title:"Alpha",targetNumber:"203",routeNumber:"203"}));updateNodeTargetConfig("closedTarget",JSON.stringify({type:"HANGUP",title:"Hang up"}));state.flow=clone(readStoredFlowDrafts()[flowDraftKey()].flow);buildVisibleFlowGraph(state.flow);state.selectedNodeId="hours-openTarget";`);
    const html = app.run('renderResourceNodeConfiguration(selectedNode(),"IVR")');
    const select = html.match(/<select\b[^>]*data-node-target-config="key3Target"[^>]*>([\s\S]*?)<\/select>/)?.[1];
    assert.ok(select);
    const selected = [...select.matchAll(/<option\b[^>]*value="([^"]*)"[^>]*\sselected(?:\s|>)[\s\S]*?<\/option>/g)];
    assert.equal(selected.length, 1);
    const value = selected[0][1].replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
    const target = JSON.parse(value);
    assert.equal(target.type, "TIMECONTROL");
    assert.equal(target.title, "Nested hours");
    assert.equal(target.config.hours, "Mo-Fr 09:00-18:00");
    assert.equal(target.config.openTarget.targetNumber, "203");
    assert.equal(target.config.closedTarget.type, "HANGUP");
    app.context.selectedValue = value;
    app.run('updateNodeTargetConfig("key3Target",selectedValue)');
    assert.equal(app.run('branchTargetNode(selectedNode(),"key3Target").type'), "TIMECONTROL");
    assert.equal(app.run('branchTargetNode(branchTargetNode(selectedNode(),"key3Target"),"closedTarget").type'), "HANGUP");
    assert.equal(app.run('targetOptionSelected(JSON.stringify({type:"TIMECONTROL",title:"Other draft"}),selectedValue)'), false);
    assert.equal(app.run('targetOptionSelected(JSON.stringify({type:"HANGUP",title:"Hang up"}),JSON.stringify({type:"HANGUP",title:"Auflegen"}))'), true);
  });
}

function planUi(app) {
  const classes = new Set();
  const panel = { innerHTML: "", classList: { add: value => classes.add(value), remove: value => classes.delete(value), contains: value => classes.has(value) } };
  const feedback = { innerHTML: "", className: "" };
  app.context.document.querySelector = selector => selector === "#flow-plan-panel" ? panel : selector === "#flow-feedback" ? feedback : null;
  return { panel, feedback };
}

for (const file of clients) {
  test(`${file}: selecting an existing target after failed Apply clears obsolete feedback and technical details`, async () => {
    const app = frontend(file);
    const ui = planUi(app);
    app.run('state.view="callflow";state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"step",type:"PLACEHOLDER",title:"New step",missing:true}],edges:[{from:"inbound",to:"step"}]};state.selectedNodeId="step";showUiNotice=()=>{}');
    await app.run("stageAndApplyFlowPlan()");
    assert.equal(app.run("state.actionPlan.ok"), false);
    assert.ok(ui.panel.classList.contains("is-open"));
    assert.match(ui.feedback.innerHTML, /Open path requires a step/);
    app.run('applyTargetSelection(JSON.stringify({type:"PHONEEXTENSION",title:"Beta",targetNumber:"202",routeNumber:"202"}))');
    assert.equal(app.run("validateFlowDetails().ok"), true);
    assert.equal(app.run("flowStartNode().targetNumber"), "202");
    assert.equal(app.run("state.actionPlan"), null);
    assert.equal(app.run("state.flowFeedback"), null);
    assert.equal(ui.panel.classList.contains("is-open"), false);
    assert.equal(ui.panel.innerHTML, "");
    assert.doesNotMatch(ui.feedback.innerHTML, /Missing:|Open path requires a step/);
    assert.equal(ui.feedback.className, "flow-feedback is-ok");
  });

  test(`${file}: node, target and branch edits invalidate the previous validation plan consistently`, () => {
    const cases = [
      ["PLACEHOLDER", 'updateNodeField("type","TIMECONTROL")'],
      ["TIMECONTROL", 'updateNodeFieldWithoutHelperRender("title","Edited hours")'],
      ["TIMECONTROL", 'updateNodeConfig("portalMode","existing")'],
      ["TIMECONTROL", 'updateNodeConfig("hours","Mon-Fri 09:00-18:00")'],
      ["TIMECONTROL", 'updateNodeConfigWithoutHelperRender("hours","Mon-Fri 09:00-18:00")'],
      ["IVR", 'applyResourceTargetSelection(JSON.stringify({type:"IVR",title:"Existing menu",routeNumber:"501",targetNumber:"701"}))'],
      ["TIMECONTROL", 'updateNodeTargetConfig("openTarget",JSON.stringify({type:"PHONEEXTENSION",title:"Beta",targetNumber:"202",routeNumber:"202"}))'],
      ["IVR", 'updateNodeTargetConfig("key1Target","")'],
      ["IVR", 'addIvrKey("step")'],
      ["PLACEHOLDER", 'state.selectedNodeIds=["step"];applyBulkTargetSelection(JSON.stringify({type:"PHONEEXTENSION",title:"Beta",targetNumber:"202",routeNumber:"202"}))'],
      ["PLACEHOLDER", 'deleteSelectedNode()'],
    ];
    for (const [kind, mutation] of cases) {
      const app = frontend(file);
      const ui = planUi(app);
      app.context.stepKind = kind;
      app.run('state.view="callflow";state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"step",type:stepKind,title:"Test step",config:{portalMode:"new",ivrKeys:["1","2"]}}],edges:[{from:"inbound",to:"step"}]};state.selectedNodeId="step";materializeBranchNodes(state.flow);stageFlowPlan({silent:true});state.actionPlan.applyAttempted=true;renderFlowFeedback();renderFlowPlan()');
      assert.ok(ui.panel.classList.contains("is-open"), mutation);
      app.run(mutation);
      assert.equal(app.run("state.actionPlan"), null, mutation);
      assert.equal(app.run("state.flowFeedback"), null, mutation);
      assert.equal(ui.panel.innerHTML, "", mutation);
      assert.equal(ui.panel.classList.contains("is-open"), false, mutation);
    }
  });
}


for (const file of clients) {
  test(`${file}: plan invalidation leaves unrelated actions and presentation-only changes intact`, () => {
    const app = frontend(file);
    app.run('state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"step",type:"PHONEEXTENSION",title:"Alpha",targetNumber:"202",routeNumber:"202"}],edges:[{from:"inbound",to:"step"}]};state.selectedNodeId="step";stageFlowPlan({silent:true})');
    const plan = app.run("state.actionPlan");
    assert.equal(plan.ok, true);
    app.setLanguage("de");
    app.dispatch("nfon:theme-change", { detail: { theme: "classic", previousTheme: "admin-portal" } });
    assert.equal(app.run("state.actionPlan"), plan);
    app.run('state.actionPlan={context:"phonebook",title:"Independent phonebook preview",applyPayload:{marker:"keep"}}');
    const unrelatedPlan = app.run("state.actionPlan");
    app.run('updateNodeFieldWithoutHelperRender("title","Edited name")');
    assert.equal(app.run("state.actionPlan"), unrelatedPlan);
  });

  test(`${file}: successful Apply feedback remains visible after saving the applied snapshot`, async () => {
    const app = frontend(file);
    const ui = planUi(app);
    app.run('state.view="callflow";state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"step",type:"PHONEEXTENSION",title:"Alpha",targetNumber:"202",routeNumber:"202"}],edges:[{from:"inbound",to:"step"}]};state.selectedNodeId="step";render=()=>{buildVisibleFlowGraph(state.flow);renderFlowFeedback();renderFlowPlan()};stageFlowPlan({silent:true})');
    app.run(`state.overview.settings.liveWritesEnabled=true;confirmUi=async()=>true;showUiProgress=()=>({success(){},error(){}});loadOverview=async()=>{};fetchJson=async(url,options)=>{if(url!=="/api/callflow/apply")throw Error("Unexpected test request");if(JSON.parse(options.body).commit!==true)throw Error("Missing commit");return {ok:true,applied:true,title:"Callflow applied",message:"Synthetic apply succeeded",flow:clone(state.flow),target:{type:"PHONEEXTENSION",number:"202",routeNumber:"202"},appliedAt:new Date().toISOString()}}`);
    await app.run("applyFlowPlan()");
    assert.match(ui.feedback.innerHTML, /Synthetic apply succeeded/);
    assert.equal(app.run("state.actionPlan.applied"), true);
    assert.equal(app.run("state.flowFeedback.ok"), true);
    assert.equal(ui.feedback.className, "flow-feedback is-ok");
    assert.equal(app.run("Object.keys(readStoredFlowDrafts()).length"), 0);
  });
}


test('static service creation and Callflow Apply describe available local actions accurately',async()=>{
 const app=frontend('../docs/portal/app.js');planUi(app);
 const form=app.run('serviceCreateCardMarkup("queue")');assert.match(form,/Create locally/);assert.match(form,/changes are saved locally/);assert.doesNotMatch(form,/Live writes locked|unavailable in demo/);
 const html=fs.readFileSync(path.join(root,'../docs/portal/index.html'),'utf8');
 const callflow=html.slice(html.indexOf('id="view-callflow"'),html.indexOf('id="view-services"'));
 const applyControl=callflow.match(/<button\b[^>]*\bid="stage-flow"[^>]*>/)?.[0];
 assert.ok(applyControl,'The static Callflow toolbar must contain its real Apply control');assert.doesNotMatch(applyControl,/\s(?:disabled|hidden)(?:\s|=|>)/);
 const requests=[];app.context.fetch=(...args)=>{requests.push(args);throw Error('No request expected before confirmation');};
 app.run('state.view="callflow";state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"step",type:"PHONEEXTENSION",title:"Local target",targetNumber:"202",routeNumber:"202"}],edges:[{from:"inbound",to:"step"}]};state.selectedNodeId="step";stageFlowPlan({silent:true})');
 assert.equal(app.run('state.actionPlan.ok'),true);assert.equal(app.run('localApplyPermitted()'),true);
 const target={closest:selector=>selector==='#stage-flow'?target:null};
 app.dispatch('click',{target,preventDefault(){},stopPropagation(){}});
 assert.equal(app.run('uiDialog.open && uiDialog.showCancel'),true);
 const message=app.run('uiDialog.message');assert.match(message,/applied locally in the demo PBX/);assert.doesNotMatch(message,/live Portal API|Live changes require/);
 app.run('closeUiDialog(false)');await new Promise(resolve=>setImmediate(resolve));
 assert.equal(app.run('state.flowApplying'),false);assert.deepEqual(requests,[]);
});

for(const file of clients)test(`${file}: R2-15 target selection and palette insertion each retain an undo step`,()=>{
 const app=frontend(file);app.run('state.flow={nodes:[{id:"inbound",type:"DID",locked:true},{id:"target",type:"PHONEEXTENSION",title:"Original",targetNumber:"201",routeNumber:"201",isTarget:true}],edges:[{from:"inbound",to:"target"}]};state.selectedNodeId="target";');
 app.run('applyTargetSelection(JSON.stringify({type:"PHONEEXTENSION",title:"New",targetNumber:"202",routeNumber:"202"}))');assert.equal(app.run('state.flow.nodes.find(n=>n.id==="target").targetNumber'),'202');app.run('undoFlowChange()');assert.equal(app.run('state.flow.nodes.find(n=>n.id==="target").targetNumber'),'201');
 const count=app.run('state.flow.nodes.length');app.run('addPaletteNodeToCanvas({type:"PHONEEXTENSION",title:"Added",targetNumber:"203",routeNumber:"203"},{x:400,y:300})');assert.equal(app.run('state.flow.nodes.length'),count+1);app.run('undoFlowChange()');assert.equal(app.run('state.flow.nodes.length'),count);
});
