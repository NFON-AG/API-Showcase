const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");

const sourceFile = path.join(__dirname, "../src/server.js");
const did = { name: "+4912340", href: "/api/customers/TEST/trunks/10/inbound-trunk-numbers/100", trunkHref: "/api/customers/TEST/trunks/10", didExtension: "0", destinationType: "PHONEEXTENSION", destinationExtension: "201" };
const target = { type: "PHONEEXTENSION", title: "Fixture extension", number: "202", routeNumber: "202" };
const writes = [
  ["/api/callflow/apply", { did, target, commit: true }],
  ["/api/callflow/bulk-apply", { changes: [{ did, target }], commit: true }],
  ["/api/service-groups/apply", { services: [{ kind: "queue", serviceNumber: "501", members: [{ extensionNumber: "202" }] }] }],
  ["/api/callflow/apply", { did, commit: true, flow: { nodes: [{ id: "inbound", type: "DID", locked: true }, { id: "ivr", type: "IVR", title: "Fixture menu", routeNumber: "999", config: { portalMode: "existing" } }], edges: [{ from: "inbound", to: "ivr" }] } }],
];

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
}

async function fixture(t, env = {}) {
  const upstreamState = { mode: "online", requests: [] };
  const upstream = http.createServer(async (req, res) => {
    req.resume();
    upstreamState.requests.push({ method: req.method, path: req.url });
    if (upstreamState.pause && req.method !== "GET") await upstreamState.pause;
    const optional = /\/version$|\/(basic-data|contract-information|feature-status)$|queue|skill|voicemail|voice-mail|mailbox|answering-machine|frontdesk/.test(req.url);
    const failed = upstreamState.mode === "unavailable"
      || (upstreamState.mode === "partial" && req.url.endsWith("/devices"))
      || (upstreamState.mode === "optional-failures" && optional);
    res.writeHead(failed ? 503 : req.method === "DELETE" ? 204 : 200, { "Content-Type": "application/json" });
    res.end(req.method === "DELETE" && !failed ? undefined : JSON.stringify(failed ? { message: "Fixture unavailable" } : { items: req.url.split("?")[0].endsWith("/dids") && !req.url.includes("_offset") ? [{href:did.href,data:[{name:"didNumber",value:did.name},{name:"destinationType",value:"PHONEEXTENSION"},{name:"destinationExtensionNumber",value:"201"}]}] : [] }));
  });
  const upstreamPort = await listen(upstream);
  const reservation = http.createServer();
  const appPort = await listen(reservation);
  await new Promise((resolve) => reservation.close(resolve));
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-runtime-test-"));
  fs.mkdirSync(path.join(workdir, "src"));
  fs.copyFileSync(sourceFile, path.join(workdir, "src/server.js"));
  fs.copyFileSync(path.join(__dirname,"../src/messages.cjs"),path.join(workdir,"src/messages.cjs"));
  fs.copyFileSync(path.join(__dirname,"../i18n-messages.json"),path.join(workdir,"i18n-messages.json"));
  fs.copyFileSync(path.join(__dirname, "../src/server-safety.cjs"), path.join(workdir, "src/server-safety.cjs"));
  const child = spawn(process.execPath, ["--require",path.join(__dirname,"helpers/egress.cjs"),"src/server.js"], {
    cwd: workdir,
    env: {
      PATH: process.env.PATH, HOME:workdir, TEST_PROVIDER_PORT:String(upstreamPort), Portal_API_ENV_FILE:"",
      NFON_SHOWCASE_CONFIG_DIR: path.join(workdir, "config"),
      PORTAL_SECRET_FILE: path.join(workdir, "missing-secret"),
      NFON_SECRET_FILE: path.join(workdir, "missing-cti-secret"),
      PORTAL_BASE_URL: `http://127.0.0.1:${upstreamPort}`,
      PORTAL_API_KEY_ID: "fixture-key", PORTAL_API_KEY_SECRET: "fixture-secret", PORTAL_CUSTOMER_ACCOUNT: "TEST",
      HOST: "127.0.0.1", PORT: String(appPort), ...env,
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const exit = once(child, "exit");
      child.kill();
      await exit;
    }
    await new Promise((resolve) => upstream.close(resolve));
    fs.rmSync(workdir, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${appPort}`;
  let initial;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try { initial = await (await fetch(`${base}/api/status`)).json(); break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  assert.ok(initial, "Fixture app started");
  async function request(route, body) {
    const response = await fetch(`${base}${route}`, body === undefined ? {} : {
      method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": initial.settings.csrfToken, "X-Portal-Context": initial.settings.writeContext }, body: JSON.stringify(body),
    });
    return { status: response.status, body: await response.json() };
  }
  return { initial, request, upstreamState };
}

test("session toggle cannot bypass missing server opt-in", async t => {
  const app = await fixture(t);
  assert.equal(app.initial.settings.liveWritesEnabled, false);
  assert.equal((await app.request("/api/settings/live-writes", { enabled: true })).status, 423);
  for (const [route, body] of writes) assert.equal((await app.request(route, body)).status, 423);
  assert.equal(app.upstreamState.requests.filter(request => request.method !== "GET").length, 0);
});

test("server opt-in permits explicit session enable and disable without weakening the hard lock", async t => {
  const app = await fixture(t, { PORTAL_ENABLE_LIVE_WRITES: "true" });
  assert.equal(app.initial.settings.liveWritesEnabled, false);
  for (const [route, body] of writes) assert.equal((await app.request(route, body)).status, 423);
  assert.equal((await app.request("/api/settings/live-writes", { enabled: true })).body.settings.liveWritesEnabled, true);
  for (const [route, body] of writes.filter(([route]) => route !== "/api/service-groups/apply")) {
    const result = await app.request(route, body);
    assert.equal(result.status, 200, JSON.stringify(result.body));
    assert.equal(result.body.ok, true);
  }
});

test("server read-only override cannot be enabled through the session switch or apply routes", async (t) => {
  const app = await fixture(t, { PORTAL_ENABLE_LIVE_WRITES: "true", PORTAL_DISABLE_LIVE_WRITES: "true" });
  assert.equal(app.initial.settings.liveWritesLocked, true);
  assert.equal(app.initial.settings.liveWritesEnabled, false);
  const attempt = await app.request("/api/settings/live-writes", { enabled: true });
  assert.equal(attempt.status, 423);
  assert.equal(attempt.body.code, "LIVE_WRITES_LOCKED");
  for (const [route, body] of writes) {
    const result = await app.request(route, body);
    assert.equal(result.status, 423);
    assert.equal(result.body.code, "LIVE_WRITES_LOCKED");
  }
  assert.equal(app.upstreamState.requests.filter((request) => request.method !== "GET").length, 0);
});

test("connectivity distinguishes unchecked, connected, optional failures, partial and total failure", async (t) => {
  const app = await fixture(t);
  assert.equal(app.initial.configured, true);
  assert.equal(app.initial.connection.state, "unchecked");
  for (const [mode, state, loaded, failed] of [["online", "connected", 9, 0], ["optional-failures", "connected", 9, 0], ["partial", "partial", 8, 1], ["unavailable", "unavailable", 0, 9]]) {
    app.upstreamState.mode = mode;
    const { body } = await app.request("/api/overview");
    assert.equal(body.connection.state, state);
    assert.equal(body.connection.requiredLoaded, loaded);
    assert.equal(body.connection.requiredFailed, failed);
    const status = (await app.request("/api/status")).body;
    assert.deepEqual(status.connection, body.connection);
    assert.equal(Object.keys(body.endpoints).length, 17, "Failed discovery endpoints remain visible");
    if (mode === "optional-failures") {
      assert.equal(body.connection.optionalFailed, 8);
      assert.equal(body.endpoints.queues.optional, true);
      assert.equal(body.endpoints.queues.ok, false);
    }
  }
});

test("missing credentials remain unconfigured before and after a demo overview", async (t) => {
  const app = await fixture(t, { PORTAL_API_KEY_ID: "", PORTAL_API_KEY_SECRET: "", PORTAL_CUSTOMER_ACCOUNT: "" });
  assert.equal(app.initial.connection.state, "unconfigured");
  await app.request("/api/overview");
  assert.equal((await app.request("/api/status")).body.connection.state, "unconfigured");
  assert.equal(app.upstreamState.requests.length, 0);
});

test("transport diagnostics retain safe DNS, timeout and TLS causes without exposing raw messages", async () => {
  const source = fs.readFileSync(sourceFile, "utf8");
  let failure;
  const context = vm.createContext({
    require(name) {
      if (name === "./messages.cjs") return require("../src/messages.cjs");
      if (name === "./server-safety.cjs") return require("../src/server-safety.cjs");
      if (name === "fs") return { ...fs, existsSync: () => false, readFileSync: () => { throw Error("Fixture must not read local configuration"); } };
      return require(name);
    },
    process: { cwd: () => "/offline-fixture", env: { PORTAL_BASE_URL: "https://fixture.invalid", PORTAL_API_KEY_ID: "fixture-key", PORTAL_API_KEY_SECRET: "fixture-secret", PORTAL_CUSTOMER_ACCOUNT: "TEST" } },
    fetch: async () => { throw failure; }, Buffer, URL, Date, console, AbortSignal,
  });
  vm.runInContext(source.slice(0, source.indexOf("const server = http.createServer")), context);
  for (const [code, kind] of [["ENOTFOUND", "dns"], ["EAI_AGAIN", "dns"], ["UND_ERR_CONNECT_TIMEOUT", "timeout"], ["CERT_HAS_EXPIRED", "tls"], ["ECONNREFUSED", "connection"]]) {
    failure = new TypeError("fetch failed", { cause: new AggregateError([Object.assign(new Error("PRIVATE fixture-secret raw upstream details"), { code })]) });
    const result = await vm.runInContext('safePortalCall("version", "/api/version")', context);
    assert.equal(result.status, 0);
    assert.equal(result.errorCode, code);
    assert.equal(result.errorKind, kind);
    assert.match(result.error, new RegExp(code));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|fixture-secret|raw upstream/);
  }
});

test('concurrent apply requests result in one upstream write and a 409 conflict', async t => {
  const app=await fixture(t,{PORTAL_ENABLE_LIVE_WRITES:'true'});
  assert.equal((await app.request('/api/settings/live-writes',{enabled:true})).status,200);
  let release;app.upstreamState.pause=new Promise(resolve=>{release=resolve;});
  const first=app.request(writes[0][0],writes[0][1]);
  const deadline=Date.now()+1000;
  while(!app.upstreamState.requests.some(request=>request.method==='PUT') && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
  try {
    const second=await app.request(writes[0][0],writes[0][1]);assert.equal(second.status,409);
  } finally { release(); }
  assert.equal((await first).status,200);
  assert.equal(app.upstreamState.requests.filter(request=>request.method==='PUT').length,1);
});
