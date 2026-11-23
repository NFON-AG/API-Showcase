const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check, message) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await check()) return;
    await pause(10);
  }
  assert.fail(message);
}
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Every fixture owns its mock listener, copied product source, HOME and config.
// The preload changes scheduling only: the original token write is held before
// physical IO. No product function, response, auth state or fetch is replaced.
async function start(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-retest5-'));
  fs.cpSync(path.join(__dirname, '../src'), path.join(temp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(temp, '.env'), '');
  const data = path.join(temp, 'data');
  fs.mkdirSync(data);
  const tokenFile = path.join(data, 'callhistory-token.json');
  const oauthStateFile = path.join(data, 'callhistory-oauth-state.json');
  if (!options.empty) fs.writeFileSync(tokenFile, JSON.stringify({
    accessToken: 'synthetic-original', refreshToken: options.noRefresh ? '' : 'synthetic-refresh',
    expiresAt: options.expired ? 1 : Date.now() + 3600000,
  }));
  const hits = [];
  const refreshEntered = deferred(), refreshRelease = deferred();
  const upstream = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const hit = { path: url.pathname, authorization: req.headers.authorization };
    hits.push(hit);
    if (url.pathname === '/token') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      hit.grant = form.get('grant_type');
      hit.code = form.get('code');
      if (hit.grant === 'refresh_token' && options.holdRefresh) {
        refreshEntered.resolve();
        await refreshRelease.promise;
      }
      if (hit.grant === 'refresh_token' && options.refreshFailure) {
        json(res, 400, { error: 'invalid_grant' }); return;
      }
      const suffix = hit.grant === 'refresh_token' ? 'refreshed' : hit.code;
      json(res, 200, { access_token: 'synthetic-' + suffix, refresh_token: 'synthetic-next-refresh', expires_in: 3600 });
      return;
    }
    if (url.pathname.startsWith('/records/')) {
      const authorized = hit.authorization === ['Bearer', 'synthetic-refreshed'].join(' ');
      if (options.detail401 && (!authorized || options.always401)) {
        if (options.detail401 === 'readable') { json(res, 401, { error: 'expired' }); return; }
        res.writeHead(401, { 'Content-Type': 'application/json', 'Content-Length': '10000' });
        res.flushHeaders();
        res.write('{');
        if (options.detail401 === 'aborted') setTimeout(() => res.destroy(), 20);
        return;
      }
      json(res, 200, { uuid: 'detail', transcription: { available: true, summary: 'Synthetic exact summary',
        transcript: [{ event: 'speech', source: 'caller', text: 'Synthetic literal speech', time: '2026-10-22T10:00:00Z' }] } });
      return;
    }
    if (url.pathname === '/records') { json(res, 200, []); return; }
    json(res, 404, { error: 'fixture route missing' });
  });
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const provider = `http://127.0.0.1:${upstream.address().port}`;
  const preload = path.join(temp, 'barrier.cjs');
  fs.writeFileSync(preload, `
    const fs = require('node:fs/promises');
    const path = require('node:path');
    const net = require('node:net');
    const http = require('node:http');
    const originalWrite = fs.writeFile;
    let armed = process.env.RETEST5_WRITE_BARRIER === '1';
    let release;
    process.on('message', message => { if (message === 'release-write') release?.(); });
    fs.writeFile = async function(file, ...args) {
      if (armed && path.basename(String(file)).includes('callhistory-token.json')) {
        armed = false;
        await new Promise(resolve => { release = resolve; process.send({ kind: 'write-entered' }); });
      }
      return originalWrite.call(this, file, ...args);
    };
    const originalRemove = fs.rm;
    let removeArmed = process.env.RETEST5_REMOVE_BARRIER === '1';
    let releaseRemove;
    process.on('message', message => { if (message === 'release-remove') releaseRemove?.(); });
    fs.rm = async function(file, ...args) {
      const held = removeArmed && path.basename(String(file)) === 'callhistory-token.json';
      if (held) {
        removeArmed = false;
        await new Promise(resolve => { releaseRemove = resolve; process.send({ kind: 'remove-entered' }); });
      }
      try {
        const result = await originalRemove.call(this, file, ...args);
        if (held) process.send({ kind: 'remove-completed' });
        return result;
      } catch (error) {
        if (path.basename(String(file)) === 'callhistory-oauth-state.json') process.send({ kind: 'state-remove-failed' });
        throw error;
      }
    };
    const listen = net.Server.prototype.listen;
    net.Server.prototype.listen = function(...args) {
      this.once('listening', () => process.send({ kind: 'listening', port: this.address().port }));
      return listen.apply(this, args);
    };
    const createServer = http.createServer;
    http.createServer = function(...args) {
      const server = createServer.apply(this, args);
      server.on('request', req => {
        // Runs after the original async handler has reached its first await;
        // the logout route invalidates memory before awaiting its disk queue.
        if (req.url === '/api/auth/logout') process.send({ kind: 'logout-entered' });
      });
      return server;
    };
  `);
  let child, base, stderr = '', writeEntered, logoutEntered, removeEntered, removeCompleted, stateRemoveFailed;
  async function stopChild() {
    if (child && child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill();
      await exited;
    }
  }
  async function boot(barrier = false, removeBarrier = false) {
    const listening = deferred();
    writeEntered = deferred();
    logoutEntered = deferred();
    removeEntered = deferred();
    removeCompleted = deferred();
    stateRemoveFailed = deferred();
    child = spawn(process.execPath, ['--require', preload, 'src/server.js'], {
      cwd: temp,
      env: { PATH: process.env.PATH, HOME: temp, HOST: '127.0.0.1', PORT: '0',
        NFON_SHOWCASE_CONFIG_DIR: path.join(temp, 'empty-config'), CALLHISTORY_DATA_DIR: data,
        CALLHISTORY_CLIENT_ID: 'synthetic-client', CALLHISTORY_API_BASE_URL: provider,
        CALLHISTORY_TOKEN_URL: provider + '/token', CALLHISTORY_AUTH_URL: provider + '/authorize',
        CALLHISTORY_PUBLIC_BASE_URL: provider, CALLHISTORY_TIMEOUT_MS: '250', DEMO_MODE: 'false',
        RETEST5_WRITE_BARRIER: barrier ? '1' : '0', RETEST5_REMOVE_BARRIER: removeBarrier ? '1' : '0' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('message', message => {
      if (message.kind === 'listening') listening.resolve(message.port);
      if (message.kind === 'write-entered') writeEntered.resolve();
      if (message.kind === 'logout-entered') logoutEntered.resolve();
      if (message.kind === 'remove-entered') removeEntered.resolve();
      if (message.kind === 'remove-completed') removeCompleted.resolve();
      if (message.kind === 'state-remove-failed') stateRemoveFailed.resolve();
    });
    const port = await Promise.race([listening.promise, pause(3000).then(() => { throw new Error('Server start failed: ' + stderr); })]);
    base = `http://127.0.0.1:${port}`;
  }
  t.after(async () => {
    refreshRelease.resolve();
    await stopChild();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  await boot(options.barrier, options.removeBarrier);
  const request = async (route, init = {}) => {
    const response = await fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...init });
    const text = await response.text();
    return { status: response.status, location: response.headers.get('location'), body: text ? JSON.parse(text) : null };
  };
  const status = async () => (await request('/api/status')).body;
  const calls = '/api/calls?mode=live&start=2026-10-22T00:00:00Z&end=2026-10-23T00:00:00Z';
  const app = { request, status, calls, hits, tokenFile, oauthStateFile, refreshEntered, refreshRelease,
    async logout() { return request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': (await status()).csrfToken } }); },
    async callback(code = 'login') {
      const login = await request('/auth/login');
      assert.equal(login.status, 302);
      const state = new URL(login.location).searchParams.get('state');
      return request('/auth/call-history/callback?state=' + encodeURIComponent(state) + '&code=' + code);
    },
    async waitForWrite() { await Promise.race([writeEntered.promise, pause(3000).then(() => { throw new Error('Token persistence barrier was not entered: ' + stderr); })]); },
    async waitForLogout() { await Promise.race([logoutEntered.promise, pause(3000).then(() => { throw new Error('Logout request was not received: ' + stderr); })]); },
    releaseWrite() { child.send('release-write'); },
    async waitForRemove() { await Promise.race([removeEntered.promise, pause(3000).then(() => { throw new Error('Token deletion barrier was not entered: ' + stderr); })]); },
    async waitForRemoveComplete() { await Promise.race([removeCompleted.promise, pause(3000).then(() => { throw new Error('Token deletion did not finish: ' + stderr); })]); },
    async waitForStateRemoveFailure() { await Promise.race([stateRemoveFailed.promise, pause(3000).then(() => { throw new Error('Expected real OAuth-state removal failure: ' + stderr); })]); },
    releaseRemove() { child.send('release-remove'); },
    async restart() { await stopChild(); base = ''; await boot(); },
  };
  return app;
}

async function loggedOutSnapshot(app) {
  return { authenticated: (await app.status()).authenticated, calls: (await app.request(app.calls)).status,
    tokenExists: fs.existsSync(app.tokenFile) };
}

for (const source of ['refresh', 'callback']) {
  test(`R5-HIST-01: logout during pending ${source} persistence stays logged out after a new request and restart`, { timeout: 15000 }, async t => {
    const app = await start(t, { barrier: true, expired: true, empty: source === 'callback' });
    const pending = source === 'refresh' ? app.request(app.calls) : app.callback('stale');
    await app.waitForWrite();
    const logout = app.logout();
    await app.waitForLogout();
    await until(async () => !(await app.status()).authenticated, 'Logout must invalidate the pending session');
    app.releaseWrite();
    assert.equal((await logout).status, 200);
    const staleResult = await pending;
    const beforeRestart = await loggedOutSnapshot(app);
    await app.restart();
    const afterRestart = await loggedOutSnapshot(app);
    assert.deepEqual({ beforeRestart, afterRestart }, {
      beforeRestart: { authenticated: false, calls: 401, tokenExists: false },
      afterRestart: { authenticated: false, calls: 401, tokenExists: false },
    });
    if (source === 'refresh') assert.equal(staleResult.status, 401);
    else assert.equal(staleResult.location, '/?auth=failed');
    assert.equal((await app.callback('fresh')).location, '/?auth=connected');
    assert.equal((await app.request(app.calls)).status, 200, 'An explicit fresh login still works');
  });

  test(`R5-HIST-01: stale ${source} persistence cannot overwrite or erase a newer login`, { timeout: 15000 }, async t => {
    const app = await start(t, { barrier: true, expired: true, empty: source === 'callback' });
    const stale = source === 'refresh' ? app.request(app.calls) : app.callback('stale');
    await app.waitForWrite();
    const logout = app.logout();
    await app.waitForLogout();
    await until(async () => !(await app.status()).authenticated, 'Logout must invalidate the old session');
    const fresh = app.callback('fresh');
    await until(() => app.hits.some(hit => hit.code === 'fresh'), 'New login reached its own token exchange');
    app.releaseWrite();
    await Promise.all([logout, stale]);
    assert.equal((await fresh).location, '/?auth=connected');
    assert.equal((await app.request(app.calls)).status, 200);
    assert.equal(app.hits.filter(hit => hit.path === '/records').at(-1).authorization, 'Bearer synthetic-fresh');
    assert.equal(JSON.parse(fs.readFileSync(app.tokenFile)).accessToken, 'synthetic-fresh');
    await app.restart();
    assert.equal((await app.request(app.calls)).status, 200);
    assert.equal(app.hits.filter(hit => hit.path === '/records').at(-1).authorization, 'Bearer synthetic-fresh');
  });
}

test('R5-HIST-01 control: successful refresh persists across restart and completed logout stays logged out', { timeout: 15000 }, async t => {
  const app = await start(t, { expired: true });
  assert.equal((await app.request(app.calls)).status, 200);
  assert.equal(app.hits.filter(hit => hit.grant === 'refresh_token').length, 1);
  assert.equal(JSON.parse(fs.readFileSync(app.tokenFile)).accessToken, 'synthetic-refreshed');
  await app.restart();
  assert.equal((await app.request(app.calls)).status, 200);
  assert.equal(app.hits.filter(hit => hit.grant === 'refresh_token').length, 1);
  assert.equal((await app.logout()).status, 200);
  await app.restart();
  assert.deepEqual(await loggedOutSnapshot(app), { authenticated: false, calls: 401, tokenExists: false });
});

test('R5-HIST-01 control: a valid new OAuth login is durable after logout', { timeout: 10000 }, async t => {
  const app = await start(t);
  assert.equal((await app.logout()).status, 200);
  assert.equal((await app.callback('fresh')).location, '/?auth=connected');
  assert.equal(JSON.parse(fs.readFileSync(app.tokenFile)).accessToken, 'synthetic-fresh');
  await app.restart();
  assert.equal((await app.request(app.calls)).status, 200);
  assert.equal(app.hits.filter(hit => hit.path === '/records').at(-1).authorization, 'Bearer synthetic-fresh');
});

test('R5-HIST-01 control: stale refresh rejection cannot expire a newer login', { timeout: 10000 }, async t => {
  const app = await start(t, { expired: true, holdRefresh: true, refreshFailure: true });
  const stale = app.request(app.calls);
  await app.refreshEntered.promise;
  assert.equal((await app.logout()).status, 200);
  assert.equal((await app.callback('fresh')).location, '/?auth=connected');
  app.refreshRelease.resolve();
  assert.equal((await stale).status, 401);
  assert.equal((await app.request(app.calls)).status, 200);
  assert.equal(JSON.parse(fs.readFileSync(app.tokenFile)).accessToken, 'synthetic-fresh');
});

for (const refreshFailure of [false, true]) {
  test(`R5-HIST-01 adjacent: new OAuth login without logout survives old refresh ${refreshFailure ? 'rejection' : 'success'}`, { timeout: 10000 }, async t => {
    const app = await start(t, { expired: true, holdRefresh: true, refreshFailure });
    const stale = app.request(app.calls);
    await app.refreshEntered.promise;
    assert.equal((await app.callback('fresh')).location, '/?auth=connected');
    assert.equal(JSON.parse(fs.readFileSync(app.tokenFile)).accessToken, 'synthetic-fresh');
    app.refreshRelease.resolve();
    const staleResult = await stale;
    const snapshot = async () => {
      const calls = await app.request(app.calls);
      return {
        authenticated: (await app.status()).authenticated,
        calls: calls.status,
        token: fs.existsSync(app.tokenFile) ? JSON.parse(fs.readFileSync(app.tokenFile)).accessToken : null,
        authorization: calls.status === 200 ? app.hits.filter(hit => hit.path === '/records').at(-1).authorization : null,
      };
    };
    const beforeRestart = await snapshot();
    await app.restart();
    const afterRestart = await snapshot();
    const expected = { authenticated: true, calls: 200, token: 'synthetic-fresh', authorization: 'Bearer synthetic-fresh' };
    assert.deepEqual({ beforeRestart, afterRestart }, { beforeRestart: expected, afterRestart: expected });
    assert.equal(staleResult.status, 401, 'Requests from the previous session must be invalidated');
    assert.equal(app.hits.filter(hit => hit.grant === 'refresh_token').length, 1);
  });
}

test('R5-HIST-01 adjacent: pending new-session persistence does not reuse the previous token', { timeout: 10000 }, async t => {
  const app = await start(t, { barrier: true });
  const fresh = app.callback('fresh');
  await app.waitForWrite();
  const whilePending = { authenticated: (await app.status()).authenticated, calls: (await app.request(app.calls)).status };
  app.releaseWrite();
  assert.equal((await fresh).location, '/?auth=connected');
  assert.deepEqual(whilePending, { authenticated: false, calls: 401 });
  assert.equal((await app.request(app.calls)).status, 200);
  assert.equal(app.hits.filter(hit => hit.path === '/records').at(-1).authorization, 'Bearer synthetic-fresh');
});

test('R5-HIST-01: a failed logout waits for pending token deletion before a new login may persist', { timeout: 10000 }, async t => {
  const app = await start(t, { removeBarrier: true });
  // A real filesystem type error makes one removal fail while the other is held.
  fs.mkdirSync(app.oauthStateFile);
  fs.writeFileSync(path.join(app.oauthStateFile, 'synthetic'), 'fixture');
  const logout = app.logout();
  await app.waitForRemove();
  await app.waitForStateRemoveFailure();
  const fresh = app.callback('fresh');
  await until(() => app.hits.some(hit => hit.code === 'fresh'), 'New login reached its token exchange');
  // A released queue would let this login finish before deletion resumes.
  await Promise.race([fresh, pause(250)]);
  app.releaseRemove();
  const [logoutResult, freshResult] = await Promise.all([logout, fresh]);
  await app.waitForRemoveComplete();
  assert.equal(logoutResult.status, 500, 'A real removal failure must remain a failed logout');
  assert.equal(freshResult.location, '/?auth=connected');
  assert.equal(fs.existsSync(app.tokenFile), true, 'Old pending deletion must not remove the new login token');
  assert.equal(JSON.parse(fs.readFileSync(app.tokenFile)).accessToken, 'synthetic-fresh');
  assert.equal((await app.request(app.calls)).status, 200);
  fs.rmSync(app.oauthStateFile, { recursive: true, force: true });
  await app.restart();
  assert.equal((await app.request(app.calls)).status, 200, 'The recovered login must survive restart');
  assert.equal(app.hits.filter(hit => hit.path === '/records').at(-1).authorization, 'Bearer synthetic-fresh');
});

for (const detail401 of ['readable', 'aborted', 'stalled']) {
  for (const noRefresh of [true, false]) {
    test(`R5-HIST-02: ${detail401} transcript 401 ${noRefresh ? 'expires session without refresh' : 'refreshes once and preserves exact transcript'}`, { timeout: 10000 }, async t => {
      const app = await start(t, { detail401, noRefresh });
      const result = await app.request('/api/transcripts/detail?mode=live');
      assert.equal(result.status, noRefresh ? 401 : 200);
      assert.equal((await app.status()).authenticated, !noRefresh);
      assert.equal(app.hits.filter(hit => hit.grant === 'refresh_token').length, noRefresh ? 0 : 1);
      assert.equal(app.hits.filter(hit => hit.path === '/records/detail').length, noRefresh ? 1 : 2);
      if (noRefresh) {
        assert.equal(fs.existsSync(app.tokenFile), false);
        assert.equal((await app.request(app.calls)).status, 401);
      } else {
        assert.equal(result.body.summary, 'Synthetic exact summary');
        assert.match(result.body.text, /Synthetic literal speech/);
        assert.equal(result.body.source, 'callhistory-live');
      }
    });
  }
}

for (const detail401 of ['readable', 'aborted', 'stalled']) {
  test(`R5-HIST-02: repeated ${detail401} transcript 401 stops after one refresh and expires the session`, { timeout: 10000 }, async t => {
    const app = await start(t, { detail401, always401: true });
    assert.equal((await app.request('/api/transcripts/detail?mode=live')).status, 401);
    assert.equal(app.hits.filter(hit => hit.grant === 'refresh_token').length, 1);
    assert.equal(app.hits.filter(hit => hit.path === '/records/detail').length, 2);
    assert.deepEqual(await loggedOutSnapshot(app), { authenticated: false, calls: 401, tokenExists: false });
  });
}
