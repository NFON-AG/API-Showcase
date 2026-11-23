const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const catalog = { ...JSON.parse(fs.readFileSync(path.join(root, "../shared/i18n-messages.json"), "utf8")), ...JSON.parse(fs.readFileSync(path.join(root, "i18n-messages.json"), "utf8")) };
const supportedLanguages = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "cs"];

test('routing preview fallback follows all language switches while provider-owned names stay literal', () => {
  const {translateMarkup}=require('./helpers/translation-dom.cjs');
  const app=loadApp('en');const dom=rendererNodes(app);
  app.evaluate('state.overview={settings:{configured:true},inventory:{dids:[{name:"+4412340",value:""},{name:"+4412341",value:"Abrechnung"},{name:"+4412342",value:"kein Ziel erkannt"}]}};renderRoutingPreview()');
  const markup=dom.element('#routing-preview').innerHTML;
  for(const language of supportedLanguages){
    const rendered=translateMarkup(markup,language,catalog);
    assert.deepEqual(rendered.elements.filter(el=>el.tagName==='B').map(el=>el.textContent),[catalog['portal.noTargetDetected'][language],'Abrechnung','kein Ziel erkannt'],language);
  }
});

test('daynight unresolved-target fallback follows all languages without changing provider-owned labels', () => {
  const {translateMarkup}=require('./helpers/translation-dom.cjs');
  const app=loadApp('en');const dom=rendererNodes(app);
  app.evaluate('state.overview={settings:{configured:true,liveWritesEnabled:true},inventory:{dids:[],extensions:[],queues:[],skills:[],ivrs:[],timeControls:[],announcements:[]}};state.daynightGatewayPreview={summary:{},capabilities:{},entries:[{did:{name:"+4412340"},currentTarget:{type:"",label:"",isUnassigned:false}},{did:{name:"+4412341"},currentTarget:{type:"PHONEEXTENSION",label:"kein Ziel erkannt",routeNumber:"200",isUnassigned:false}}]};renderDaynightGatewayPreview()');
  const markup=dom.element('#daynight-gateway-preview').innerHTML;
  for(const language of supportedLanguages){
    const rendered=translateMarkup(markup,language,catalog);
    assert.ok(rendered.elements.some(el=>el.tagName==='STRONG'&&el.textContent===catalog['portal.noTargetDetected'][language]),language);
    assert.ok(rendered.elements.some(el=>el.tagName==='STRONG'&&el.hasAttribute('data-i18n-ignore')&&el.textContent==='kein Ziel erkannt'),language+': provider label');
  }
});

function loadApp(language = "en", appSource = source) {
  const elements = [];
  const options = [];
  const connectionOptions = [];
  const listeners = new Map();
  let currentLanguage = language;
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const i18n = {
    getLanguage: () => currentLanguage,
    message: (key, params = {}) => {
      const entry = catalog[key];
      assert.ok(entry, `Missing message ${key}`);
      return (entry[currentLanguage] || entry.en).replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? String(params[name]) : match);
    },
  };
  const context = vm.createContext({
    window: { location: { hash: "" }, NFON_I18N: i18n, NFON_MESSAGES: catalog, addEventListener() {} },
    localStorage: storage,
    document: {
      querySelector: () => null,
      querySelectorAll: (selector) => selector === "[data-portal-default-key]" ? elements : selector === "option[data-portal-target-option]" ? options : selector === "option[data-portal-connection-option]" ? connectionOptions : [],
      addEventListener: (name, callback) => listeners.set(name, [...(listeners.get(name) || []), callback]),
    },
    URL, Intl, Date, console,
  });
  vm.runInContext(appSource.replace(/\nbindStaticNavigation\(\);\nloadOverview\(\);(?:\nloadCustomers\(\);)?\s*$/, ""), context);
  return { context, elements, options, connectionOptions, dispatch(name, event) { (listeners.get(name) || []).forEach(fn => fn(event)); }, evaluate: (code) => vm.runInContext(code, context), setLanguage(value) { currentLanguage = value; (listeners.get("nfon:language-change") || []).forEach(fn => fn({detail: {language: value}})); } };
}

test("new extension and clone defaults are localized without changing source names", () => {
  const app = loadApp("en");
  app.evaluate(`state.overview = { inventory: { extensions: [{ id: "201", number: "201", name: "Warteschlange & Partner" }] } }; state.selectedExtensionId = "201";`);
  let html = app.evaluate("extensionActionMarkup()");
  assert.match(html, /value="Warteschlange &amp; Partner copy"/);
  assert.doesNotMatch(html, /value="Neue Nebenstelle"/);
  app.evaluate('state.extensionActionMode = "create"');
  html = app.evaluate("extensionActionMarkup()");
  assert.match(html, /value="New extension"/);
  app.setLanguage("de");
  assert.match(app.evaluate("extensionActionMarkup()"), /value="Neue Nebenstelle"/);
});

test("existing extension metadata follows language switches while authored subtitles remain literal", () => {
  const app = loadApp("en");
  app.evaluate('state.flow = buildFlowForDid({id:"did", name:"101", destinationType:"PHONEEXTENSION", destinationName:"Zentrale", destinationExtension:"200"}, {inventory:{}})');
  assert.equal(app.evaluate('flowNodeSubtitle(state.flow.nodes.find(node => node.id === "target"))'), "Extension 200");
  app.setLanguage("fr");
  assert.equal(app.evaluate('flowNodeSubtitle(state.flow.nodes.find(node => node.id === "target"))'), "Poste 200");
  assert.equal(app.evaluate('state.flow.nodes.find(node => node.id === "target").title'), "Zentrale");
  app.evaluate('state.flow.nodes.find(node => node.id === "target").subtitle = "Support 200 – Sondertext"');
  assert.equal(app.evaluate('flowNodeSubtitle(state.flow.nodes.find(node => node.id === "target"))'), "Support 200 – Sondertext");
});

test("language switching updates untouched defaults, preserves edits and target values", () => {
  const app = loadApp("en");
  const untouched = { value: "New extension", dataset: { portalDefaultKey: "portal.newExtension", portalDefaultFallback: "New extension", portalDefaultParams: "{}", portalDefaultValue: "New extension" }, removeAttribute() {} };
  let removed = false;
  const edited = { value: "Warteschlange Team", dataset: {...untouched.dataset}, removeAttribute() { removed = true; } };
  const option = {value: JSON.stringify({type:"QUEUE", targetNumber:"501", title:"Warteschlange Team"}), textContent:""};
  const originalValue = option.value;
  app.elements.push(untouched, edited); app.options.push(option);
  app.setLanguage("de");
  assert.equal(untouched.value, "Neue Nebenstelle");
  assert.equal(edited.value, "Warteschlange Team");
  assert.ok(removed);
  app.setLanguage("en");
  assert.equal(untouched.value, "New extension");
  assert.equal(option.value, originalValue);
  assert.match(option.textContent, /Queue.*Warteschlange Team/);
});

test("new flow templates and invalid resource configuration use whole English messages", () => {
  const app = loadApp("en");
  assert.equal(app.evaluate("emptyFlowStepTarget().title"), "New step");
  const time = app.evaluate(`(() => { const node = { title: "", config: {} }; applyNodeTypeDefaults(node, "TIMECONTROL"); return node; })()`);
  assert.equal(time.title, "Business hours");
  assert.equal(time.config.hours, "Mon-Fri 08:00-17:00");
  assert.deepEqual(Array.from(app.evaluate('nodeValidationIssues({id:"ivr",type:"IVR",config:{portalMode:"new"}})')), ["Announcement missing", "Key target missing", "Timeout target missing"]);
  assert.deepEqual(Array.from(app.evaluate('nodeValidationIssues({id:"time",type:"TIMECONTROL",config:{portalMode:"new"}})')), ["Time window missing", "Target inside opening hours missing", "Target outside opening hours missing"]);
  assert.deepEqual(Array.from(app.evaluate('nodeValidationIssues({id:"queue",type:"QUEUE",config:{portalMode:"existing"}})')), ["Existing Queue missing"]);
  app.setLanguage("de");
  assert.equal(app.evaluate("emptyFlowStepTarget().title"), "Neuer Schritt");
});

test("phonebook preview protects real contact names from DOM translation", () => {
  const app = loadApp();
  const html = app.evaluate('renderPhonebookPreviewRows([{contact:"Neue Nebenstelle",phone:"+491234",status:"present"}], "portal")');
  assert.match(html, /<strong data-i18n-ignore>Neue Nebenstelle<\/strong>/);
});

test("every referenced Portal message has an English and German entry", () => {
  for (const match of source.matchAll(/portalMessage\("([^"]+)"/g)) {
    assert.equal(typeof catalog[match[1]]?.en, "string", match[1]);
    assert.equal(typeof catalog[match[1]]?.de, "string", match[1]);
  }
  assert.ok(Object.values(catalog).some(value => value.de === "Mailbox-PIN muss 4 bis 12 Ziffern enthalten" && value.en === "Mailbox PIN must contain 4 to 12 digits"));
  assert.ok(Object.values(catalog).some(value => value.de === "Telefonbuch-Sync teilweise fehlgeschlagen" && value.en === "Phonebook sync partially failed"));
});

test("resource labels follow all 12 languages and absent runtime uses English", () => {
  const app = loadApp("de");
  assert.equal(app.evaluate("RESOURCE_DEFS.ivrs.itemLabel"), "Sprachdialog");
  app.setLanguage("en");
  assert.equal(app.evaluate("RESOURCE_DEFS.ivrs.itemLabel"), "Voice dialog");
  for (const language of ["fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "cs"]) {
    app.setLanguage(language);
    assert.equal(app.evaluate("emptyFlowStepTarget().title"), catalog["portal.newStep"][language]);
    assert.notEqual(catalog["portal.newStep"][language], catalog["portal.newStep"].en);
  }
  app.evaluate("window.NFON_I18N = undefined");
  assert.equal(app.evaluate('portalMessage("missing", "Create {name}", { name: "Warteschlange" })'), "Create Warteschlange");
});

test("whole-message catalog parameters match across English and German", () => {
  const params = (text) => Array.from(new Set(Array.from(text.matchAll(/\{(\w+)\}/g), match => match[1]))).sort();
  for (const [key, message] of Object.entries(catalog)) assert.deepEqual(params(message.en), params(message.de), key);
});

test("grouped validation feedback keeps complete messages as separate DOM nodes", () => {
  const app = loadApp();
  const html = app.evaluate('portalMessagesMarkup(["Target missing", "Announcement missing"], " | ")');
  assert.equal(html, "<span>Target missing</span> | <span>Announcement missing</span>");
});


test("open flow defaults switch language in place while edited values stay unchanged", () => {
  const staticSource = fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8");
  for (const appSource of [source, staticSource]) {
    const app = loadApp("en", appSource);
    const titleInput = { value: "Business hours" };
    const hoursInput = { value: "Mon-Fri 08:00-17:00" };
    app.context.document.querySelector = (selector) => selector === '[data-node-field="title"]' ? titleInput : selector === '[data-node-config-field="hours"]' ? hoursInput : null;
    app.evaluate(`state.flow = {nodes:[{id:"draft",title:"",config:{}}],edges:[]}; state.selectedNodeId="draft"; applyNodeTypeDefaults(state.flow.nodes[0], "TIMECONTROL"); render=()=>{throw Error("Unexpected whole-page render")};`);
    app.setLanguage("de");
    assert.equal(titleInput.value, "Geschäftszeiten");
    assert.equal(hoursInput.value, "Mon-Fri 08:00-17:00");
    assert.equal(app.evaluate("state.flow.nodes[0].title"), titleInput.value);
    assert.equal(app.evaluate("state.flow.nodes[0].config.hours"), hoursInput.value);
    app.setLanguage("en");
    assert.equal(titleInput.value, "Business hours");
    assert.equal(hoursInput.value, "Mon-Fri 08:00-17:00");
    app.evaluate(`saveCurrentFlowLayout=()=>{}; saveCurrentFlowDraft=()=>{}; renderCallflow=()=>{}; renderFlowFeedback=()=>{}; updateNodeFieldWithoutHelperRender("title", "Geschäftszeiten Team"); updateNodeConfigWithoutHelperRender("hours", "Mo-Fr 09:00-18:00");`);
    titleInput.value = "Geschäftszeiten Team";
    hoursInput.value = "Mo-Fr 09:00-18:00";
    app.setLanguage("de"); app.setLanguage("en");
    assert.equal(titleInput.value, "Geschäftszeiten Team");
    assert.equal(hoursInput.value, "Mo-Fr 09:00-18:00");
    assert.equal(app.evaluate("state.flow.nodes[0].title"), titleInput.value);
    assert.equal(app.evaluate("state.flow.nodes[0].config.hours"), hoursInput.value);
    assert.equal(app.evaluate("state.flow.nodes[0]._i18nDefaults.title"), undefined);
    assert.equal(app.evaluate('state.flow.nodes[0]._i18nDefaults["config.hours"]'), undefined);
  }
});

test("branch drafts retain edits and default metadata through real nested materialization", () => {
  const staticSource = fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8");
  for (const appSource of [source, staticSource]) {
    const app = loadApp("de", appSource);
    // Isolate DOM/storage side effects, while keeping all branch/config functions real.
    app.evaluate(`saveCurrentFlowLayout=()=>{}; saveCurrentFlowDraft=()=>{}; renderCallflow=()=>{}; renderFlowHelper=()=>{}; renderFlowFeedback=()=>{};
      state.flow={nodes:[{id:"root",type:"IVR",title:"Root",locked:true,config:{portalMode:"new",ivrKeys:["1"]}}],edges:[]};
      materializeBranchNodes(state.flow); state.selectedNodeId="root-key1Target"; updateNodeField("type","TIMECONTROL");`);
    assert.equal(app.evaluate('selectedNode()._i18nDefaults.title.key'), "portal.businessHours");
    app.setLanguage("en");
    app.evaluate('materializeBranchNodes(state.flow)');
    assert.equal(app.evaluate('selectedNode().title'), "Business hours");
    assert.equal(app.evaluate('selectedNode().config.hours'), "Mon-Fri 08:00-17:00");
    assert.equal(app.evaluate('state.flow.nodes[0].config.key1Target.config.hours'), "Mon-Fri 08:00-17:00");
    app.evaluate('updateNodeConfigWithoutHelperRender("hours", "Mo-Fr 09:00-18:00"); updateNodeFieldWithoutHelperRender("title", "Geschäftszeiten");');
    assert.equal(app.evaluate('selectedNode().titleUserEdited'), true);
    assert.equal(app.evaluate('selectedNode().config.hours'), "Mo-Fr 09:00-18:00");
    assert.equal(app.evaluate('selectedNode().targetNumber'), "");
    assert.equal(app.evaluate('selectedNode().routeNumber'), "");
    app.evaluate('state.selectedNodeId="root-key1Target-openTarget"; updateNodeField("type","TIMECONTROL"); updateNodeConfig("hours","Sa 10:00-16:00"); updateNodeField("title","Geschäftszeiten Team");');
    app.setLanguage("de"); app.setLanguage("en");
    app.evaluate('materializeBranchNodes(state.flow)');
    assert.equal(app.evaluate('selectedNode().config.hours'), "Sa 10:00-16:00");
    assert.equal(app.evaluate('selectedNode().title'), "Geschäftszeiten Team");
    assert.equal(app.evaluate('selectedNode().titleUserEdited'), true);
    assert.equal(app.evaluate('state.flow.nodes[0].config.key1Target.config.openTarget.config.hours'), "Sa 10:00-16:00");
    assert.equal(app.evaluate('state.flow.nodes.find(node=>node.id==="root-key1Target").config.hours'), "Mo-Fr 09:00-18:00");
    assert.equal(app.evaluate('state.flow.nodes.find(node=>node.id==="root-key1Target").title'), "Geschäftszeiten");
    // JSON target roundtrips and reconstruction preserve both title protection and defaults.
    app.evaluate('const serializedTarget=JSON.parse(targetConfigValue(selectedNode())); const rebuilt=nodeFromTargetSpec(state.flow,state.flow.nodes[0],branchSpec("customTarget","","","",24,8,serializedTarget));');
    assert.equal(app.evaluate('rebuilt.titleUserEdited'), true);
    assert.equal(app.evaluate('rebuilt.config.hours'), "Sa 10:00-16:00");
  }
});

test("a template selected after a locale switch uses the current defaults", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("de", appSource);
    app.evaluate('const pendingTemplate=emptyFlowStepTarget(); const storedDefault={id:"stored",title:"",config:{}}; applyNodeTypeDefaults(storedDefault,"TIMECONTROL"); const serializedDefault=JSON.stringify(storedDefault);');
    app.setLanguage("en");
    assert.equal(app.evaluate('const inserted={}; applyTargetToNode(inserted,pendingTemplate); inserted.title'), "New step");
    assert.equal(app.evaluate('inserted._i18nDefaults.title.value'), "New step");
    app.evaluate('state.flow={nodes:[JSON.parse(serializedDefault)],edges:[]}; materializeBranchNodes(state.flow);');
    assert.equal(app.evaluate('state.flow.nodes[0].title'), "Business hours");
    assert.equal(app.evaluate('state.flow.nodes[0].config.hours'), "Mon-Fri 08:00-17:00");
  }
});

test("system palette labels and boolean values stay keyed while actual names stay protected", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("de", appSource);
    const palette = { innerHTML: "" }; const detail = { innerHTML: "" };
    app.context.document.querySelector = selector => selector === "#flow-resource-palette" ? palette : selector === "#extension-detail" ? detail : null;
    app.evaluate('state.overview={inventory:{extensions:[{id:"201",number:"201",name:"Neuer Sprachdialog",fields:{accessCentralPhoneBook:true,phoneBookHide:false,costCenter:"Ja"}}]}}; renderFlowResourcePalette(); renderExtensionDetail();');
    assert.match(palette.innerHTML, /<span data-i18n-key="portal.newVoiceDialog">Neuer Sprachdialog<\/span>/);
    assert.match(palette.innerHTML, /<span data-i18n-ignore>Neuer Sprachdialog<\/span>/);
    assert.match(detail.innerHTML, /<strong data-i18n-key="portal.yes">Ja<\/strong>/);
    assert.match(detail.innerHTML, /<strong data-i18n-key="portal.no">Nein<\/strong>/);
    assert.match(detail.innerHTML, /<strong data-i18n-ignore>Ja<\/strong>/);
  }
});

test("branch labels follow locale on initial and existing edges", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource);
    app.evaluate('state.flow={nodes:[{id:"time",type:"TIMECONTROL",config:{portalMode:"new"}},{id:"announcement",type:"ANNOUNCEMENT",config:{}}],edges:[]}; materializeBranchNodes(state.flow);');
    assert.equal(app.evaluate('state.flow.edges.find(edge=>edge.branchField==="openTarget").label'), "inside");
    assert.equal(app.evaluate('state.flow.edges.find(edge=>edge.branchField==="afterTarget").label'), "after");
    app.setLanguage("de"); app.evaluate('materializeBranchNodes(state.flow)');
    assert.equal(app.evaluate('state.flow.edges.find(edge=>edge.branchField==="openTarget").label'), "innerhalb");
    assert.equal(app.evaluate('state.flow.edges.find(edge=>edge.branchField==="afterTarget").label'), "danach");
  }
});

test("resource source choices use complete keyed messages for every supported type", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource);
    for (const [kind, suffix] of [["QUEUE","Queue"],["GROUP","SkillGroup"],["SKILL","SkillGroup"],["IVR","VoiceDialog"],["TIMECONTROL","TimeControl"]]) {
      for (const language of [...supportedLanguages, "en"]) {
        app.setLanguage(language);
        const html = app.evaluate(`renderResourceSourceChoice({config:{portalMode:"new"}},${JSON.stringify(kind)})`);
        for (const prefix of ["createNew", "selectExisting"]) {
          const key = `portal.${prefix}${suffix}`;
          const escaped=app.evaluate(`escapeHtml(${JSON.stringify(catalog[key][language])})`);
          assert.ok(html.includes(`data-i18n-key="${key}">${escaped}</option>`),`${key} / ${language}`);
        }
        assert.match(html, /<option value="new" selected/);
      }
    }
  }
});

test("editing a time-control draft refreshes only its preview and never derives an extension from hours", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource);
    const preview = { textContent: "" };
    const title = { value: "V12-QA Geschäftszeiten" };
    const hours = { value: "Mo-Fr 09:00-18:00" };
    app.context.document.querySelector = selector => selector === "#flow-helper [data-flow-draft-preview]" ? preview : selector === '[data-node-field="title"]' ? title : selector === '[data-node-config-field="hours"]' ? hours : null;
    app.evaluate(`state.overview={inventory:{dids:[{id:"did",name:"+49 89 12345-0"}]}};state.selectedDidId="did";
      state.flow={nodes:[{id:"entry",type:"DID",locked:true,title:"Incoming call"},{id:"draft",...emptyFlowStepTarget()}],edges:[{from:"entry",to:"draft"}]};state.selectedNodeId="draft";
      saveCurrentFlowLayout=()=>{};saveCurrentFlowDraft=()=>{};renderCallflow=()=>{};renderFlowFeedback=()=>{};renderFlowHelper=()=>{};
      updateNodeField("type","TIMECONTROL"); refreshFlowDraftPreview();
      renderFlowHelper=()=>{throw Error("Inspector must not be rebuilt")};render=()=>{throw Error("Page must not be rebuilt")};`);
    assert.match(preview.textContent, /Business hours: inside Target missing/);
    app.evaluate('updateNodeFieldWithoutHelperRender("title","V12-QA Geschäftszeiten");updateNodeConfigWithoutHelperRender("hours","Mo-Fr 09:00-18:00");');
    assert.match(preview.textContent, /V12-QA Geschäftszeiten: inside Target missing/);
    assert.equal(app.evaluate('flowNodeNumberMeta(selectedNode())'), "");
    assert.equal(app.evaluate('targetNumberFromText(selectedNode().subtitle)'), "");
    app.setLanguage("de");
    assert.match(preview.textContent, /V12-QA Geschäftszeiten/);
    assert.doesNotMatch(preview.textContent, /inside|Target missing/);
    app.setLanguage("en");
    assert.match(preview.textContent, /V12-QA Geschäftszeiten: inside Target missing/);
    assert.equal(title.value, "V12-QA Geschäftszeiten");
    assert.equal(hours.value, "Mo-Fr 09:00-18:00");
    assert.equal(app.evaluate('selectedNode().config.hours'), hours.value);
    assert.equal(app.evaluate('targetNumberFromText("Time control 7300")'), "7300");
    assert.equal(app.evaluate('flowNodeNumberMeta({type:"TIMECONTROL",subtitle:"Mo-Fr 09:00-18:00",targetNumber:"7300",routeNumber:"30"})'), "Extension 7300 · Service 30");
  }
});

test("the static demo header localizes its display name without changing account identifiers", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource);
    const label = { textContent: "" };
    app.context.document.querySelector = selector => selector === "#account-label" ? label : null;
    app.evaluate('window.NFON_WEB_ONLY_DEMO=true;state.overview={account:"Demo-Anlage",settings:{configured:true},inventory:{dids:[]}};refreshPortalAccountLabel();');
    assert.match(label.textContent, /^Demo PBX · checked /);
    assert.equal(app.evaluate('visibleAccount()'), "Demo-Anlage");
    const storageKey = app.evaluate('flowDraftKey()');
    app.setLanguage("de");
    assert.match(label.textContent, /^Demo-Anlage · geprüft /);
    app.setLanguage("en");
    assert.match(label.textContent, /^Demo PBX · checked /);
    assert.equal(app.evaluate('flowDraftKey()'), storageKey);
    app.evaluate('window.NFON_WEB_ONLY_DEMO=false;refreshPortalAccountLabel();');
    assert.match(label.textContent, /^Demo-Anlage · checked /);
  }
});

test("day/night names remain literal while types and complete status messages change language", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource);
    app.evaluate('state.overview={inventory:{queues:[{id:"501",name:"New Partner",extensionNumber:"501"},{id:"502",name:"Alpha Members-Service",extensionNumber:"502"}]}};');
    const choices = app.evaluate('daynightTargetOptions().filter(option=>option.kind==="QUEUE")');
    for (const option of choices) {
      assert.match(app.evaluate(`daynightTargetOptionMarkup(${JSON.stringify(option)},"")`), /data-i18n-ignore data-portal-target-option/);
      app.options.push({value:option.value,textContent:option.label});
    }
    const values = app.options.map(option=>option.value);
    for (const language of ["de","en"]) {
      app.setLanguage(language);
      assert.deepEqual(app.options.map(option=>option.value),values);
      for (const option of app.options) {
        const original = JSON.parse(option.value);
        assert.ok(option.textContent.includes(original.title));
        assert.ok(option.textContent.includes(language==="de" ? "Warteschlange" : "Queue"));
      }
      const status = app.evaluate('daynightGatewayStatusMarkup({gatewayExists:true,gatewayNeedsUpdate:true,gateway:{extensionNumber:"7301"}})');
      assert.match(status, /data-i18n-key="portal.timeControlNeedsUpdate"/);
      assert.ok(status.includes(language==="de" ? "Ziel aktualisieren · Zeitsteuerung 7301" : "Update target · Time control 7301"));
      const note = app.evaluate('daynightBehaviorMarkup({currentTarget:{isFrontdesk:true},behaviorNote:"server-authored note"})');
      assert.match(note, /data-i18n-key="portal.server.frontdeskNiaRemainsTheDayTargetBehindTheTime"/);
      assert.ok(note.includes(language==="de" ? "bleibt Tagesziel" : "remains the day target"));
    }
  }
});

test("environment setup uses keyed copy and a neutral account placeholder", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource); const panel={innerHTML:""};
    app.context.document.querySelector=selector=>selector==="#auth-login-panel" ? panel : null;
    app.evaluate('state.overview={settings:{configured:true,sources:{environment:true}}};renderAuthLoginPanel();');
    assert.match(panel.innerHTML, /data-i18n-key="portal.envActive">\.env active<\/h3>/);
    assert.match(panel.innerHTML, /PORTAL_CUSTOMER_ACCOUNT=&lt;CUSTOMER_ACCOUNT&gt;/);
    assert.doesNotMatch(panel.innerHTML, /ANLAGENNUMMER|\.env aktiv/);
  }
});

test("dialog Tab/Escape handling traps focus and restores the triggering control", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app=loadApp("en",appSource);const doc=app.context.document;const elements=new Map();
    const element=(id,classes=[])=>{const value={id,hidden:false,disabled:false,isConnected:true,classList:{contains:name=>classes.includes(name),toggle(){}},focus(){doc.activeElement=value;}};elements.set('#'+id,value);return value;};
    const origin=element('stage-flow');const confirm=element('app-dialog-confirm');const cancel=element('app-dialog-cancel');const dialog=element('dialog');element('app-dialog-title');element('app-dialog-message');
    const modal=element('app-dialog-modal');let aria='true';modal.getAttribute=()=>aria;modal.setAttribute=(name,value)=>{aria=value;};modal.contains=value=>[confirm,cancel,dialog].includes(value);modal.querySelector=()=>dialog;modal.querySelectorAll=()=>[cancel,confirm];
    const dayOrigin=element('daynight-mode-toggle');const dayClose=element('day-close');const backdrop=element('day-backdrop',['daynight-mode-backdrop']);const dayDialog=element('day-dialog');const dayModal=element('daynight-mode-modal');dayModal.hidden=true;element('daynight-mode-modal-symbol');element('daynight-mode-modal-title');element('daynight-mode-modal-message');
    dayModal.querySelector=()=>dayDialog;dayModal.querySelectorAll=()=>[backdrop,dayClose];dayDialog.querySelector=selector=>selector.startsWith('[data-daynight-mode-close]')?dayClose:null;dayDialog.querySelectorAll=()=>[dayClose];dayDialog.contains=value=>value===dayClose||value===dayDialog;
    doc.querySelector=selector=>elements.get(selector)||null;doc.getElementById=id=>elements.get('#'+id)||null;doc.activeElement=origin;
    app.evaluate('showUiNotice({title:"Notice",message:"Local preview"})');assert.equal(doc.activeElement,confirm);
    const event=(key,shiftKey=false)=>({key,shiftKey,target:doc.activeElement,preventDefault(){}});
    app.dispatch('keydown',event('Tab'));assert.equal(doc.activeElement,confirm);
    app.dispatch('keydown',event('Tab',true));assert.equal(doc.activeElement,confirm);
    app.dispatch('keydown',event('Escape'));assert.equal(doc.activeElement,origin);
    doc.activeElement=dayOrigin;app.evaluate('state.daynightModeModal="setup";renderDaynightModeModal()');assert.equal(doc.activeElement,dayClose);
    app.dispatch('keydown',event('Tab'));assert.equal(doc.activeElement,dayClose);
    app.dispatch('keydown',event('Escape'));assert.equal(doc.activeElement,dayOrigin);assert.equal(dayModal.hidden,true);
    doc.activeElement=origin;app.evaluate('const testProgress=showUiProgress({title:"Busy",message:"Waiting"})');assert.equal(doc.activeElement,dialog);
    app.dispatch('keydown',event('Tab'));assert.equal(doc.activeElement,dialog);
    app.dispatch('keydown',event('Escape'));assert.equal(app.evaluate('uiDialog.open'),true);
    app.evaluate('testProgress.success()');assert.equal(app.evaluate('uiDialog.open'),false);assert.equal(doc.activeElement,origin,'success returns focus without another acknowledgement');
  }
});

test("keyboard activation of a node dock opens the existing connection selector", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app=loadApp("en",appSource);let focused=false;const select={focus(){focused=true;}};
    app.context.document.querySelector=selector=>selector==="#flow-connect-target"?select:null;
    app.evaluate('state.flow={nodes:[{id:"node",type:"IVR",config:{}}],edges:[]};renderCallflow=()=>{};renderFlowHelper=()=>{};renderView=()=>{};');
    const dock={dataset:{nodeDock:"node"},closest:selector=>selector==="[data-node-dock]"?dock:null};
    app.dispatch('click',{target:dock,detail:0,preventDefault(){},stopPropagation(){}});
    assert.equal(app.evaluate('state.inspectorOpen'),true);assert.equal(app.evaluate('state.selectedNodeId'),"node");assert.equal(focused,true);assert.equal(app.evaluate('state.cableDrag'),null);
  }
});

test("target and announcement selects have field-specific localized accessible names without changing options", () => {
  const sources = [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")];
  for (const appSource of sources) {
    const app = loadApp("en", appSource);
    app.evaluate('state.overview={inventory:{extensions:[{id:"201",number:"201",name:"New Partner Members"}],announcements:[{id:"800",name:"New Partner Announcement"}]}}');
    const namedSelect = (html, attribute, key, language, params = {}) => {
      const tag = [...html.matchAll(/<select\b[^>]*>/g)].map(match => match[0]).find(item => item.includes(attribute));
      assert.ok(tag, `Select ${attribute} exists`);
      const label = catalog[key][language].replace(/\{(\w+)\}/g, (match, name) => Object.hasOwn(params, name) ? params[name] : match);
      assert.ok(tag.includes(`aria-label="${label}"`), `${attribute}: ${label}`);
      assert.ok(tag.includes(`data-i18n-aria-label="${key}"`));
      assert.ok(tag.includes(`data-i18n-params="${JSON.stringify(params).replaceAll('"', "&quot;")}"`));
    };
    for (const language of supportedLanguages) {
      app.setLanguage(language);
      const time = app.evaluate('renderResourceNodeConfiguration({id:"hours",type:"TIMECONTROL",config:{portalMode:"new",hours:"Mo-Fr 09:00-18:00"}},"TIMECONTROL")');
      namedSelect(time, 'data-node-target-config="openTarget"', "portal.targetInsideOpeningHours", language);
      namedSelect(time, 'data-node-target-config="closedTarget"', "portal.targetOutsideOpeningHours", language);
      const ivr = app.evaluate('renderResourceNodeConfiguration({id:"menu",type:"IVR",config:{portalMode:"new",ivrKeys:["1","2"]}},"IVR")');
      namedSelect(ivr, 'data-node-target-config="key1Target"', "portal.keyValue", language, { p0: "1" });
      namedSelect(ivr, 'data-node-target-config="key2Target"', "portal.keyValue", language, { p0: "2" });
      namedSelect(ivr, 'data-node-target-config="timeoutTarget"', "portal.noInputTimeout", language);
      namedSelect(ivr, 'data-node-config-field="announcement"', "portal.announcementBeforeSelection", language);
      const direct = app.evaluate('renderTargetSelect("target-select","",targetOptions()[0].value,true)');
      namedSelect(direct, 'id="target-select"', "portal.selectExistingTarget", language);
      assert.match(direct, /<option[^>]* selected[^>]*data-i18n-ignore data-portal-target-option>[^<]*New Partner Members/);
      assert.match(ivr, /<option value="New Partner Announcement"[^>]*data-i18n-ignore>New Partner Announcement<\/option>/);
      namedSelect(app.evaluate('targetSelectMarkup("openTarget",true)'), 'name="openTarget"', "portal.targetInsideOpeningHours", language);
      namedSelect(app.evaluate('targetSelectMarkup("timeoutTarget")'), 'name="timeoutTarget"', "portal.timeoutTarget", language);
      namedSelect(app.evaluate('announcementSelectMarkup()'), 'name="announcementName"', "portal.announcement", language);
    }
  }
});


test("connection options localize system labels in place and retain names, selection and draft values", () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, "../docs/portal/app.js"), "utf8")]) {
    const app = loadApp("en", appSource);
    app.evaluate(`state.flow={nodes:[
      {id:"hours",type:"TIMECONTROL",title:"New Partner Members",titleUserEdited:true,subtitle:"Mo-Fr 09:00-18:00",config:{portalMode:"new",hours:"Mo-Fr 09:00-18:00"},floating:true},
      {id:"menu",type:"IVR",title:"Welcome Menu",subtitle:"New Partner Announcement",config:{portalMode:"new",ivrKeys:["1"],announcement:"New Partner Announcement"},floating:true},
      {id:"phone",type:"PHONEEXTENSION",title:"New Partner",subtitle:"Extension 203",targetNumber:"203",routeNumber:"203",floating:true},
      {id:"end",type:"HANGUP",title:"Hang up",subtitle:"End call",_i18nDefaults:flowNodeDefaultMetadata("HANGUP"),floating:true},
      {id:"custom",type:"HANGUP",title:"Hang up",titleUserEdited:true,subtitle:"End call",floating:true}
    ],edges:[]};state.selectedNodeId="hours"`);
    for (const id of ["hours", "menu", "phone", "end", "custom"]) {
      app.connectionOptions.push({ value: id, selected: id === "phone", textContent: "", hidden: id === "custom" });
    }
    const labels = () => app.connectionOptions.map(option => option.textContent);
    app.setLanguage("de");
    assert.deepEqual(labels(), [
      "Zeitsteuerung · New Partner Members · Mo-Fr 09:00-18:00",
      "Sprachdialog · Welcome Menu · New Partner Announcement",
      "Nebenstelle · New Partner · Nebenstelle 203",
      "Auflegen · Auflegen · Anruf beenden",
      "Auflegen · Hang up · Anruf beenden",
    ]);
    app.setLanguage("en");
    assert.deepEqual(labels(), [
      "Time control · New Partner Members · Mo-Fr 09:00-18:00",
      "Voice dialog · Welcome Menu · New Partner Announcement",
      "Extension · New Partner · Extension 203",
      "Hang up · Hang up · End call",
      "Hang up · Hang up · End call",
    ]);
    assert.deepEqual(app.connectionOptions.filter(option => option.selected).map(option => option.value), ["phone"]);
    assert.equal(app.connectionOptions.find(option => option.value === "custom").hidden, true);
    assert.equal(app.evaluate('state.flow.nodes[0].config.hours'), "Mo-Fr 09:00-18:00");
    assert.equal(app.evaluate('state.flow.nodes[2].subtitle'), "Extension 203");
    assert.match(app.evaluate('renderConnectionBuilder(state.flow.nodes[0])'), /<option value="phone" data-i18n-ignore data-portal-connection-option>/);
  }
});

function rendererNodes(app) {
  const nodes = new Map();
  function element(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', dataset: {}, hidden: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: { setProperty() {} },
      setAttribute(name, value) { this[name] = String(value); },
      getAttribute(name) { return this[name] ?? null; },
      removeAttribute(name) { delete this[name]; },
      toggleAttribute() {}, querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return null; }, addEventListener() {}, contains() { return false; },
    });
    return nodes.get(selector);
  }
  app.context.document.querySelector = selector => selector.includes(' ') || selector.startsWith('[') ? null : element(selector);
  app.context.document.body = element('body');
  return { nodes, element };
}

// This matrix exercises page renderers; the shared DOM translator is checked separately.
test('all Portal views render through each locale without altering real names or drafts', () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, '../docs/portal/app.js'), 'utf8')]) {
    const app = loadApp('en', appSource);
    const dom = rendererNodes(app);
    app.evaluate(`state.overview = buildDemoOverview({settings:{configured:true,liveWritesEnabled:false}});
      state.loading=false; state.selectedExtensionId='201';
      state.overview.inventory.extensions[0].name='Geschäftszeiten & New Partner';
      state.phonebookManualDraft={firstName:'Sophie',name:'Warteschlange Partners',phone:'+491234'};
      state.extensionBatchRows=[{extensionNumber:'211',displayName:'Nouvelle équipe',mailboxPin:'123456',costCenter:'Kostenstelle Nord'}];
      state.serviceCreateDrafts.queues.displayName='Règle horaire Client';
      state.browserLoginDraft.customerAccount='Account-Test';
      state.flow={nodes:[{id:'draft',...emptyFlowStepTarget()}],edges:[]}; state.selectedNodeId='draft';
      applyNodeTypeDefaults(state.flow.nodes[0],'TIMECONTROL');`);
    const views = {
      overview: ['renderMetrics', 'renderSummary', 'renderRoutingPreview'],
      extensions: ['renderExtensionSummary', 'renderExtensions', 'renderExtensionDetail', 'renderExtensionActions', 'renderExtensionBatch'],
      services: ['renderServices'],
      callflow: ['renderDidList', 'renderFlowResourcePalette'],
      phonebook: ['renderPhonebookSync'],
      changes: ['renderSettingsSummary', 'renderAuthLoginPanel', 'renderEndpoints', 'renderActionPlan'],
    };
    for (const language of supportedLanguages) {
      app.setLanguage(language);
      for (const [view, functions] of Object.entries(views)) {
        app.evaluate(`state.view=${JSON.stringify(view)}`);
        for (const name of functions) assert.doesNotThrow(() => app.evaluate(`${name}()`), `${language} / ${view} / ${name}`);
      }
      assert.equal(app.evaluate('state.flow.nodes[0].title'), catalog['portal.businessHours'][language]);
      const extensionHtml = dom.element('#extension-detail').innerHTML;
      assert.ok(extensionHtml.includes('data-i18n-ignore>Geschäftszeiten &amp; New Partner'));
      assert.ok(dom.element('#extension-batch').innerHTML.includes('value="Nouvelle équipe"'));
      assert.equal(app.evaluate('state.phonebookManualDraft.name'), 'Warteschlange Partners');
      assert.equal(app.evaluate('state.serviceCreateDrafts.queues.displayName'), 'Règle horaire Client');
      assert.equal(app.evaluate('state.browserLoginDraft.customerAccount'), 'Account-Test');
      const serviceHtml = app.evaluate('serviceCreateCardMarkup("queues")');
      assert.match(serviceHtml, /data-i18n-placeholder="portal.queueNameField"/);
      assert.match(serviceHtml, /value="Règle horaire Client"/);
      assert.ok(dom.element('#metrics').innerHTML.includes(catalog['portal.extensions'][language]));
      assert.ok(dom.element('#settings-summary').innerHTML.includes(catalog['portal.liveWritesOff'][language]));
    }
  }
});

test('untouched creation fields switch through all locales while edited and emptied fields stay user data', () => {
  for (const appSource of [source, fs.readFileSync(path.join(root, '../docs/portal/app.js'), 'utf8')]) {
    const app = loadApp('en', appSource);
    app.evaluate('selectedAnnouncementName=()=>"Accueil & Partner";');
    const untouched = {id:'daynight-announcement-display-name',value:'Night announcement Accueil & Partner',dataset:{portalDefaultKey:'portal.nightAnnouncementValue',portalDefaultFallback:'Night announcement {p0}',portalDefaultParams:'{"p0":"Accueil & Partner"}',portalDefaultValue:'Night announcement Accueil & Partner'},removeAttribute(){delete this.dataset.portalDefaultKey;}};
    const edited = {value:'Nuit client',dataset:{portalDefaultKey:'portal.newExtension',portalDefaultValue:'New extension'},removeAttribute(){delete this.dataset.portalDefaultKey;}};
    app.elements.push(untouched,edited);
    for (const language of supportedLanguages) {
      app.setLanguage(language);
      assert.equal(untouched.value,catalog['portal.nightAnnouncementValue'][language].replace('{p0}','Accueil & Partner'));
      assert.equal(edited.value,'Nuit client');
      assert.equal(app.evaluate('daynightAnnouncementDisplayName("Accueil & Partner")'),untouched.value);
      app.evaluate('state.extensionActionMode="create"');
      assert.ok(app.evaluate('extensionActionMarkup()').includes(`value="${catalog['portal.newExtension'][language]}"`));
    }
    app.evaluate('state.daynightAnnouncementDisplayName="Custom Nacht";state.daynightAnnouncementDisplayNameEdited=true');
    for (const language of supportedLanguages) {
      app.setLanguage(language);
      assert.equal(app.evaluate('daynightAnnouncementDisplayName("Accueil")'),'Custom Nacht');
    }
    app.evaluate('state.daynightAnnouncementDisplayName=""');
    app.setLanguage('en');
    assert.equal(app.evaluate('daynightAnnouncementDisplayName("Accueil")'),'');
  }
});

test('technical time-window defaults remain parseable after editing hours in every UI language', () => {
  const serverSource = fs.readFileSync(path.join(root,'src/server.js'),'utf8');
  const parser = vm.createContext({});
  vm.runInContext(serverSource.slice(serverSource.indexOf('function nfonDay('),serverSource.indexOf('function targetSummary(')),parser);
  for (const language of supportedLanguages) {
    const app=loadApp(language);
    const value=app.evaluate('flowNodeDefaultMetadata("TIMECONTROL")["config.hours"].value');
    const expected='Mon-Fri 08:00-17:00';
    assert.equal(value,expected,language);
    for(const time of [value,value.replace('08:00-17:00','09:00-18:00')]) {
      const parsed=vm.runInContext(`parseTimeWindow(${JSON.stringify(time)})`,parser);
      assert.equal(parsed.fromDay,'MONDAY',`${language}: ${time}`);
      assert.equal(parsed.toDay,'FRIDAY',`${language}: ${time}`);
      assert.equal(parsed.fromTimeOfDay,time.includes('09:00')?'09:00 AM':'08:00 AM');
      assert.equal(parsed.toTimeOfDay,time.includes('18:00')?'06:00 PM':'05:00 PM');
    }
    const field=app.evaluate('EXTENSION_BATCH_FIELD_MAP.get("language")');
    assert.equal(field.defaultValue,'de','PBX language configuration is not the UI locale');
    assert.equal(app.evaluate('EXTENSION_BATCH_FIELD_MAP.get("recordingMode").defaultValue'),'NEVER');
  }
});

test('search placeholders, optional fields and time examples have explicit message keys in both builds', () => {
  for(const appSource of [source,fs.readFileSync(path.join(root,'../docs/portal/app.js'),'utf8')]) {
    assert.doesNotMatch(appSource,/placeholder="(?:Name oder Nummer suchen|Ziel suchen|Ansage suchen|z\. B\.|optional|\$\{escapeHtml\(label\)\} Name)/);
    const app=loadApp('en',appSource);
    for(const language of supportedLanguages) {
      app.setLanguage(language);
      const search=app.evaluate('portalPlaceholderAttributes("portal.searchNameOrNumber","Search name or number")');
      assert.ok(search.includes(`placeholder="${catalog['portal.searchNameOrNumber'][language]}"`));
      assert.match(search,/data-i18n-placeholder="portal.searchNameOrNumber"/);
      const optional=app.evaluate('portalPlaceholderAttributes("portal.optionalField","Optional")');
      assert.ok(optional.includes(`placeholder="${catalog['portal.optionalField'][language]}"`));
      assert.equal(app.evaluate('EXTENSION_BATCH_FIELD_MAP.get("voicemailEmail").groupKey'),'voicemail');
      assert.equal(app.evaluate('EXTENSION_BATCH_FIELD_MAP.get("voicemailEmail").group'),catalog['portal.voicemail'][language]);
    }
  }
  for(const file of ['public/index.html','../docs/portal/index.html']) {
    const html=fs.readFileSync(path.join(root,file),'utf8');
    assert.match(html,/<html lang="en">/);
    assert.equal((html.match(/data-i18n-placeholder="portal.searchNameOrNumber"/g)||[]).length,2);
  }
});

test('every generated resource action has complete translations and correct Finnish/Czech forms', () => {
  for(const action of ['create','delete']) for(const kind of ['queues','skills','ivrs','timeControls']) for(const language of supportedLanguages) assert.ok(catalog[`portal.resource.${action}.${kind}`][language]);
  const app=loadApp('fi');assert.equal(app.evaluate('resourceActionText("create","queues")'),'Luo jono');assert.equal(app.evaluate('resourceActionText("delete","timeControls")'),'Poista aikaohjaus');
  assert.equal(app.evaluate('portalMessage("portal.deleteValue","Delete {p0}",{p0:"Müller Abrechnung GmbH"})'),'Poista Müller Abrechnung GmbH');
  app.setLanguage('cs');assert.equal(app.evaluate('resourceActionText("create","queues")'),'Vytvořit frontu');
});

test('account and revision checks preserve memberships, and deltas only add requested extensions', () => {
  const app=loadApp();app.evaluate('state.overview={account:"A"};');
  app.context.groups={account:'A',queues:[{id:'500',serviceNumber:'500',name:'Abrechnung',memberRevision:'v2',members:[{extensionNumber:'201',name:'Abrechnung'},{extensionNumber:'202',name:'Open'}]}],skills:[]};
  const fresh=app.evaluate('buildServiceDraft(groups)');app.context.saved=JSON.parse(JSON.stringify(fresh));app.context.saved.account='B';app.context.saved.queues['500'].members=[];
  assert.equal(app.evaluate('reconcileServiceDraft(groups,saved).queues["500"].members.length'),2);
  app.context.saved.account='A';app.context.saved.queues['500'].baseRevision='v1';assert.equal(app.evaluate('reconcileServiceDraft(groups,saved).queues["500"].members.length'),2);
  app.context.entry=fresh.queues['500'];app.context.entry.members.push({extensionNumber:'203'});const delta=app.evaluate('membershipDelta(entry)');
  assert.deepEqual(Array.from(delta.add,x=>x.extensionNumber),['203']);assert.equal(delta.remove.length,0);assert.equal(delta.update.length,0);
});

test('keyboard handlers assign extensions, insert palette nodes, and offer undo', () => {
  const app=loadApp();let added,inserted,undone=false;
  app.context.add=(...args)=>{added=args;};app.context.insert=(...args)=>{inserted=args;};app.context.undo=()=>{undone=true;};
  app.evaluate('state.view="services"; state.serviceGroups={queues:[{id:"500",serviceNumber:"500",memberRevision:"v1"}],skills:[]}; state.selectedServiceKey="queue:500"; addServiceMember=add; addPaletteNodeToCanvas=insert; undoFlowChange=undo;');
  const ext={dataset:{serviceExtensionId:'203'}};
  app.dispatch('keydown',{key:'Enter',target:{closest:s=>s==='[data-service-extension-id]'?ext:null},preventDefault(){}});assert.deepEqual(added,['queue','500','203']);
  app.evaluate('state.view="callflow"');const palette={dataset:{flowPaletteTarget:JSON.stringify({type:'QUEUE',title:'Abrechnung'})},hasAttribute:()=>false};
  app.dispatch('keydown',{key:' ',target:{closest:s=>s.includes('data-flow-palette-target')?palette:null},preventDefault(){}});assert.equal(inserted[0].title,'Abrechnung');
  app.dispatch('keydown',{key:'z',ctrlKey:true,target:{closest:()=>null},preventDefault(){}});assert.equal(undone,true);
});

test('explicit server message metadata localizes status while preserving API names', () => {
  const app=loadApp('fr');app.context.payload={message:'old',messageKey:'portal.server.liveWritesAreEnabledForThisSession',messageParams:{},inventory:{items:[{name:'Open',message:'Abrechnung'}]}};
  const value=app.evaluate('localizeResponseMessages(payload)');assert.equal(value.message,catalog['portal.server.liveWritesAreEnabledForThisSession'].fr);assert.equal(value.inventory.items[0].name,'Open');assert.equal(value.inventory.items[0].message,'Abrechnung');
});

test('deleting a flow node can restore its content and edges without leaking undo across numbers', () => {
  const app=loadApp();const stored=new Map();
  app.context.localStorage.getItem=key=>stored.get(key)||null;
  app.context.localStorage.setItem=(key,value)=>stored.set(key,value);
  app.evaluate(`render=()=>{};renderFlowFeedback=()=>{};renderFlowPlan=()=>{};
    state.overview={account:"A",inventory:{dids:[{id:"1",name:"+442012345678"},{id:"2",name:"+442012345679"}]}};
    state.selectedDidId="1";
    state.flow={nodes:[{id:"inbound",type:"DID",locked:true,x:46,y:24},{id:"step",type:"PHONEEXTENSION",title:"Müller Abrechnung GmbH",config:{extensionNumber:"201"},x:46,y:54},{id:"end",type:"HANGUP",x:75,y:70}],edges:[{from:"inbound",to:"step"},{from:"step",to:"end"}]};
    state.selectedNodeId="step";`);
  const original=app.evaluate('JSON.stringify({nodes:state.flow.nodes,edges:state.flow.edges})');
  app.evaluate('deleteSelectedNode()');
  assert.equal(app.evaluate('state.flow.nodes.some(node=>node.id==="step")'),false);
  assert.ok([...stored.values()].some(value=>value.includes('A:1')));
  app.evaluate('undoFlowChange()');
  assert.equal(app.evaluate('JSON.stringify({nodes:state.flow.nodes,edges:state.flow.edges})'),original);
  assert.equal(app.evaluate('readStoredFlowDrafts()["A:1"].flow.nodes.find(node=>node.id==="step").title'),'Müller Abrechnung GmbH');
  app.evaluate('state.selectedNodeId="step";deleteSelectedNode();state.selectedDidId="2"');
  const different=app.evaluate('JSON.stringify(state.flow)');app.evaluate('undoFlowChange()');
  assert.equal(app.evaluate('JSON.stringify(state.flow)'),different);
});

test('the legacy demo fallback never inherits permission to perform live writes', () => {
  const app=loadApp();app.evaluate('state.overview={settings:{configured:true,liveWritesEnabled:true,liveWritesLocked:false}};state.overview.demoFallback=buildDemoOverview(state.overview);state.demoMode=true');
  assert.equal(app.evaluate('portalLiveWritesEnabled()'),false);
  assert.equal(app.evaluate('getOverview().settings.liveWritesLocked'),true);
});


test('R03: a persisted night target survives reload and no missing choice silently selects the first item', () => {
 const app=loadApp();app.context.choices=[{option:{value:'first'},target:{type:'TIMECONTROL',href:'/time-control-services/0',routeNumber:'0'}},{option:{value:'saved'},target:{type:'PHONEEXTENSION',href:'/phone-extensions/239',routeNumber:'239'}}];
 app.evaluate('state.overview={daynight:{nightTarget:{type:"PHONEEXTENSION",href:"/phone-extensions/239",routeNumber:"239"}}};state.profileTargetValue=""');
 assert.equal(app.evaluate('selectedProfileTarget(choices).routeNumber'),'239');
 app.evaluate('state.profileTargetValue="";state.overview.daynight.nightTarget={type:"PHONEEXTENSION",href:"/phone-extensions/999",routeNumber:"999"}');
 assert.equal(app.evaluate('selectedProfileTarget(choices)'),null);assert.equal(app.evaluate('state.profileTargetValue'),'');
});

test('R12: reviewed stale intent preserves external additions and cancellation preserves the conflict', async () => {
 const app=loadApp();app.context.groups={account:'A',queues:[{id:'500',serviceNumber:'500',name:'Open',memberRevision:'v2',members:[{extensionNumber:'201'},{extensionNumber:'202'},{extensionNumber:'299'}]}],skills:[]};
 app.context.saved={account:'A',queues:{'500':{kind:'queue',serviceNumber:'500',name:'Open',baseRevision:'v1',baseMembers:[{extensionNumber:'201'},{extensionNumber:'202'}],members:[{extensionNumber:'202'},{extensionNumber:'203'}]}},skills:{}};
 app.evaluate('state.overview={account:"A"};state.serviceDraft=reconcileServiceDraft(groups,saved);renderServices=()=>{};window.confirm=()=>{throw new Error("Unexpected native confirmation")}');
 assert.equal(app.evaluate('state.serviceDraftConflicts.length'),1);
 const cancelled=app.evaluate('reviewServiceDraftConflicts()');app.evaluate('closeUiDialog(false)');await cancelled;
 assert.equal(app.evaluate('state.serviceDraftConflicts.length'),1);
 const reviewed=app.evaluate('reviewServiceDraftConflicts()');app.evaluate('closeUiDialog(true)');await reviewed;
 assert.deepEqual(Array.from(app.evaluate('state.serviceDraft.queues["500"].members.map(m=>m.extensionNumber).sort()')),['202','203','299']);
 assert.equal(app.evaluate('state.serviceDraftConflicts.length'),0);assert.equal(app.evaluate('state.serviceDraft.queues["500"].baseRevision'),'v2');
 assert.deepEqual(Array.from(app.evaluate('membershipDelta(state.serviceDraft.queues["500"]).remove')),['201']);
});

test('R07/R15: member-load error metadata translates in every language without translating service names', () => {
 const {serverMessage,responseMessages}=require('../src/messages.cjs');
 for(const language of supportedLanguages){const app=loadApp(language);app.context.payload=responseMessages({queues:[{name:'Abrechnung',memberError:serverMessage('portal.requestFailed',{status:503})}],inventory:{items:[{name:'Open',memberError:'Open'}]}});const value=app.evaluate('localizeResponseMessages(payload)');assert.equal(value.queues[0].memberError,catalog['portal.requestFailed'][language].replace('{status}','503'));assert.equal(value.queues[0].name,'Abrechnung');assert.equal(value.inventory.items[0].memberError,'Open');}
});


test('R13: failed inventory counts and routing are unavailable, never successful zero totals',()=>{
 const app=loadApp();const dom=rendererNodes(app);app.evaluate('state.overview={settings:{configured:true},counts:{dids:0,extensions:0},endpoints:{dids:{ok:false,status:503},extensions:{ok:false,status:503}},inventory:{dids:[],extensions:[]}};renderMetrics();renderRoutingPreview()');
 const metrics=[...dom.nodes.values()].map(n=>n.innerHTML).join('');assert.ok(metrics.includes(">—</strong>"));assert.match(dom.element('#routing-preview').innerHTML,/Data could not be loaded/);assert.doesNotMatch(dom.element('#routing-preview').innerHTML,/No targets/);
});


test('resource popups translate connection labels and empty states in every locale',()=>{
 for(const language of supportedLanguages){const app=loadApp(language);const dom=rendererNodes(app);app.evaluate('state.resourceModalKind="queues";state.overview={settings:{liveWritesEnabled:true},inventory:{queues:[{id:"500",serviceNumber:"500",name:"Abrechnung"}],dids:[],extensions:[],skills:[],ivrs:[],timeControls:[]}};renderResourceModal()');const html=dom.element('#resource-modal-body').innerHTML;assert.ok(html.includes(catalog['portal.connectedTo'][language]),language);assert.ok(html.includes(catalog['portal.noLinkDetected'][language]),language);assert.match(html,/>Abrechnung<\/strong>/);if(language!=='de')assert.doesNotMatch(html,/Verbunden mit|Keine Verknüpfung erkannt/);}
});

test('R-shared-6: actual DOM translation preserves names in bulk selection and resource/extension relations',()=>{
 const {translateMarkup}=require('./helpers/translation-dom.cjs');
 const fullCatalog={...JSON.parse(fs.readFileSync(path.join(root,'../shared/i18n-messages.json'),'utf8')),...catalog};
 const control=translateMarkup('<small>Abrechnung</small>','en',fullCatalog);assert.equal(control.root.textContent,'Billing','the actual translator must translate an unprotected exact match');
 for(const language of supportedLanguages)for(const name of ['Abrechnung','Open','Status','Lager bearbeiten']){
  const app=loadApp(language);const dom=rendererNodes(app);app.context.realName=name;
  const bulk=app.evaluate('renderBulkFlowHelper([{id:"start",locked:true,title:"Start"},{id:"user",title:realName}])');
  const translatedBulk=translateMarkup(bulk,language,fullCatalog);assert.ok(translatedBulk.elements.some(el=>el.tagName==='STRONG'&&el.textContent===name),`${language}: bulk name ${name}`);
  app.evaluate('state.resourceModalKind="queues";state.selectedExtensionId="201";state.overview={settings:{liveWritesEnabled:true},inventory:{queues:[{id:"500",serviceNumber:"500",name:realName,members:[{extensionNumber:"201"}]}],dids:[{id:"did1",name:"+441234",value:realName,destinationType:"QUEUE",destinationServiceNumber:"500"}],extensions:[{id:"201",number:"201",name:realName}],skills:[],ivrs:[],timeControls:[]}};renderResourceModal();renderExtensionDetail()');
  const popup=translateMarkup(dom.element('#resource-modal-body').innerHTML,language,fullCatalog);assert.ok(popup.elements.some(el=>el.tagName==='SMALL'&&el.textContent===name),`${language}: resource detail ${name}`);
  const detail=translateMarkup(dom.element('#extension-detail').innerHTML,language,fullCatalog);assert.ok(detail.elements.some(el=>el.tagName==='SPAN'&&el.textContent===name),`${language}: linked queue ${name}`);
 }
});

test('login method tabs use their locale in the actual shared DOM translator',()=>{
 const {translateMarkup}=require('./helpers/translation-dom.cjs');const fullCatalog={...JSON.parse(fs.readFileSync(path.join(root,'../shared/i18n-messages.json'),'utf8')),...catalog};
 for(const language of supportedLanguages){const app=loadApp(language);const dom=rendererNodes(app);app.evaluate('state.overview={settings:{configured:true,authMode:"env"},inventory:{}};renderAuthLoginPanel()');const translated=translateMarkup(dom.element('#auth-login-panel').innerHTML,language,fullCatalog);const tabs=translated.elements.filter(el=>el.hasAttribute('data-auth-login-mode'));assert.deepEqual(tabs.map(el=>el.textContent),[catalog['portal.signInViaEnv'][language],catalog['portal.signInViaBrowser'][language]],language);if(language!=='en')assert.ok(tabs.every(el=>!el.textContent.includes('Sign in via')),language);}
});

test('night-target fallback follows a language switch while a real target name stays literal',()=>{
 const {translateMarkup}=require('./helpers/translation-dom.cjs');const fullCatalog={...JSON.parse(fs.readFileSync(path.join(root,'../shared/i18n-messages.json'),'utf8')),...catalog};
 const app=loadApp('en');app.evaluate('state.overview={settings:{configured:true},inventory:{extensions:[{id:"201",number:"201",name:"Abrechnung"}],dids:[],queues:[],skills:[],ivrs:[],timeControls:[],announcements:[]}};state.profileTargetValue=""');
 const empty=app.evaluate('gatewayTargetControlMarkup()');assert.match(empty,/No target selected/);
 app.evaluate('state.profileTargetValue=parsedDaynightTargetOptions().find(({target})=>target.title==="Abrechnung").option.value');const selected=app.evaluate('gatewayTargetControlMarkup()');
 for(const language of supportedLanguages){const translated=translateMarkup(empty,language,fullCatalog);assert.ok(translated.elements.some(el=>el.tagName==='STRONG'&&el.textContent===catalog['portal.noTargetSelected'][language]),language);const actual=translateMarkup(selected,language,fullCatalog);assert.ok(actual.elements.some(el=>el.tagName==='STRONG'&&el.textContent==='Abrechnung'),language);}
});

test('R3: language switch rerenders a checked night plan without altering user-authored target fields', () => {
  const app = loadApp('fr');
  app.evaluate(`globalThis.planElement = { innerHTML: '', querySelectorAll: () => [] };
    document.querySelector = selector => selector === '#daynight-gateway-preview' ? planElement : null;
    state.overview = { inventory: { dids: [], timeControls: [], announcements: [], extensions: [] }, settings: {} };
    state.profileTargetValue = JSON.stringify({type:'HANGUP',title:'Hang up',routeNumber:'HANGUP',number:'HANGUP'});
    state.daynightAnnouncementDisplayName = 'Kundenname unverändert';
    state.daynightAnnouncementDisplayNameEdited = true;
    state.daynightGatewayPreview = {ok:false, messageKey:'portal.timeControlNotOwned', message:'provider text', summary:{total:3}, entries:[], blockers:[{messageKey:'portal.timeControlNotOwned',message:'provider text',label:'Kundenname unverändert'}]};`);
  app.setLanguage('de');
  assert.match(app.evaluate('planElement.innerHTML'), /Eine Zeitsteuerung mit diesem Namen/);
  assert.match(app.evaluate('planElement.innerHTML'), /Bereinigung/);
  assert.doesNotMatch(app.evaluate('planElement.innerHTML'), /provider text|Un contrôle horaire/);
  assert.equal(app.evaluate('state.daynightAnnouncementDisplayName'), 'Kundenname unverändert');
  assert.equal(app.evaluate('JSON.parse(state.profileTargetValue).routeNumber'), 'HANGUP');
  app.setLanguage('fi');
  assert.match(app.evaluate('planElement.innerHTML'), /Tämänniminen aikaohjaus/);
  assert.match(app.evaluate('planElement.innerHTML'), /Kundenname unverändert/);
});

test('R4-I18N-01: selected HANGUP summary follows language changes without reselection', () => {
  const app = loadApp('fi');
  const dom = rendererNodes(app);
  app.evaluate(`state.overview = buildDemoOverview({settings:{configured:true,liveWritesEnabled:false}});
    state.profileTargetValue = daynightTargetOptions().find(option => option.kind === 'HANGUP').value;
    state.daynightAnnouncementDisplayName = 'Kundenname unverändert';
    state.daynightAnnouncementDisplayNameEdited = true;
    renderFlowProfileActions();`);
  assert.ok(dom.element('#daynight-summary').innerHTML.includes(catalog['portal.hangUp'].fi + ' HANGUP'));
  for (const language of supportedLanguages) {
    app.setLanguage(language);
    assert.ok(dom.element('#daynight-summary').innerHTML.includes(catalog['portal.hangUp'][language] + ' HANGUP'), language);
    assert.equal(app.evaluate('selectedProfileTarget().routeNumber'), 'HANGUP');
    assert.equal(app.evaluate('state.daynightAnnouncementDisplayName'), 'Kundenname unverändert');
  }
});

test('R4-I18N-01: language changes preserve a named night target and its route', () => {
  const app = loadApp('fi');
  const dom = rendererNodes(app);
  app.evaluate(`state.overview={settings:{configured:true},inventory:{extensions:[{id:'201',number:'201',name:'Abrechnung & Partners'}],dids:[],queues:[],skills:[],ivrs:[],timeControls:[],announcements:[]}};
    state.profileTargetValue=parsedDaynightTargetOptions().find(({target})=>target.title==='Abrechnung & Partners').option.value;
    renderFlowProfileActions();`);
  for (const language of supportedLanguages) {
    app.setLanguage(language);
    assert.ok(dom.element('#daynight-summary').innerHTML.includes('Abrechnung &amp; Partners 201'), language);
    assert.equal(app.evaluate('selectedProfileTarget().title'), 'Abrechnung & Partners');
    assert.equal(app.evaluate('selectedProfileTarget().routeNumber'), '201');
  }
});

test('R4-I18N-02: current phonebook count uses the locale for zero, one and many contacts', () => {
  const { translateMarkup } = require('./helpers/translation-dom.cjs');
  const app = loadApp('en');
  const dom = rendererNodes(app);
  for (const language of supportedLanguages) {
    app.setLanguage(language);
    for (const count of [0, 1, 18]) {
      app.evaluate(`state.overview={settings:{configured:true},inventory:{phoneBooks:Array.from({length:${count}},(_,i)=>({name:'Abrechnung & Partners',value:'+490000'+i}))},counts:{phoneBooks:${count}}};renderPhonebookSync();`);
      const html = dom.element('#phonebook-sync-summary').innerHTML;
      const expected = catalog['portal.valueEntries'][language].replace('{p11}', String(count));
      const rendered = translateMarkup(html, language, catalog);
      const countElement = rendered.elements.find(element => element.getAttribute('data-i18n-key') === 'portal.valueEntries');
      assert.equal(countElement?.textContent, expected, language + '/' + count);
      assert.doesNotMatch(countElement.textContent, /\{p\d+\}/);
      const switched = translateMarkup(html, 'fi', catalog);
      assert.equal(switched.elements.find(element => element.getAttribute('data-i18n-key') === 'portal.valueEntries').textContent, 'Merkinnät: ' + count);
      if (count) assert.ok(html.includes('data-i18n-ignore>Abrechnung &amp; Partners'), language);
    }
  }
});

test('R3: restored count, including zero, is the modal feedback in every language', () => {
  for (const language of supportedLanguages) {
    const app = loadApp(language);
    app.evaluate(`state.daynightModeModal={mode:'day', restoredRoutings:0, message:'old'};`);
    app.setLanguage(language);
    assert.equal(app.evaluate('state.daynightModeModal.message'), catalog['portal.valueNumbersRestored'][language].replace('{p0}', '0'));
  }
});
