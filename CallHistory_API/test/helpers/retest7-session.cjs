'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const vm = require('node:vm');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

async function until(predicate, label = 'condition') {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(r => setTimeout(r, 5)); }
  throw new Error('Timed out waiting for ' + label);
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }

// Only synthetic providers and copied source are used. No .env, user HOME, live
// credential, fixed port, production function, or persistence boundary is patched.
async function fixture(t, options = {}) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-retest7-'));
  fs.cpSync(path.join(__dirname, '../../src'), path.join(temp, 'src'), { recursive: true });
  fs.writeFileSync(path.join(temp, '.env'), '');
  const hits = [], sessions = new Map(); let sequence = 0, current, providerHold;
  const json = (res, value, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
  const provider = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://fixture.invalid');
    if (url.pathname === '/token') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw), refreshing = form.get('grant_type') === 'refresh_token';
      const user = refreshing ? current.user : form.get('code').split(':')[0];
      const expires = form.get('code')?.endsWith(':short') ? 1 : 3600;
      current = { user, id: refreshing ? current.id : ++sequence, access: 'synthetic-access-' + ++sequence };
      sessions.set(current.access, current);
      hits.push({ kind: refreshing ? 'refresh' : 'login', user, session: current.id });
      json(res, { access_token: current.access, refresh_token: 'synthetic-refresh-' + current.id, expires_in: expires,
        id_token: 'synthetic.' + Buffer.from(JSON.stringify({ name: user, email: user + '@example.invalid' })).toString('base64url') + '.unsigned' });
      return;
    }
    const session = sessions.get(String(req.headers.authorization || '').replace(/^Bearer /, ''));
    assert.ok(session, 'Provider accepts only this fixture\'s synthetic tokens');
    hits.push({ kind: 'request', path: url.pathname, user: session.user, session: session.id });
    if (url.pathname === '/records') {
      const base = { startedAt: new Date(Date.now() - 60000).toISOString(), direction: 'inbound', outcome: 'answered', durationSeconds: 30,
        from: { name: 'Synthetic caller', number: '100' }, to: { name: 'Synthetic agent', number: '200' } };
      json(res, [ { ...base, id: 'plain-call', transcriptId: '' },
        { ...base, id: 'current-call', transcriptId: 'current-' + session.id },
        { ...base, id: 'old-call', transcriptId: 'old-' + session.id },
        { ...base, id: 'shared-call', transcriptId: 'same-resource' } ]);
      return;
    }
    if (providerHold && url.pathname.includes(providerHold.match)) {
      const hold = providerHold; providerHold = null; hold.started.resolve(); await hold.release.promise;
    }
    const id = url.pathname.split('/').pop();
    json(res, options.detail ? options.detail(id, session) : { id, summary: 'Synthetic summary ' + session.id,
      text: 'SYNTHETIC TRANSCRIPT ' + session.user + ' SESSION ' + session.id });
  });
  provider.listen(0, '127.0.0.1'); await once(provider, 'listening');
  const upstream = 'http://127.0.0.1:' + provider.address().port;
  const preload = path.join(temp, 'listening.cjs');
  fs.writeFileSync(preload, "const net=require('node:net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){this.once('listening',()=>process.send({port:this.address().port}));return listen.apply(this,args)};");
  let child, base, stderr = '';
  async function stop() { if (child && child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill(); await exited; } }
  async function boot() {
    child = spawn(process.execPath, ['--require', preload, 'src/server.js'], { cwd: temp,
      env: { PATH: process.env.PATH, HOME: temp, HOST: '127.0.0.1', PORT: '0',
        NFON_SHOWCASE_CONFIG_DIR: path.join(temp, 'config'), CALLHISTORY_DATA_DIR: path.join(temp, 'data'),
        CALLHISTORY_CLIENT_ID: 'synthetic-client', CALLHISTORY_AUTH_URL: upstream + '/authorize',
        CALLHISTORY_TOKEN_URL: upstream + '/token', CALLHISTORY_API_BASE_URL: upstream,
        CALLHISTORY_PUBLIC_BASE_URL: upstream, DEMO_MODE: 'false' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.on('data', bytes => { stderr += bytes; });
    const timeout = setTimeout(() => child.kill(), 5000);
    try { const [message] = await once(child, 'message'); base = 'http://127.0.0.1:' + message.port; }
    finally { clearTimeout(timeout); }
  }
  t.after(async () => { providerHold?.release.resolve(); await stop(); provider.closeAllConnections();
    await new Promise(r => provider.close(r)); fs.rmSync(temp, { recursive: true, force: true }); });
  await boot();
  async function request(route, options = {}) { return fetch(base + route, { redirect: 'manual', signal: AbortSignal.timeout(5000), ...options }); }
  const status = async () => (await request('/api/status')).json();
  return { hits, request, status, get base() { return base; }, get session() { return current; },
    async login(user, short = false) {
      const login = await request('/auth/login'); assert.equal(login.status, 302);
      const state = new URL(login.headers.get('location')).searchParams.get('state');
      const result = await request('/auth/call-history/callback?code=' + encodeURIComponent(user + (short ? ':short' : '')) + '&state=' + encodeURIComponent(state));
      assert.equal(result.status, 302); assert.equal(result.headers.get('location'), '/?auth=connected');
      return status();
    },
    async logout() { const response = await request('/api/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': (await status()).csrfToken } }); assert.equal(response.status, 200); },
    holdProvider(match) { providerHold = { match, started: deferred(), release: deferred() }; return providerHold; },
    async restart() { await stop(); await boot(); },
  };
}

// Execute the COMPLETE client including automatic startup and event binding.
// DOM rendering and clipboard are isolated host adapters; all product functions,
// normal entry paths and session HTTP responses remain real. Holding a completed
// fetch models delayed client delivery, not an NFON latency guarantee.
async function client(server, options = {}) {
  const nodes = new Map(), events = new Map(), clipboard = [], pending = new Set(); let gate;
  function element(key) {
    if (!nodes.has(key)) nodes.set(key, { value: '', innerHTML: '', textContent: '', hidden: false, checked: false,
      dataset: {}, style: {}, classList: { toggle() {}, add() {}, remove() {} }, setAttribute() {}, removeAttribute() {},
      getAttribute() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; },
      closest() { return element('label'); }, focus() {}, scrollIntoView() {},
      addEventListener(type, fn) { events.set(key + ':' + type, fn); }, remove() {} });
    return nodes.get(key);
  }
  const context = vm.createContext({ document: { documentElement: { dataset: {}, lang: 'en' }, querySelector: element,
    querySelectorAll: () => [], getElementById: id => element('#' + id), activeElement: null,
    addEventListener(type, fn) { events.set('document:' + type, fn); } },
    window: { location: new URL(server.base), addEventListener() {}, NFON_I18N: { getLanguage: () => 'en', message: () => '', refresh() {} } },
    localStorage: { getItem() { return null; }, setItem() {} }, navigator: { clipboard: { async writeText(text) {
      await options.writeClipboard?.(text); clipboard.push(text);
    } } },
    Intl, Map, URL, URLSearchParams, FormData: class { constructor(form) { this.form = form; } entries() { return Object.entries(this.form.fields); } },
    AbortSignal, setTimeout, clearTimeout, console,
    fetch: (url, options) => {
      const held = gate && String(url).includes(gate.match) ? gate : null; if (held) gate = null;
      const operation = (async () => {
        const response = await server.request(url, options);
        if (!held) return response;
        const body = await response.text(); held.started.resolve({ status: response.status, body }); await held.release.promise;
        if (held.outcome === 'network') throw new Error('Synthetic old network failure');
        if (held.outcome === 401 || held.outcome === 500) return new Response(JSON.stringify({ error: 'Synthetic old HTTP ' + held.outcome }), { status: held.outcome });
        return new Response(body, { status: response.status, headers: response.headers });
      })();
      if (!held) pending.add(operation);
      operation.then(() => { pending.delete(operation); held?.finished.resolve(); }, () => { pending.delete(operation); held?.finished.resolve(); }); return operation;
    }, Response });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../../public/app.js'), 'utf8'), context);
  const run = code => vm.runInContext(code, context);
  await until(() => !run('state.loading') && pending.size === 0, 'full client startup');
  return { run, clipboard, element, events,
    snapshot: () => JSON.parse(run('JSON.stringify({status:state.status,calls:state.calls,cache:[...state.transcriptCache],error:state.error,generation:callDataGeneration,transcript:state.transcript})')),
    hold(match, outcome) { gate = { match, outcome, started: deferred(), release: deferred(), finished: deferred() }; return gate; },
    refresh: () => events.get('#refresh-button:click')(),
    async demo(value) { element('#demo-toggle').checked = value; events.get('#demo-toggle:change')(); await until(() => !run('state.loading') && pending.size === 0, 'demo toggle'); },
    async logout() { events.get('#auth-login-panel:click')({ target: { closest: selector => selector === '#auth-logout' ? {} : null } });
      await until(() => run('state.status.authenticated === false') && !run('state.loading') && pending.size === 0, 'logout control'); },
  };
}
module.exports = { fixture, client, until };
