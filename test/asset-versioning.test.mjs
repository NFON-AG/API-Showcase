import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

test('static-only adapter changes invalidate asset URLs and a second sync is idempotent', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'nfon-asset-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const emit = async (name, content = '') => {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), content);
  };
  await emit('scripts/version-assets.mjs');
  await copyFile(new URL('../scripts/version-assets.mjs', import.meta.url), path.join(root, 'scripts/version-assets.mjs'));
  const apps = ['CTI_API', 'Portal_API', 'CallHistory_API', 'landing'];
  for (const directory of ['shared', ...apps, 'docs']) await emit(`${directory}/i18n-messages.json`, '{}');
  for (const app of apps) {
    await emit(`${app}/public/app.js`, '// local');
    await emit(`${app}/public/styles.css`, 'body {}');
    await emit(`${app}/public/index.html`, '<script src="app.js?v=old"></script>');
  }
  await mkdir(path.join(root, 'CallHistory_API/public/crm-demo'));
  for (const name of ['shared/appearance.js', 'shared/appearance.css', 'docs/i18n.js', 'docs/demo-runtime.js', 'docs/landing/app.js']) await emit(name);
  await emit('docs/portal/app.js', '// independent static adapter');
  await emit('docs/portal/index.html', '<script src="app.js?v=old"></script>');
  const run = (...args) => spawnSync(process.execPath, ['scripts/version-assets.mjs', ...args], { cwd: root, encoding: 'utf8' });
  assert.equal(run().status, 0);
  const initial = await readFile(path.join(root, 'docs/portal/index.html'), 'utf8');
  assert.equal(run('--check').status, 0);
  assert.match(run().stdout, /0 HTML files updated/);
  await emit('docs/portal/app.js', '// changed only in the static build');
  assert.notEqual(run('--check').status, 0, 'check must detect stale URLs');
  assert.equal(run().status, 0);
  assert.notEqual(await readFile(path.join(root, 'docs/portal/index.html'), 'utf8'), initial);
  assert.equal(run('--check').status, 0);
  const beforeMissing = await readFile(path.join(root, 'docs/portal/index.html'), 'utf8');
  await rm(path.join(root, 'docs/landing'), { recursive:true });
  const missing = run('--check');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /^Browser asset missing: docs\/landing\/app.js; run npm run sync:shared\s*$/);
  assert.doesNotMatch(missing.stderr, /ENOENT|\n\s+at /);
  assert.equal(await readFile(path.join(root, 'docs/portal/index.html'), 'utf8'), beforeMissing);
  await assert.rejects(readFile(path.join(root, 'docs/landing/app.js')), { code:'ENOENT' });
});
