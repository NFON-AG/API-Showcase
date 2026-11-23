import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// One content version for the self-contained apps and downloadable copies.
// HTML is excluded from the digest so writing version URLs is idempotent.
const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const apps = ['CTI_API', 'Portal_API', 'CallHistory_API', 'landing'];
async function main() {
async function files(directory) {
  const result = [];
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(relative));
    else result.push(relative);
  }
  return result;
}
const inputs = ['docs/i18n.js', 'docs/demo-runtime.js', 'docs/landing/app.js'];
for (const directory of ['shared', ...apps, 'docs']) inputs.push(`${directory}/i18n-messages.json`);
for (const app of apps) inputs.push(`${app}/public/app.js`, `${app}/public/styles.css`);
inputs.push('shared/appearance.js', 'shared/appearance.css');
inputs.push(...(await files('CallHistory_API/public/crm-demo')).filter(file => /\.(?:js|css)$/.test(file)));
// Static adapters can change independently of their local-server counterpart.
// Include every shipped script/style so their cached URLs change as well.
for (const directory of [...apps.map(app => `${app}/public`), 'docs']) {
  inputs.push(...(await files(directory)).filter(file => /\.(?:js|css)$/.test(file)));
}
const hash = createHash('sha256');
for (const file of [...new Set(inputs)].sort()) hash.update(file).update(await readFile(path.join(root, file)));
const version = hash.digest('hex').slice(0, 16);
let count = 0;
for (const directory of [...apps.map(app => `${app}/public`), 'docs']) {
  for (const file of (await files(directory)).filter(file => file.endsWith('.html'))) {
    const original = await readFile(path.join(root, file), 'utf8');
    const updated = original.replace(/\b(src|href)="([^"\n]+\.(?:js|css)(?:\?[^"\n]*)?)"/g, (match, attr, value) => {
      if (/^(?:https?:|data:|\/\/)/.test(value)) return match;
      const url = new URL(value, 'https://local.invalid/');
      url.searchParams.set('v', version);
      return `${attr}="${value.split('?')[0]}?${url.searchParams}"`;
    });
    if (updated === original) continue;
    if (check) throw new Error(`Asset URLs out of date: ${file}; run npm run sync:shared`);
    await writeFile(path.join(root, file), updated);
    count++;
  }
}
console.log(`${check ? 'Verified' : 'Versioned'} browser assets ${version} (${count} HTML files updated).`);
}

main().catch(error => {
  console.error(error.code === 'ENOENT'
    ? `Browser asset missing: ${path.relative(root, error.path || root)}; run npm run sync:shared`
    : error.message);
  process.exitCode = 1;
});
