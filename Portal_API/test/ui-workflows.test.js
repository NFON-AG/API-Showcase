const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture, writeFixture } = require('./helpers/fixture.cjs');
const { clientRenderer } = require('./helpers/client-render.cjs');

// Run the real delegated input handlers, serializers and HTTP paths. The DOM and
// file chooser are boundaries here; browser layout/download acceptance is separate.
function eventTarget(selector = '', properties = {}) {
  const element = { id: selector.startsWith('#') ? selector.slice(1) : '', dataset: {}, value: '', tagName: 'BUTTON',
    classList: { add() {}, remove() {}, contains() { return false; } },
    matches: query => query === selector,
    hasAttribute() { return false; }, removeAttribute() {}, ...properties };
  element.closest = query => query === selector ? element : (properties.parents?.[query] || null);
  return element;
}
async function until(check, label) {
  const limit = Date.now() + 5000;
  while (!await check()) {
    assert(Date.now() < limit, `Timed out: ${label}`);
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
async function setup(t, { sessionWrites = true, env = {} } = {}) {
  const app = await (sessionWrites ? writeFixture : fixture)(t, { provider: { queueMembers: 2, skillMembers: 2, customers: 3 }, env });
  const listeners = new Map(), storage = new Map(), requests = [], downloads = [], blobs = new Map();
  let failedRoute, held;
  const defer = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
  const hold = route => {
    held = { route, ready: defer(), release: defer() };
    const current = held;
    t.after(() => current.release.resolve());
    return current;
  };
  const document = { querySelector: () => null, querySelectorAll: () => [],
    addEventListener(type, fn) { listeners.set(type, [...(listeners.get(type) || []), fn]); },
    createElement() { return { click() { downloads.push({ filename: this.download, blob: blobs.get(this.href) }); }, remove() {} }; } };
  class DownloadURL extends URL {
    static createObjectURL(blob) { const key = `blob:fixture-${blobs.size}`; blobs.set(key, blob); return key; }
    static revokeObjectURL(key) { blobs.delete(key); }
  }
  const ui = clientRenderer('en', { document, Blob, URL: DownloadURL,
    localStorage: { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    FormData: class { constructor(form) { this.values = form.values; } entries() { return Object.entries(this.values); } },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', body: options.body, headers: options.headers });
      if (url === failedRoute) return new Response(JSON.stringify({ error: 'Synthetic opt-in failure' }), { status: 503 });
      const response = await fetch(`http://127.0.0.1:${app.port}${url}`, options);
      if (held?.route === url) {
        const current = held; held = null;
        current.ready.resolve(); await current.release.promise;
      }
      return response;
    },
  });
  for (const selector of ['#callflow-canvas', '.flow-menu-launcher']) {
    ui.element(selector).getBoundingClientRect = () => ({ width: 0, height: 0, left: 0, top: 0, right: 0, bottom: 0 });
  }
  document.body.appendChild = () => {};
  ui.evaluate('window.requestAnimationFrame=fn=>fn();window.confirm=()=>{throw new Error("Unexpected native confirmation")};');
  await ui.evaluate('loadOverview();');
  assert.equal(ui.evaluate('state.error'), '');
  const dispatch = (type, element, extras = {}) => {
    const event = { target: element, preventDefault() {}, stopPropagation() {}, ...extras };
    for (const fn of listeners.get(type) || []) fn(event);
  };
  return { app, ui, requests, downloads, dispatch, hold, fail: url => { failedRoute = url; },
    run: ui.evaluate,
    json: expression => JSON.parse(ui.evaluate(`JSON.stringify(${expression})`)),
    click: (selector, properties) => dispatch('click', eventTarget(selector, properties)),
    change: (selector, properties) => dispatch('change', eventTarget(selector, properties)),
  };
}
function file(name, text) { return { name, lastModified: 1, text: async () => text }; }
async function upload(env, uploaded) {
  env.dispatch('submit', eventTarget('#phonebook-upload-form', {
    querySelector: selector => selector === '#phonebook-upload-file' ? { files: [uploaded] } : null,
  }));
  await until(() => env.run('state.phonebookUploadFeedback !== null && !state.phonebookSyncLoading'), 'phonebook upload/comparison');
}

for (const format of ['csv', 'json-array', 'json-object']) test(`File submit parses ${format}, compares contacts and applies the same names and numbers`, async t => {
  const env = await setup(t);
  const contact = { firstName: 'Ada', name: 'Support, "North"', phones: '+493012345678' };
  const text = format === 'csv' ? 'firstName,name,phones\nAda,"Support, ""North""",+493012345678\n' : JSON.stringify(format === 'json-array' ? [contact] : { contacts: [contact] });
  await upload(env, file(format === 'csv' ? 'contacts.CSV' : 'contacts.json', text));
  assert.equal(env.run('state.phonebookUploadFeedback.ok'), true);
  const sent = JSON.parse(env.requests.find(request => request.url === '/api/phonebook-sync/upload').body);
  assert.deepEqual(sent.contacts, [contact]);
  assert.equal(env.run('state.actionPlan.summary.create'), 1);
  assert.deepEqual(await env.app.control('writes'), [], 'Preparing a source must not write provider contacts');
  env.click('#apply-phonebook-sync-live');
  await until(() => env.run('state.actionPlan.applied === true && !state.phonebookSyncLoading'), 'phonebook apply');
  const added = (await env.app.control('state')).pb.find(row => row.id === '5000');
  assert.equal(added.displayName, 'Ada Support, "North"');
  assert.equal(added.displayNumber, contact.phones);
});

test('Malformed uploaded JSON keeps the existing source and does not submit a replacement', async t => {
  const env = await setup(t);
  await upload(env, file('valid.json', JSON.stringify([{ name: 'Existing source', phones: '+493012345678' }])));
  const source = env.run('state.overview.settings.googleContactsFile');
  env.run('state.phonebookUploadFeedback=null');
  await upload(env, file('broken.json', '{invalid'));
  assert.equal(env.run('state.phonebookUploadFeedback.ok'), false);
  assert.equal(env.run('state.overview.settings.googleContactsFile'), source);
  assert.equal(env.requests.filter(request => request.url === '/api/phonebook-sync/upload').length, 1);
  assert.deepEqual(await env.app.control('writes'), []);
});

test('Manual contact input/add/remove handlers preserve normalized rows and apply only remaining contacts', async t => {
  const env = await setup(t);
  env.click('#add-phonebook-manual-contact');
  assert.equal(env.run('state.phonebookUploadFeedback.ok'), false);
  for (const name of ['First customer', 'Second customer']) {
    for (const [field, value] of Object.entries({ firstName: '  Ada  ', name: ` ${name} `, phone: '+493012345678' })) {
      env.dispatch('input', eventTarget('', { dataset: { phonebookManualField: field }, value }));
    }
    env.click('#add-phonebook-manual-contact');
  }
  assert.equal(env.run('state.phonebookManualRows.length'), 2);
  env.click('[data-phonebook-manual-remove]', { dataset: { phonebookManualRemove: '0' } });
  env.click('#stage-phonebook-sync');
  await until(() => env.run('state.actionPlan?.type === "phonebook-sync" && !state.phonebookSyncLoading'), 'manual comparison');
  const sent = JSON.parse(env.requests.find(request => request.url === '/api/phonebook-sync/upload').body);
  assert.equal(sent.contacts.length, 1);
  assert.equal(sent.contacts[0].name, 'Ada Second customer');
  env.click('#apply-phonebook-sync-live');
  await until(() => env.run('state.actionPlan.applied === true && !state.phonebookSyncLoading'), 'manual apply');
  assert.equal((await env.app.control('state')).pb.find(row => row.id === '5000').displayName, 'Ada Second customer');
});

test('Batch CSV change handler retains quoted text, selected optional values and requires recheck after input', async t => {
  const env = await setup(t);
  for (const field of ['accessCentralPhoneBook', 'costCenter']) env.change('', { dataset: { extensionBatchOption: field }, checked: true });
  env.change('#extension-batch-csv', { files: [file('batch.csv', 'number,name,pin,accessCentralPhoneBook,costCenter\n888,"Support, North",1234,false,CC-42\n')] });
  await until(() => env.run('state.extensionBatchRows[0].extensionNumber === "888"'), 'batch import');
  const row = env.json('state.extensionBatchRows[0]');
  assert.equal(row.displayName, 'Support, North');
  assert.equal(row.accessCentralPhoneBook, false);
  assert.equal(row.costCenter, 'CC-42');
  env.click('#plan-extension-batch');
  await until(() => env.run('state.extensionBatchPlan?.ok === true && !state.extensionBatchLoading'), 'batch check');
  const rowElement = { dataset: { extensionBatchRow: '0' } };
  env.dispatch('input', eventTarget('', { dataset: { extensionBatchField: 'displayName' }, value: 'Updated support', parents: { '[data-extension-batch-row]': rowElement } }));
  assert.equal(env.run('state.extensionBatchPlan'), null);
  env.dispatch('keydown', eventTarget('', { dataset: { extensionBatchField: 'displayName' }, parents: { '[data-extension-batch-row]': rowElement } }), { key: 'Enter' });
  assert.equal(env.run('state.extensionBatchRows.length'), 2);
  env.click('[data-remove-extension-batch-row]', { dataset: { removeExtensionBatchRow: '1' } });
  env.click('#plan-extension-batch');
  await until(() => env.run('state.extensionBatchPlan?.ok === true && !state.extensionBatchLoading'), 'batch recheck');
  env.click('#apply-extension-batch');
  await until(() => env.run('uiDialog.open && uiDialog.showCancel'), 'batch confirmation');
  env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.extensionBatchPlan?.applied === true && !state.extensionBatchLoading'), 'batch apply');
  const body = JSON.parse(env.requests.find(request => request.url === '/api/extensions/batch/apply').body);
  assert.equal(body.rows[0].displayName, 'Updated support');
  assert.equal(body.rows[0].accessCentralPhoneBook, false);
  assert.equal(body.rows[0].costCenter, 'CC-42');
  assert.equal((await env.app.control('state')).ext, 41);
});

test('Profile export and file import preserve routing and restore it through the prepared Apply handler', async t => {
  const env = await setup(t);
  env.click('#save-standard-flow-profile');
  assert.equal(env.downloads.length, 1);
  assert.match(env.downloads[0].filename, /^nfon-standard-K9001-.*\.json$/);
  const text = await env.downloads[0].blob.text(), backup = JSON.parse(text);
  assert.equal(backup.type, 'nfon-portal-standard-profile');
  assert.equal(backup.account, 'K9001');
  assert.equal(backup.profile.dids.length, 4);
  await env.app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/phone-extensions/239' } });
  await env.run('loadOverview()');
  env.change('#standard-flow-import-file', { files: [file('restore.json', text)] });
  await until(() => env.run('state.actionPlan?.type === "profile" && state.actionPlan?.applyPayload'), 'profile import plan');
  env.click('#apply-profile-live');
  await until(() => env.run('uiDialog.open && uiDialog.showCancel'), 'profile confirmation');
  env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.actionPlan?.applied === true'), 'profile restore');
  assert.equal((await env.app.control('state')).dids[0].dest.ext, '200');
  const current = env.run('JSON.stringify(readProfile("standard"))');
  env.change('#standard-flow-import-file', { files: [file('foreign.json', JSON.stringify({ ...backup, account: 'K9002' }))] });
  await until(() => env.run('state.actionPlan?.ok === false'), 'foreign profile rejection');
  assert.equal(env.run('JSON.stringify(readProfile("standard"))'), current);
});

test('Setup contains the real profile result region beside its Save and Restore controls', () => {
  const html = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/index.html'), 'utf8');
  const setup = html.slice(html.indexOf('id="view-changes"'), html.indexOf('<section class="panel endpoint-panel"'));
  assert.match(setup, /id="standard-flow-import-file"/);
  assert.match(setup, /id="action-plan"[^>]*aria-live="polite"/, 'the real Setup DOM must expose profile results, not just the synthetic renderer');
});

test('Setup profile file change exposes the plan, keeps Cancel local and displays invalid-file feedback', async t => {
  const env = await setup(t, { sessionWrites: false });
  env.run('state.view="changes"');
  env.click('#save-standard-flow-profile');
  assert.equal(env.run('state.actionPlan.context'), 'changes');
  assert.equal(env.ui.element('#action-plan').hidden, false);
  assert.match(env.ui.element('#action-plan').innerHTML, /Default profile saved/);
  const text = await env.downloads[0].blob.text();
  await env.app.control('mutate', { didDest: { id: '0049.89.55500-0', href: '/api/customers/K9001/targets/phone-extensions/239' } });
  await env.run('loadOverview()');
  env.change('#standard-flow-import-file', { files: [file('restore.json', text)] });
  await until(() => env.run('!!state.actionPlan?.applyPayload'), 'visible Setup profile plan');
  assert.equal(env.run('state.view'), 'changes');
  assert.equal(env.run('state.actionPlan.context'), 'changes');
  assert.equal(env.ui.element('#action-plan').hidden, false);
  assert.match(env.ui.element('#action-plan').innerHTML, /id="apply-profile-live"/);
  const prepared = env.run('JSON.stringify(state.actionPlan)');
  env.change('#standard-flow-import-file', { files: [] });
  assert.equal(env.run('JSON.stringify(state.actionPlan)'), prepared, 'cancelling the file chooser leaves the visible plan unchanged');
  env.click('#apply-profile-live');
  await until(() => env.run('uiDialog.open && uiDialog.showCancel'), 'profile confirmation');
  env.click('[data-app-dialog-cancel]');
  await until(() => env.run('!uiDialog.open'), 'profile cancellation');
  assert.deepEqual(await env.app.control('writes'), [], 'Cancel must not opt in or write routing');
  assert.equal(env.run('JSON.stringify(state.actionPlan)'), prepared);
  env.click('#apply-profile-live');
  await until(() => env.run('uiDialog.open && uiDialog.showCancel'), 'profile confirmation again');
  env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.actionPlan?.applied === true'), 'Setup profile restore');
  await until(() => env.ui.element('#action-plan').innerHTML.includes('Applied live'), 'visible Setup restore result');
  assert.equal((await env.app.control('state')).dids[0].dest.ext, '200');
  assert.equal(env.run('state.view'), 'changes');
  assert.equal(env.ui.element('#action-plan').hidden, false);
  assert.match(env.ui.element('#action-plan').innerHTML, /Applied live/);
  const current = env.run('JSON.stringify(readProfile("standard"))');
  env.change('#standard-flow-import-file', { files: [file('broken.json', '{invalid')] });
  await until(() => env.run('state.actionPlan?.ok === false'), 'visible invalid-file feedback');
  assert.equal(env.run('state.actionPlan.context'), 'changes');
  assert.equal(env.ui.element('#action-plan').hidden, false);
  assert.match(env.ui.element('#action-plan').innerHTML, /Default backup not loaded/);
  assert.doesNotMatch(env.ui.element('#action-plan').innerHTML, /id="apply-profile-live"/);
  assert.equal(env.run('JSON.stringify(readProfile("standard"))'), current);
});

for (const [kind, collection, id] of [['queue', 'queues', '500'], ['skill', 'skills', '600']]) test(`Services ${kind} keyboard/drop/settings/remove/Undo handlers apply their exact membership intent`, async t => {
  const env = await setup(t);
  await env.run('loadServiceGroups()');
  env.run(`state.view='services';state.serviceMode='${collection}';state.selectedServiceKey='${kind}:${id}'`);
  env.dispatch('keydown', eventTarget('[data-service-extension-id]', { dataset: { serviceExtensionId: '238' } }), { key: 'Enter' });
  const card = eventTarget('[data-service-card]', { dataset: { serviceKind: kind, serviceId: id } });
  env.dispatch('drop', card, { dataTransfer: { getData: type => type === 'application/json' ? '["238","239"]' : '' } });
  assert.equal(env.run(`state.serviceDraft.${collection}['${id}'].members.filter(member=>member.extensionNumber==='238').length`), 1);
  const field = kind === 'queue' ? 'penalty' : 'skillLevel';
  env.change('[data-update-service-member]', { type: 'number', value: '4', dataset: { serviceKind: kind, serviceId: id, extensionNumber: '239', field } });
  if (kind === 'skill') env.change('[data-update-service-member]', { type: 'checkbox', checked: false, dataset: { serviceKind: kind, serviceId: id, extensionNumber: '239', field: 'enabled' } });
  env.click('[data-remove-service-member]', { dataset: { serviceKind: kind, serviceId: id, extensionNumber: '200' } });
  env.click('#undo-service-draft');
  assert(env.run(`state.serviceDraft.${collection}['${id}'].members.some(member=>member.extensionNumber==='200')`));
  env.click('[data-remove-service-member]', { dataset: { serviceKind: kind, serviceId: id, extensionNumber: '200' } });
  const writesBeforeColor = (await env.app.control('writes')).length;
  env.change('#service-color-select', { value: 'blue', dataset: { serviceKind: kind, serviceId: id } });
  assert.equal(env.run(`state.serviceDraft.${collection}['${id}'].color`), 'blue');
  assert.equal((await env.app.control('writes')).length, writesBeforeColor);
  env.click('#apply-service-draft');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.serviceFeedback?.type === "success" && !state.serviceApplying'), 'service apply');
  const members = (await env.app.control('state')).members[kind][id];
  assert.deepEqual(members, ['201', '238', '239']);
  const sent = JSON.parse(env.requests.find(request => request.url === '/api/service-groups/apply').body);
  assert.deepEqual(sent.services[0].remove, ['200']);
  assert.equal(sent.services[0].add.find(member => member.extensionNumber === '239')[field], 4);
  if (kind === 'skill') assert.equal(sent.services[0].add.find(member => member.extensionNumber === '239').enabled, false);
});

async function stageMember(env, kind = 'queue', id = '500') {
  await env.run('loadServiceGroups()');
  env.run(`state.view='services';state.serviceMode='${kind === 'queue' ? 'queues' : 'skills'}';state.selectedServiceKey='${kind}:${id}'`);
  env.dispatch('keydown', eventTarget('[data-service-extension-id]', { dataset: { serviceExtensionId: '239' } }), { key: 'Enter' });
  env.run('renderServices()');
  env.requests.length = 0;
}

for (const [kind, id] of [['queue', '500'], ['skill', '600']]) test(`Services ${kind} Apply opts in and writes through one visible confirmation without visiting Setup`, async t => {
  const env = await setup(t, { sessionWrites: false });
  await stageMember(env, kind, id);
  assert.equal(env.run('localWritesEnabled()'), false);
  assert.equal(env.ui.element('#apply-service-draft').disabled, false, 'A permitted session must offer Apply');
  const context = env.run('state.overview.settings.writeContext');
  env.click('#apply-service-draft');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  assert(env.run(`uiDialog.message.includes(state.serviceDraft.${kind === 'queue' ? 'queues' : 'skills'}['${id}'].name)`));
  env.click('#apply-service-draft');
  assert.equal(env.requests.length, 0, 'Opening or double-clicking confirmation does not write');
  env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.serviceFeedback?.type === "success" && !state.serviceApplying'), 'session-enabled membership apply');
  const mutations = env.requests.filter(item => item.method === 'POST');
  assert.deepEqual(mutations.map(item => item.url), ['/api/settings/live-writes', '/api/service-groups/apply']);
  assert(mutations.every(item => item.headers['X-Portal-Context'] === context));
  assert.deepEqual((await env.app.control('state')).members[kind][id], ['200', '201', '239']);
  assert.equal(env.run('uiDialog.open'), false);
});

test('Services confirmation cancellation preserves its draft and leaves the session untouched', async t => {
  const env = await setup(t, { sessionWrites: false });
  await stageMember(env);
  const draft = env.run('JSON.stringify(state.serviceDraft)');
  env.click('#apply-service-draft');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  env.click('[data-app-dialog-cancel]');
  await until(() => !env.run('state.serviceApplying'), 'membership cancellation');
  assert.equal(env.run('JSON.stringify(state.serviceDraft)'), draft);
  assert.deepEqual(env.requests, []);
  assert.equal((await env.app.request('/api/status')).body.settings.liveWritesEnabled, false);
  assert.deepEqual(await env.app.control('writes'), []);
});

test('Services opt-in failure keeps the draft and reports the failure without provider writes', async t => {
  const env = await setup(t, { sessionWrites: false });
  await stageMember(env); env.fail('/api/settings/live-writes');
  const draft = env.run('JSON.stringify(state.serviceDraft)');
  env.click('#apply-service-draft');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.serviceFeedback?.type === "error" && !state.serviceApplying'), 'failed opt-in');
  assert.match(env.run('state.serviceFeedback.message'), /Synthetic opt-in failure/);
  assert.equal(env.run('JSON.stringify(state.serviceDraft)'), draft);
  assert.deepEqual(env.requests.map(item => item.url), ['/api/settings/live-writes']);
  assert.deepEqual(await env.app.control('writes'), []);
});

for (const envConfig of [{ PORTAL_DISABLE_LIVE_WRITES: 'true' }, { PORTAL_ENABLE_LIVE_WRITES: 'false' }]) test(`Services preserves server permissions ${JSON.stringify(envConfig)}`, async t => {
  const env = await setup(t, { sessionWrites: false, env: envConfig });
  await stageMember(env);
  assert.equal(env.ui.element('#apply-service-draft').disabled, true);
  env.click('#apply-service-draft');
  assert.equal(env.run('uiDialog.open'), false);
  assert.deepEqual(env.requests, []);
  assert.deepEqual(await env.app.control('writes'), []);
});

test('Services confirmation cannot migrate its prepared membership intent to another account', async t => {
  const env = await setup(t, { sessionWrites: false });
  await stageMember(env); env.click('#apply-service-draft');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  assert.equal((await env.app.request('/api/settings/customer', { customerAccount: 'K9002' })).status, 200);
  await env.run('loadOverview()'); env.requests.length = 0;
  env.click('[data-app-dialog-confirm]');
  await until(() => !env.run('state.serviceApplying'), 'old account confirmation');
  assert.deepEqual(env.requests, []);
  assert.deepEqual(await env.app.control('writes'), []);
  assert.equal(env.run('state.overview.account'), 'K9002');
});

test('Services stale-draft review offers Cancel and rebases only the reviewed intent', async t => {
  const env = await setup(t);
  await stageMember(env);
  await env.app.control('mutate', { kind: 'queue', service: '500', addMember: '238' });
  await env.run('loadServiceGroups()');
  assert.equal(env.run('state.serviceDraftConflicts.length'), 1);
  env.click('#review-service-conflicts');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  assert.match(env.run('uiDialog.message'), /239/);
  env.click('[data-app-dialog-cancel]');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(env.run('state.serviceDraftConflicts.length'), 1);
  env.click('#review-service-conflicts'); env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.serviceDraftConflicts.length') === 0, 'reviewed membership intent');
  assert.deepEqual(env.json('state.serviceDraft.queues["500"].members.map(member=>member.extensionNumber)'), ['200', '201', '238', '239']);
  assert.deepEqual(await env.app.control('writes'), [], 'Review is a local draft operation');
});

for (const [kind, id, collection, field] of [['queue', '500', 'queues', 'penalty'], ['skill', '600', 'skills', 'skillLevel']]) test(`Services ${kind} retains and subsequently applies a newer member edit while the first Apply is pending`, async t => {
  const env = await setup(t);
  await stageMember(env, kind, id);
  const held = env.hold('/api/service-groups/apply');
  env.click('#apply-service-draft'); env.click('[data-app-dialog-confirm]');
  await held.ready.promise;
  env.change('[data-update-service-member]', { type: 'number', value: '4', dataset: { serviceKind: kind, serviceId: id, extensionNumber: '239', field } });
  held.release.resolve();
  await until(() => !env.run('state.serviceApplying'), 'first membership response');
  assert.equal(env.run(`state.serviceDraft.${collection}['${id}'].members.find(member=>member.extensionNumber==='239').${field}`), 4, 'The newer local edit must survive the older readback');
  assert.equal(env.run(`membershipDelta(state.serviceDraft.${collection}['${id}']).update.find(member=>member.extensionNumber==='239').${field}`), 4);
  env.click('#apply-service-draft'); env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.serviceFeedback?.type === "success" && !state.serviceApplying'), 'second membership apply');
  const providerGroups = (await env.app.request('/api/service-groups')).body;
  assert.equal(providerGroups[collection].find(group=>group.serviceNumber===id).members.find(member=>member.extensionNumber==='239')[field], 4);
  assert.equal(env.run(`membershipDelta(state.serviceDraft.${collection}['${id}']).update.length`), 0);
});

for (const [kind, id, collection] of [['queue', '500', 'queues'], ['skill', '600', 'skills']]) test(`Services ${kind} retains a removal made while that member's addition is pending`, async t => {
  const env = await setup(t);
  await stageMember(env, kind, id);
  const held = env.hold('/api/service-groups/apply');
  env.click('#apply-service-draft'); env.click('[data-app-dialog-confirm]');
  await held.ready.promise;
  env.click('[data-remove-service-member]', { dataset: { serviceKind: kind, serviceId: id, extensionNumber: '239' } });
  held.release.resolve();
  await until(() => !env.run('state.serviceApplying'), 'first membership response');
  assert.deepEqual(env.json(`state.serviceDraft.${collection}['${id}'].members.map(member=>member.extensionNumber)`), ['200', '201']);
  assert.deepEqual(env.json(`membershipDelta(state.serviceDraft.${collection}['${id}']).remove`), ['239']);
  env.click('#apply-service-draft'); env.click('[data-app-dialog-confirm]');
  await until(() => env.run('state.serviceFeedback?.type === "success" && !state.serviceApplying'), 'subsequent member removal');
  assert.deepEqual((await env.app.control('state')).members[kind][id], ['200', '201']);
  assert.equal(env.run(`membershipDelta(state.serviceDraft.${collection}['${id}']).remove.length`), 0);
});

for (const sessionWrites of [true, false]) test(`Day/night maintenance uses visible app choices through create, route, restore and reset (session writes ${sessionWrites})`, async t => {
  const env = await setup(t);
  env.run(`state.profileTargetValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239',number:'239',title:'Night extension'})`);
  await env.run('previewDaynightGateway()');
  for (const [expression, selector, route] of [
    ['applyDaynightGateways()', '#apply-daynight-gateways', '/api/daynight/gateways/apply'],
    ['applyDaynightGatewayRouting()', '#apply-daynight-gateway-routing', '/api/daynight/gateway-routing/apply'],
    ['restoreDaynightRouting()', null, '/api/daynight/restore'],
    ['resetDaynightTimeControls()', '#reset-daynight-time-controls', '/api/daynight/reset'],
  ]) {
    if (!sessionWrites) await env.run('setLiveWritesEnabled(false)');
    const before = (await env.app.control('writes')).length;
    const cancelled = env.run(expression);
    assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true, expression);
    env.click('[data-app-dialog-cancel]'); await cancelled;
    assert.equal((await env.app.control('writes')).length, before, 'Cancel must preserve provider state');
    env.requests.length = 0;
    const pending = selector ? (env.click(selector), null) : env.run(expression);
    assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true, expression);
    env.click('[data-app-dialog-confirm]');
    if (pending) await pending;
    await until(() => env.requests.some(item => item.url === route) && !env.run('state.daynightGatewayApplyLoading || state.daynightGatewayRoutingLoading || state.daynightGatewayResetLoading'), expression);
    assert.equal(env.requests.filter(item => item.url === route).length, 1);
    if (route.endsWith('/gateway-routing/apply')) assert((await env.app.control('state')).dids.every(did=>did.dest.type === 'TIMECONTROL'));
    if (route.endsWith('/restore')) assert((await env.app.control('state')).dids.every(did=>did.dest.type === 'PHONEEXTENSION'));
  }
  assert.deepEqual((await env.app.control('state')).tcs.map(item => item.serviceNumber), ['0'], 'Unmanaged business hours are retained');
});

for (const sessionWrites of [true, false]) test(`Day/night cleanup shows owned stale resources and deletes them only after its app confirmation (session writes ${sessionWrites})`, async t => {
  const env = await setup(t);
  env.run(`state.profileTargetValue=JSON.stringify({type:'PHONEEXTENSION',routeNumber:'239',number:'239',title:'Night extension'})`);
  await env.run('previewDaynightGateway()');
  await env.run('applyDaynightGateways({skipConfirm:true})');
  await env.app.control('mutate', { removeDid: '0049.89.55500-0' });
  await env.run('loadOverview();'); await env.run('previewDaynightGateway()');
  assert.equal(env.run('state.daynightGatewayPreview.staleTimeControls.length'), 1);
  const stale = env.run('state.daynightGatewayPreview.staleTimeControls[0].name');
  if (!sessionWrites) await env.run('setLiveWritesEnabled(false)');
  env.click('#cleanup-daynight-time-controls');
  assert.equal(env.run('uiDialog.open && uiDialog.showCancel'), true);
  assert(env.run(`uiDialog.message.includes(${JSON.stringify(stale)})`));
  env.click('[data-app-dialog-cancel]'); await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await env.app.control('state')).tcs.length, 5);
  env.click('#cleanup-daynight-time-controls'); env.click('[data-app-dialog-confirm]');
  await until(() => env.requests.some(item=>item.url==='/api/daynight/time-controls/cleanup') && !env.run('state.daynightGatewayCleanupLoading'), 'stale time-control cleanup');
  assert.equal((await env.app.control('state')).tcs.length, 4);
});

const directWriteCases = [
  { name: 'Batch', route: '/api/extensions/batch/apply', confirm: true,
    async prepare(env) { env.run(`state.extensionBatchRows=[{extensionNumber:'888',displayName:'Fresh-session extension',mailboxPin:'1234'}]`); env.click('#plan-extension-batch'); await until(()=>env.run('state.extensionBatchPlan?.ok && !state.extensionBatchLoading'),'batch preparation'); },
    available(env) { assert.doesNotMatch(env.ui.element('#extension-batch').innerHTML,/id="apply-extension-batch"[^>]*disabled/); },
    begin(env) { env.click('#apply-extension-batch'); },
    idle: 'state.extensionBatchLoading === false',
    async verify(env) { assert.equal((await env.app.control('state')).ext,41); },
  },
  { name: 'Profile', route: '/api/callflow/bulk-apply', confirm: true,
    async prepare(env) { await env.run(`stageProfilePlan('Prepared restore',[{did:state.overview.inventory.dids[0],target:{type:'PHONEEXTENSION',routeNumber:'239',number:'239'}}],'')`); assert.equal(env.run('state.actionPlan.ok'),true); },
    available(env) { assert.match(env.ui.element('#action-plan').innerHTML,/id="apply-profile-live"/); },
    begin(env) { env.click('#apply-profile-live'); },
    idle: '!uiDialog.pending',
    async verify(env) { assert.equal((await env.app.control('state')).dids[0].dest.ext,'239'); },
  },
  { name: 'Delete resource', route: '/api/resources/queues/501', confirm: true,
    async prepare(env) { env.run(`state.resourceModalKind='queues';renderResourceModal()`); },
    available(env) { assert.doesNotMatch(env.ui.element('#resource-modal-body').innerHTML,/data-delete-resource-kind="queues"[^>]*data-delete-resource-id="501"[^>]*disabled/); },
    begin(env) { env.click('[data-delete-resource-kind][data-delete-resource-id]',{dataset:{deleteResourceKind:'queues',deleteResourceId:'501'}}); },
    idle: '!state.resourceDeleting && !uiDialog.pending',
    async verify(env) { assert.equal((await env.app.control('state')).queues.includes('501'),false); },
  },
  { name: 'Create resource', route: '/api/resources/queues', confirm: false,
    async prepare(env) { env.run(`state.resourceModalKind='queues';renderResourceModal();state.resourceCreateKind='queues';renderResourceCreateModal()`); },
    available(env) { assert.doesNotMatch(env.ui.element('#resource-modal-body').innerHTML,/data-open-resource-create="queues"[^>]*disabled/); assert.doesNotMatch(env.ui.element('#resource-create-body').innerHTML,/data-create-resource-submit[^>]*disabled/); },
    begin(env) { env.dispatch('submit',eventTarget('#resource-create-form',{dataset:{resourceCreateKind:'queues'},values:{displayName:'Fresh-session resource',serviceNumber:'700',extensionNumber:'700'}})); },
    idle: '!state.resourceCreating && !uiDialog.pending',
    async verify(env) { assert((await env.app.control('state')).queues.includes('700')); },
  },
  ...[['queue','queues'],['skill','skills']].map(([kind,collection])=>({name:'Create service '+kind,route:'/api/resources/'+collection,confirm:false,
    async prepare(env) { env.run(`serviceCreateDraftFor('${kind}').displayName='Fresh-session service';serviceCreateDraftFor('${kind}').serviceNumber='700'`); },
    available(env) { assert.doesNotMatch(env.run(`serviceCreateCardMarkup('${kind}')`),/type="submit" disabled/); },
    begin(env) { env.dispatch('submit',eventTarget('[data-service-create-kind]',{dataset:{serviceCreateKind:kind}})); },
    idle: '!state.serviceCreating',
    async verify(env) { assert((await env.app.control('state'))[collection].includes('700')); },
  })),
  { name: 'Phonebook',route:'/api/phonebook-sync/apply',confirm:false,
    async prepare(env) { await upload(env,file('fresh.csv','name,phones\nFresh-session contact,+493012345678\n')); assert.equal(env.run('state.actionPlan.ok'),true); },
    available(env) { assert.doesNotMatch(env.ui.element('#phonebook-sync-summary').innerHTML,/id="apply-phonebook-sync-live"[^>]*disabled/); },
    begin(env) { env.click('#apply-phonebook-sync-live'); },
    idle: '!state.phonebookSyncLoading',
    async verify(env) { assert.equal((await env.app.control('state')).pb.find(row=>row.id==='5000').displayName,'Fresh-session contact'); },
  },
];

for (const action of directWriteCases) {
  test(`Fresh session ${action.name}: explicit action enables and completes without Setup`,async t=>{
    const env=await setup(t,{sessionWrites:false});await action.prepare(env);action.available(env);
    const context=env.run('state.overview.settings.writeContext');env.requests.length=0;
    action.begin(env);
    assert.equal(env.run('uiDialog.open && uiDialog.showCancel'),action.confirm,'Only existing confirmations remain');
    if(action.confirm) { assert.deepEqual(env.requests,[]);env.click('[data-app-dialog-confirm]'); }
    await until(()=>env.requests.some(item=>item.url===action.route)&&env.run(action.idle),'direct action completion');
    assert.deepEqual(env.requests.filter(item=>item.method!=='GET').map(item=>item.url),['/api/settings/live-writes',action.route]);
    assert(env.requests.filter(item=>item.method!=='GET').every(item=>item.headers['X-Portal-Context']===context));
    assert.equal(env.run('uiDialog.open && uiDialog.showCancel'),false,'No second confirmation');
    await action.verify(env);
  });
  if(action.confirm) test(`Fresh session ${action.name}: Cancel does not enable writes`,async t=>{
    const env=await setup(t,{sessionWrites:false});await action.prepare(env);env.requests.length=0;
    action.begin(env);assert.equal(env.run('uiDialog.open && uiDialog.showCancel'),true);
    env.click('[data-app-dialog-cancel]');await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(env.requests,[]);assert.equal((await env.app.request('/api/status')).body.settings.liveWritesEnabled,false);
    assert.deepEqual(await env.app.control('writes'),[]);
  });
  test(`Fresh session ${action.name}: failed opt-in stops before provider mutation`,async t=>{
    const env=await setup(t,{sessionWrites:false});await action.prepare(env);env.requests.length=0;env.fail('/api/settings/live-writes');
    action.begin(env);if(action.confirm) {assert.equal(env.run('uiDialog.open && uiDialog.showCancel'),true);env.click('[data-app-dialog-confirm]');}
    await until(()=>env.requests.length>0&&env.run(action.idle),'failed direct opt-in');
    assert.deepEqual(env.requests.filter(item=>item.method!=='GET').map(item=>item.url),['/api/settings/live-writes']);
    assert.match(env.run('JSON.stringify({dialog:uiDialog.message,plan:state.actionPlan?.message,service:state.serviceFeedback?.message,batch:state.extensionBatchPlan?.message})'),/Synthetic opt-in failure/);
    assert.deepEqual(await env.app.control('writes'),[]);
  });
  test(`Fresh session ${action.name}: pending opt-in cannot cross an account change`,async t=>{
    const env=await setup(t,{sessionWrites:false});await action.prepare(env);env.requests.length=0;
    const held=env.hold('/api/settings/live-writes');action.begin(env);
    if(action.confirm) {assert.equal(env.run('uiDialog.open && uiDialog.showCancel'),true);env.click('[data-app-dialog-confirm]');}
    await Promise.race([held.ready.promise,new Promise((_,reject)=>setTimeout(()=>reject(new Error('No opt-in request')),1500))]);
    assert.equal((await env.app.request('/api/settings/customer',{customerAccount:'K9002'})).status,200);await env.run('loadOverview()');
    held.release.resolve();await new Promise(resolve=>setTimeout(resolve,30));
    assert.equal(env.requests.filter(item=>item.url===action.route).length,0);
    assert.equal(env.run('state.overview.account'),'K9002');assert.equal(env.run('state.overview.settings.liveWritesEnabled'),false);
    assert.deepEqual(await env.app.control('writes'),[]);
  });
  test(`Fresh session ${action.name}: hard read-only remains effective`,async t=>{
    const env=await setup(t,{sessionWrites:false,env:{PORTAL_DISABLE_LIVE_WRITES:'true'}});await action.prepare(env);env.requests.length=0;
    action.begin(env);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(env.run('uiDialog.open && uiDialog.showCancel'),false);
    assert.deepEqual(env.requests,[]);assert.deepEqual(await env.app.control('writes'),[]);
  });
}
