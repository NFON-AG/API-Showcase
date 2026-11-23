// Retest "portal" - stateful mock of the NFON Service Portal API (synthetic data only).
// Based on agent-3's mock (original evidence), extended: stateful writes, paging anomalies,
// member-read failures, external changes, write failures/delays, 429, per-account delays.
// Documented paging shape (spec pages in agent-3/docs-nfon): href, offset, total, size, links, items; default _pagesize=16.
//   node mock-portal.mjs <port> [logfile]
// Control: GET /__mock/log | /__mock/writes | /__mock/state?account=K9001 ; POST /__mock/reset | /__mock/config {json} | /__mock/mutate {json}
import http from 'node:http';
import crypto from 'node:crypto';
import { appendFileSync } from 'node:fs';

let PORT = Number(process.argv[2] || 0);
const LOG = process.argv[3] || '';
const SECRET = process.env.MOCK_SECRET || 'retest-portal-secret';
const KEY_ID = process.env.MOCK_KEY_ID || 'retest-portal-key';

const XSS = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
const defaults = () => ({
  pageSize: 16, maxPageSize: 100,
  customers: 20,            // number of visible customers or 'forbidden'
  extensions: 40, dids: 20, phonebook: 30, queueMembers: 20, skillMembers: 20,
  memberNumbers: null,      // explicit queue/skill member numbers or null = 200..(200+n-1)
  userTimeControl: true,    // customer-made "TN Zentrale" (service 5)
  foreignTn: false,         // unowned "TN +49 (89) 55500-0" (service 6), convention-conform name
  didToTc: '',              // e.g. '5' or '6': DID 0 points to this time-control service
  xss: false, i18nNames: false,
  paging: {},               // { <collectionKey|regex>: mode } modes: totalPlus,totalMinus,repeat,overlap,endlessNext,failOffset,noTotal,nextOnly,emptyMiddle,changeDuringLoad
  membersError: null,       // { mode:'html'|'json'|'plain', times: n|Infinity, service:'500'|undefined }
  detailFail: '',           // regex: GET detail paths that fail with 500
  getFail: '',              // regex: any GET path failing with 500
  writeFail: null,          // { path: regex, method, nth (1-based among matching writes), status, html:true }
  writeDelayMs: 0, writeDelayPath: '',
  accountDelay: {},         // { K9002: ms } for every GET of that account
  getDelay: null,           // { path: regex, ms }
  rateLimit: null,          // { path: regex, retryAfter: '60', times }
  errorBodyHtml: false,     // failing responses carry HTML
});
let cfg = defaults();
let log = [];
let accounts = new Map();
let counters = { memberErrors: 0, rate: 0, writeMatches: 0 };

const I18N_NAMES = ['Zentrale', 'Empfang', 'Vertrieb', 'Abrechnung', 'Reception', 'Support', 'Sales', 'Warteschlange', 'Open', 'Offen'];
function nameFor(prefix, i) {
  if (cfg.xss) return `${prefix} ${i} ${XSS}`;
  if (cfg.i18nNames && i < I18N_NAMES.length) return I18N_NAMES[i];
  return `${prefix} ${i}`;
}
const pad = (n) => String(n).padStart(2, '0');

function makeAccount(account) {
  const base = `/api/customers/${account}`;
  const a = { account, base, ext: new Map(), dids: new Map(), pb: new Map(), tcs: new Map(), queues: new Map(), skills: new Map(), ivrs: new Map(), members: { queue: new Map(), skill: new Map() }, nextPb: 5000, misc: [], timeouts: {} };
  for (let i = 0; i < cfg.extensions; i++) { const n = String(200 + i); a.ext.set(n, { extensionNumber: n, displayName: nameFor('Ext', i), name: nameFor('Ext', i) }); }
  for (let i = 0; i < cfg.dids; i++) {
    const id = `0049.89.555${pad(i)}-0`;
    const ext = String(200 + (i % Math.max(1, cfg.extensions)));
    a.dids.set(id, { id, trunkNumber: `+49 (89) 555${pad(i)}(0-9)`, didNumber: `+49 (89) 555${pad(i)}-0`, didExtension: '0', dest: { type: 'PHONEEXTENSION', ext, service: '', name: a.ext.get(ext)?.displayName || '' } });
  }
  for (let i = 0; i < cfg.phonebook; i++) a.pb.set(String(1000 + i), { displayName: nameFor('Contact', i), displayNumber: `+49 (30) 1234${String(i).padStart(3, '0')}` });
  a.tcs.set('0', { serviceNumber: '0', displayName: nameFor('Business hours', 0), extensionNumber: '7200', allowed: `${base}/targets/phone-extensions/200`, denied: `${base}/targets/HANGUP`, tz: '/api/time-zones/Europe.Berlin', data: {} });
  if (cfg.userTimeControl) a.tcs.set('5', { serviceNumber: '5', displayName: 'TN Zentrale', extensionNumber: '7205', allowed: `${base}/targets/phone-extensions/200`, denied: `${base}/targets/HANGUP`, tz: '/api/time-zones/Europe.Berlin', data: {} });
  if (cfg.foreignTn) a.tcs.set('6', { serviceNumber: '6', displayName: 'TN +49 (89) 55500-0', extensionNumber: '7206', allowed: `${base}/targets/phone-extensions/200`, denied: `${base}/targets/HANGUP`, tz: 'INHERIT', data: {} });
  if (cfg.didToTc && a.tcs.has(String(cfg.didToTc))) { const d = a.dids.get(`0049.89.55500-0`); const tc = a.tcs.get(String(cfg.didToTc)); d.dest = { type: 'TIMECONTROL', service: tc.serviceNumber, ext: tc.extensionNumber, name: tc.displayName }; }
  a.queues.set('500', { serviceNumber: '500', displayName: nameFor('Queue', 0), extensionNumber: '500' });
  a.queues.set('501', { serviceNumber: '501', displayName: nameFor('Queue', 1), extensionNumber: '501' });
  a.skills.set('600', { serviceNumber: '600', displayName: nameFor('Skill', 0), extensionNumber: '600' });
  a.ivrs.set('1', { serviceNumber: '1', displayName: nameFor('IVR', 0), extensionNumber: '7100' });
  const memberList = (n) => Array.isArray(cfg.memberNumbers) ? cfg.memberNumbers.map(String) : Array.from({ length: n }, (_, i) => String(200 + i));
  a.members.queue.set('500', new Map(memberList(cfg.queueMembers).map((num) => [num, { extensionNumber: num, penalty: 0 }])));
  a.members.queue.set('501', new Map(['201', '202'].map((num) => [num, { extensionNumber: num, penalty: 0 }])));
  a.members.skill.set('600', new Map(memberList(cfg.skillMembers).map((num) => [num, { extensionNumber: num, skillLevel: 1, enabled: true }])));
  return a;
}
function acct(account) { if (!accounts.has(account)) accounts.set(account, makeAccount(account)); return accounts.get(account); }

function item(href, data, links = []) {
  return { href, links, data: Object.entries(data).filter(([, v]) => v !== undefined && v !== '').map(([name, value]) => ({ name, value })) };
}
function pagingMode(key, path) {
  for (const [k, mode] of Object.entries(cfg.paging || {})) {
    if (k === key) return mode;
    try { if (k.startsWith('/') && new RegExp(k.slice(1)).test(path)) return mode; } catch {}
  }
  return '';
}
const pageCounts = new Map();
function collection(url, items, key) {
  const mode = pagingMode(key, url.pathname);
  let offset = Number(url.searchParams.get('_offset') || 0);
  const size = Math.min(Number(url.searchParams.get('_pagesize') || cfg.pageSize), cfg.maxPageSize);
  let all = items;
  if (mode === 'changeDuringLoad') {
    const c = (pageCounts.get(url.pathname) || 0) + 1; pageCounts.set(url.pathname, c);
    if (c > 1) all = [item(`${url.pathname}/0000-inserted`, { displayName: 'Inserted during load', extensionNumber: '199' }), ...items];
  }
  if (mode === 'endlessNext') {
    const page = Array.from({ length: size }, (_, i) => item(`${url.pathname}/gen-${offset + i}`, { displayName: `Generated ${offset + i}`, extensionNumber: String(100000 + offset + i) }));
    return { href: `${url.pathname}?_offset=${offset}&_pagesize=${size}`, offset, size: page.length, links: [{ rel: 'next', href: `${url.pathname}?_offset=${offset + size}&_pagesize=${size}` }], items: page };
  }
  if (mode === 'repeat') offset = 0;
  if (mode === 'overlap' && offset > 0) offset -= 1;
  if (mode === 'failOffset' && offset > 0) return { __status: 500, body: { title: 'page failed (mock)' } };
  let page = all.slice(offset, offset + size);
  if (mode === 'emptyMiddle' && offset > 0) page = [];
  let total = all.length;
  if (mode === 'totalPlus') total += 5;
  if (mode === 'totalMinus') total = Math.max(0, total - 10);
  const links = [];
  if (mode === 'nextOnly' && offset + size < all.length) links.push({ rel: 'next', href: `${url.pathname}?_offset=${offset + size}&_pagesize=${size}` });
  const body = { href: `${url.pathname}?_offset=${offset}&_pagesize=${size}`, offset, total, size: page.length, links, items: page };
  if (mode === 'noTotal' || mode === 'nextOnly') delete body.total;
  return body;
}

function signatureOk(req, bodyText, url) {
  const auth = req.headers.authorization || '';
  const date = req.headers['x-nfon-date'] || '';
  const path = `${url.pathname}${url.search}`;
  let sts = `${req.method}\n${date}\n${path}`;
  if (['POST', 'PUT'].includes(req.method) && bodyText) sts = `${req.method}\n${req.headers['content-md5'] || ''}\n${req.headers['content-type'] || ''}\n${date}\n${path}`;
  const expected = `NFON-API ${KEY_ID}:${crypto.createHmac('sha1', SECRET).update(sts, 'utf8').digest('base64')}`;
  const md5ok = !(['POST', 'PUT'].includes(req.method) && bodyText) || req.headers['content-md5'] === crypto.createHash('md5').update(bodyText, 'utf8').digest('hex');
  return auth === expected && md5ok;
}
function send(res, status, body, headers = {}) {
  const isString = typeof body === 'string';
  const text = body === undefined ? '' : (isString ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': isString ? 'text/html' : 'application/json', ...headers });
  res.end(text);
}
function errBody(title) {
  return cfg.errorBodyHtml ? `<html><body><h1>${title}</h1>${XSS}<script>window.__xss2=1</script></body></html>` : { title, detail: `${title} ${XSS}`, errors: [{ message: `${title} ${XSS}`, path: 'x' }] };
}
function dataOf(body) { const out = {}; for (const e of body?.data || []) if (e?.name) out[e.name] = e.value; return out; }
function linkOf(body, rel) { return (body?.links || []).find((l) => l.rel === rel)?.href || ''; }
const last = (p) => String(p || '').split('?')[0].replace(/\/+$/, '').split('/').pop();

function setDestFromHref(a, did, href) {
  const p = String(href || '');
  const route = last(p);
  if (/\/targets\/phone-extensions\//.test(p)) { const e = a.ext.get(route); if (!e) return false; did.dest = { type: 'PHONEEXTENSION', ext: route, service: '', name: e.displayName }; return true; }
  if (/\/targets\/queue-services\//.test(p)) { const q = a.queues.get(route); if (!q) return false; did.dest = { type: 'QUEUE', ext: q.extensionNumber, service: route, name: q.displayName }; return true; }
  if (/\/targets\/skill-services\//.test(p)) { const q = a.skills.get(route); if (!q) return false; did.dest = { type: 'SKILL', ext: q.extensionNumber, service: route, name: q.displayName }; return true; }
  if (/\/targets\/time-control-services\//.test(p)) { const t = a.tcs.get(route); if (!t) return false; did.dest = { type: 'TIMECONTROL', ext: t.extensionNumber, service: route, name: t.displayName }; return true; }
  if (/\/targets\/ivr-services\//.test(p)) { const t = a.ivrs.get(route); if (!t) return false; did.dest = { type: 'IVR', ext: t.extensionNumber, service: route, name: t.displayName }; return true; }
  if (/\/targets\/NO_ACTION$/.test(p)) { did.dest = null; return true; }
  if (/\/targets\/(HANGUP|BUSY)$/.test(p)) { did.dest = { type: route, ext: '', service: '', name: '' }; return true; }
  return false;
}

function handleWrite(req, url, body, a, rest) {
  // Returns [status, body, headers]
  let m;
  if ((m = rest.match(/^\/targets\/(queue|skill)-services\/(\d+)\/members(?:\/(\d+))?$/))) {
    const [, kind, svc, num] = m; const members = a.members[kind].get(svc);
    if (!members) return [404, { title: 'service not found' }];
    if (req.method === 'POST') { const n = last(linkOf(body, 'phoneExtension')) || dataOf(body).extensionNumber; if (members.has(n)) return [409, { title: 'already member' }]; members.set(n, { extensionNumber: n, ...dataOf(body) }); return [201, { href: `${url.pathname}/${n}` }, { Location: `http://127.0.0.1:${PORT}${url.pathname}/${n}` }]; }
    if (req.method === 'DELETE') { if (!members.delete(num)) return [404, { title: 'member not found' }]; return [204]; }
    if (req.method === 'PUT') { if (!members.has(num)) return [404, { title: 'member not found' }]; Object.assign(members.get(num), dataOf(body)); return [204]; }
  }
  if ((m = rest.match(/^\/dids\/([^/]+)\/destination$/)) && req.method === 'PUT') {
    const did = a.dids.get(decodeURIComponent(m[1])); if (!did) return [404, { title: 'DID not found' }];
    const href = linkOf(body, 'destination'); if (!href) return [400, { errors: [{ message: 'destination is required', path: 'destination' }] }];
    if (!setDestFromHref(a, did, href)) return [400, { errors: [{ message: 'destination not found', path: 'destination' }] }];
    return [204];
  }
  if (rest === '/targets/time-control-services' && req.method === 'POST') {
    const d = dataOf(body); let sn = d.serviceNumber !== undefined ? String(d.serviceNumber) : '';
    if (!sn) { let i = 0; while (a.tcs.has(String(i))) i++; sn = String(i); }
    if (cfg.assignTcOffset) sn=String(Number(sn)+cfg.assignTcOffset);
    if (a.tcs.has(sn)) return [409, { title: 'serviceNumber in use' }];
    a.tcs.set(sn, { serviceNumber: sn, displayName: d.displayName, extensionNumber: d.extensionNumber, allowed: linkOf(body, 'destinationIfAllowed'), denied: linkOf(body, 'destinationIfDenied'), tz: linkOf(body, 'timezone'), data: d });
    return [201, { href: `${a.base}/targets/time-control-services/${sn}` }, { Location: `http://127.0.0.1:${PORT}${a.base}/targets/time-control-services/${sn}` }];
  }
  if ((m = rest.match(/^\/targets\/time-control-services\/(\d+)$/))) {
    const t = a.tcs.get(m[1]); if (!t) return [404, { title: 'Time Control Service not found' }];
    if (req.method === 'DELETE') {
      if ([...a.dids.values()].some((d) => d.dest?.type === 'TIMECONTROL' && d.dest.service === m[1])) return [409, { title: 'time control still referenced (mock)' }];
      a.tcs.delete(m[1]); return [204];
    }
    if (req.method === 'PUT') { const d = dataOf(body); Object.assign(t, { displayName: d.displayName || t.displayName, allowed: linkOf(body, 'destinationIfAllowed') || t.allowed, denied: linkOf(body, 'destinationIfDenied') || t.denied, tz: linkOf(body, 'timezone') || t.tz, data: { ...t.data, ...d } }); return [204]; }
  }
  if (rest === '/phone-books' && req.method === 'POST') { const id = String(a.nextPb++); const d = dataOf(body); a.pb.set(id, { displayName: d.displayName, displayNumber: d.displayNumber, extra: Object.keys(d).filter((k) => !['displayName', 'displayNumber'].includes(k)) }); return [201, { href: `${a.base}/phone-books/${id}` }, { Location: `http://127.0.0.1:${PORT}${a.base}/phone-books/${id}` }]; }
  if ((m = rest.match(/^\/phone-books\/(\d+)$/)) && req.method === 'PUT') { const e = a.pb.get(m[1]); if (!e) return [404, { title: 'not found' }]; const d = dataOf(body); Object.assign(e, { displayName: d.displayName ?? e.displayName, displayNumber: d.displayNumber ?? e.displayNumber }); return [204]; }
  if (rest === '/targets/phone-extensions' && req.method === 'POST') { const d = dataOf(body); if (a.ext.has(String(d.extensionNumber))) return [409, { title: 'extension exists' }]; a.ext.set(String(d.extensionNumber), { extensionNumber: String(d.extensionNumber), displayName: d.displayName, name: d.displayName }); return [201, { href: `${a.base}/targets/phone-extensions/${d.extensionNumber}` }]; }
  if ((m = rest.match(/^\/targets\/(queue|skill)-services$/)) && req.method === 'POST') { const d = dataOf(body); const map = m[1] === 'queue' ? a.queues : a.skills; let sn = String(d.serviceNumber || ''); if (!sn) { let i = 700; while (map.has(String(i))) i++; sn = String(i); } map.set(sn, { serviceNumber: sn, displayName: d.displayName, extensionNumber: String(d.extensionNumber || sn) }); a.members[m[1]].set(sn, new Map()); return [201, { href: `${a.base}/targets/${m[1]}-services/${sn}` }]; }
  if ((m = rest.match(/^\/targets\/(queue|skill|ivr)-services\/(\d+)$/)) && req.method === 'DELETE') { const map = { queue: a.queues, skill: a.skills, ivr: a.ivrs }[m[1]]; if (!map.delete(m[2])) return [404, { title: 'not found' }]; return [204]; }
  if (rest === '/targets/ivr-services' && req.method === 'POST') { const d = dataOf(body); let i = 1; while (a.ivrs.has(String(i))) i++; a.ivrs.set(String(i), { serviceNumber: String(i), displayName: d.displayName, extensionNumber: String(d.extensionNumber || ''), announcement: linkOf(body, 'announcement'), keys: [] }); return [201, { href: `${a.base}/targets/ivr-services/${i}` }]; }
  // Preserve created IVR topology for repeat-Apply readback in synthetic tests.
  if ((m = rest.match(/^\/targets\/ivr-services\/(\d+)\/key-assignments$/)) && req.method === 'POST') {
    const v = a.ivrs.get(m[1]); if (!v) return [404, { title: 'IVR not found' }];
    const d = dataOf(body); v.keys ||= []; v.keys.push({ number: String(d.number), target: linkOf(body, 'target') });
    return [201, { href: `${url.pathname}/${v.keys.length}` }];
  }
  if ((m = rest.match(/^\/targets\/ivr-services\/(\d+)\/timeout$/)) && req.method === 'PUT') {
    const v = a.ivrs.get(m[1]); if (!v) return [404, { title: 'IVR not found' }]; v.timeout = body; return [204];
  }
  if ((m = rest.match(/^\/targets\/(queue|skill)-services\/(\d+)\/timeout$/)) && req.method === 'PUT') { a.timeouts[m[1]+'/'+m[2]] = body; return [204]; }
  a.misc.push({ method: req.method, rest });
  if (req.method === 'DELETE') return [204];
  if (req.method === 'PUT') return [204];
  return [201, { href: `${url.pathname}/${Math.floor(Math.random() * 900 + 100)}` }];
}

const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const bodyText = Buffer.concat(chunks).toString('utf8');
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  if (url.pathname.startsWith('/__mock/')) {
    if (url.pathname === '/__mock/log') return send(res, 200, log);
    if (url.pathname === '/__mock/writes') return send(res, 200, log.filter((e) => e.method !== 'GET'));
    if (url.pathname === '/__mock/reset') { log = []; accounts = new Map(); counters = { memberErrors: 0, rate: 0, writeMatches: 0 }; pageCounts.clear(); return send(res, 200, { ok: true }); }
    if (url.pathname === '/__mock/clearlog') { log = []; return send(res, 200, { ok: true }); }
    if (url.pathname === '/__mock/config') { cfg = { ...defaults(), ...JSON.parse(bodyText || '{}') }; log = []; accounts = new Map(); counters = { memberErrors: 0, rate: 0, writeMatches: 0 }; pageCounts.clear(); return send(res, 200, cfg); }
    if (url.pathname === '/__mock/patch') { Object.assign(cfg, JSON.parse(bodyText || '{}')); counters.memberErrors = 0; counters.rate = 0; counters.writeMatches = 0; return send(res, 200, cfg); }
    if (url.pathname === '/__mock/mutate') {
      const op = JSON.parse(bodyText || '{}'); const a = acct(op.account || 'K9001');
      if (op.addMember) a.members[op.kind || 'queue'].get(op.service).set(String(op.addMember), { extensionNumber: String(op.addMember), penalty: 0, skillLevel: 1, enabled: true });
      if (op.removeMember) a.members[op.kind || 'queue'].get(op.service).delete(String(op.removeMember));
      // Test-only external provider state changes retain native Boolean values.
      if (op.setMember) {
        const member = a.members[op.kind || 'skill'].get(String(op.service || '600'))?.get(String(op.setMember.extensionNumber));
        if (!member) return send(res, 404, { error: 'Synthetic member not found' });
        Object.assign(member, op.setMember);
      }
      if (op.addTc) a.tcs.set(String(op.addTc.serviceNumber), { allowed: `${a.base}/targets/phone-extensions/200`, denied: `${a.base}/targets/HANGUP`, tz: 'INHERIT', data: {}, ...op.addTc });
      if (op.didDest) { const d = a.dids.get(op.didDest.id); setDestFromHref(a, d, op.didDest.href); }
      if (op.removeDid) a.dids.delete(op.removeDid);
      if (op.addDid) { const id = op.addDid; a.dids.set(id, { id, trunkNumber: '+49 (89) 777(0-9)', didNumber: op.didNumber || ('+49 (89) ' + id), didExtension: '0', dest: { type: 'PHONEEXTENSION', ext: op.ext || '220', service: '', name: a.ext.get(op.ext || '220')?.displayName || '' } }); }
      if (op.removeTc) a.tcs.delete(String(op.removeTc));
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/__mock/state') {
      const a = acct(url.searchParams.get('account') || 'K9001');
      return send(res, 200, {
        members: Object.fromEntries(['queue', 'skill'].map((k) => [k, Object.fromEntries([...a.members[k]].map(([s, m]) => [s, [...m.keys()]]))])),
        dids: [...a.dids.values()].map((d) => ({ id: d.id, dest: d.dest })),
        tcs: [...a.tcs.values()].map((t) => ({ serviceNumber: t.serviceNumber, displayName: t.displayName, allowed: t.allowed, denied: t.denied, tz: t.tz, data: t.data })),
        pb: [...a.pb].map(([id, e]) => ({ id, ...e })), ext: a.ext.size, misc: a.misc, queues:[...a.queues.keys()], skills:[...a.skills.keys()], ivrs:[...a.ivrs.keys()], timeouts:a.timeouts,
      });
    }
    return send(res, 404, { error: 'mock' });
  }
  const entry = { t: new Date().toISOString(), method: req.method, path: `${url.pathname}${url.search}`, bodyLength: bodyText.length, sigOk: signatureOk(req, bodyText, url), userAgent: req.headers['user-agent'] || '' };
  if (req.method !== 'GET') entry.body = bodyText.slice(0, 3000);
  log.push(entry);
  if (LOG) appendFileSync(LOG, JSON.stringify(entry) + '\n');
  if (!entry.sigOk) return send(res, 403, { title: 'Access forbidden', detail: 'signature mismatch (mock)' });

  const m = url.pathname.match(/^\/api\/customers\/([^/]+)(\/.*)?$/);
  const account = m ? decodeURIComponent(m[1]) : '';
  const rest = m ? (m[2] || '') : '';
  let delay = cfg.accountDelay?.[account] && req.method === 'GET' ? cfg.accountDelay[account] : 0;
  if (cfg.getDelay && req.method === 'GET' && new RegExp(cfg.getDelay.path).test(url.pathname)) delay += cfg.getDelay.ms;
  if (req.method !== 'GET' && cfg.writeDelayMs && (!cfg.writeDelayPath || new RegExp(cfg.writeDelayPath).test(url.pathname))) delay += cfg.writeDelayMs;
  if (delay) await new Promise((r) => setTimeout(r, delay));
  if (cfg.rateLimit && new RegExp(cfg.rateLimit.path).test(url.pathname) && counters.rate < (cfg.rateLimit.times ?? Infinity)) { counters.rate++; return send(res, 429, { title: 'Too many requests' }, { 'Retry-After': String(cfg.rateLimit.retryAfter || '60') }); }

  if (req.method !== 'GET') {
    if (cfg.writeFail && new RegExp(cfg.writeFail.path || '.').test(url.pathname) && (!cfg.writeFail.method || cfg.writeFail.method === req.method)) {
      counters.writeMatches++;
      if (!cfg.writeFail.nth || counters.writeMatches === cfg.writeFail.nth || (cfg.writeFail.from && counters.writeMatches >= cfg.writeFail.from)) return send(res, cfg.writeFail.status || 400, cfg.writeFail.html ? errBody('mock write rejected') : { errors: [{ message: `mock rejected ${XSS}`, path: 'x' }] });
    }
    if (!/^K9\d{3}$/.test(account)) return send(res, 404, { title: 'Customer not found' });
    let body = {}; try { body = bodyText ? JSON.parse(bodyText) : {}; } catch {}
    let [status, out, headers] = handleWrite(req, url, body, acct(account), rest);
    if (cfg.locationOnly && status === 201 && out?.href) { headers = {...headers, Location:out.href + (cfg.trailingLocationSlash ? '/' : '')}; out={}; }
    if (cfg.collectionLocation && status === 201 && /time-control-services$/.test(rest)) { headers = {...headers, Location:url.pathname}; out={}; }
    if (cfg.timeControlResponse && status === 201 && /time-control-services$/.test(rest)) {
      if (cfg.timeControlResponse === 'body-only') delete headers.Location;
      if (cfg.timeControlResponse === 'collection-with-body') headers.Location = url.pathname;
      if (cfg.timeControlResponse === 'conflicting') headers.Location = url.pathname + '/999';
      if (cfg.timeControlResponse === 'foreign-account') { headers.Location = out.href.replace(account, 'K9002'); out = {}; }
      if (cfg.timeControlResponse === 'foreign-origin') { headers.Location = 'https://foreign.invalid' + out.href; out = {}; }
      if (cfg.timeControlResponse === 'wrong-endpoint') { headers.Location = out.href.replace('time-control-services', 'queue-services'); out = {}; }
      if (cfg.timeControlResponse === 'missing') { delete headers.Location; out = {}; }
    }
    if (cfg.concurrentTimeControl && status === 201 && /time-control-services$/.test(rest)) {
      const a=acct(account); const last=[...a.tcs.values()].at(-1); const duplicate={...last,serviceNumber:'999',extensionNumber:'7999'}; a.tcs.set('999',duplicate);
      if (cfg.hideCreatedTimeControl) last.hiddenFromInventory = true;
    }
    return send(res, status, out, headers || {});
  }
  if (cfg.getFail && new RegExp(cfg.getFail).test(url.pathname)) return send(res, cfg.getFailStatus || 500, errBody('get failed'));
  if (cfg.getResponse && new RegExp(cfg.getResponse.path).test(url.pathname) && (!cfg.getResponse.firstPageOnly || !url.searchParams.has('_offset')) && (cfg.getResponse.offset === undefined || Number(url.searchParams.get('_offset') || 0) === cfg.getResponse.offset)) {
    return send(res, cfg.getResponse.status || 200, cfg.getResponse.body);
  }
  if (url.pathname === '/api/version') return send(res, 200, { href: '/api/version', data: [{ name: 'version', value: 'mock-1.20.6.0' }, { name: 'secretInternal', value: 'should-not-leak' }] });
  if (url.pathname === '/api/customers' || url.pathname === '/api/customers/') {
    if (cfg.customers === 'forbidden') return send(res, 403, { title: 'Access forbidden', detail: 'mock' });
    const all = []; for (let i = 0; i < Number(cfg.customers); i++) all.push(item(`/api/customers/K9${String(i).padStart(3, '0')}`, { externalIdentifier: `K9${String(i).padStart(3, '0')}`, name: cfg.xss ? `Tenant ${i} ${XSS}` : `Mock tenant ${i}` }));
    const out = collection(url, all, 'customers'); if (out.__status) return send(res, out.__status, out.body); return send(res, 200, out);
  }
  if (!m) return send(res, 404, { title: 'not found' });
  if (!/^K9\d{3}$/.test(account)) return send(res, 404, { title: 'Customer not found', detail: `Customer with identifier ${account} has not been found` });
  const a = acct(account);
  const base = a.base;
  const tcItem = (t) => item(`${base}/targets/time-control-services/${t.serviceNumber}`, { displayName: t.displayName, extensionNumber: t.extensionNumber, serviceNumber: Number(t.serviceNumber) });
  const tcDetail = (t) => ({ href: `${base}/targets/time-control-services/${t.serviceNumber}`, links: [{ rel: 'destinationIfAllowed', href: t.allowed }, { rel: 'destinationIfDenied', href: t.denied }, { rel: 'timezone', href: t.tz }], data: [{ name: 'displayName', value: t.displayName }, { name: 'extensionNumber', value: t.extensionNumber }, { name: 'evaluationStrategy', value: t.data?.evaluationStrategy || 'AUTO' }, ...['fromDay', 'fromTimeOfDay', 'toDay', 'toTimeOfDay'].filter(name => t.data?.[name] !== undefined).map(name => ({ name, value: t.data[name] }))] });
  const didItem = (d) => item(`${base}/dids/${d.id}`, { trunkNumber: d.trunkNumber, didNumber: d.didNumber, didExtension: d.didExtension, destinationExtensionNumber: d.dest?.ext, destinationServiceNumber: d.dest?.service, destinationDisplayName: d.dest?.name, destinationType: d.dest?.type });
  const out = (body, key) => { const c = collection(url, body, key); return c.__status ? { status: c.__status, body: c.body } : c; };
  const routes = [
    [/^\/basic-data$/, () => ({ href: url.pathname, data: [{ name: 'externalIdentifier', value: account }, { name: 'name', value: cfg.xss ? `Tenant ${XSS}` : `Mock tenant ${account}` }] })],
    [/^\/contract-information$/, () => ({ href: url.pathname, data: [{ name: 'name', value: 'Mock contract' }] })],
    [/^\/feature-status$/, () => ({ status: 403, body: { title: 'Access forbidden' } })],
    [/^\/targets\/phone-extensions$/, () => out([...a.ext.values()].map((e) => item(`${base}/targets/phone-extensions/${e.extensionNumber}`, { extensionNumber: e.extensionNumber, displayName: e.displayName, type: 'PHONE' })), 'extensions')],
    [/^\/devices$/, () => out([item(`${base}/devices/D1`, { deviceType: 'Yealink T54W', deviceId: 'D1' })], 'devices')],
    [/^\/trunks$/, () => out([...a.dids.values()].map((d, i) => item(`${base}/trunks/0049.89.555${pad(i)}.0-9`, { baseNumber: `+49 (89) 555${pad(i)}`, trunkNumber: d.trunkNumber, inboundCallsEnabled: true })), 'trunks')],
    [/^\/dids$/, () => out([...a.dids.values()].map(didItem), 'dids')],
    [/^\/phone-books$/, () => out([...a.pb].map(([id, e]) => item(`${base}/phone-books/${id}`, { displayName: e.displayName, displayNumber: e.displayNumber })), 'phoneBooks')],
    [/^\/targets\/group-services$/, () => out([item(`${base}/targets/group-services/10`, { displayName: nameFor('Group', 0), serviceNumber: 10, extensionNumber: '10' })], 'groups')],
    [/^\/targets\/ivr-services$/, () => out([...a.ivrs.values()].map((v) => item(`${base}/targets/ivr-services/${v.serviceNumber}`, { displayName: v.displayName, extensionNumber: v.extensionNumber, serviceNumber: Number(v.serviceNumber) })), 'ivrs')],
    [/^\/targets\/ivr-services\/(\d+)$/, (mm) => { const v = a.ivrs.get(mm[1]); return v ? item(url.pathname, { displayName: v.displayName, extensionNumber: v.extensionNumber }, [{ rel: 'announcement', href: v.announcement || `${base}/announcements/ANN1` }]) : { status: 404, body: { title: 'not found' } }; }],
    [/^\/targets\/ivr-services\/(\d+)\/key-assignments$/, (mm) => out((a.ivrs.get(mm[1])?.keys || [{number:'1',target:`${base}/targets/phone-extensions/200`}]).map((key,i) => item(`${url.pathname}/${i+1}`, {number:key.number}, [{rel:'target',href:key.target}])), 'ivrKeys')],
    [/^\/targets\/ivr-services\/(\d+)\/timeout$/, (mm) => a.ivrs.get(mm[1])?.timeout || item(url.pathname, { timeoutDelay: 20 }, [{ rel: 'destinationOnTimeout', href: `${base}/targets/HANGUP` }])],
    [/^\/targets\/time-control-services$/, () => out([...a.tcs.values()].filter(t => !t.hiddenFromInventory).map(tcItem), 'timeControls')],
    [/^\/targets\/time-control-services\/(\d+)$/, (mm) => { const t = a.tcs.get(mm[1]); return t ? tcDetail(t) : { status: 404, body: { title: 'Time Control Service not found' } }; }],
    [/^\/announcements$/, () => out([item(`${base}/announcements/ANN1`, { displayName: nameFor('Announcement', 0), type: 'GENERAL_ANNOUNCEMENT' })], 'announcements')],
    [/^\/targets\/queue-services$/, () => out([...a.queues.values()].map((q) => item(`${base}/targets/queue-services/${q.serviceNumber}`, { displayName: q.displayName, extensionNumber: q.extensionNumber, serviceNumber: Number(q.serviceNumber), type: 'QUEUE' })), 'queues')],
    [/^\/targets\/skill-services$/, () => out([...a.skills.values()].map((q) => item(`${base}/targets/skill-services/${q.serviceNumber}`, { displayName: q.displayName, extensionNumber: q.extensionNumber, serviceNumber: Number(q.serviceNumber), type: 'SKILL' })), 'skills')],
    [/^\/targets\/(queue|skill|group)-services\/(\d+)\/(timeout|destination-on-rejection)$/, (mm) => a.timeouts[mm[1]+'/'+mm[2]] || item(url.pathname, {timeoutDelay:120}, [{rel:mm[3]==='timeout'?'destinationOnTimeout':'destinationOnRejection',href:cfg.routingReference || base+'/targets/HANGUP'}])],
    [/^\/targets\/(queue|skill)-services\/(\d+)\/members$/, (mm) => {
      const me = cfg.membersError;
      if (me && (!me.service || me.service === mm[2]) && (!me.kind || me.kind === mm[1]) && counters.memberErrors < (me.times ?? Infinity)) {
        counters.memberErrors++;
        if (me.mode === 'html') return { status: 500, body: `<html><body><h1>Gateway error</h1>${XSS}</body></html>` };
        if (me.mode === 'json') return { status: 500, body: { message: `upstream failed ${XSS}`, title: `<b>${XSS}</b>` } };
        return { status: 503, body: 'Service unavailable' };
      }
      const members = a.members[mm[1]].get(mm[2]);
      if (!members) return { status: 404, body: { title: 'not found' } };
      return out([...members.values()].map((mem) => item(`${url.pathname}/${mem.extensionNumber}`, { extensionNumber: mem.extensionNumber, displayName: `Extension #${mem.extensionNumber}`, penalty: mm[1] === 'queue' ? (mem.penalty ?? 0) : undefined, skillLevel: mm[1] === 'skill' ? (mem.skillLevel ?? 1) : undefined, enabled: mm[1] === 'skill' ? (mem.enabled !== false) : undefined })), 'members');
    }],
  ];
  if (cfg.detailFail && new RegExp(cfg.detailFail).test(url.pathname)) return send(res, 500, errBody('detail failed'));
  for (const [re, fn] of routes) {
    const mm = rest.match(re);
    if (mm) {
      const result = fn(mm);
      if (result && result.status && result.body !== undefined && !result.items) return send(res, result.status, result.body);
      return send(res, 200, result);
    }
  }
  return send(res, 404, { title: 'Not found', detail: `mock has no ${rest}` });
});
server.listen(PORT, '127.0.0.1', () => { PORT=server.address().port; console.log(`MOCK_PORT=${PORT}`); });
