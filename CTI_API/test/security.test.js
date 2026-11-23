const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

let PORT;
let BASE_URL;

test('R3-CTI-02 duplicate environment keys abort startup with a concise safe configuration error',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cti-invalid-env-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const envFile=path.join(dir,'duplicate.env');
  fs.writeFileSync(envFile,'APP_NAME=synthetic-first\nAPP_NAME=synthetic-second\n');
  const child=spawn(process.execPath,[path.resolve(__dirname,'../src/server.js')],{
    cwd:dir,env:{PATH:process.env.PATH,HOME:dir,CTI_API_ENV_FILE:envFile,NFON_SHOWCASE_CONFIG_DIR:path.join(dir,'config')},stdio:['ignore','pipe','pipe']
  });
  let output='';child.stdout.on('data',data=>output+=data);child.stderr.on('data',data=>output+=data);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve)});
  assert.equal(code,1);
  assert.match(output,/^CTI configuration error: Duplicate environment key: APP_NAME on lines 1 and 2\s*$/);
  assert.doesNotMatch(output,/synthetic-first|synthetic-second|\n\s+at |listening/);
});

function makeWorkdir(t) {
  const sourceRoot = path.resolve(__dirname, "..");
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "cti-api-test-"));
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

async function startServer(t) {
  const probe = require("node:http").createServer();
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  PORT = probe.address().port;
  BASE_URL = `http://127.0.0.1:${PORT}`;
  await new Promise(resolve => probe.close(resolve));
  const workdir = makeWorkdir(t);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: workdir,
    env: {
      PATH: process.env.PATH,
      HOME: workdir,
      HOST: "127.0.0.1",
      PORT: String(PORT),
      NFON_SHOWCASE_CONFIG_DIR: path.join(workdir, "isolated-config"),
      CTI_API_ENV_FILE: path.join(workdir, "isolated.env"),
      CTI_DATA_DIR: path.join(workdir, "isolated-data"),
      NFON_SECRET_FILE: "",
      GOOGLE_CLIENT_SECRET_FILE: "",
      NFON_BASE_URL: `http://127.0.0.1:${PORT}/unconfigured-upstream`,
      CTI_ALLOW_REMOTE_CONTROL: "false",
      CTI_ALLOW_REMOTE_READ: "false",
      CTI_ALLOWED_ORIGIN: `http://localhost:${PORT}`,
      NFON_K_ACCOUNT: "",
      NFON_API_USERNAME: "",
      NFON_API_PASSWORD: "",
      GOOGLE_CLIENT_ID: "",
      GOOGLE_CLIENT_SECRET: "",
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

test("local control routes require CSRF and enforce body limits", async (t) => {
  await startServer(t);

  const status = await waitForStatus();
  assert.equal(typeof status.csrfToken, "string");
  assert.ok(status.csrfToken.length > 20);

  const missingToken = await fetch(`${BASE_URL}/api/settings/browser-login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kAccount: "K0000", username: "user", password: "secret" }),
  });
  assert.equal(missingToken.status, 403);

  const oversized = await fetch(`${BASE_URL}/api/settings/browser-login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": status.csrfToken,
    },
    body: JSON.stringify({ payload: "x".repeat(1024 * 1024 + 1) }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(oversized.headers.get("connection"), "close");
  assert.equal((await fetch(`${BASE_URL}/api/status`)).status, 200);
});

test("cross-origin API reads are blocked by CORS policy", async (t) => {
  await startServer(t);
  await waitForStatus();

  const response = await fetch(`${BASE_URL}/api/history`, {
    headers: { Origin: "http://evil.example" },
  });
  assert.equal(response.status, 403);
});

test("isolated setup and storage validation return English API copy", async (t) => {
  await startServer(t);
  const status = await waitForStatus();
  assert.equal(status.credentialsConfigured, false);
  assert.equal(status.google.configured, false);
  const cases = [
    ["/api/settings/browser-login", {}, 400, "K-Account, API username and API password are required"],
    ["/api/local-contacts", {}, 400, "Name and phone number are required"],
    ["/api/storage/restore", {}, 400, "Backup contains no call events"],
  ];
  for (const [route, body, expectedStatus, error] of cases) {
    const response = await fetch(`${BASE_URL}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-CSRF-Token": status.csrfToken },
      body: JSON.stringify(body),
    });
    assert.equal(response.status, expectedStatus, route);
    assert.equal((await response.json()).error, error, route);
  }
});
