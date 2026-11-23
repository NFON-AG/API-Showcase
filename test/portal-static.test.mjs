import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const catalogContext = { window: {} };
vm.runInNewContext(readFileSync(new URL("../docs/portal/messages.js", import.meta.url), "utf8"), catalogContext);
const catalog = catalogContext.window.NFON_MESSAGES;
const runtime = readFileSync(new URL("../docs/demo-runtime.js", import.meta.url), "utf8");
const appSource = readFileSync(new URL("../docs/portal/app.js", import.meta.url), "utf8");

function createDemo(language = "en", storage = new Map()) {
  let externalFetches = 0;
  const window = {
    location: { href: "https://showcase.example/portal/index.html", pathname: "/portal/index.html", hash: "" },
    fetch: () => { externalFetches += 1; throw new Error("Unexpected external request"); },
    setTimeout() {}, clearInterval() {}, addEventListener() {},
    NFON_I18N: {
      getLanguage: () => language,
      message(key, params = {}) {
        const entry = catalog[key];
        assert.ok(entry, `Missing message: ${key}`);
        return (entry[language] || entry.en).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
      },
    },
  };
  const context = vm.createContext({
    window, URL, Response, EventTarget, Event, MessageEvent, Date, Intl, console,
    localStorage: { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    document: { readyState: "loading", body: {dataset:{nfonApp:"portal"}}, addEventListener() {}, getElementById: () => ({}), querySelector: () => null, querySelectorAll: () => [] },
    MutationObserver: class { observe() {} },
  });
  vm.runInContext(runtime, context);
  context.fetch = (...args) => window.fetch(...args);
  return {
    context, storage,
    async request(route, body) { const response = await window.fetch(route, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }); return { status: response.status, body: await response.json() }; },
    get externalFetches() { return externalFetches; },
    evaluate(code) { return vm.runInContext(code, context); },
    loadApp() { vm.runInContext(appSource.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);\s*$/, ""), context); },
  };
}

test("static Portal exposes a consistent local write context without enabling live writes", async () => {
  const demo = createDemo();
  const status = (await demo.request("/api/status")).body;
  const overview = (await demo.request("/api/overview")).body;
  assert.equal(typeof status.settings?.writeContext, "string");
  assert.ok(status.settings.writeContext.length > 0);
  assert.equal(status.settings.writeContext, overview.settings.writeContext);
  assert.equal(status.settings.account, overview.settings.account);
  assert.equal(status.settings.liveWritesEnabled, false);
  assert.equal(overview.settings.liveWritesEnabled, false);
  assert.equal((await demo.request("/api/settings/live-writes", {enabled:true})).body.enabled, false);
  assert.equal(demo.externalFetches, 0);
});

test("static Portal retains local service creation and membership edits", async () => {
  const demo = createDemo();
  const created = (await demo.request("/api/resources/queues", {displayName: "Warteschlange Team", extensionNumber: "509"})).body;
  assert.equal(created.item.name, "Warteschlange Team");
  assert.match(created.title, /Queue created locally/);
  const groups = (await demo.request('/api/service-groups')).body;
  const queue = groups.queues.find(item => item.id === '509');
  const payload = {account: groups.account, services: [{kind:'queue',serviceNumber:'509',baseRevision:queue.memberRevision,add:[{extensionNumber:'201',name:'Neue Nebenstelle'}],remove:[],update:[]}]};
  const result = (await demo.request('/api/service-groups/apply', payload)).body;
  assert.equal(result.title, "Demo memberships applied");
  assert.equal(result.serviceGroups.queues.find(item => item.id === "509").members[0].name, "Neue Nebenstelle");
  assert.equal((await demo.request('/api/service-groups/apply', payload)).status, 409, 'a stale draft cannot overwrite newer members');
  assert.equal(demo.externalFetches, 0);
});

test("static batch preview reports row validation in the UI contract without enabling apply", async () => {
  const demo = createDemo();
  const rows = [{extensionNumber:"299", displayName:"Warteschlange Team", mailboxPin:"123456"}, {extensionNumber:"201", displayName:"", mailboxPin:"x"}];
  const result = (await demo.request("/api/extensions/batch/plan", {rows})).body;
  assert.equal(result.ok, false);
  assert.deepEqual(result.summary, {total:2, valid:1, invalid:1, existing:8});
  assert.equal(result.entries[0].displayName, "Warteschlange Team");
  assert.ok(result.entries[1].errors.includes("Extension already exists"));
  const applied = (await demo.request("/api/extensions/batch/apply", {rows: rows.slice(0,1)})).body;
  assert.equal(applied.applied, false);
  assert.equal(applied.blocked, true);
  assert.equal((await demo.request("/api/overview")).body.inventory.extensions.length, 8);
});

test("static phonebook upload and preview preserve contacts and expose actual differences", async () => {
  const demo = createDemo();
  const contacts = [{name:"Neue Nebenstelle", phones:"+491234567"}, {name:"Warteschlange", phones:"+491234567"}];
  const upload = (await demo.request("/api/phonebook-sync/upload", {contacts, source:"contacts.json"})).body;
  assert.equal(upload.contacts, 2);
  assert.equal(upload.settings.configured, true);
  const preview = (await demo.request("/api/phonebook-sync/preview", {})).body;
  assert.equal(preview.type, "phonebook-sync");
  assert.equal(preview.summary.create, 1);
  assert.equal(preview.summary.duplicate, 1);
  assert.equal(preview.preview.google[0].contact, "Neue Nebenstelle");
  assert.equal(preview.preview.google[1].reason, "Duplicate phone number in the contact source");
  assert.equal((await demo.request("/api/phonebook-sync/apply", {})).body.applied, false);
  assert.equal((await demo.request("/api/phonebook-sync/upload", {contacts:[]})).status, 400);
});

test("static clone preview returns the submitted draft and keeps live writes disabled", async () => {
  const demo = createDemo();
  const result = (await demo.request("/api/demo/clone-extension", {extensionNumber:"299",displayName:"Anna copy",source:{number:"201"}})).body;
  assert.equal(result.dryRun, true);
  assert.equal(result.body.templateSource, "201");
  assert.equal(result.body.displayName, "Anna copy");
  assert.equal((await demo.request("/api/settings/live-writes", {enabled:true})).body.enabled, false);
});

test("static Portal retains v2 storage and local callflow apply", async () => {
  const demo = createDemo(); demo.loadApp();
  assert.equal(demo.evaluate("STATIC_STORAGE_VERSION"), "v2");
  assert.equal(demo.evaluate("localWritesEnabled()"), true);
  assert.equal(demo.evaluate("liveWritesEnabled()"), false);
  demo.evaluate(`state.overview={account:"DEMO",settings:{configured:true,account:"DEMO",liveWritesEnabled:false},inventory:{dids:[{id:"did-1",name:"did-1"}]}}; state.selectedDidId="did-1"; state.flow={nodes:[{id:"target",type:"HANGUP",title:"Hang up"}],edges:[]}; state.actionPlan={context:"callflow",applyPayload:{flow:state.flow}}; render=()=>{}; renderFlowFeedback=()=>{}; renderFlowPlan=()=>{}; loadOverview=async()=>{}; confirmUi=async()=>true; showUiProgress=()=>({success(){},error(){}});`);
  await demo.evaluate("applyFlowPlan()");
  assert.equal(demo.evaluate("state.actionPlan.applied"), true);
  assert.ok(Array.from(demo.storage.keys()).some(key => key === "nfon-portal-flow-applied-v2"));
  assert.equal(demo.externalFetches, 0);
});

test("static Portal includes appearance and message assets with portable paths", () => {
  const html = readFileSync(new URL("../docs/portal/index.html", import.meta.url), "utf8");
  assert.match(html, /src="\.\.\/appearance\.js(?:\?[^\"]*)?"/);
  assert.match(html, /href="\.\.\/appearance\.css(?:\?[^\"]*)?"/);
  assert.match(html, /data-appearance-settings/);
  assert.ok(html.indexOf("./messages.js") < html.indexOf("../i18n.js"));
  assert.ok(html.indexOf("../i18n.js") < html.indexOf("../demo-runtime.js"));
});


test("static callflow apply survives reload and updates the incoming number routing", async () => {
  for (const language of ["en", "de"]) {
    const demo = createDemo(language);
    demo.loadApp();
    demo.evaluate('render=()=>buildVisibleFlowGraph(state.flow);renderStatus=()=>{};loadServiceGroups=async()=>{};showUiNotice=()=>{};renderFlowFeedback=()=>{};renderFlowPlan=()=>{};confirmUi=async()=>true;showUiProgress=()=>({success(){},error(){}})');
    await demo.evaluate("loadOverview()");
    assert.equal(demo.evaluate("state.error"), "");
    assert.equal(demo.evaluate("flowStartNode().type"), "QUEUE");
    demo.evaluate(`state.flow.nodes.push({id:"hours",type:"TIMECONTROL",title:"Team hours",titleUserEdited:true,floating:true,config:{portalMode:"new",hours:"Mon-Fri 09:00-18:00",openTarget:{type:"PHONEEXTENSION",title:"Alpha",targetNumber:"201",routeNumber:"201"},closedTarget:{type:"HANGUP",title:"Hang up"}}});connectFlowNodes("inbound","hours");`);
    await demo.evaluate("stageAndApplyFlowPlan()");
    assert.equal(demo.evaluate("state.flowFeedback.ok"), true);
    assert.equal(demo.evaluate("flowStartNode().id"), "hours");
    assert.equal(demo.evaluate("selectedDid().destinationType"), "TIMECONTROL");
    assert.equal(demo.evaluate("Object.keys(readStoredFlowDrafts()).length"), 0);
    const appliedEdges = JSON.parse(demo.evaluate("JSON.stringify(state.flow.edges)"));
    const reloaded = createDemo(language, demo.storage);
    reloaded.loadApp();
    reloaded.evaluate('render=()=>buildVisibleFlowGraph(state.flow);renderStatus=()=>{};loadServiceGroups=async()=>{}');
    await reloaded.evaluate("loadOverview()");
    assert.equal(reloaded.evaluate("state.error"), "");
    assert.equal(reloaded.evaluate("flowStartNode().id"), "hours");
    assert.equal(reloaded.evaluate("flowStartNode().title"), "Team hours");
    assert.equal(reloaded.evaluate("flowStartNode().config.hours"), "Mon-Fri 09:00-18:00");
    assert.ok(reloaded.evaluate("state.flow.appliedSnapshotAt"));
    reloaded.context.feedback = {};
    reloaded.evaluate('document.querySelector=selector=>selector==="#flow-feedback"?feedback:null;renderFlowFeedback()');
    assert.ok(reloaded.context.feedback.innerHTML.includes(catalog["portal.demo.localFlowLoaded"][language].split("{p0}")[0]));
    assert.deepEqual(JSON.parse(reloaded.evaluate("JSON.stringify(state.flow.edges)")), appliedEdges);
    assert.equal(reloaded.evaluate('branchTargetNode(flowStartNode(),"openTarget").targetNumber'), "201");
    assert.equal(reloaded.evaluate('branchTargetNode(flowStartNode(),"closedTarget").type'), "HANGUP");
    // The local overlay is still scoped to the stored PBX and incoming number.
    assert.equal(reloaded.evaluate('applyStoredAppliedFlow(buildFlowForDid(getOverview().inventory.dids[1],getOverview()),getOverview().inventory.dids[1]).nodes.some(node=>node.id==="hours")'), false);
    reloaded.evaluate('state.overview.account="SECOND-DEMO"');
    assert.equal(reloaded.evaluate('applyStoredAppliedFlow(buildFlowForDid(selectedDid(),getOverview()),selectedDid()).nodes.some(node=>node.id==="hours")'), false);
    assert.equal(demo.externalFetches + reloaded.externalFetches, 0);
  }
});


test("non-static Portal keeps checking the applied snapshot against live target routing", () => {
  const demo = createDemo();
  demo.context.window.NFON_WEB_ONLY_DEMO = false;
  demo.loadApp();
  assert.equal(demo.evaluate('didMatchesAppliedSnapshot({id:"did-1",name:"did-1",destinationType:"QUEUE",destinationServiceNumber:"501"},{did:"did-1",rootType:"TIMECONTROL",target:{}})'), false);
  assert.equal(demo.evaluate('didMatchesAppliedSnapshot({id:"did-1",name:"did-1",destinationType:"QUEUE",destinationServiceNumber:"501"},{did:"did-1",target:{type:"QUEUE",routeNumber:"502"}})'), false);
});
