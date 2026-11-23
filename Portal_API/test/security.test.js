const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const http=require("node:http");
const {once}=require("node:events");
let PORT, BASE_URL;

function makeWorkdir(t) {
  const sourceRoot = path.resolve(__dirname,"..");
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-api-test-"));
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
  const reservation=http.createServer(); reservation.listen(0,"127.0.0.1");await once(reservation,"listening");PORT=reservation.address().port;BASE_URL=`http://127.0.0.1:${PORT}`;await new Promise(resolve=>reservation.close(resolve));
  const workdir = makeWorkdir(t);
  const child = spawn(process.execPath, ["--require",path.join(__dirname,"helpers/egress.cjs"),"src/server.js"], {
    cwd: workdir,
    env: {
      PATH:process.env.PATH, HOME:workdir, TEST_PROVIDER_PORT:"0",
      NFON_SHOWCASE_CONFIG_DIR: path.join(workdir, "test-config"),
      Portal_API_ENV_FILE: "",
      PORTAL_DATA_DIR: path.join(workdir, "test-data"),
      PORTAL_SECRET_FILE: path.join(workdir, "test-secrets", "missing.txt"),
      NFON_SECRET_FILE: path.join(workdir, "test-secrets", "missing.txt"),
      PORTAL_GOOGLE_CONTACTS_FILE: path.join(workdir, "test-data", "missing.json"),
      HOST: "127.0.0.1",
      PORT: String(PORT),
      PORTAL_ALLOWED_ORIGIN: `http://localhost:${PORT}`,
      PORTAL_API_KEY_ID: "",
      PORTAL_API_KEY_SECRET: "",
      PORTAL_CUSTOMER_ACCOUNT: "",
      PORTAL_ENABLE_LIVE_WRITES: "false",
      PORTAL_DISABLE_LIVE_WRITES: "false",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  t.after(async () => {if(child.exitCode===null){const exit=once(child,"exit");child.kill();await exit;}});
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

test("live writes are disabled by default and settings require CSRF", async (t) => {
  await startServer(t);

  const status = await waitForStatus();
  assert.equal(status.settings.liveWritesEnabled, false);
  assert.equal(status.settings.liveWritesDefaultEnabled, false);
  assert.equal(typeof status.settings.csrfToken, "string");

  const missingToken = await fetch(`${BASE_URL}/api/settings/live-writes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(missingToken.status, 403);

  const allowed = await fetch(`${BASE_URL}/api/settings/live-writes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": status.settings.csrfToken,
      "X-Portal-Context": status.settings.writeContext,
    },
    body: JSON.stringify({ enabled: false }),
  });
  assert.equal(allowed.status, 200);
});

test("JSON bodies are bounded", async (t) => {
  await startServer(t);

  const status = await waitForStatus();
  const oversized = await fetch(`${BASE_URL}/api/settings/live-writes`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-CSRF-Token": status.settings.csrfToken,
      "X-Portal-Context": status.settings.writeContext,
    },
    body: JSON.stringify({ payload: "x".repeat(1024 * 1024 + 1) }),
  });
  assert.equal(oversized.status, 413);
});
