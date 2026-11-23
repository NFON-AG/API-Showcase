import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const liveRoot = path.join(root, 'CallHistory_API/public/crm-demo');
const staticRoot = path.join(root, 'docs/call-history/crm-demo');

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(path.join(directory, entry.name)).map((file) => `${entry.name}/${file}`) : [entry.name]).sort();
}

test('downloadable/static Call History ships the same fixed CRM module as the server app', () => {
  const liveFiles = files(liveRoot);
  assert.ok(liveFiles.includes('index.html'));
  assert.ok(liveFiles.includes('demo-records.js'));
  assert.deepEqual(files(staticRoot).filter(file => file !== 'offline.html'), liveFiles, 'the complete module is packaged, without stale leftover assets');
  for (const file of liveFiles) {
    if (file.endsWith('.css')) {
      // The static site keeps shared fonts at docs/assets; the standalone app
      // keeps them under public/assets. Compare each referenced font itself as
      // well as all styles after resolving that legitimate relative-path change.
      const urls = (text) => [...text.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]);
      const live = readFileSync(path.join(liveRoot, file), 'utf8');
      const published = readFileSync(path.join(staticRoot, file), 'utf8');
      const liveUrls = urls(live);
      const publishedUrls = urls(published);
      assert.equal(publishedUrls.length, liveUrls.length, file);
      for (let index = 0; index < liveUrls.length; index += 1) {
        assert.deepEqual(readFileSync(path.resolve(staticRoot, publishedUrls[index])), readFileSync(path.resolve(liveRoot, liveUrls[index])), liveUrls[index]);
      }
      assert.equal(published.replace(/url\([^)]+\)/g, 'url(ASSET)'), live.replace(/url\([^)]+\)/g, 'url(ASSET)'), file);
    } else {
      assert.deepEqual(readFileSync(path.join(staticRoot, file)), readFileSync(path.join(liveRoot, file)), file);
    }
  }
});

test('both CRM entry points resolve local assets without loading the history API simulator', () => {
  for (const directory of [liveRoot, staticRoot]) {
    const html = readFileSync(path.join(directory, 'index.html'), 'utf8');
    const css = readFileSync(path.join(directory, 'styles.css'), 'utf8');
    const cssReferences = [...css.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((match) => match[1]);
    const references = [...html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)].map((match) => match[1]);
    assert.ok(references.length > 0);
    for (const reference of [...references, ...cssReferences]) {
      assert.doesNotMatch(reference, /^(?:https?:)?\/\//, 'the fixed demo does not depend on a network asset');
      assert.ok(existsSync(path.resolve(directory, reference.split(/[?#]/)[0])), `${directory}: ${reference}`);
      assert.doesNotMatch(reference, /demo-runtime|(?:^|\/)api\//, 'the fixed module must not import the live/history simulator');
    }
  }
});

test('static generator fails on changed adapter anchors and copies binary assets without stale leftovers', async t => {
  const { mkdtemp, mkdir, copyFile, cp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const temp = await mkdtemp(path.join(tmpdir(), 'history-static-build-'));
  t.after(() => rm(temp, {recursive: true, force: true}));
  for (const folder of ['scripts', 'CallHistory_API/public/crm-demo', 'docs/call-history/crm-demo']) await mkdir(path.join(temp, folder), {recursive: true});
  await copyFile(path.join(root, 'scripts/sync-history.mjs'), path.join(temp, 'scripts/sync-history.mjs'));
  for (const file of ['app.js','styles.css','index.html','messages.js']) await copyFile(path.join(root,'CallHistory_API/public',file),path.join(temp,'CallHistory_API/public',file));
  await cp(path.join(root, 'CallHistory_API/public/crm-demo'), path.join(temp, 'CallHistory_API/public/crm-demo'), {recursive:true});
  await cp(path.join(root, 'CallHistory_API/public/assets'), path.join(temp, 'CallHistory_API/public/assets'), {recursive:true});
  const binary = Buffer.from([0,255,128,64,3,254,0]);
  await writeFile(path.join(temp,'CallHistory_API/public/crm-demo/asset.bin'),binary);
  await writeFile(path.join(temp,'docs/call-history/crm-demo/orphan.js'),'obsolete');
  await writeFile(path.join(temp,'docs/call-history/unrelated.txt'),'keep');
  const run = (...args) => spawnSync(process.execPath,['scripts/sync-history.mjs',...args],{cwd:temp,encoding:'utf8'});
  assert.equal(run().status,0);
  assert.deepEqual(await readFile(path.join(temp,'docs/call-history/crm-demo/asset.bin')),binary);
  assert.equal(existsSync(path.join(temp,'docs/call-history/crm-demo/orphan.js')),false);
  assert.equal(existsSync(path.join(temp,'docs/call-history/unrelated.txt')),false,'the entire app download is generator-owned');
  assert.equal(run('--check').status,0);
  const crm = path.join(temp,'CallHistory_API/public/crm-demo/index.html');
  const originalCrm = await readFile(crm,'utf8');
  for (const extra of ['<script type="module" src="extra.js"></script>', '<link rel="stylesheet" href="extra.css">']) {
    await writeFile(crm, originalCrm.replace('</head>', extra+'</head>'));
    assert.notEqual(run('--check').status,0); assert.notEqual(run().status,0);
  }
  await writeFile(crm,originalCrm);
  // Replacement metacharacters in inline source must survive packaging byte-for-byte.
  const scriptFile = path.join(temp,'CallHistory_API/public/crm-demo/app.js');
  await writeFile(scriptFile, (await readFile(scriptFile,'utf8'))+'\n/* literal $& and $$ marker */');
  assert.equal(run().status,0);
  assert.ok((await readFile(path.join(temp,'docs/call-history/crm-demo/offline.html'),'utf8')).includes('/* literal $& and $$ marker */'));
  const source = path.join(temp,'CallHistory_API/public/app.js');
  const original = await readFile(source,'utf8');
  for (const content of [original.replace('demoMode: storedValue("callhistory-demo-mode") === "1"','demoMode: false'), original+'\n// demoMode: storedValue("callhistory-demo-mode") === "1"']) {
    await writeFile(source,content);
    const result = run();
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/Static adapter must match exactly once/);
  }
});

test('offline packaging rejects additional resource syntax before replacing the previous bundle', async t => {
  const { mkdtemp, mkdir, copyFile, cp, writeFile, readFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { spawnSync } = await import('node:child_process');
  const temp = await mkdtemp(path.join(tmpdir(), 'history-offline-resources-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  await mkdir(path.join(temp, 'scripts'), { recursive: true });
  await copyFile(path.join(root, 'scripts/sync-history.mjs'), path.join(temp, 'scripts/sync-history.mjs'));
  await cp(path.join(root, 'CallHistory_API/public'), path.join(temp, 'CallHistory_API/public'), { recursive: true });
  const htmlPath = path.join(temp, 'CallHistory_API/public/crm-demo/index.html');
  const cssPath = path.join(temp, 'CallHistory_API/public/crm-demo/styles.css');
  const originalHtml = await readFile(htmlPath, 'utf8');
  const originalCss = await readFile(cssPath, 'utf8');
  const run = (...args) => spawnSync(process.execPath, ['scripts/sync-history.mjs', ...args], { cwd: temp, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const offlinePath = path.join(temp, 'docs/call-history/crm-demo/offline.html');
  const previousBundle = await readFile(offlinePath);
  const mutations = [
    ['uppercase CSS URL', '', '.probe { background-image: URL("https://invalid.example/a.png"); }'],
    ['mixed-case unquoted CSS URL', '', '.probe { background-image: uRl(https://invalid.example/a.png); }'],
    ['CSS image-set quoted URL', '', '.probe { background-image: image-set("https://invalid.example/a.png" 1x); }'],
    ['prefixed mixed-case image-set', '', '.probe { background-image: -webkit-IMAGE-SET("https://invalid.example/a.png" 1x); }'],
    ['uppercase CSS import', '', '@IMPORT "https://invalid.example/a.css";'],
    ['double-quoted srcset', '<img srcset="https://invalid.example/a.png 1x">', ''],
    ['single-quoted srcset', "<img srcset='https://invalid.example/a.png 1x'>", ''],
    ['unquoted mixed-case srcset', '<IMG\nSRCSET = https://invalid.example/a.png>', ''],
    ['srcset following quoted angle bracket', '<img alt="size > default" srcset="https://invalid.example/a.png 1x">', ''],
    ['inline style import', '<style>@import "https://invalid.example/a.css";</style>', ''],
    ['mixed-case inline style import', "<STYLE media='screen'>@IMPORT 'https://invalid.example/a.css';</STYLE>", ''],
    ['inline style attribute', '<div STYLE="background-image: url(https://invalid.example/a.png)"></div>', ''],
    ['inline style following quoted angle bracket', '<div title="size > default" style="background-image: url(https://invalid.example/a.png)"></div>', ''],
    ['video poster', '<video poster=https://invalid.example/a.png></video>', ''],
    ['SVG image', '<svg><image href="https://invalid.example/a.svg"></image></svg>', ''],
    ['object data', '<object data=https://invalid.example/a.svg></object>', ''],
    ['meta refresh quoted', '<meta http-equiv="refresh" content="0;url=https://invalid.example/">', ''],
    ['meta refresh unquoted mixed-case', '<META HTTP-EQUIV=REFRESH CONTENT="0;url=https://invalid.example/">', ''],
  ];
  for (const [label, extraHtml, extraCss] of mutations) {
    await writeFile(htmlPath, originalHtml.replace('</body>', extraHtml + '</body>'));
    await writeFile(cssPath, originalCss + '\n' + extraCss);
    for (const mode of [[], ['--check']]) {
      const result = run(...mode);
      assert.notEqual(result.status, 0, `${label}: ${mode[0] || 'build'} must reject unsupported resources`);
      assert.match(result.stderr, /Unsupported offline|Unresolved offline/, label);
      assert.deepEqual(await readFile(offlinePath), previousBundle, `${label}: preserve the previously valid bundle`);
    }
  }
  await writeFile(htmlPath, originalHtml);
  await writeFile(cssPath, originalCss.replace('url(', 'URL('));
  assert.equal(run().status, 0, 'the existing font also embeds with an uppercase URL function');
  const offline = await readFile(offlinePath, 'utf8');
  assert.match(offline, /data:font\/woff2;base64,/);
  assert.doesNotMatch(offline, /url\(\s*["']?\.\.\/assets\/fonts\//i);
  assert.equal(run('--check').status, 0);

  // A late adapter failure must preserve every output, even when an earlier
  // source changed. Checking only offline.html misses partial publication.
  const target = path.join(temp, 'docs/call-history');
  const snapshot = () => files(target).map(file => [file, readFileSync(path.join(target,file)).toString('base64')]);
  const previousOutputs = snapshot();
  const appPath = path.join(temp, 'CallHistory_API/public/app.js');
  const originalApp = await readFile(appPath, 'utf8');
  await writeFile(appPath, originalApp + '\n/* changed before late source validation */\n');
  const extraCss = path.join(temp, 'CallHistory_API/public/crm-demo/extra.css');
  await writeFile(extraCss, '.probe { src: url("../assets/fonts/extra.woff2"); }');
  for (const mode of [[], ['--check']]) {
    const result = run(...mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unexpected font adapter location/);
    assert.deepEqual(snapshot(), previousOutputs, 'all prior outputs survive late source validation failures');
  }
  await rm(extraCss);
  await writeFile(appPath, originalApp);
  assert.equal(run('--check').status, 0);
});


test('offline CRM is self-contained while the parent keeps an opaque sandbox', () => {
  const offline = readFileSync(path.join(staticRoot, 'offline.html'), 'utf8');
  assert.doesNotMatch(offline, /<(?:script|link)\b[^>]*(?:src|href)=/);
  for (const [,url] of offline.matchAll(/url\(["']?([^"')]+)["']?\)/g)) assert.ok(url.startsWith("data:"), "offline CSS never requests a sibling resource");
  assert.match(offline, /data:font\/woff2;base64,/);
  assert.match(offline, /DEMO_AUTOMATION/);
  assert.match(offline, /nfon:crm-demo:ready/);
  const parent = readFileSync(path.join(root, 'docs/call-history/index.html'), 'utf8');
  assert.match(parent, /sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"/);
  assert.doesNotMatch(parent, /allow-same-origin/);
});
