'use strict';
// Explicit browser regression; every HTTP request uses disposable fixtures.
// NFON_PLAYWRIGHT=/path/to/playwright HISTORY_FILTER_CASE=removed \
// HISTORY_FILTER_EVIDENCE=/new/output/directory node test/browser/final-history-filter.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const { chromium } = require(process.env.NFON_PLAYWRIGHT || 'playwright');
const { isolatedBrowser } = require(path.join(root, 'CTI_API/test/helpers/browser-isolation.cjs'));
const { until } = require(path.join(root, 'CallHistory_API/test/helpers/retest7-session.cjs'));
const scenario = process.env.HISTORY_FILTER_CASE || 'removed';
assert(['removed', 'restored', 'kept', 'normal'].includes(scenario));
const evidence = path.resolve(process.env.HISTORY_FILTER_EVIDENCE || path.join(root, 'output/playwright/final-two-fixes-2026-11-04/history/browser-' + scenario));
const forbidden = new Set([3000, 3001, 3002, 3090]);
const summary = 'SYNTHETIC summary for now-filtered call <literal>';
const sentinel = 'SYNTHETIC prior clipboard content';
const result = { node: process.version, scenario, method: 'Unmodified application; native browser clipboard; only synthetic provider detail HTTP responses held', provider: [], pageErrors: [] };
let release; const gate = new Promise(resolve => { release = resolve; });
const send = (res, body, status=200) => { res.writeHead(status, {'Content-Type':'application/json'});res.end(JSON.stringify(body)); };
async function run() {
  fs.mkdirSync(evidence, {recursive:true});
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'history-filter-browser-'));
  let provider, child, browser, context, page, traceStarted = false;
  try {
    fs.cpSync(path.join(root, 'CallHistory_API/src'), path.join(temp, 'src'), {recursive:true});
    fs.cpSync(path.join(root, 'CallHistory_API/public'), path.join(temp, 'public'), {recursive:true});
    fs.writeFileSync(path.join(temp, '.env'), '');
    provider = http.createServer(async (req, res) => {
      const url = new URL(req.url, 'http://fixture.invalid');
      result.provider.push({path:url.pathname, at:new Date().toISOString()});
      if (url.pathname === '/token') {
        send(res, {access_token:'example-filter-access',expires_in:3600,id_token:'synthetic.'+Buffer.from(JSON.stringify({name:'Synthetic filter fixture'})).toString('base64url')+'.unsigned'}); return;
      }
      assert.equal(req.headers.authorization, 'Bearer example-filter-access');
      if (url.pathname === '/records') {
        if (Number(url.searchParams.get('offset')) > 0) { send(res, []); return; }
        send(res, [{id:'filter-call',transcriptId:'filter-detail',summary,startedAt:new Date(Date.now()-60000).toISOString(),direction:'inbound',outcome:'answered',durationSeconds:30,from:{name:'Synthetic caller',number:'100'},to:{name:'Synthetic agent',number:'200'}}]); return;
      }
      assert.equal(url.pathname, '/records/filter-detail');
      await gate; send(res, {id:'filter-detail',text:'SYNTHETIC transcript',summary});
    });
    provider.listen(0,'127.0.0.1'); await once(provider, 'listening');
    assert(!forbidden.has(provider.address().port));
    const upstream = 'http://127.0.0.1:'+provider.address().port;
    const preload = path.join(temp, 'fixture-guard.cjs');
    fs.writeFileSync(preload, "const net=require('node:net'),listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){this.once('listening',()=>process.send({port:this.address().port}));return listen.apply(this,args)};const real=global.fetch;global.fetch=(url,...args)=>{if(new URL(String(url)).origin!==process.env.FIXTURE_ORIGIN)throw Error('Non-fixture upstream denied');return real(url,...args)};");
    child = spawn(process.execPath, ['--require',preload,'src/server.js'], {cwd:temp, env:{PATH:process.env.PATH,HOME:temp,HOST:'127.0.0.1',PORT:'0',NFON_SHOWCASE_CONFIG_DIR:path.join(temp,'config'),CALLHISTORY_DATA_DIR:path.join(temp,'data'),CALLHISTORY_CLIENT_ID:'synthetic-filter-client',CALLHISTORY_AUTH_URL:upstream+'/authorize',CALLHISTORY_TOKEN_URL:upstream+'/token',CALLHISTORY_API_BASE_URL:upstream,CALLHISTORY_PUBLIC_BASE_URL:upstream,FIXTURE_ORIGIN:upstream,DEMO_MODE:'false'},stdio:['ignore','ignore','pipe','ipc']});
    child.stderr.on('data', b=> {result.serverStderr=(result.serverStderr||'')+b;});
    const [{port}] = await once(child,'message'); assert(!forbidden.has(port));
    const base = 'http://127.0.0.1:'+port;
    result.fixturePorts = {app:port,provider:provider.address().port};
    const request = route => fetch(base+route, {redirect:'manual',signal:AbortSignal.timeout(5000)});
    const login = await request('/auth/login'); assert.equal(login.status,302);
    const authState = new URL(login.headers.get('location')).searchParams.get('state');
    const callback = await request('/auth/call-history/callback?code=synthetic-filter-code&state='+encodeURIComponent(authState));
    assert.equal(callback.status,302); assert.equal((await (await request('/api/status')).json()).authenticated,true);
    result.sourceHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'CallHistory_API/public/app.js'))).digest('hex');
    result.servedHash = crypto.createHash('sha256').update(await (await request('/app.js')).text()).digest('hex');
    assert.equal(result.sourceHash,result.servedHash);
    browser = await isolatedBrowser(chromium, process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    result.browser = browser.browser.version();
    context = await browser.context(base); await context.grantPermissions(['clipboard-read','clipboard-write'],{origin:base});
    await context.tracing.start({screenshots:true,snapshots:true,sources:true}); traceStarted = true;
    page = await context.newPage(); page.setDefaultTimeout(7000);
    page.on('pageerror', error=>result.pageErrors.push(error.message));
    let completedDetails = 0;
    page.on('requestfinished', request => { if (new URL(request.url()).pathname === '/api/transcripts/filter-detail') completedDetails += 1; });
    await page.addInitScript(() => {
      window.observedCopyToasts = [];
      new MutationObserver(records => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node.nodeType === 1 && node.matches?.('.copy-toast')) window.observedCopyToasts.push(node.textContent);
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto(base, {waitUntil:'domcontentloaded'});
    const copy = page.locator('#call-detail [data-copy-kind="summary"]');
    await copy.waitFor({state:'visible'});
    await until(()=>result.provider.filter(p=>p.path==='/records/filter-detail').length===1,'initial selection detail held');
    result.nativeClipboardFunction = await page.evaluate(()=>navigator.clipboard.writeText.toString());
    assert.match(result.nativeClipboardFunction,/\[native code\]/);
    await page.evaluate(text=>navigator.clipboard.writeText(text),sentinel);
    result.beforeCopy = {button:await copy.innerText(),detail:await page.locator('#call-detail').innerText()};
    await page.screenshot({path:path.join(evidence,'01-summary-visible-detail-pending.png'),fullPage:true});
    await copy.click();
    await until(()=>result.provider.filter(p=>p.path==='/records/filter-detail').length===2,'copy detail request held');
    if (scenario === 'removed' || scenario === 'restored') {
      await page.locator('#direction-filter').selectOption('outbound');
      await page.waitForFunction(()=>document.querySelector('#detail-subtitle')?.textContent==='No call selected');
      if (scenario === 'restored') await page.locator('#direction-filter').selectOption('inbound');
    } else if (scenario === 'kept') await page.locator('#direction-filter').selectOption('inbound');
    result.beforeRelease = await page.evaluate(()=>({rows:document.querySelectorAll('.history-row').length,subtitle:document.querySelector('#detail-subtitle').textContent,detail:document.querySelector('#call-detail').textContent.trim(),selectedId:state.selectedCallId,selectedExists:Boolean(selectedCall()),copySequence:copyRequestSequence}));
    result.beforeRelease.clipboard = await page.evaluate(()=>navigator.clipboard.readText());
    assert.equal(result.beforeRelease.clipboard,sentinel);
    await page.screenshot({path:path.join(evidence,'02-filtered-no-selection-before-release.png'),fullPage:true});
    const expectedDetails = result.provider.filter(p => p.path === '/records/filter-detail').length;
    release();
    await until(() => completedDetails >= expectedDetails, 'all held browser HTTP responses finished');
    await page.evaluate(async () => { await new Promise(resolve => setTimeout(resolve, 100)); await copyWriteQueue; });
    result.afterRelease = {clipboard:await page.evaluate(()=>navigator.clipboard.readText()),toasts:await page.evaluate(()=>window.observedCopyToasts),subtitle:await page.locator('#detail-subtitle').innerText(),rows:await page.locator('.history-row').count(),selectedId:await page.evaluate(()=>state.selectedCallId)};
    await page.screenshot({path:path.join(evidence,'03-after-response-release.png'),fullPage:true});
    const shouldCopy = scenario === 'kept' || scenario === 'normal';
    assert.equal(result.afterRelease.clipboard, shouldCopy ? summary : sentinel, 'Only a still-valid copy may write to the native clipboard');
    assert.deepEqual(result.afterRelease.toasts, shouldCopy ? ['Copied to clipboard'] : [], 'Discarded copy intents must never report success');
    if (scenario === 'removed') {
      assert.equal(result.afterRelease.subtitle,'No call selected'); assert.equal(result.afterRelease.rows,0);
      assert.equal(result.afterRelease.selectedId, '');
    } else {
      assert.equal(result.afterRelease.rows,1); assert.equal(result.afterRelease.selectedId,'filter-call');
    }
    result.outcome = 'PASS: native clipboard and visible success state match selection validity';
  } finally {
    release();
    if (traceStarted) await context.tracing.stop({path:path.join(evidence,'trace.zip')});
    if (context) await context.close();
    if (browser) { result.deniedBrowserRequests=browser.routeDenials; result.deniedBrowserBackgroundTargets=browser.proxyDenials; await browser.close(); }
    if (child && child.exitCode===null && child.signalCode===null) {const stopped=once(child,'exit');child.kill();await stopped;}
    if (provider) {provider.closeAllConnections();await new Promise(resolve=>provider.close(resolve));}
    fs.rmSync(temp,{recursive:true,force:true});
  }
}
run().catch(error=>{result.error=error.stack;process.exitCode=1;}).finally(()=>{fs.writeFileSync(path.join(evidence,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));});
