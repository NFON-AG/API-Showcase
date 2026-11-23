import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, cp, readdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { scanText } from '../scripts/secret-scan.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function snapshot(directory) {
  const result = {};
  async function visit(relative = '') {
    for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) { result[name + '/'] = 'directory'; await visit(name); }
      else result[name] = createHash('sha256').update(await readFile(path.join(directory, name))).digest('hex');
    }
  }
  await visit();
  return result;
}
async function generatorFixture(t, generator) {
  const directory = await mkdtemp(path.join(tmpdir(), 'nfon-r4-generator-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, 'scripts'));
  await copyFile(path.join(root, 'scripts', generator), path.join(directory, 'scripts', generator));
  for (const [app, files] of [
    ['CTI_API', ['index.html', 'analytics.html', 'contacts.html', 'setup.html', 'app.js', 'styles.css', 'phone-number.js']],
    ['Portal_API', ['index.html', 'styles.css', 'app.js']],
    ['landing', ['index.html', 'app.js', 'styles.css']],
  ]) {
    await mkdir(path.join(directory, app, 'public'), { recursive: true });
    for (const file of files) await copyFile(path.join(root, app, 'public', file), path.join(directory, app, 'public', file));
  }
  await mkdir(path.join(directory, 'docs'));
  await cp(path.join(root, 'Portal_API/public/pdf'), path.join(directory, 'Portal_API/public/pdf'), { recursive: true });
  if (generator === 'sync-shared.mjs') {
    await cp(path.join(root, 'shared'), path.join(directory, 'shared'), { recursive: true });
    await copyFile(path.join(root, 'docs/i18n.js'), path.join(directory, 'docs/i18n.js'));
    await copyFile(path.join(root, 'docs/demo-runtime.js'), path.join(directory, 'docs/demo-runtime.js'));
    for (const app of ['CTI_API', 'Portal_API', 'CallHistory_API', 'landing', 'docs']) {
      await mkdir(path.join(directory, app), { recursive: true });
      await copyFile(path.join(root, app, 'i18n-messages.json'), path.join(directory, app, 'i18n-messages.json'));
    }
  }
  const run = (check = false) => spawnSync(process.execPath, ['scripts/' + generator, ...(check ? ['--check'] : [])], { cwd: directory, encoding: 'utf8' });
  assert.equal(run().status, 0, 'fixture generation');
  return { directory, run };
}

test('R4-SHARED-01 static generation validates late HTML before changing or pruning any output', async t => {
  const { directory, run } = await generatorFixture(t, 'sync-static.mjs');
  const source = path.join(directory, 'CTI_API/public/app.js');
  const html = path.join(directory, 'CTI_API/public/contacts.html');
  const original = await readFile(html, 'utf8');
  await writeFile(source, (await readFile(source, 'utf8')) + '\n/* changed source */\n');
  await writeFile(path.join(directory, 'docs/cti/orphan.js'), 'obsolete');
  const before = await snapshot(path.join(directory, 'docs'));
  for (const broken of [
    original.replace(/src="\/app\.js(?:\?[^\"]*)?"/, 'src="/missing.js"'),
    original.replace('<body>', '<body><body>'),
  ]) {
    await writeFile(html, broken);
    const check = run(true);
    assert.notEqual(check.status, 0);
    assert.deepEqual(await snapshot(path.join(directory, 'docs')), before, '--check must not mutate outputs');
    const result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Expected one static HTML anchor/);
    assert.deepEqual(await snapshot(path.join(directory, 'docs')), before, 'late invalid input must leave every generated file and orphan unchanged');
  }
  await writeFile(html, original);
  assert.equal(run().status, 0);
  assert.equal(await readFile(path.join(directory, 'docs/cti/app.js'), 'utf8'), await readFile(source, 'utf8'));
  await assert.rejects(readFile(path.join(directory, 'docs/cti/orphan.js')), { code: 'ENOENT' });
  const successful = await snapshot(path.join(directory, 'docs'));
  assert.equal(run().status, 0);
  assert.equal(run(true).status, 0);
  assert.deepEqual(await snapshot(path.join(directory, 'docs')), successful, 'valid sync stays idempotent');
});

test('R4-SHARED-01 shared generation reads every source before modifying outputs', async t => {
  for (const missing of ['appearance.css', 'server-safety.cjs', 'assets/fonts']) await t.test(missing, async t => {
    const { directory, run } = await generatorFixture(t, 'sync-shared.mjs');
    const changed = path.join(directory, 'shared/appearance.js');
    await writeFile(changed, (await readFile(changed, 'utf8')) + '\n/* changed shared source */\n');
    await writeFile(path.join(directory, 'CTI_API/public/assets/material/orphan.svg'), '<svg/>');
    const before = await snapshot(directory);
    const missingPath = path.join(directory, 'shared', missing);
    await rm(missingPath, { recursive: true });
    const expected = Object.fromEntries(Object.entries(before).filter(([name]) => name !== 'shared/' + missing && !name.startsWith('shared/' + missing + '/')));
    assert.notEqual(run(true).status, 0);
    assert.deepEqual(await snapshot(directory), expected);
    assert.notEqual(run().status, 0);
    assert.deepEqual(await snapshot(directory), expected, 'a missing later source must not leave partial copies or prune earlier assets');
    await cp(path.join(root, 'shared', missing), missingPath, { recursive: true });
    assert.equal(run().status, 0);
    for (const target of ['CTI_API/public', 'Portal_API/public', 'CallHistory_API/public', 'landing/public', 'docs']) {
      assert.equal(await readFile(path.join(directory, target, 'appearance.js'), 'utf8'), await readFile(changed, 'utf8'));
    }
    const successful = await snapshot(directory);
    assert.equal(run().status, 0);
    assert.equal(run(true).status, 0);
    assert.deepEqual(await snapshot(directory), successful);
  });
});

test('R4-SHARED-03 expansion prefixes cannot hide literal credential suffixes or defaults', async t => {
  const key = 'NFON_API_' + 'PASSWORD';
  const literal = ['SYNTHETIC', 'ONLY', 'PASSWORD', '12345'].join('_');
  const values = ['${VAULT_PASSWORD_LONG}' + literal, '${VAULT_PASSWORD_LONG:-' + literal + '}', '${VAULT_PASSWORD_LONG:=' + literal + '}', '<PASSWORD>' + literal];
  for (const extension of ['sh', 'bash', 'zsh', 'command', 'env']) await t.test(extension, () => {
    for (const value of values) for (const quoted of [value, '"' + value + '"', "'" + value + "'"]) {
      const findings = scanText('export ' + key + '=' + quoted, 'synthetic.' + extension);
      assert.ok(findings.length > 0, extension + ' must flag a literal component');
      assert.ok(!JSON.stringify(findings).includes(literal), 'diagnostics must not expose credentials');
    }
  });
  for (const extension of ['sh', 'bash', 'zsh', 'command']) await t.test(extension + ' complete expansion controls', () => {
    for (const value of ['$VAULT_PASSWORD_LONG', '${VAULT_PASSWORD_LONG}', '$(security find-generic-password -w)']) {
      for (const quoted of [value, '"' + value + '"']) assert.deepEqual(scanText('export ' + key + '=' + quoted, 'start.' + extension), []);
    }
    assert.ok(scanText(key + "='${VAULT_PASSWORD_LONG}'", 'start.' + extension).length > 0, 'single quotes store the expansion as literal text');
  });
});

test('R4-SHARED-03 scanner CLI fails for mixed expansion literals in a clean Git fixture', async t => {
  const directory = await mkdtemp(path.join(tmpdir(), 'nfon-r4-scanner-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const git = process.env.GIT_BIN || 'git';
  const init = spawnSync(git, ['init', '--quiet'], { cwd: directory, encoding: 'utf8' });
  assert.equal(init.status, 0, init.stderr);
  const key = 'NFON_API_' + 'PASSWORD';
  const literal = ['SYNTHETIC', 'ONLY', 'CREDENTIAL', '12345'].join('_');
  const file = path.join(directory, 'synthetic.sh');
  const run = () => spawnSync(process.execPath, [path.join(root, 'scripts/secret-scan.mjs')], { cwd: directory, encoding: 'utf8', env: { ...process.env, GIT_BIN: git } });
  await writeFile(file, 'export ' + key + '="${VAULT_PASSWORD_LONG}"\n');
  assert.equal(run().status, 0, 'a complete variable expansion is safe');
  for (const value of ['${VAULT_PASSWORD_LONG}' + literal, '${VAULT_PASSWORD_LONG:-' + literal + '}']) {
    await writeFile(file, 'export ' + key + '="' + value + '"\n');
    const result = run();
    assert.equal(result.status, 1, 'CLI must fail when commit-visible values contain literal credentials');
    assert.match(result.stderr, /synthetic\.sh:1/);
    assert.ok(!result.stderr.includes(literal));
  }
});

test('R4-SHARED-03 quoted placeholders cannot hide concatenated shell literals', () => {
  const key = 'NFON_API_' + 'PASSWORD';
  const literal = ['SYNTHETIC', 'LONG', 'CREDENTIAL'].join('_');
  for (const extension of ['sh', 'bash', 'zsh', 'command']) {
    for (const prefix of ['<PASSWORD>', 'change-me', 'example', '${VAULT_PASSWORD_LONG}', '']) {
      for (const quote of ['"', "'"]) {
        for (const suffix of [literal, '"' + literal + '"', "'" + literal + "'"]) {
          const findings = scanText(key + '=' + quote + prefix + quote + suffix, 'fixture.' + extension);
          assert.ok(findings.length > 0, extension + ': concatenation after ' + prefix);
          assert.ok(!JSON.stringify(findings).includes(literal));
        }
      }
    }
    for (const value of ['"<PASSWORD>"', "'change-me'", '"example"']) {
      assert.deepEqual(scanText(key + '=' + value + ' # documented placeholder', 'fixture.' + extension), []);
    }
  }
});

test('R4-SHARED-03 closing shell quotes respect backslash parity and literal single quotes', () => {
  const key = 'NFON_API_' + 'PASSWORD';
  const literal = ['SYNTHETIC', 'LONG', 'CREDENTIAL'].join('_');
  for (const extension of ['sh', 'bash', 'zsh', 'command']) {
    for (const slashes of [2, 4]) {
      const value = '"change-me' + '\\'.repeat(slashes) + '"' + literal;
      assert.ok(scanText(key + '=' + value, 'fixture.' + extension).length > 0, 'even backslashes leave the double quote closing');
    }
    for (const slashes of [1, 2, 3]) {
      const value = "'change-me" + '\\'.repeat(slashes) + "'" + literal;
      assert.ok(scanText(key + '=' + value, 'fixture.' + extension).length > 0, 'backslashes inside single quotes are literal');
    }
  }
});
