const assert = require("node:assert/strict");
const { spawn } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const net = require("node:net");
async function availablePort() { const server=net.createServer(); await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve)); const port=server.address().port; await new Promise(resolve=>server.close(resolve)); return port; }

const STABLE_BASE = "https://start.cloudya.com/api/callhistory";

async function startIsolatedServer(t, apiBaseUrl) {
  const port = await availablePort();
  const workdir = fs.mkdtempSync(path.join(os.tmpdir(), "callhistory-routing-"));
  fs.cpSync(path.join(process.cwd(), "src"), path.join(workdir, "src"), { recursive: true });
  fs.writeFileSync(path.join(workdir, ".env"), "");
  const requestsFile = path.join(workdir, "requests.jsonl");
  const preload = path.join(workdir, "mock-upstream.cjs");
  // Intercept the upstream boundary, leaving URL construction and response
  // normalization in the real server. No credentials or network are used.
  fs.writeFileSync(preload, `
    const fs = require("node:fs");
    globalThis.fetch = async (url, options) => {
      fs.appendFileSync(${JSON.stringify(requestsFile)}, JSON.stringify({
        url: String(url), headers: options.headers
      }) + "\\n");
      const record = {
        uuid: "record-1", started_at: "2026-09-20T10:00:00Z",
        direction: "inbound", status: "answered", duration: 60,
        caller: { name: "Example", number: "100" },
        callee: { name: "Test", number: "200" },
        transcription: { available: true, summary: "Test summary", transcript: [] }
      };
      const body = new URL(url).pathname.endsWith("/records") ? (Number(new URL(url).searchParams.get("offset")) ? [] : [record]) : record;
      return new Response(JSON.stringify(body), {
        status: 200, headers: { "Content-Type": "application/json" }
      });
    };
  `);
  const child = spawn(process.execPath, ["--require", preload, "src/server.js"], {
    cwd: workdir,
    env: {
      PATH: process.env.PATH,
      HOME: workdir,
      HOST: "127.0.0.1",
      PORT: String(port),
      CALLHISTORY_CLIENT_ID: "test-client",
      CALLHISTORY_ACCESS_TOKEN: "example-routing-token",
      CALLHISTORY_DATA_DIR: path.join(workdir, "data"),
      APP_NAME: "routing-test",
      APP_VERSION: "1.0.0",
      DEMO_MODE: "false",
      ...(apiBaseUrl === undefined ? {} : { CALLHISTORY_API_BASE_URL: apiBaseUrl }),
    },
    stdio: "ignore",
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, "exit");
      child.kill();
      await exited;
    }
    fs.rmSync(workdir, { recursive: true, force: true });
  });
  const base = "http://127.0.0.1:" + port;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`${base}/api/status`);
      if (response.ok) { ready = true; break; }
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.ok(ready, "isolated server starts");
  return { base, requests: () => fs.readFileSync(requestsFile, "utf8").trim().split("\n").map(JSON.parse) };
}

for (const apiBaseUrl of [undefined, "https://history.example.test/custom/prefix/"]) {
  test(`live requests preserve ${apiBaseUrl ? "an explicit base override" : "the stable default base"}`, async (t) => {
    const app = await startIsolatedServer(t, apiBaseUrl);
    const expectedBase = (apiBaseUrl || STABLE_BASE).replace(/\/$/, "");
    const query = new URLSearchParams({
      mode: "live", start: "2026-09-20T00:00:00Z", end: "2026-09-21T00:00:00Z",
      direction: "inbound", outcome: "answered", party: "Example",
    });
    const list = await fetch(`${app.base}/api/calls?${query}`);
    assert.equal(list.status, 200);
    const calls = await list.json();
    assert.equal(calls.source, "callhistory-live");
    assert.equal(calls.calls[0].id, "record-1");
    assert.equal(calls.calls[0].summary, "Test summary");
    const detail = await fetch(`${app.base}/api/transcripts/record-1?mode=live`);
    assert.equal(detail.status, 200);
    assert.equal((await detail.json()).summary, "Test summary");

    const requests = app.requests();
    assert.equal(requests.length, 3);
    const listUrl = new URL(requests[0].url);
    assert.equal(`${listUrl.origin}${listUrl.pathname}`, `${expectedBase}/records`);
    assert.deepEqual(Object.fromEntries(listUrl.searchParams), {
      from: String(Date.parse("2026-09-20T00:00:00Z") / 1000),
      to: String(Date.parse("2026-09-21T00:00:00Z") / 1000),
      limit: "100", sort: "desc", filter: "direction:inbound,status:answered", offset: "0",
    });
    assert.equal(new URL(requests[1].url).searchParams.get("offset"), "1");
    assert.equal(requests[2].url, `${expectedBase}/records/record-1`);
    for (const request of requests) {
      assert.equal(request.headers.Accept, "application/json");
      assert.equal(request.headers.Authorization, "Bearer example-routing-token");
      assert.equal(request.headers["User-Agent"], "routing-test/1.0.0");
    }
  });
}
