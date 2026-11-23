const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

async function isolatedServer(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cti-restore-test-"));
  const configDirectory = path.join(directory, "config");
  const dataDirectory = path.join(directory, "data");
  const envFile = path.join(directory, "isolated.env");
  const guardFile = path.join(directory, "deny-upstream.cjs");
  const networkMarker = path.join(directory, "unexpected-upstream");
  fs.mkdirSync(configDirectory);
  fs.mkdirSync(dataDirectory);
  fs.writeFileSync(envFile, "");
  fs.writeFileSync(guardFile, `globalThis.fetch = () => { require("node:fs").writeFileSync(${JSON.stringify(networkMarker)}, "attempted"); throw new Error("Unexpected upstream request in restore test"); };`);
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const origin = `http://127.0.0.1:${port}`;
  let child;
  let token;
  let logs = "";
  const env = {
    HOST: "127.0.0.1", PORT: String(port),
    NFON_SHOWCASE_CONFIG_DIR: configDirectory,
    CTI_API_ENV_FILE: envFile, CTI_DATA_DIR: dataDirectory,
    NFON_BASE_URL: `${origin}/unconfigured-upstream`,
    NFON_SECRET_FILE: "", NFON_K_ACCOUNT: "", NFON_API_USERNAME: "", NFON_API_PASSWORD: "",
    GOOGLE_CLIENT_SECRET_FILE: "", GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "",
    GOOGLE_REDIRECT_URI: `${origin}/auth/google/callback`,
    CTI_ALLOW_REMOTE_CONTROL: "false", CTI_ALLOW_REMOTE_READ: "false", CTI_ALLOWED_ORIGIN: origin,
  };
  async function stop() {
    if (!child || child.exitCode !== null) return;
    const exited = once(child, "exit");
    child.kill();
    await exited;
    child = null;
  }
  t.after(async () => {
    await stop();
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return {
    historyFile: path.join(dataDirectory, "call-events.jsonl"), dataDirectory,
    async start() {
      logs = "";
      // Only this server source executes; its cwd, config and data are entirely temporary.
      child = spawn(process.execPath, ["--require", guardFile, path.resolve(__dirname, "../src/server.js")], { cwd: directory, env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout.on("data", (chunk) => { logs += chunk; });
      child.stderr.on("data", (chunk) => { logs += chunk; });
      let status;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        try {
          const response = await fetch(`${origin}/api/status`);
          if (response.ok) { status = await response.json(); break; }
        } catch { /* Wait briefly for the isolated listener. */ }
        if (child.exitCode !== null) throw new Error(`Isolated server exited: ${logs}`);
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      assert.ok(status, `Isolated server did not start: ${logs}`);
      assert.equal(status.credentialsConfigured, false);
      assert.equal(status.google.configured, false);
      token = status.csrfToken;
      return status;
    },
    stop,
    async restore(body, raw = false) {
      const response = await fetch(`${origin}/api/storage/restore`, { method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": token }, body: raw ? body : JSON.stringify(body) });
      return { http: response.status, body: await response.json() };
    },
    async get(route) { const response = await fetch(`${origin}${route}`); assert.equal(response.status, 200); return response.json(); },
    assertNoCredentialsOrNetwork() {
      assert.equal(fs.existsSync(networkMarker), false, "no upstream fetch may execute");
      assert.equal(fs.existsSync(path.join(dataDirectory, "google-token.json")), false);
      assert.equal(fs.existsSync(path.join(dataDirectory, "google-oauth-state.json")), false);
    },
  };
}

function event(uuid, state, seconds) {
  return { uuid, state, extension: "201", caller: "200", callee: "201", direction: "inbound", updated: `2026-09-24T08:00:${String(seconds).padStart(2, "0")}.000Z`, receivedAt: `2026-09-24T08:00:${String(seconds).padStart(2, "0")}.000Z` };
}

test("real CTI restore validates before writing, deduplicates and survives a server restart", async (t) => {
  const server = await isolatedServer(t);
  const existing = event("restore-existing", "hangup", 0);
  const ringing = event("restore-incoming", "ring", 10);
  const answered = event("restore-incoming", "answer", 15);
  fs.writeFileSync(server.historyFile, `${JSON.stringify(existing)}\n`, { mode: 0o600 });
  await server.start();
  const backup = { schema: "nfon-cti-local-backup-v1", data: { callEvents: [ringing, answered, ringing] } };
  const first = await server.restore(backup);
  assert.deepEqual(first, { http: 200, body: { imported: 2, duplicates: 1, total: 3 } });
  t.diagnostic(`first restore: HTTP ${first.http}, ${JSON.stringify(first.body)}`);
  const expected = [existing, ringing, answered];
  assert.deepEqual(fs.readFileSync(server.historyFile, "utf8").trim().split("\n").map(JSON.parse), expected);
  const store = fs.readFileSync(server.historyFile);
  const second = await server.restore(backup);
  assert.deepEqual(second, { http: 200, body: { imported: 0, duplicates: 3, total: 3 } });
  assert.deepEqual(fs.readFileSync(server.historyFile), store);
  t.diagnostic(`duplicate restore: HTTP ${second.http}, ${JSON.stringify(second.body)}, store unchanged`);

  const extra = event("must-not-be-written", "ring", 20);
  const invalid = [
    ["malformed JSON", '{"data":', true, "Malformed JSON request body"],
    ["unsupported schema", { schema: "other-backup-v99", data: { callEvents: [extra] } }, false, "Unsupported backup schema"],
    ["null schema", { schema: null, callEvents: [extra] }, false, "Unsupported backup schema"],
    ["non-object backup", [], false, "Invalid backup format"],
    ["non-array events", { schema: backup.schema, data: { callEvents: {} } }, false, "Invalid backup format"],
    ["missing events", {}, false, "Backup contains no call events"],
    ["empty events", { data: { callEvents: [] } }, false, "Backup contains no call events"],
    ["object UUID after valid record", { data: { callEvents: [extra, { uuid: { value: "bad" } }] } }, false, "Backup contains an invalid call event"],
    ["blank UUID", { callEvents: [{ uuid: " " }] }, false, "Backup contains an invalid call event"],
    ["null event", { callEvents: [null] }, false, "Backup contains an invalid call event"],
  ];
  for (const [label, payload, raw, error] of invalid) {
    const result = await server.restore(payload, raw);
    assert.deepEqual(result, { http: 400, body: { error } }, label);
    assert.deepEqual(fs.readFileSync(server.historyFile), store, `${label}: byte-for-byte store preservation`);
    assert.deepEqual((await server.get("/api/storage/backup")).data.callEvents, expected, `${label}: unchanged export`);
    t.diagnostic(`${label}: HTTP 400, store unchanged (${expected.length} records)`);
  }

  const legacyEvent = event("restore-legacy", "hangup", 30);
  assert.deepEqual(await server.restore({ callEvents: [legacyEvent] }), { http: 200, body: { imported: 1, duplicates: 0, total: 4 } });
  expected.push(legacyEvent);
  const beforeRestart = fs.readFileSync(server.historyFile);
  server.assertNoCredentialsOrNetwork();
  await server.stop();
  await server.start();
  const exported = await server.get("/api/storage/backup");
  assert.equal(exported.schema, backup.schema);
  assert.deepEqual(exported.data.callEvents, expected);
  assert.deepEqual(await server.get("/api/history"), [...expected].reverse());
  assert.deepEqual(fs.readFileSync(server.historyFile), beforeRestart);
  assert.deepEqual(await server.restore(exported), { http: 200, body: { imported: 0, duplicates: 4, total: 4 } });
  server.assertNoCredentialsOrNetwork();
  t.diagnostic("restart: HTTP 200 history/export contain 4 persisted records; reimport reports 0 new / 4 duplicates; no upstream or OAuth access");
});
