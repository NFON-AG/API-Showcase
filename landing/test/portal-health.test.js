const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const source = fs.readFileSync(path.join(__dirname, "../src/server.js"), "utf8");
const context = vm.createContext({});
vm.runInContext(source.match(/const PORTAL_OPTIONAL_ENDPOINT_ERRORS = [^;]+;/)[0], context);
vm.runInContext(source.slice(source.indexOf("function classifyHealth("), source.indexOf("async function checkService(")), context);
const classify = (payload) => context.classifyHealth("portal", { appId: 'portal', ...payload }, true);

test('unknown status identity cannot be presented as Portal online', () => {
  const payload = { ok: true, configured: true, connection: { state: 'connected' } };
  assert.equal(context.classifyHealth('portal', payload, true).health, 'warning');
  assert.equal(classify({ ...payload, appId: 'cti' }).health, 'warning');
});

test("Portal health reflects verified connection state, not credentials alone", () => {
  for (const state of ["unchecked", "unavailable", "partial"]) {
    const result = classify({ ok: true, configured: true, connection: { state } });
    assert.equal(result.health, "warning", state);
    assert.doesNotMatch(result.detail, /ready|connected\./i, state);
  }
  assert.equal(classify({ connection: { state: "unconfigured" } }).health, "auth-required");
  assert.equal(classify({ ok: true, configured: true, connection: { state: "connected" }, cache: { errors: { featureStatus: "HTTP 403" } } }).health, "online");
  assert.match(classify({ connection: { state: "unavailable" } }).detail, /connection failed/);
  assert.match(classify({ connection: { state: "partial" } }).detail, /partially available/);
});

test("older Portal status needs a completed inventory check before reporting online", () => {
  assert.equal(classify({ ok: true, configured: true, cache: { errors: {} } }).health, "warning");
  const cache = { syncedAt: "2026-01-01T12:00:00Z", errors: { featureStatus: "HTTP 403" } };
  assert.equal(classify({ ok: true, configured: true, cache }).health, "online");
  cache.errors.extensions = "fetch failed";
  assert.equal(classify({ ok: true, configured: true, cache }).health, "warning");
});
