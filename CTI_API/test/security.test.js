const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const PORT = 43102;
const BASE_URL = `http://127.0.0.1:${PORT}`;

function makeWorkdir(t) {
  const sourceRoot = process.cwd();
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

function startServer(t) {
  const workdir = makeWorkdir(t);
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: workdir,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(PORT),
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
  startServer(t);

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
});

test("cross-origin API reads are blocked by CORS policy", async (t) => {
  startServer(t);
  await waitForStatus();

  const response = await fetch(`${BASE_URL}/api/history`, {
    headers: { Origin: "http://evil.example" },
  });
  assert.equal(response.status, 403);
});
