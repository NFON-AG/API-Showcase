const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const net = require("node:net");
async function availablePort() { const server=net.createServer(); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)); const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port; }

let PORT;
let BASE_URL;

function localDayKey(value) {
  return new Date(value).toLocaleDateString("sv-SE");
}

function makeWorkdir(t) {
  const sourceRoot = process.cwd();
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "callhistory-api-test-"));
  fs.cpSync(sourceRoot, workdir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(sourceRoot, source);
      return relative !== ".env" && relative !== "data" && !relative.startsWith(`data${path.sep}`);
    },
  });
  t.after(() => fs.rmSync(workdir, { recursive: true, force: true }));
  return workdir;
}

async function startServer(t, extraEnv = {}, now) {
  PORT=await availablePort(); BASE_URL=`http://127.0.0.1:${PORT}`;
  const workdir = makeWorkdir(t);
  const args = ["src/server.js"];
  if (now) {
    const clockFile = path.join(workdir, "test-clock.cjs");
    fs.writeFileSync(clockFile, `const RealDate=Date;const fixed=new RealDate(${JSON.stringify(now)}).getTime();globalThis.Date=class extends RealDate{constructor(...args){super(...(args.length?args:[fixed]))}static now(){return fixed}};`);
    args.unshift("--require", clockFile);
  }
  const child = spawn(process.execPath, args, {
    cwd: workdir,
    env: {
      PATH: process.env.PATH, HOME: workdir,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      NFON_SHOWCASE_CONFIG_DIR: path.join(workdir, "config"),
      CallHistory_API_ENV_FILE: "",
      CALLHISTORY_DATA_DIR: path.join(workdir, "data"),
      CALLHISTORY_ALLOWED_ORIGIN: `http://localhost:${PORT}`,
      CALLHISTORY_CLIENT_ID: "",
      CALLHISTORY_CLIENT_SECRET: "",
      CALLHISTORY_ACCESS_TOKEN: "",
      CALLHISTORY_REFRESH_TOKEN: "",
      DEMO_MODE: "false",
      ...extraEnv,
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  t.after(() => child.kill());
  return child;
}

async function waitForStatus() {
  const deadline = Date.now() + 5000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${BASE_URL}/api/status`);
      if (response.ok) return response.json();
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  throw lastError || new Error("Server did not start");
}

test("logout and browser settings require CSRF", async (t) => {
  await startServer(t);

  const status = await waitForStatus();
  assert.equal(status.redirectUri, "http://localhost:3000");
  assert.equal(status.authenticated, false);
  assert.equal(status.account, "", "an unauthenticated response must not put system copy in the account identity");
  assert.equal(typeof status.csrfToken, "string");

  const missingToken = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
  });
  assert.equal(missingToken.status, 403);

  const ok = await fetch(`${BASE_URL}/api/auth/logout`, {
    method: "POST",
    headers: { "X-CSRF-Token": status.csrfToken },
  });
  assert.equal(ok.status, 200);
});

test("browser login accepts an explicit redirect URI and bounds JSON bodies", async (t) => {
  await startServer(t);

  const status = await waitForStatus();
  const updated = await fetch(`${BASE_URL}/api/settings/browser-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": status.csrfToken,
    },
    body: JSON.stringify({
      clientId: "local-client",
      redirectUri: "https://showcase.example/call-history/callback",
    }),
  });
  assert.equal(updated.status, 200);
  const body = await updated.json();
  assert.equal(body.status.redirectUri, "https://showcase.example/call-history/callback");

  const oversized = await fetch(`${BASE_URL}/api/settings/browser-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": body.status.csrfToken,
    },
    body: JSON.stringify({ payload: "x".repeat(512 * 1024 + 1) }),
  });
  assert.equal(oversized.status, 413);
});

test("live call failures are not converted to demo responses", async (t) => {
  await startServer(t, {
    CALLHISTORY_CLIENT_ID: "local-client",
    CALLHISTORY_ACCESS_TOKEN: ['expired','test','token'].join('-'),
    CALLHISTORY_API_BASE_URL: "http://127.0.0.1:9/call-history",
  });

  await waitForStatus();
  const response = await fetch(`${BASE_URL}/api/calls?mode=live`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.source, "callhistory-live");
  assert.notEqual(body.source, "demo-fallback");

  // The fixed CRM remains usable even when the real NFON history endpoint is
  // unavailable, and its documents are served without an authenticated API call.
  const crm = await fetch(`${BASE_URL}/crm-demo/index.html`);
  assert.equal(crm.status, 200);
  assert.match(crm.headers.get("content-type"), /text\/html/);
  assert.match(await crm.text(), /demo-records\.js/);
  const fixedData = await fetch(`${BASE_URL}/crm-demo/demo-records.js`);
  assert.equal(fixedData.status, 200);
  assert.match(await fixedData.text(), /DEMO_RECORDS/);

});

test("demo mode returns bounded 30-day business volume with transcripts", async (t) => {
  // Finished business day: the midnight case is covered separately; wall-clock
  // time must not decide whether the exact 30-day volume assertion passes.
  await startServer(t, {
    CALLHISTORY_CLIENT_ID: "local-client",
  }, "2026-10-17T23:00:00");

  await waitForStatus();
  const response = await fetch(`${BASE_URL}/api/calls?mode=demo&range=7d`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "demo");
  assert.ok(body.calls.every((call) => call.source === "demo" && call.demoTemplate === "call-history-v1"), "generated fixtures carry explicit localization metadata");
  assert.ok(body.calls.length >= 140 && body.calls.length <= 160, `expected around 140 demo calls, got ${body.calls.length}`);
  assert.ok(body.calls.filter((call) => call.transcriptId).length >= 45);
  assert.ok(new Set(body.calls.map((call) => localDayKey(call.startedAt))).size >= 5);

  const monthResponse = await fetch(`${BASE_URL}/api/calls?mode=demo&range=30d`);
  assert.equal(monthResponse.status, 200);
  const monthBody = await monthResponse.json();
  assert.equal(monthBody.calls.length, 600);
  assert.ok(monthBody.calls.filter((call) => call.transcriptId).length >= 180);
  assert.equal(new Set(monthBody.calls.map((call) => localDayKey(call.startedAt))).size, 30);
});

test('the opaque CRM frame can load the public font without gaining access to API data', async t => {
  await startServer(t); await waitForStatus();
  const font = await fetch(BASE_URL + '/assets/fonts/PPPangramSans-Variable.woff2', {headers:{Origin:'null'}});
  assert.equal(font.status,200); assert.equal(font.headers.get('access-control-allow-origin'),'*');
  assert.equal(font.headers.get('access-control-allow-credentials'),null);
  const api = await fetch(BASE_URL + '/api/status', {headers:{Origin:'null'}});
  assert.equal(api.status,403); assert.notEqual(api.headers.get('access-control-allow-origin'),'*');
  assert.equal((await api.json()).csrfToken,undefined);
  const html = await fetch(BASE_URL + '/index.html', {headers:{Origin:'null'}});
  assert.equal(html.headers.get('access-control-allow-origin'),null);
});
