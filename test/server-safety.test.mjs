import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import safety from '../shared/server-safety.cjs';
import { scanText } from '../scripts/secret-scan.mjs';

test('environment comments cannot disable a configured safety flag', () => {
  assert.equal(safety.parseEnvValue('true # hard read-only lock'), 'true');
  assert.equal(safety.parseEnvValue('"true" # hard read-only lock'), 'true');
  assert.equal(safety.parseEnvValue("'a # b' # comment"), 'a # b');
  assert.equal(safety.parseEnvValue('true#lock'), 'true');
  assert.equal(safety.parseEnvValue(String.raw`"a\"b" # comment`), String.raw`a\"b`);
  assert.throws(() => safety.parseEnvValue('"unfinished'));
  assert.throws(() => safety.parseEnvValue('"true" invalid'));
});

test('security booleans reject unknown or empty values and do not include values in errors', () => {
  for (const value of ['true', '1', 'YES', 'on']) assert.equal(safety.parseEnvFlag('LOCK', value), true);
  for (const value of ['true#lock', '"true" # lock']) assert.equal(safety.parseEnvFlag('LOCK', safety.parseEnvValue(value)), true);
  for (const value of ['false', '0', 'NO', 'off']) assert.equal(safety.parseEnvFlag('LOCK', value), false);
  assert.equal(safety.parseEnvFlag('LOCK', undefined, true), true);
  for (const value of ['', 'tru', 'locked', 'true and false']) assert.throws(() => safety.parseEnvFlag('LOCK', value), { message: 'Invalid boolean configuration: LOCK' });
  for (const value of ['"false#literal"', "'true#literal'"]) assert.throws(() => safety.parseEnvFlag('LOCK', safety.parseEnvValue(value)), {message:'Invalid boolean configuration: LOCK'});
});

test('static files never follow symlinks outside their public tree', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'nfon-public-'));
  t.after(() => rm(root, { recursive:true, force:true }));
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'private.txt'), 'outside');
  await writeFile(path.join(root, 'public', 'inside.txt'), 'inside');
  await symlink('../private.txt', path.join(root, 'public', 'escape.txt'));
  assert.equal(String(await safety.readPublicFile(path.join(root,'public'),path.join(root,'public/inside.txt'))),'inside');
  await assert.rejects(safety.readPublicFile(path.join(root,'public'),path.join(root,'public/escape.txt')), { code:'EACCES' });
});

test('shared boundary protects GET data and permits only the local CRM frame', async t => {
  const server = http.createServer((req,res) => { if (!safety.guardRequest(req,res, { framePaths:['/crm-demo/', '/crm-demo/index.html'] })) return; res.end('ok'); });
  server.listen(0,'127.0.0.1'); await once(server,'listening'); t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const status = await new Promise((resolve, reject) => {
    http.get(base + '/api/status', { headers: { Host: 'attacker.example:' + server.address().port } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject);
  });
  assert.equal(status,403);
  const crm = await fetch(base + '/crm-demo/index.html'); assert.match(crm.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  const top = await fetch(base + '/'); assert.match(top.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  for (const route of ['/crm-demo/not-a-document', '/crm-demo/%69ndex.html', '/crm-demo/index.html/extra']) {
    assert.match((await fetch(base + route)).headers.get('content-security-policy'), /frame-ancestors 'none'/);
  }
  assert.equal((await fetch(base + '/' + 'x'.repeat(8192))).status, 414);
  assert.equal((await fetch(base + '/api/_service')).status,403);
  assert.deepEqual(await (await fetch(base + '/api/ui-config')).json(),{cockpitUrl:''});
});

test('secret scanning reports every credential without exposing its value', () => {
  const password = ['NFON_API_PASSWORD=', 'synthetic', 'Password123'].join('');
  const jwt = ['eyJ', 'abcdefghijklmno', '.', 'abcdefghijklmnop', '.', 'abcdefghijklmnop'].join('');
  const body = [password,password,'Authorization: ' + ['Bearer','a'.repeat(30)].join(' '),jwt].join('\n');
  const findings=scanText(body,'fixture');
  assert.equal(findings.filter(f=>f.name==='environment password value').length,2);
  assert.ok(findings.some(f=>f.name==='JWT')); assert.ok(findings.some(f=>f.name==='Bearer token'));
  assert.ok(!JSON.stringify(findings).includes('Password123'));
  assert.equal(scanText('NFON_API_PASSWORD=<PASSWORD>\nAuthorization: Bearer <ACCESS_TOKEN>').length,0);
});

test('secret scanner covers configuration formats and does not exempt test-like prefixes', () => {
  const secret='synth'+'etic-secret-value';
  const examples=[
    ['Google OAuth client secret',['GOCSPX',secret].join('-')],
    ['environment token value','NFON_SERVICE_TOKEN='+secret],
    ['environment password value','export NFON_API_PASSWORD=test-'+secret],
    ['environment password value','NFON_API_PASSWORD="fixture-'+secret+'#tail"'],
    ['structured password or token value',JSON.stringify({password:secret})],
    ['YAML password or token value','password: '+secret],
    ['Basic authorization','Authorization: Basic '+Buffer.from('user:'+secret).toString('base64')],
    ['URL access token','https://example.invalid/?access_token='+secret],
    ['URL credentials','https://user:'+secret+'@example.invalid/'],
    ['local user path',['','Users','sample-owner','private'].join('/')],
  ];
  for(const [name,body] of examples){const found=scanText(body);assert.ok(found.some(f=>f.name===name),name);assert.ok(!JSON.stringify(found).includes(secret));}
});

test('environment files reject duplicate keys atomically, including copied safety defaults', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'nfon-env-'));
  t.after(() => rm(dir,{recursive:true,force:true}));
  const file = path.join(dir,'.env');
  for(const pair of [['false','true'],['true','false'],['true','true']]) {
    await writeFile(file, `ORDINARY=value\nPORTAL_FORCE_READ_ONLY=${pair[0]}\nexport PORTAL_FORCE_READ_ONLY="${pair[1]}" # lock\n`);
    const env = {EXTERNAL:'retained'};
    assert.throws(() => safety.loadEnvFile(file,env),/Duplicate environment key: PORTAL_FORCE_READ_ONLY on lines 2 and 3/);
    assert.deepEqual(env,{EXTERNAL:'retained'},'invalid files never partially mutate the environment');
    assert.throws(() => safety.loadEnvFile(file,{PORTAL_FORCE_READ_ONLY:'true'}),/Duplicate/);
  }
  await writeFile(file,'PORTAL_FORCE_READ_ONLY=true # lock\nOTHER="with spaces"\n');
  const env={PORTAL_FORCE_READ_ONLY:'false'};
  assert.equal(safety.loadEnvFile(file,env),true);
  assert.deepEqual(env,{PORTAL_FORCE_READ_ONLY:'false',OTHER:'with spaces'});
});

test('scanner recognizes exported, quoted, inline, camelCase and ownership credentials', () => {
  const secret = ['synthetic','long','value'].join('-');
  const cases = [
    'export NFON_API_SECRET="'+secret+'"', 'export NFON_API_SECRET='+secret,
    'NFON_SERVICE_TOKEN="'+secret+' with spaces"', 'NFON_API_PASSWORD="'+secret+' with spaces"',
    JSON.stringify({credentials:{apiKey:secret}}), JSON.stringify({cti:{token:secret}}),
    'X-NFON-Service-Token: '+secret, 'https://example.invalid/?client_secret='+secret,
  ];
  for (const body of cases) {const findings=scanText(body);assert.ok(findings.length>0,body.split('=')[0]);assert.ok(!JSON.stringify(findings).includes(secret));}
  for(const body of ['export NFON_API_SECRET="<API_SECRET>"', 'NFON_API_PASSWORD="<PASSWORD>"', '{"apiKey":"<API_KEY>"}', 'X-NFON-Service-Token: <SERVICE_TOKEN>']) assert.equal(scanText(body).length,0,body);
});

test('scanner covers JavaScript API keys and the two-field CTI secret-file format',()=>{
  const secret=['synthetic','opaque','value'].join('-');
  assert.ok(scanText('const apiKey = "'+secret+'";').some(item=>item.name==='assigned credential value'));
  assert.ok(scanText('KABCD\n'+secret,'CTI_secret.txt').some(item=>item.name==='CTI credential file'));
  assert.equal(scanText('KABCD\n<PASSWORD>','CTI_secret.txt').length,0);
});

test('scanner retains lowercase keys and escaped quoted JSON credentials',()=>{
 const secret=['synthetic','credential','value'].join('-');
 for(const body of ['nfon_api_password='+secret,'export Google_Client_Secret='+secret,JSON.stringify({password:secret+'"tail'}),JSON.stringify({password:secret+"'tail"})])assert.ok(scanText(body).length>0);
});

test('scanner treats dotenv punctuation as literal without flagging source expressions',()=>{
 const value=['synthetic','safe','fixture'].join('-');
 for(const suffix of ['?tail',';tail','(tail)','{tail}','||tail',' with spaces','$(tail)']){
  assert.ok(scanText('NFON_API_PASSWORD='+value+suffix,'.env').length>0);
 }
 assert.equal(scanText('token = resolveToken() || fallback;', 'server.js').length,0);
 assert.ok(scanText('token = "'+value+'";', 'server.js').length>0);
});

test('scanner distinguishes complete shell expansions from literal credential values',()=>{
  const key='NFON_API_'+'PASSWORD';
  for(const extension of ['sh','bash','zsh','command']){
    for(const expansion of ['$(security find-generic-password -w)','$VAULT_PASSWORD_LONG','${VAULT_PASSWORD_LONG}']){
      for(const value of [expansion,'"'+expansion+'"'])assert.equal(scanText('export '+key+'='+value,'start.'+extension).length,0);
    }
    assert.equal(scanText('export '+key+'="$(security find-generic-password -s "$SERVICE" -w)"','start.'+extension).length,0);
    for(const value of ["'$(synthetic-literal)'","'$VAULT_PASSWORD_LONG'",'"\\$VAULT_PASSWORD_LONG"','"literal-$VAULT_PASSWORD_LONG"','"$(fetch)"-hardcoded-suffix','"$(fetch)literal$(fetch)"']){
      assert.ok(scanText('export '+key+'='+value,'start.'+extension).length>0,value);
    }
  }
  assert.ok(scanText(key+'="$(synthetic-literal)"','.env').length>0,'dotenv does not execute commands');
  assert.ok(scanText('const password = '+JSON.stringify('$(synthetic-literal)')+';','app.js').length>0,'JavaScript does not expand shell syntax');
});

test('scanner recognizes common secret, password and API key names without reporting values',()=>{
  const secret=['synthetic','opaque','credential'].join('-');
  for(const key of ['SECRET_KEY','AWS_SECRET_ACCESS_KEY','PRIVATE_KEY','SMTP_PASS','DB_PASSWD','APIKEY']){
    for(const body of [key+'='+secret,JSON.stringify({[key]:secret}),'const '+key+' = "'+secret+'";']){
      const found=scanText(body,'fixture.txt');
      assert.ok(found.length>0,key);assert.ok(!JSON.stringify(found).includes(secret));
    }
  }
  assert.equal(scanText('CACHE_KEY="non-secret-cache-key"').length,0);
});

test('scanner reads continued launcher expansions without exempting shell literals', async()=>{
  const launcher = await readFile(new URL('../landing/start-cockpit.command', import.meta.url), 'utf8');
  assert.deepEqual(scanText(launcher, 'landing/start-cockpit.command'), []);
  const key = 'NFON_API_' + 'PASSWORD';
  const continuation = '\\' + '\n';
  const expansion = '$(printf "%s" '+continuation+' "$(printf \'%s\' \'value(with)parentheses\')")';
  const dynamic = key+'="'+expansion+'"';
  assert.deepEqual(scanText(dynamic, 'start.sh'), []);
  for(const value of ["'"+expansion+"'", '"'+expansion+'literal$(printf value)"']) {
    assert.ok(scanText(key+'='+value, 'start.sh').length>0, 'literal shell values remain findings');
  }
  const literal = ['synthetic','opaque','credential'].join('-');
  const findings = scanText(dynamic+'\n'+key+'='+literal, 'start.sh');
  assert.deepEqual(findings.map(item=>item.line), [3], 'continuation does not change diagnostic line numbers');
});
