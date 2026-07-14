const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PORT = 43100;
const BASE_URL = `http://127.0.0.1:${PORT}`;

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

function startServer(t, extraEnv = {}) {
  const workdir = makeWorkdir(t);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: workdir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
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
  startServer(t);

  const status = await waitForStatus();
  assert.equal(status.redirectUri, "http://localhost:3000");
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
  startServer(t);

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
  startServer(t, {
    CALLHISTORY_CLIENT_ID: "local-client",
    CALLHISTORY_ACCESS_TOKEN: "expired-test-token",
    CALLHISTORY_API_BASE_URL: "http://127.0.0.1:9/call-history",
  });

  await waitForStatus();
  const response = await fetch(`${BASE_URL}/api/calls?mode=live`);
  assert.equal(response.status, 502);
  const body = await response.json();
  assert.equal(body.source, "callhistory-live");
  assert.notEqual(body.source, "demo-fallback");
});

test("demo mode returns bounded 30-day business volume with transcripts", async (t) => {
  startServer(t, {
    CALLHISTORY_CLIENT_ID: "local-client",
  });

  await waitForStatus();
  const response = await fetch(`${BASE_URL}/api/calls?mode=demo&range=7d`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, "demo");
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
