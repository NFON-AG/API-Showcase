import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import vm from 'node:vm';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanText } from '../scripts/secret-scan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const catalogs = ['shared', 'CTI_API', 'Portal_API', 'CallHistory_API', 'landing', 'docs'];
function snapshot(dir) {
  const result = {};
  function visit(rel = '') {
    for (const e of fs.readdirSync(path.join(dir, rel), {withFileTypes:true})) {
      const name = path.join(rel, e.name);
      if (e.isDirectory()) { result[name + '/'] = 'directory'; visit(name); }
      else result[name] = createHash('sha256').update(fs.readFileSync(path.join(dir,name))).digest('hex');
    }
  }
  visit(); return result;
}
function generator(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nfon-r5-catalog-'));
  t.after(() => fs.rmSync(dir,{recursive:true,force:true}));
  fs.mkdirSync(path.join(dir,'scripts'));
  fs.copyFileSync(path.join(root,'scripts/sync-shared.mjs'),path.join(dir,'scripts/sync-shared.mjs'));
  fs.cpSync(path.join(root,'shared'),path.join(dir,'shared'),{recursive:true});
  for (const name of catalogs) {
    fs.mkdirSync(path.join(dir,name),{recursive:true});
    fs.copyFileSync(path.join(root,name,'i18n-messages.json'),path.join(dir,name,'i18n-messages.json'));
  }
  for (const file of ['i18n.js','demo-runtime.js']) fs.copyFileSync(path.join(root,'docs',file),path.join(dir,'docs',file));
  const run = check => spawnSync(process.execPath,['scripts/sync-shared.mjs',...(check?['--check']:[])],{cwd:dir,encoding:'utf8'});
  assert.equal(run().status,0);
  return {dir,run};
}

test('R5-BUILD-01 every required catalogue must exist before any generated output changes',async t=>{
  for (const missing of catalogs) await t.test(missing,()=>{
    const {dir,run}=generator(t);
    fs.writeFileSync(path.join(dir,'CTI_API/public/assets/material/obsolete.svg'),'<svg/>');
    fs.appendFileSync(path.join(dir,'shared/appearance.js'),'\n/* pending update */\n');
    fs.unlinkSync(path.join(dir,missing,'i18n-messages.json'));
    const before=snapshot(dir);
    for (const check of [true,false]) {
      const r=run(check);
      assert.notEqual(r.status,0,`${missing}: missing required catalogue must fail`);
      assert.deepEqual(snapshot(dir),before,'failure must not change output bytes, file set or orphans');
    }
  });
});

test('R5-BUILD-01 valid catalogue changes reach the actual message output and remain idempotent',t=>{
  const {dir,run}=generator(t),file=path.join(dir,'Portal_API/i18n-messages.json');
  const data=JSON.parse(fs.readFileSync(file));
  data['portal.retest5Sample']=Object.fromEntries(Object.keys(Object.values(data)[0]).map(l=>[l,'Verified '+l]));
  fs.writeFileSync(file,JSON.stringify(data));
  assert.equal(run().status,0);
  const context={window:{}};
  vm.runInNewContext(fs.readFileSync(path.join(dir,'Portal_API/public/messages.js'),'utf8'),context);
  assert.equal(context.window.NFON_MESSAGES['portal.retest5Sample'].fi,'Verified fi');
  const before=snapshot(dir);assert.equal(run(true).status,0);assert.equal(run().status,0);assert.deepEqual(snapshot(dir),before);
});

test('R6-BUILD-01 invalid catalogue types fail preflight without touching generated files',async t=>{
  const cases=catalogs.flatMap(name=>[[name,[]],[name,false]]);
  // The remaining JSON types exercise the shared schema boundary once.
  cases.push(...[null,true,0,1,'','invalid',[{}]].map(value=>['Portal_API',value]));
  for(const [name,value]of cases) await t.test(`${name}: ${JSON.stringify(value)}`,async t=>{
    const {dir,run}=generator(t);
    fs.writeFileSync(path.join(dir,'CTI_API/public/assets/material/obsolete.svg'),'<svg/>');
    fs.appendFileSync(path.join(dir,'shared/appearance.js'),'\n/* pending valid asset update */\n');
    fs.writeFileSync(path.join(dir,name,'i18n-messages.json'),JSON.stringify(value));
    const before=snapshot(dir);
    for(const check of [true,false]) await t.test(check?'check':'generate',()=>{
      const result=run(check);
      assert.notEqual(result.status,0,'invalid catalogue must fail, never drop its messages');
      assert.ok(result.stderr.includes(`${name}/i18n-messages.json`),'diagnostic identifies the invalid catalogue');
      assert.match(result.stderr,/must be a JSON object/);
      assert.deepEqual(snapshot(dir),before,'preflight failure preserves all bytes, file names and orphans');
    });
  });
});

const key=['NFON','API','PASSWORD'].join('_');
const literal=['synthetic','multiline','fixture'].join('-');
const cases=[
  ['double-quoted multiline',`export ${key}="${literal}\ncontinued"`,true],
  ['single-quoted multiline',`export ${key}='${literal}\ncontinued'`,true],
  ['continued dynamic',`export ${key}=\\\n"\${VAULT_PASSWORD_LONG}"`,false],
  ['continued CRLF dynamic',`export ${key}=\\\r\n"\${VAULT_PASSWORD_LONG}"`,false],
  ['continued literal',`export ${key}=\\\n"${literal}"`,true],
  ['single-quoted dynamic is literal',`export ${key}='\${VAULT_PASSWORD_LONG}'`,true],
  ['literal suffix after multiline quoted prefix',`${key}="\${VAULT_PASSWORD_LONG}\n"${literal}`,true],
  ['one-line dynamic',`${key}="\${VAULT_PASSWORD_LONG}"`,false],
  ['command substitution spanning lines',`${key}="$(printf '%s'\n fixture)"`,false],
  ['continued variable with trailing comment',`${key}=\\\n"\${VAULT_PASSWORD_LONG}" # value supplied at runtime`,false],
  ['placeholder',`${key}="<PASSWORD>"`,false],
];
test('R5-SCAN-01 shell logical words distinguish multiline literals and dynamic expansions',async t=>{
  for(const ext of ['sh','bash','zsh','command']) for(const [name,body,expected]of cases) await t.test(`${ext}: ${name}`,()=>{
    const findings=scanText('# harmless preamble\n'+body+'\n','sample.'+ext);
    assert.equal(findings.length>0,expected);
    if(expected)assert.ok(findings.every(f=>f.line===2),'diagnostics retain the assignment line');
  });
});

test('R5-SCAN-01 actual CLI catches multiline credentials without echoing values',t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'nfon-r5-scanner-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const git=process.env.GIT_BIN||'git';
  assert.equal(spawnSync(git,['init','-q'],{cwd:dir}).status,0);
  for(const [name,body,expected]of cases.slice(0,5)){
    fs.writeFileSync(path.join(dir,'sample.sh'),body+'\n');
    const r=spawnSync(process.execPath,[path.join(root,'scripts/secret-scan.mjs')],{cwd:dir,encoding:'utf8',env:{...process.env,GIT_BIN:git}});
    assert.equal(r.status,expected?1:0,name);
    assert.ok(!(r.stdout+r.stderr).includes(literal),'diagnostics must not leak the synthetic value');
  }
});
