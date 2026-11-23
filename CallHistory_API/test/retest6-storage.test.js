const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

// Exercise the real HTTP server and native filesystem. The preload only injects
// filesystem rejections at explicit persistence boundaries; no auth logic is mocked.
async function fixture(t, { empty = false, expired = false } = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-retest6-'));
  fs.cpSync(path.join(__dirname, '../src'), path.join(temp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(temp, '.env'), '');
  const data = path.join(temp, 'data');
  fs.mkdirSync(data);
  const tokenFile = path.join(data, 'callhistory-token.json');
  if (!empty) fs.writeFileSync(tokenFile, JSON.stringify({ accessToken: 'synthetic-old', refreshToken: 'synthetic-refresh',
    expiresAt: expired ? 1 : Date.now() + 3600000 }), { mode: 0o600 });
  const hits = [];
  const json = (res, body) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
  const provider = http.createServer(async (req, res) => {
    hits.push({ path: req.url, authorization: req.headers.authorization });
    if (req.url === '/token') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const grant = new URLSearchParams(raw).get('grant_type');
      json(res, { access_token: grant === 'refresh_token' ? 'synthetic-refreshed' : 'synthetic-login',
        refresh_token: 'synthetic-next-refresh', expires_in: 3600 });
    } else json(res, []);
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const upstream = `http://127.0.0.1:${provider.address().port}`;
  const preload = path.join(temp, 'faults.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs/promises'), path = require('node:path'), net = require('node:net');
    let mode = '';
    process.on('message', message => { mode = message.mode; process.send({ kind: 'armed' }); });
    const target = file => path.basename(String(file)).includes('callhistory-token.json');
    const fail = stage => { mode = ''; process.send({ kind: 'injected', stage });
      throw Object.assign(new Error('Synthetic persistence fault: ' + stage), { code: 'EIO' }); };
    const write = fs.writeFile;
    fs.writeFile = async function(file, bytes, ...args) {
      if (target(file) && mode === 'before-write') fail('before-write');
      if (target(file) && mode === 'partial-write') {
        await write.call(this, file, String(bytes).slice(0, 25), ...args); fail('partial-write');
      }
      const result = await write.call(this, file, bytes, ...args);
      if (target(file) && mode === 'full-write') fail('full-write');
      return result;
    };
    const chmod = fs.chmod;
    fs.chmod = async function(file, ...args) {
      if (target(file) && mode === 'chmod') fail('chmod');
      if (path.basename(String(file)) === 'callhistory-token.json' && mode === 'final-chmod') fail('final-chmod');
      return chmod.call(this, file, ...args);
    };
    const rename = fs.rename;
    fs.rename = async function(from, to, ...args) {
      if (target(to) && mode === 'rename') fail('rename');
      return rename.call(this, from, to, ...args);
    };
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function(...args) {
      this.once('listening', () => setImmediate(() => process.send({ kind: 'listening', port: this.address().port })));
      return listen.apply(this, args);
    };
  `);
  let child, base, stderr = '';
  const messages = [], listeners = [];
  const next = kind => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Missing ' + kind + ': ' + stderr)), 4000);
    listeners.push({ kind, resolve: value => { clearTimeout(timer); resolve(value); } });
  });
  async function stop() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit'); child.kill(); await exited;
    }
  }
  async function boot() {
    const ready = next('listening');
    child = spawn(process.execPath, ['--require', preload, 'src/server.js'], { cwd: temp,
      env: { PATH: process.env.PATH, HOME: temp, NFON_SHOWCASE_CONFIG_DIR: path.join(temp, 'empty-config'),
        HOST: '127.0.0.1', PORT: '0', CALLHISTORY_CLIENT_ID: 'synthetic-client', CALLHISTORY_DATA_DIR: data,
        CALLHISTORY_AUTH_URL: upstream + '/authorize', CALLHISTORY_TOKEN_URL: upstream + '/token',
        CALLHISTORY_API_BASE_URL: upstream, CALLHISTORY_PUBLIC_BASE_URL: upstream, DEMO_MODE: 'false' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', message => {
      messages.push(message);
      for (const listener of [...listeners]) if (listener.kind === message.kind) {
        listeners.splice(listeners.indexOf(listener), 1); listener.resolve(message);
      }
    });
    base = `http://127.0.0.1:${(await ready).port}`;
  }
  t.after(async () => { await stop(); provider.closeAllConnections(); await new Promise(resolve => provider.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true }); });
  await boot();
  const request = async (route, options = {}) => {
    const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options });
    const body = await response.text();
    return { status: response.status, location: response.headers.get('location'), body: body ? JSON.parse(body) : null };
  };
  const status = async () => (await request('/api/status')).body;
  const calls = () => request('/api/calls?mode=live&start=2026-10-24T00:00:00Z&end=2026-10-25T00:00:00Z');
  return { tokenFile, data, messages, hits, status, calls,
    bytes: () => fs.existsSync(tokenFile) ? fs.readFileSync(tokenFile, 'utf8') : null,
    async arm(mode) { const armed = next('armed'); child.send({ mode }); await armed; },
    async callback() { const login = await request('/auth/login');
      assert.equal(login.status, 302);
      const state = new URL(login.location).searchParams.get('state');
      return request('/auth/call-history/callback?code=synthetic-code&state=' + encodeURIComponent(state)); },
    async logout() { return request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': (await status()).csrfToken } }); },
    async restart() { await stop(); await boot(); },
  };
}

for (const source of ['first-login', 'replacement-login', 'refresh']) {
  for (const failure of ['before-write', 'partial-write', 'full-write', 'chmod', 'rename']) {
    test(`R6-HIST-02: ${source} ${failure} preserves the last committed session and leaves no candidate files`, { timeout: 15000 }, async t => {
      const app = await fixture(t, { empty: source === 'first-login', expired: source === 'refresh' });
      const original = app.bytes();
      await app.arm(failure);
      const result = source === 'refresh' ? await app.calls() : await app.callback();
      assert.equal(source === 'refresh' ? result.status : result.location, source === 'refresh' ? 502 : '/?auth=failed');
      assert.equal(app.messages.filter(message => message.kind === 'injected').length, 1, 'The requested filesystem boundary was exercised');
      assert.equal(app.bytes(), original, 'Failure must not replace or truncate the last committed file');
      assert.deepEqual(fs.readdirSync(app.data), original === null ? [] : ['callhistory-token.json'], 'Failed candidate data must be cleaned up');
      const authenticated = source !== 'first-login';
      assert.equal((await app.status()).authenticated, authenticated, 'Memory follows the last committed session');
      if (source !== 'refresh') {
        assert.equal((await app.calls()).status, authenticated ? 200 : 401);
        if (authenticated) assert.equal(app.hits.filter(hit => hit.path.startsWith('/records')).at(-1).authorization, 'Bearer synthetic-old');
      }
      await app.restart();
      assert.equal((await app.status()).authenticated, authenticated, 'Restart follows the same committed state');
      assert.equal(app.bytes(), original);
      assert.equal((await app.calls()).status, authenticated ? 200 : 401);
      if (source === 'replacement-login') assert.equal(app.hits.filter(hit => hit.path.startsWith('/records')).at(-1).authorization, 'Bearer synthetic-old');
      if (authenticated) assert.equal(fs.statSync(app.tokenFile).mode & 0o777, 0o600);
    });
  }
}

for (const source of ['first-login', 'replacement-login', 'refresh']) {
  test(`R6-HIST-02 control: successful ${source} persists privately, survives restart and is removed by logout`, { timeout: 15000 }, async t => {
    const app = await fixture(t, { empty: source === 'first-login', expired: source === 'refresh' });
    const result = source === 'refresh' ? await app.calls() : await app.callback();
    assert.equal(source === 'refresh' ? result.status : result.location, source === 'refresh' ? 200 : '/?auth=connected');
    const expected = source === 'refresh' ? 'synthetic-refreshed' : 'synthetic-login';
    assert.equal(JSON.parse(app.bytes()).accessToken, expected);
    assert.equal(fs.statSync(app.tokenFile).mode & 0o777, 0o600);
    assert.deepEqual(fs.readdirSync(app.data), ['callhistory-token.json']);
    await app.restart();
    assert.equal((await app.calls()).status, 200);
    assert.equal(app.hits.filter(hit => hit.path.startsWith('/records')).at(-1).authorization, 'Bearer ' + expected);
    assert.equal((await app.logout()).status, 200);
    await app.restart();
    assert.equal((await app.status()).authenticated, false);
    assert.equal((await app.calls()).status, 401);
    assert.equal(app.bytes(), null);
  });
}

test('R6-HIST-02: permission setup finishes before commit, so no failing final-file chmod can turn committed login into failure', { timeout: 15000 }, async t => {
  const app = await fixture(t, { empty: true });
  await app.arm('final-chmod');
  assert.equal((await app.callback()).location, '/?auth=connected');
  assert.equal(app.messages.filter(message => message.kind === 'injected').length, 0);
  assert.equal((await app.status()).authenticated, true);
  assert.equal(fs.statSync(app.tokenFile).mode & 0o777, 0o600);
});
