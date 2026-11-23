const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "public/app.js"), "utf8");
const catalog = { ...JSON.parse(fs.readFileSync(path.join(root, "../shared/i18n-messages.json"), "utf8")), ...JSON.parse(fs.readFileSync(path.join(root, "i18n-messages.json"), "utf8")) };
const languages = ["en", "de", "fr", "es", "it", "nl", "pl", "pt", "sv", "da", "fi", "cs"];
const clients = [
  ["standalone", source],
  ["static demo", fs.readFileSync(path.join(root, "../docs/cti/app.js"), "utf8")],
];

function element() {
  const attrs = new Map();
  return {
    textContent: "", innerHTML: "", value: "", hidden: false, dataset: {},
    classList: { add() {}, remove() {}, toggle() {} },
    addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; },
    setAttribute(key, value) { attrs.set(key, value); },
    getAttribute(key) { return attrs.get(key); },
    removeAttribute(key) { attrs.delete(key); },
    closest() { return null; },
  };
}

function app(language = "en", nodes = {}, clientSource = source) {
  let currentLanguage = language;
  let requests = 0;
  const listeners = new Map();
  const document = {
    getElementById(id) { return nodes[id] || null; },
    querySelectorAll() { return []; },
    addEventListener(name, listener) { listeners.set(name, listener); },
    documentElement: { lang: language }, body: { classList: { add() {}, remove() {} } },
    activeElement: null,
  };
  const runtime = {
    getLanguage: () => currentLanguage,
    message(key, params) {
      const text = catalog[key]?.[currentLanguage] || catalog[key]?.en || "";
      return text.replace(/\{(\w+)\}/g, (_, key) => String(params[key] ?? `{${key}}`));
    },
  };
  const sandbox = {
    window: { NFON_PHONE: require("../public/phone-number.js"), NFON_I18N: runtime, location: { protocol: "http:", pathname: "/" }, addEventListener() {} },
    document, localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    Intl, Date, URL, URLSearchParams, Blob, Map, setTimeout, clearTimeout,
    fetch() { requests++; throw new Error("Unexpected network call"); },
  };
  vm.createContext(sandbox);
  vm.runInContext(clientSource.replace(/\nstartApp\(\);\s*$/, ""), sandbox);
  return {
    run: (code) => vm.runInContext(code, sandbox), document, sandbox, runtime,
    switchLanguage(language) { currentLanguage = language; },
    fireLanguageChange() { listeners.get("nfon:language-change")(); },
    dispatch(name, event) { listeners.get(name)?.(event); },
    requests: () => requests,
  };
}

function seedHistory(a) {
  a.run(`state.extensions = [{extension_number: "100", name: "Frei & Leitung"}];
    state.contactCache.set("490000010001", {name: "Angenommen <Test>", organization: "Neue Kontakte"});
    state.history = [
      {uuid:"synthetic-call", extension:"100", caller:"490000010001", callee:"100", direction:"inbound", state:"ring", updated:"2026-09-24T08:00:00Z"},
      {uuid:"synthetic-call", extension:"100", caller:"490000010001", callee:"100", direction:"inbound", state:"answer", updated:"2026-09-24T08:00:05Z"},
      {uuid:"synthetic-call", extension:"100", caller:"490000010001", callee:"100", direction:"inbound", state:"hangup", updated:"2026-09-24T08:01:05Z"}
    ];`);
}

test("every CTI key is complete in all 12 languages with unchanged parameters", () => {
  const texts = [source, ...["index", "analytics", "setup", "contacts"].map((page) => fs.readFileSync(path.join(root, `public/${page}.html`), "utf8"))];
  const used = new Set(texts.join("\n").match(/cti\.[A-Za-z][A-Za-z0-9.]+/g));
  for (const key of used) assert.ok(catalog[key], `${key}: canonical message missing`);
  for (const [key, translations] of Object.entries(catalog)) {
    for (const language of languages) {
      assert.equal(typeof translations[language], "string", `${key}: ${language} copy missing`);
      assert.ok(translations[language].trim(), `${key}: ${language} copy empty`);
      assert.deepEqual([...translations.en.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), [...translations[language].matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort(), `${key}: ${language} parameter mismatch`);
    }
  }
});

test("all empty CSV and Excel headers follow the selected language", () => {
  const a = app();
  assert.equal(a.run("rowsToCsv([])"), "Date;Status;Direction;From;To;Extension;Duration;Events;Call ID");
  assert.match(a.run("rowsToHtmlTable([])"), /<th>Date<\/th>/);
  a.switchLanguage("de");
  assert.equal(a.run("rowsToCsv([])"), "Datum;Status;Richtung;Von;An;Nebenstelle;Dauer;Ereignisse;Anruf-ID");
  a.switchLanguage("fr");
  assert.equal(a.run("rowsToCsv([])"), "Date;Statut;Direction;De;Vers;Poste;Durée;Événements;ID d’appel");
});

test("populated exports localize copy without changing actual records or IDs", async () => {
  const a = app(); seedHistory(a);
  const english = await a.run("exportRows()");
  assert.equal(english[0].Status, "Answered");
  assert.equal(english[0].Direction, "Inbound");
  assert.match(english[0].From, /^Angenommen <Test> · Neue Kontakte/);
  assert.equal(english[0].To, "Frei & Leitung · Extension 100");
  assert.equal(english[0]["Call ID"], "synthetic-call");
  assert.equal(english[0].Duration, "01:00");
  a.switchLanguage("de");
  const german = await a.run("exportRows()");
  assert.equal(german[0].Status, "Angenommen");
  assert.equal(german[0].Richtung, "Eingehend");
  assert.equal(german[0].An, "Frei & Leitung · Nebenstelle 100");
  assert.equal(german[0].Von, english[0].From);
  assert.equal(a.requests(), 0);
});

test("CSV formula protection and HTML escaping survive localization", () => {
  const a = app();
  assert.equal(a.run('csvCell("=HYPERLINK(1)")'), '"\'=HYPERLINK(1)"');
  assert.match(a.run('rowsToHtmlTable([{Date: "<script>alert(1)</script>"}])'), /&lt;script&gt;/);
  assert.doesNotMatch(a.run('messageMarkup("cti.extension.named", "{name}", {name: "<img src=x>", extension: "100"})'), /<img/);
});

test("status, popup labels, dates and elapsed time follow current language", () => {
  const a = app();
  assert.equal(a.run('label("dnd", "presence")'), "Do not disturb");
  assert.equal(a.run('label("caller-ring", "call")'), "Extension ringing");
  assert.equal(a.run('minutesSince(new Date())'), "Less than 1 minute");
  assert.equal(a.run('formatDuration(60000, true)'), "1 min");
  const englishDate = a.run('formatDate("2026-09-24T08:00:00Z")');
  a.switchLanguage("de");
  assert.equal(a.run('label("dnd", "presence")'), "Bitte nicht stören");
  assert.equal(a.run('label("caller-ring", "call")'), "Nebenstelle klingelt");
  assert.equal(a.run('formatDuration(60000, true)'), "1 Min");
  assert.notEqual(a.run('formatDate("2026-09-24T08:00:00Z")'), englishDate);
  a.switchLanguage("en");
  assert.equal(a.run('label("dnd", "presence")'), "Do not disturb");
});

test("language change preserves mounted forms and never requests data", () => {
  const auth = element(); auth.innerHTML = "existing draft form";
  const contact = element(); contact.innerHTML = "existing selected file";
  const a = app("en", { "account-label": element(), "connection-state": element(), "auth-login-panel": auth, "contacts-status": contact });
  a.switchLanguage("de"); a.fireLanguageChange();
  a.switchLanguage("en"); a.fireLanguageChange();
  assert.equal(auth.innerHTML, "existing draft form");
  assert.equal(contact.innerHTML, "existing selected file");
  assert.equal(a.requests(), 0);
});

test("server refresh preserves the actual form node, values, file and caret", () => {
  const a = app();
  const selectedFile = { name: "Keine Datei.png" };
  let focused = false;
  let selection;
  const field = { value: "User & actual data", files: [selectedFile], selectionStart: 2, selectionEnd: 5,
    focus() { focused = true; }, setSelectionRange(...range) { selection = range; } };
  const form = { contains: (node) => node === field, field };
  let current = form;
  const replacement = { replaceWith(node) { current = node; } };
  const container = { querySelector() { return current; }, set innerHTML(value) { current = replacement; } };
  a.document.activeElement = field;
  a.sandbox.container = container;
  a.run('replaceContentPreservingForm(container, "new surrounding status", "form")');
  assert.equal(current, form);
  assert.equal(current.field.files[0], selectedFile);
  assert.equal(current.field.value, "User & actual data");
  assert.equal(focused, true);
  assert.deepEqual(selection, [2, 5]);
});

test("known local API errors localize only their owned prefix", () => {
  const a = app();
  assert.match(a.run('copyMarkup(errorCopy("Google Kontakte konnten nicht gelesen werden: Externer Name"))'), /Could not read Google contacts: Externer Name/);
  a.switchLanguage("de");
  assert.match(a.run('copyMarkup(errorCopy("Name and phone number are required"))'), /Name und Telefonnummer sind erforderlich/);
  assert.equal(a.run('errorCopy("A customer message in Deutsch")'), "A customer message in Deutsch");
});

test("record names are explicitly protected in table and contact markup", () => {
  const nodes = { "extensions-body": element(), "contacts-list": element() };
  const a = app("en", nodes); seedHistory(a);
  a.run('renderExtensions(buildAnalytics())');
  assert.match(nodes["extensions-body"].innerHTML, /data-i18n-ignore>Frei &amp; Leitung<\/td>/);
  a.run('state.contactsMode = "local"; state.contacts = [{id:"test", name:"Verfügbar", organization:"Neue Kontakte", source:"local", phones:[]}]; renderContactsPage()');
  assert.match(nodes["contacts-list"].innerHTML, /data-i18n-ignore>Verfügbar<\/strong>/);
  assert.match(nodes["contacts-list"].innerHTML, /data-i18n-key="cti.contacts.noPhone"/);
});

test("all pages bootstrap appearance before CSS and setup owns a stable settings host", () => {
  for (const page of ["index", "analytics", "setup", "contacts"]) {
    const html = fs.readFileSync(path.join(root, `public/${page}.html`), "utf8");
    assert.ok(html.indexOf('/appearance.js') < html.indexOf('/styles.css'), page);
    assert.ok(html.indexOf('/appearance.css') > html.indexOf('/styles.css'), page);
    assert.doesNotMatch(html, /\b(?:Übersicht|Auswertungen|Nebenstellen|Speicherung)\b/);
  }
  const html = fs.readFileSync(path.join(root, "public/setup.html"), "utf8");
  assert.match(html, /<div data-appearance-settings><\/div>\s*<section[^>]*id="auth-login-panel"/);
});

for (const [clientName, clientSource] of clients) {
  test(`${clientName}: exports and status messages follow all 12 languages without altering call data`, async () => {
    const a = app("en", {}, clientSource); seedHistory(a);
    const original = a.run("JSON.stringify({ history: state.history, extensions: state.extensions, contacts: [...state.contactCache] })");
    const headerKeys = ["date", "status", "direction", "from", "to", "extension", "duration", "events", "callId"];
    for (const language of languages) {
      a.switchLanguage(language);
      const headers = headerKeys.map((key) => catalog[`cti.export.${key}`][language]);
      assert.equal(a.run("rowsToCsv([])"), headers.join(";"), `${language} empty export headers`);
      const rows = await a.run("exportRows()");
      assert.deepEqual(Object.keys(rows[0]), headers, `${language} populated export headers`);
      assert.equal(rows[0][headers[1]], catalog["cti.call.answered"][language]);
      assert.equal(rows[0][headers[2]], catalog["cti.direction.inbound"][language]);
      assert.match(rows[0][headers[3]], /^Angenommen <Test> · Neue Kontakte/);
      assert.match(rows[0][headers[4]], /^Frei & Leitung · /);
      assert.equal(rows[0][headers[8]], "synthetic-call");
      assert.equal(a.run('label("caller-ring", "call")'), catalog["cti.call.callerRing"][language]);
      assert.equal(a.run('label("away", "presence")'), catalog["cti.presence.away"][language]);
      assert.equal(a.run('label("custom API value", "call")'), catalog["cti.unknownInfo"][language]);
      assert.equal(a.run('(() => { const error = errorCopy("Google Kontakte konnten nicht gelesen werden: Original API detail"); return message(error.key, error.fallback, error.params); })()'), catalog["cti.error.googleContactsRead"][language].replace("{detail}", ": Original API detail"));
    }
    assert.equal(a.run("JSON.stringify({ history: state.history, extensions: state.extensions, contacts: [...state.contactCache] })"), original);
    assert.equal(a.requests(), 0);
  });

  test(`${clientName}: switching all languages preserves contact and credential drafts, searches and file selection`, () => {
    const fields = {
      firstName: { value: "Example" }, lastName: { value: "Beispiel" }, organization: { value: "Example Company" },
      password: { value: "synthetic-unsaved-password" },
      photo: { files: [{ name: "Keine Datei.png" }] },
    };
    const auth = element(); auth.innerHTML = "mounted login form"; auth.querySelector = () => fields.password;
    const contacts = element(); contacts.innerHTML = "mounted contact form"; contacts.querySelector = () => fields;
    const nodes = { "account-label": element(), "connection-state": element(), "auth-login-panel": auth,
      "contacts-status": contacts, "contact-filter": element(), "extension-filter": element(), "callee-input": element() };
    nodes["contact-filter"].value = "Untranslated search";
    nodes["extension-filter"].value = "Frei & Leitung";
    nodes["callee-input"].value = "+4900000001";
    const file = fields.photo.files[0];
    const a = app("en", nodes, clientSource); seedHistory(a);
    a.document.activeElement = fields.lastName;
    const drafts = JSON.stringify(fields);
    for (const language of languages) {
      a.switchLanguage(language); a.fireLanguageChange();
      assert.equal(auth.innerHTML, "mounted login form");
      assert.equal(contacts.innerHTML, "mounted contact form");
      assert.equal(JSON.stringify(fields), drafts, `${language} retains entered text even when it equals a demo placeholder`);
      assert.equal(fields.photo.files[0], file);
      assert.equal(a.document.activeElement, fields.lastName);
      assert.equal(nodes["contact-filter"].value, "Untranslated search");
      assert.equal(nodes["extension-filter"].value, "Frei & Leitung");
      assert.equal(nodes["callee-input"].value, "+4900000001");
    }
    assert.equal(a.requests(), 0);
    assert.match(clientSource, /placeholder="Example" data-i18n-placeholder="cti\.contacts\.exampleLast"/);
    for (const language of languages) assert.ok(catalog["cti.contacts.exampleLast"][language]);
  });

  test(`${clientName}: contact source fallback translates while entered company names remain verbatim`, () => {
    const list = element();
    const a = app("en", { "contacts-list": list }, clientSource);
    a.run('state.contactsMode = "google"; state.contacts = [{id:"one",source:"google",name:"Real name",organization:"",phones:[]},{id:"two",source:"google",name:"Other name",organization:"Google Contact",phones:[]}];');
    for (const language of languages) {
      a.switchLanguage(language); a.run("renderContactsPage()");
      assert.match(list.innerHTML, /data-i18n-key="cti.contacts.googleContact"/);
      assert.ok(list.innerHTML.includes(catalog["cti.contacts.googleContact"][language]));
      assert.match(list.innerHTML, /data-i18n-ignore>Google Contact<\/span>/);
    }
  });
}

test("live and static CTI start in English and explicitly translate the remaining headings", () => {
  for (const directory of ["public", "../docs/cti"]) {
    for (const page of ["index", "analytics", "setup", "contacts"]) {
      const html = fs.readFileSync(path.join(root, directory, `${page}.html`), "utf8");
      assert.match(html, /<html lang="en">/);
      assert.match(html, /data-i18n-key="cti.nav.setup"/);
      assert.doesNotMatch(html, /<h2>(?:Trend|Team)<\/h2>|<th>Name<\/th>/);
    }
  }
});

test('audit: destination answer is required, ready means available and idle, and curves cannot overshoot zero', () => {
  const a=app();
  const result=a.run(`buildCallSessions([{uuid:'setup-only',state:'caller-answer',updated:'2026-10-17T08:00:00Z',direction:'outbound'},{uuid:'setup-only',state:'hangup',updated:'2026-10-17T08:00:15Z',direction:'outbound'}])[0]`);
  assert.equal(result.answered,false); assert.equal(result.durationMs,0);
  const curve=a.run('smoothPath([{x:0,y:126},{x:10,y:60},{x:20,y:126},{x:30,y:126}])');
  const values=curve.match(/-?\d+(?:\.\d+)?/g).map(Number);assert.ok(values.every(x=>x>=0&&x<=126));
  const ready=element(); const b=app('en',{'metric-available':ready});b.run('state.states=[{presence:"available",line:"offline"},{presence:"available",line:"ringing"},{presence:"available",line:"idle"}];renderMetrics(buildAnalytics())');assert.equal(ready.textContent,1);
});

test('audit: export timestamps remain unambiguous across years and DST; phone text and formulas stay separate',async()=>{
 const a=app();seedHistory(a);const rows=await a.run('exportRows()');assert.equal(rows[0].Date,'2026-09-24T08:00:00.000Z');
 assert.equal(a.run('csvCell("+49123456")'),'"+49123456"');
 for(const input of ['\t=1+1','\r=1+1',' +SUM(1)','@HYPERLINK(1)']) assert.ok(a.run(`csvCell(${JSON.stringify(input)})`).startsWith('"\''));
 const xls=a.run('rowsToHtmlTable([{Name:"=HYPERLINK(1)",Number:"+49123456"}])');assert.match(xls,/mso-number-format/);assert.match(xls,/x:str/);assert.doesNotMatch(xls,/<script/);
});

test('audit: history is never mixed with legacy local synthetic data and live/static implementations stay identical',()=>{
 assert.equal(source,clients[1][1]);
 for(const [name,client] of clients){const a=app('en',{},client);a.run('state.history=[{uuid:"real"}];state.demoHistory=[{uuid:"synthetic"}];state.demoEnabled=true');assert.equal(a.run('JSON.stringify(historySource())'),'[{"uuid":"real"}]',name);}
});

test('audit: event deltas update history, snapshots without calls do not crash and analytics is reused between pointer moves',()=>{
 const a=app();a.run('render=()=>{};maybeShowCallPopup=()=>{};handleEvent({type:"call",call:{uuid:"delta",state:"ring",updated:"2026-10-17T08:00:00Z"},activeCalls:[]})');
 assert.equal(a.run('state.history[0].uuid'),'delta');a.run('handleEvent({type:"call",history:[],activeCalls:[]})');assert.equal(a.run('state.history.length'),0);
 assert.equal(a.run('buildAnalytics()===buildAnalytics()'),true);
});

test('audit: unknown/offline/caller-wait labels and minute durations are localized without lowercasing names',()=>{
 const a=app();for(const l of languages){a.switchLanguage(l);assert.equal(a.run('label("offline","line")'),catalog['cti.presence.offline'][l]);assert.equal(a.run('label("caller-wait","call")'),catalog['cti.call.callerWait'][l]);assert.equal(a.run('formatPhone("unknown")'),catalog['cti.unknown'][l]);const elapsed=a.run('minutesSince(new Date(Date.now()-5*60000).toISOString())');assert.doesNotMatch(elapsed,/Minuty:|Počet minut:/);}
});

test('audit: repeated form submission issues only one request and re-enables the submit button',async()=>{
 const form=element(),submit=element(),caller=element(),callee=element();let handler;
 form.addEventListener=(event,fn)=>{if(event==='submit')handler=fn};form.querySelector=()=>submit;callee.value='+49000002001';caller.value='201';callee.select=()=>{};
 const a=app('en',{'dial-form':form,'caller-select':caller,'callee-input':callee});
 let resolveRequest, calls=0;a.sandbox.window.request=()=>{calls++;return new Promise(r=>resolveRequest=r)};a.run('api=window.request');
 const first=handler({preventDefault(){}}),second=handler({preventDefault(){}});assert.equal(calls,1);assert.equal(submit.disabled,true);
 resolveRequest({uuid:'one'});await Promise.all([first,second]);assert.equal(submit.disabled,false);assert.equal(a.run('state.dialPending'),false);
});

test('audit: an SSE event received during refresh cannot be overwritten by older HTTP responses',async()=>{
 const a=app();const pending=[];a.sandbox.window.request=route=>new Promise(resolve=>pending.push({route,resolve}));a.run('api=window.request;render=()=>{};maybeShowCallPopup=()=>{}');
 const refresh=a.run('refreshAll()');assert.equal(pending.length,1);pending[0].resolve({csrfToken:'current',credentialsConfigured:true});await new Promise(setImmediate);assert.equal(pending.length,5);
 a.run('handleEvent({type:"call",call:{uuid:"newer",state:"answer",updated:"2026-10-17T08:01:00Z"},activeCalls:[]})');
 for(const {route,resolve} of pending)resolve(route==='/api/status'?{csrfToken:'current'}:[]);await refresh;
 assert.equal(a.run('state.history[0].uuid'),'newer');assert.equal(a.run('state.refreshPending'),false);
});

test('audit: stale CSRF is refreshed once before retrying a mutation rejected before execution',async()=>{
 const a=app();const requests=[];a.run('state.csrfToken="old"');
 a.sandbox.fetch=async(url,options)=>{requests.push({url,options});if(url==='/api/status')return new Response(JSON.stringify({csrfToken:'new'}));if(requests.length===1)return new Response(JSON.stringify({error:'Missing or invalid CSRF token'}),{status:403});return new Response(JSON.stringify({uuid:'one'}));};
 const result=await a.run('api("/api/calls",{method:"POST",body:JSON.stringify({callee:"+49000002001"})})');assert.equal(result.uuid,'one');assert.equal(requests.length,3);assert.equal(requests[2].options.headers['X-CSRF-Token'],'new');assert.equal(requests[0].options.body,requests[2].options.body);
});


test('Google start URLs carry only validated current presentation preferences',()=>{
 const a=app('de');a.sandbox.window.NFON_APPEARANCE={getTheme:()=> 'classic'};assert.equal(a.run('googleLoginPath()'),'/auth/google/start?theme=classic&lang=de');
 a.switchLanguage('xx');a.sandbox.window.NFON_APPEARANCE.getTheme=()=> 'https://invalid.example';assert.equal(a.run('googleLoginPath()'),'/auth/google/start?');
});

test('synthetic CTI header is explicitly neutral Demo while live mode keeps its connection status',()=>{
 const staticConnection=element();const staticUi=app('en',{'account-label':element(),'connection-state':staticConnection},source.replace('Boolean(window.NFON_WEB_ONLY_DEMO)','true'));
 staticUi.run('renderStatus()');assert.equal(staticConnection.textContent,'Demo');assert.equal(staticConnection.getAttribute('data-status-mode'),'demo');assert.equal(staticConnection.className,'connection');
 const connection=element();connection.setAttribute('data-status-mode','demo');const liveUi=app('en',{'account-label':element(),'connection-state':connection});
 liveUi.run('state.status={credentialsConfigured:true,streams:{calls:{connected:true},states:{connected:true}}};renderStatus()');assert.equal(connection.textContent,'Live');assert.equal(connection.getAttribute('data-status-mode'),undefined);
});

// R-CTI-1: a single provider timestamp must not poison the whole export.
test('malformed updated falls back to receivedAt; entirely undated rows still export', async()=>{
 const a=app();a.run(`state.history=[{uuid:'bad-date',extension:'100',state:'hangup',updated:'2013-10-27T13:01:10:00.069620809+02:00',receivedAt:'2026-10-17T12:00:00Z'},{uuid:'no-date',extension:'100',state:'end',updated:'invalid',receivedAt:'invalid'}]`);
 const rows=await a.run('exportRows()');assert.equal(rows.length,2);
 assert.equal(rows.find(r=>r['Call ID']==='bad-date').Date,'2026-10-17T12:00:00.000Z');
 assert.equal(rows.find(r=>r['Call ID']==='no-date').Date,'');
});

test('R-CTI-9 count messages stay grammatically neutral for zero, one and multiple records in all languages',()=>{
 for(const language of languages){const a=app(language);for(const count of [0,1,2]){
  const connected=a.run(`message('cti.contacts.connectedCount','',{count:${count}})`);assert.match(connected,new RegExp(': '+count+'$'));
  const answered=a.run(`message('cti.analytics.answeredCount','',{count:${count}})`);assert.match(answered,new RegExp(': '+count+'$'));
  const imported=a.run(`message('cti.backup.imported','',{imported:${count},duplicates:${count}})`);assert.ok(imported.includes(': '+count));assert.doesNotMatch(imported,/\{/);
 }}
});

test('R-CTI-10 byte decimals follow locale and German labels avoid the reported English terms',()=>{
 const a=app('de');assert.equal(a.run('formatBytes(1536)'),'1,5 KB');a.switchLanguage('en');assert.equal(a.run('formatBytes(1536)'),'1.5 KB');
 for(const translations of Object.values(catalog))assert.doesNotMatch(translations.de,/Call History|Call-Verlauf|Call-ID|API Username|API Password|Top 3 User|Userdaten|Secret-Datei|Login via/);
 for(const key of ['cti.contacts.lookup','cti.error.googleCode','cti.error.googleLogin'])assert.doesNotMatch(catalog[key].de,/Lookup|Login/);
});

test('R3-CTI-03 dial authentication errors render the retry state in every language',()=>{
 for(const language of languages){
  const a=app(language,{'connection-state':element(),'account-label':element()});
  const result=a.run("errorCopy('Call request failed with HTTP 401')");assert.equal(result.key,'cti.error.nfonRetry');
  const text=a.run("message(errorCopy('Call request failed with HTTP 401').key,'')");assert.equal(text,catalog['cti.error.nfonRetry'][language]);
  a.run("state.status={credentialsConfigured:true,streams:{calls:{connected:true},states:{connected:true}},lastError:'NFON sign-in failed',authRetryAt:Date.now()+30000};renderStatus()");
  assert.notEqual(a.document.getElementById('connection-state').textContent,'Live');
 }
});

test('R3-CTI-07 keyboard focus on a row action clears the unrelated detail popover',()=>{
 const popover=element(),chip=element(),row=element(),button=element();
 popover.hidden=true;chip.dataset={lineStatus:'idle'};row.dataset={extensionRow:'21'};row.hasAttribute=()=>false;
 chip.matches=()=>true;chip.closest=()=>chip;chip.hasAttribute=key=>key==='data-line-status';chip.getBoundingClientRect=()=>({left:0,bottom:20});
 button.matches=()=>false;button.closest=()=>row;button.getBoundingClientRect=()=>({left:100,bottom:20});
 const a=app('en',{'insight-popover':popover});
 a.run('showLineStatusPopover=()=>{els.popover.hidden=false};showExtensionPopover=()=>{els.popover.hidden=false};positionPopover=()=>{}');
 a.dispatch('focusin',{target:chip});
 assert.equal(popover.hidden,false);assert.equal(chip.getAttribute('aria-describedby'),'insight-popover');
 a.dispatch('focusin',{target:button});
 assert.equal(popover.hidden,true);assert.equal(chip.getAttribute('aria-describedby'),undefined);
 assert.equal(row.getAttribute('aria-describedby'),undefined);assert.equal(button.getAttribute('aria-describedby'),undefined);
});

test('R-CTI-12 storage event count excludes contacts and static setup has no sign-in state',()=>{
 const nodes={'storage-summary':element(),'auth-login-panel':element()};const a=app('en',nodes);
 a.run(`state.storage={files:{'call-events.jsonl':{records:5,bytes:10},'google-contacts.json':{records:4,bytes:20}}};renderStoragePage()`);
 assert.match(nodes['storage-summary'].innerHTML,/<strong>5<\/strong>/);assert.doesNotMatch(nodes['storage-summary'].innerHTML,/<strong>9<\/strong>/);
 const staticSource=source.replace('const STATIC_DEMO_MODE = Boolean(window.NFON_WEB_ONLY_DEMO);','const STATIC_DEMO_MODE = true;');
 const demo=app('en',nodes,staticSource);demo.run('renderAuthLoginPanel()');assert.equal(nodes['auth-login-panel'].hidden,true);
});

test('R-CTI-13 status contact revision invalidates positive and negative lookups',()=>{
 const a=app();a.run(`state.contactCache.set('a',null);state.contactCache.set('b',{name:'Old'});invalidateContacts({contactsRevision:'1'})`);assert.equal(a.run('state.contactCache.size'),0);
 a.run(`state.contactCache.set('b',{name:'New'});invalidateContacts({contactsRevision:'1'})`);assert.equal(a.run('state.contactCache.size'),1);
 a.run(`invalidateContacts({contactsRevision:'2'})`);assert.equal(a.run('state.contactCache.size'),0);
});

test('R-CTI-8 failed remote revocation is visible after local disconnect in all languages',()=>{
 const nodes={'contacts-list':element(),'contacts-status':element()};
 for(const language of languages){const a=app(language,nodes);a.run(`state.google={configured:true,connected:false,lastError:'Google token revocation failed'};renderContactsPage()`);assert.ok(nodes['contacts-status'].innerHTML.includes(catalog['cti.contacts.revocationWarning'][language]));}
});

test('R-CTI-13 successful contact writes invalidate cached lookup results even without SSE',async()=>{
 const a=app();let lookups=0;
 a.sandbox.fetch=async url=>({ok:true,status:200,text:async()=>String(url).includes('/lookup')?(lookups++,JSON.stringify({contact:{name:'New'}})):JSON.stringify({ok:true})});
 a.run(`state.csrfToken='fixture';state.contactCache.set('49301234567',{name:'Old'})`);
 assert.equal((await a.run(`lookupContact('+49301234567')`)).name,'Old');assert.equal(lookups,0);
 await a.run(`api('/api/local-contacts',{method:'POST',body:'{}'})`);
 assert.equal((await a.run(`lookupContact('+49301234567')`)).name,'New');assert.equal(lookups,1);
});

test('R2-CTI-05 analytics count labels remain neutral at zero, one, two and five in all 12 languages',()=>{
 for(const language of languages){const nodes={'timeline-kicker':element(),'timeline-chart':element(),'team-kicker':element(),'team-ranking':element(),'quality-panel':element()};const a=app(language,nodes);
 for(const count of [0,1,2,5]){
  for(const key of ['cti.analytics.active','cti.analytics.missedCount'])assert.match(a.run(`message(${JSON.stringify(key)},'',{count:${count}})`),new RegExp(': '+count+'$'));
  for(const key of ['cti.analytics.summary','cti.analytics.extensionSummary','cti.analytics.userSummary']){
   const value=a.run(`message(${JSON.stringify(key)},'',{extension:'21',answered:${count},missed:${count},inbound:${count},outbound:${count}})`);
   assert.doesNotMatch(value,/\{/);assert.ok(value.includes(': '+count));assert.doesNotMatch(value,new RegExp('(?:^|· )'+count+' [^·]+'));
  }
 }
 }
});
test('R2-I18N-02 a single history row and export use singular statuses separately from aggregate headings',async()=>{
 for(const language of languages){const a=app(language);seedHistory(a);const rows=await a.run('exportRows()');const key=catalog['cti.export.status'][language];assert.equal(rows[0][key],catalog['cti.call.answered'][language]);assert.equal(a.run('sessionStatusLabel({missed:true})'),catalog['cti.call.missed'][language]);}
 assert.equal(catalog['cti.call.answered'].fr,'Répondu');assert.equal(catalog['cti.call.answered'].es,'Atendida');assert.equal(catalog['cti.call.missed'].fi,'Vastaamaton');
});
test('R2-CTI-13 dial validation and action-specific 403 errors are localized in all languages',()=>{
 for(const language of languages){const a=app(language);for(const [value,key] of [
 ['Use a valid international number (+ or 00) or an extension of 1–6 digits','cti.error.dialTarget'],
 ['Call timeout must be a whole number between 1 and 120 seconds','cti.error.dialTimeout'],
 ['Call request failed with HTTP 403: {}','cti.error.notAllowed'],
 ['Google connection changed; retry the request','cti.error.googleChanged']])assert.equal(a.run(`(() => { const c = errorCopy(${JSON.stringify(value)}); return message(c.key,c.fallback,c.params); })()`),catalog[key][language]);}
});
test('R2-CTI-07 duplicate snapshot delivery does not cancel a pending caller popup lookup',async()=>{
 const a=app('en',{'call-popup':element()});let complete;const shown=[];
 a.sandbox.window.lookup=()=>new Promise(resolve=>complete=resolve);a.sandbox.window.show=call=>shown.push(call.uuid);
 a.run(`lookupContact=window.lookup;showCallPopup=window.show;this.testCall={uuid:'same',state:'ring',extension:'21',caller:'+49301234567',callee:'21',direction:'inbound'};state.activeCalls=[testCall]`);
 const first=a.run('maybeShowCallPopup(testCall)');await a.run('maybeShowCallPopup(testCall)');complete(null);await first;assert.deepEqual(shown,['same']);
});

test('K2-02 an unconfigured refresh loads local data without provider reads or synthetic error events',async()=>{
 const connection=element(),a=app('de',{'connection-state':connection,'account-label':element()}),requests=[];
 a.sandbox.window.request=async route=>{requests.push(route);if(route==='/api/status')return {credentialsConfigured:false,lastError:null,csrfToken:'fixture',streams:{}};if(['/api/history','/api/active-calls'].includes(route))return [];throw Error('Unconfigured provider request: '+route)};
 a.run('api=window.request;render=renderStatus');await a.run('refreshAll()');
 assert.deepEqual(requests,['/api/status','/api/history','/api/active-calls']);assert.equal(a.run('state.events.length'),0);assert.equal(a.run('state.refreshPending'),false);assert.equal(connection.textContent,catalog['shared.authRequired'].de);assert.equal(connection.className,'connection');
});

test('K2-02 real authorization errors still produce an API error event',async()=>{
 for(const failingRoute of ['/api/status','/api/extensions']){const a=app('de');a.sandbox.fetch=async url=>{if(url===failingRoute)return new Response(JSON.stringify({error:'NFON sign-in failed'}),{status:401});return new Response(JSON.stringify(url==='/api/status'?{credentialsConfigured:true,csrfToken:'fixture'}:[]));};a.run('render=()=>{}');await a.run('refreshAll()');assert.equal(a.run('state.events.length'),1);assert.ok(a.run('copyMarkup(state.events[0].title)').includes(catalog['cti.api.error'].de));assert.match(a.run('JSON.stringify(state.events[0])'),/NFON sign-in failed/);assert.equal(a.run('state.refreshPending'),false);}
});
