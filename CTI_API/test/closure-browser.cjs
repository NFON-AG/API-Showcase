'use strict';
// Explicit real-browser regression. Runs only disposable local fixtures.
// CTI_CLOSURE_EVIDENCE=/new/output/directory NFON_PLAYWRIGHT=/path/to/playwright node test/closure-browser.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fixture, eventually } = require('./helpers/fixture.cjs');
const { isolatedBrowser } = require('./helpers/browser-isolation.cjs');
const { chromium } = require(process.env.NFON_PLAYWRIGHT || 'playwright');
const evidence = path.resolve(process.env.CTI_CLOSURE_EVIDENCE || path.join(__dirname, '../../output/playwright/closure-cti'));
const report = { runtime: process.version, cases: {}, errors: [] };
const cleanups = [];
let isolated;
const textIncludes = (page, selector, text) => page.waitForFunction(({ selector, text }) => document.querySelector(selector)?.textContent.includes(text), { selector, text });
async function language(page, code) {
  if (await page.locator('html').getAttribute('lang') === code) return;
  await page.locator('#language-trigger').click();
  await page.locator(`#language-menu [data-language="${code}"]`).click();
  assert.equal(await page.locator('html').getAttribute('lang'), code);
}
async function check(id, run) {
  try { report.cases[id] = { status: 'PASS', ...(await run()) }; }
  catch (error) { report.cases[id] = { status: 'FAIL', error: error.stack }; }
  console.log(id, report.cases[id].status);
  fs.writeFileSync(path.join(evidence, 'results.json'), JSON.stringify(report, null, 2)+'\n');
}
function event(uuid, index, state = 'hangup', phone = '') {
  return { account: 'K1', uuid, state, extension: '21', direction: 'inbound',
    caller: phone || `+1202555${String(100 + index).padStart(4, '0')}`, callee: '21',
    updated: new Date(Date.now() - 120000 - index * 1000).toISOString() };
}
async function app(events = []) {
  const f = await fixture({ after: fn => cleanups.push(fn) }, { credentials: true, events, publicFiles: true });
  f.mock.extensionName = 'Original Éléna'; await f.start();
  await eventually(() => f.mock.streams.size === 2);
  const context = await isolated.context(f.base); cleanups.push(() => context.close());
  const page = await context.newPage(); page.setDefaultTimeout(7000);
  page.on('pageerror', error => report.errors.push(error.message));
  return { f, page, context };
}
async function download(page, selector, filename) {
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator(selector).click()]);
  const target = path.join(evidence, filename); await file.saveAs(target);
  assert.equal(await file.failure(), null);
  const bytes = fs.readFileSync(target);
  return { text: bytes.toString('utf8'), sha256: createHash('sha256').update(bytes).digest('hex'), filename: file.suggestedFilename() };
}
async function parse(page, format, text) {
  if (format === 'csv') {
    const [headers, ...rows] = text.replace(/^\uFEFF/, '').split('\n');
    return { headers: headers.split(';'), rows: rows.filter(Boolean).map(row => [...row.matchAll(/"((?:[^"]|"")*)"(?:;|$)/g)].map(m => m[1].replaceAll('""','"'))) };
  }
  return page.evaluate(text => { const dom = new DOMParser().parseFromString(text, 'text/html'); return {
    headers: [...dom.querySelectorAll('th')].map(n => n.textContent),
    rows: [...dom.querySelectorAll('tbody tr')].map(tr => [...tr.cells].map(td => td.textContent)) }; }, text);
}
async function exports() {
  const events = Array.from({ length: 83 }, (_, i) => event('closure-export-' + String(i+1).padStart(2,'0'), i));
  const { f, page } = await app(events);
  for (const [format, selector] of [['csv','#export-csv'],['xls','#export-excel']]) {
    for (const changeLanguage of [false,true]) {
      await check(`CTI-01-${format}-${changeLanguage ? 'language-race' : 'stable'}`, async () => {
        await page.goto(f.base+'/analytics.html?lang=en', {waitUntil:'domcontentloaded'});
        await textIncludes(page, '#history-count', 'Calls shown: 80 / 83');
        await language(page,'en');
        let reached, release;
        const entered = new Promise(resolve => { reached = resolve; });
        const barrier = new Promise(resolve => { release = resolve; });
        const target = url => url.origin===f.base && url.pathname==='/api/contacts/lookup' && url.searchParams.get('phone')===events[80].caller;
        const hold = async route => { reached(); await barrier; await route.continue(); };
        if (changeLanguage) await page.route(target,hold);
        let output;
        try {
          const pending = download(page, selector, `${format}-${changeLanguage?'language-race':'stable'}.${format}`); pending.catch(()=>{});
          if (changeLanguage) {
            await Promise.race([entered,new Promise((_,reject)=>setTimeout(()=>reject(Error('Row 81 lookup barrier not reached')),9000).unref())]);
            await language(page,'de'); release();
          }
          output=await pending;
        } finally { release(); if(changeLanguage) await page.unroute(target,hold); }
        const data=await parse(page,format,output.text);
        fs.writeFileSync(path.join(evidence,`${format}-${changeLanguage?'language-race':'stable'}-cells.json`),JSON.stringify(data,null,2)+'\n');
        assert.deepEqual(data.headers,['Date','Status','Direction','From','To','Extension','Duration','Events','Call ID']);
        assert.equal(data.rows.length,83);
        assert.deepEqual(data.rows.map(row=>row[8]),events.map(row=>row.uuid));
        assert(data.rows.every(row=>row.length===9 && row.every(Boolean)), 'Every column must retain its value');
        assert(data.rows.every(row=>row[1]==='Missed' && row[2]==='Inbound' && row[4]==='Original Éléna · Extension 21'), 'One export uses one locale throughout');
        return { rows:83, visible:80, sha256:output.sha256, filename:output.filename };
      });
    }
  }
}
async function sources() {
  const { f, page, context }=await app();
  await page.goto(f.base+'/setup.html?lang=en',{waitUntil:'domcontentloaded'});
  await page.locator('[data-contact-mode=local]').click();
  const form=page.locator('#local-contact-form');
  await form.locator('[name=firstName]').fill('Source');
  await form.locator('[name=lastName]').fill('Local');
  await form.locator('[name=phone]').fill('+12025550118');
  await form.locator('[type=submit]').click();
  await textIncludes(page,'#contacts-list','Source Local');
  await check('CTI-02-local-list',async()=>{
    const row=page.locator('.contact-row').filter({hasText:'Source Local'});
    const lookup=(await f.get('/api/contacts/lookup?phone=%2B12025550118')).body.contact;
    assert.equal(lookup.source,'local');
    const label=await row.locator('.contact-main small').textContent();
    await row.screenshot({path:path.join(evidence,'local-contact.png')});
    assert.equal(label,'Local contact');return {lookupSource:lookup.source,label};
  });
  const calls=await context.newPage();calls.setDefaultTimeout(7000);
  calls.on('pageerror',e=>report.errors.push(e.message));
  await calls.goto(f.base+'/analytics.html?lang=en',{waitUntil:'domcontentloaded'});
  await textIncludes(calls,'#connection-state','Live');
  for (const [kind,phone,expected] of [['local','+12025550118','Local contact'],['unknown','+12025550119','']]) {
    await check('CTI-02-'+kind+'-popup',async()=>{
      const ring=event('source-'+kind,0,'ring',phone);f.send('one','calls',ring);
      await calls.locator('#call-popup:not([hidden])').waitFor();
      await textIncludes(calls,'.call-popup-summary',kind==='local'?'Source Local':'+1');
      const caller=calls.locator('#call-popup .call-person').first();
      const label=await caller.locator('small').count()?await caller.locator('small').textContent():'';
      await calls.locator('#call-popup').screenshot({path:path.join(evidence,kind+'-popup.png')});
      f.send('one','calls',{...ring,state:'hangup',updated:new Date().toISOString()});
      await calls.locator('#call-popup').waitFor({state:'hidden'});
      assert.equal(label,expected);return {label};
    });
  }
  assert.equal(f.mock.writes,0);assert.equal(f.mock.deletes,0);
}
(async()=>{
  fs.mkdirSync(evidence,{recursive:true});
  isolated=await isolatedBrowser(chromium,process.env.NFON_CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
  report.browser=isolated.browser.version();
  try {await exports();await sources();}
  finally {
    for(const cleanup of cleanups.reverse())await cleanup();
    report.deniedBrowserRequests=isolated.routeDenials;
    report.deniedChromeBackgroundTargets=[...new Set(isolated.proxyDenials)];
    await isolated.close();
    fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(report,null,2)+'\n');
  }
  if(report.errors.length || report.deniedBrowserRequests.length || Object.values(report.cases).some(r=>r.status!=='PASS'))process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1;});
