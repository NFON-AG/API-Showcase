const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PORT = 43110;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function startServer(t) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "landing-cockpit-test-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      LANDING_HOST: "127.0.0.1",
      PORT: String(PORT),
      LANDING_ENABLE_SERVICE_CONTROL: "true",
      NFON_SHOWCASE_CONFIG_DIR: configDir,
      LANDING_ENV_FILE: path.join(configDir, "does-not-exist.env"),
      CTI_UPSTREAM: "",
      PORTAL_UPSTREAM: "",
      CORE_HISTORY_UPSTREAM: "",
      CALL_HISTORY_UPSTREAM: "",
    },
    stdio: ["ignore", "ignore", "ignore"],
  });
  t.after(() => {
    child.kill();
    fs.rmSync(configDir, { recursive: true, force: true });
  });
  return { configDir };
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

test("state-changing endpoints require a CSRF token", async (t) => {
  startServer(t);
  await waitForStatus();

  const noToken = await fetch(`${BASE_URL}/api/services/cti/start`, { method: "POST" });
  assert.equal(noToken.status, 403, "start without token must be rejected");

  const badToken = await fetch(`${BASE_URL}/api/services/cti/upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": "wrong" },
    body: JSON.stringify({ upstream: "http://127.0.0.1:3999" }),
  });
  assert.equal(badToken.status, 403, "wrong token must be rejected");
});

test("upstream override is validated, persisted, and resettable", async (t) => {
  startServer(t);
  const status = await waitForStatus();
  const token = status.csrfToken;
  assert.ok(token, "status exposes a csrf token");
  assert.equal(status.services.cti.upstream, "http://127.0.0.1:3002", "default upstream");

  const invalid = await fetch(`${BASE_URL}/api/services/cti/upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify({ upstream: "not a url" }),
  });
  assert.equal(invalid.status, 400, "invalid url rejected");

  const reject = await fetch(`${BASE_URL}/api/services/cti/upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify({ upstream: "ftp://example.com" }),
  });
  assert.equal(reject.status, 400, "non-http scheme rejected");

  const ok = await fetch(`${BASE_URL}/api/services/cti/upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify({ upstream: "http://127.0.0.1:3999/ignored/path" }),
  });
  const okBody = await ok.json();
  assert.equal(ok.status, 200);
  assert.equal(okBody.upstream, "http://127.0.0.1:3999", "stored as origin only");
  assert.equal(okBody.upstreamSource, "override");

  const after = await (await fetch(`${BASE_URL}/api/status`)).json();
  assert.equal(after.services.cti.upstream, "http://127.0.0.1:3999", "override reflected in status");
  assert.equal(after.routes.cti.upstream, "http://127.0.0.1:3999", "override reflected in routes");

  const reset = await fetch(`${BASE_URL}/api/services/cti/upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": token },
    body: JSON.stringify({ upstream: "" }),
  });
  const resetBody = await reset.json();
  assert.equal(reset.status, 200);
  assert.equal(resetBody.upstream, "http://127.0.0.1:3002", "reset restores default");
  assert.equal(resetBody.upstreamSource, "default");
});

test("unknown service id is rejected", async (t) => {
  startServer(t);
  const status = await waitForStatus();
  const unknown = await fetch(`${BASE_URL}/api/services/bogus/upstream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": status.csrfToken },
    body: JSON.stringify({ upstream: "http://127.0.0.1:3999" }),
  });
  assert.equal(unknown.status, 404);
});
