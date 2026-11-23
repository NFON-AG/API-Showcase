import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
test('static generation detects source/copy drift, preserves versioned parity and rejects ambiguous anchors',async t=>{
  const fixture=await mkdtemp(path.join(tmpdir(),'nfon-static-generator-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  for(const dir of ['scripts','docs','CTI_API/public','Portal_API/public','landing/public']) await mkdir(path.join(fixture,dir),{recursive:true});
  await copyFile(path.join(root,'scripts/sync-static.mjs'),path.join(fixture,'scripts/sync-static.mjs'));
  for(const [app,files] of [
    ['CTI_API',['index.html','analytics.html','contacts.html','setup.html','app.js','styles.css','phone-number.js']],
    ['Portal_API',['index.html','styles.css','app.js']],
    ['landing',['index.html','app.js','styles.css']],
  ]) for(const file of files) await copyFile(path.join(root,app,'public',file),path.join(fixture,app,'public',file));
  await cp(path.join(root,'Portal_API/public/pdf'), path.join(fixture,'Portal_API/public/pdf'), {recursive:true});
  const run=(check=false)=>spawnSync(process.execPath,['scripts/sync-static.mjs',...(check?['--check']:[])],{cwd:fixture,encoding:'utf8'});
  assert.equal(run().status,0); assert.equal(run(true).status,0);
  const copy=path.join(fixture,'docs/cti/app.js');
  await writeFile(copy,(await readFile(copy,'utf8'))+'\n/* stale copy */\n');
  assert.notEqual(run(true).status,0); assert.equal(run().status,0);
  const generated=path.join(fixture,'docs/cti/index.html');
  await writeFile(generated,(await readFile(generated,'utf8')).replace('src="./app.js"','src="./app.js?v=sample-version"'));
  assert.equal(run(true).status,0,'version hashes belong to version-assets, not a hand-edited copy');
  for (const app of ['cti','portal','landing']) {
    const orphan=path.join(fixture,'docs',app,'orphan.js');
    await writeFile(orphan,'obsolete'); assert.notEqual(run(true).status,0); assert.equal(run().status,0);
    await assert.rejects(readFile(orphan),{code:'ENOENT'});
  }
  const source=path.join(fixture,'CTI_API/public/index.html'); const original=await readFile(source,'utf8');
  const appAnchor=/src="\/app\.js(?:\?[^\"]*)?"/;
  for(const invalid of [original.replace(appAnchor,'src="/missing.js"'),original.replace(appAnchor,'src="/app.js"></script><script src="/app.js"')]) {
    await writeFile(source,invalid); const result=run(); assert.notEqual(result.status,0); assert.match(result.stderr,/Expected one static HTML anchor/);
  }
});

test('shared --check reports a missing generated surface without creating directories',async t=>{
  const {existsSync}=await import('node:fs');
  const fixture=await mkdtemp(path.join(tmpdir(),'nfon-readonly-check-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  for(const folder of ['scripts','shared','docs'])await mkdir(path.join(fixture,folder),{recursive:true});
  for(const file of ['scripts/sync-shared.mjs','docs/i18n.js','shared/i18n-messages.json'])await copyFile(path.join(root,file),path.join(fixture,file));
  await copyFile(path.join(root,'docs/demo-runtime.js'),path.join(fixture,'docs/demo-runtime.js'));
  for(const app of ['CTI_API','Portal_API','CallHistory_API','landing','docs']) {
    await mkdir(path.join(fixture,app),{recursive:true});
    await copyFile(path.join(root,app,'i18n-messages.json'),path.join(fixture,app,'i18n-messages.json'));
  }
  const result=spawnSync(process.execPath,['scripts/sync-shared.mjs','--check'],{cwd:fixture,encoding:'utf8'});
  assert.notEqual(result.status,0);assert.match(result.stderr,/Shared asset out of sync: CTI_API/);
  assert.equal(existsSync(path.join(fixture,'CTI_API/public')),false);
});
