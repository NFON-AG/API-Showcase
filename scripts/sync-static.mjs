import { readFile, writeFile, mkdir, rename, rm, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const check = process.argv.includes('--check');
const writes = [];
const orphans = [];
function withoutVersion(html) {
  return html.replace(/\b(src|href)="([^"\n]+\.(?:js|css))(?:\?[^"\n]*)?"/g, '$1="$2"');
}
function once(text, from, to) {
  const count = typeof from === 'string' ? text.split(from).length - 1 : [...text.matchAll(new RegExp(from.source, from.flags.replace('g','')+'g'))].length;
  if (count !== 1) throw new Error(`Expected one static HTML anchor, found ${count}: ${from}`);
  return text.replace(from, typeof to === 'function' ? to : () => to);
}
async function emit(relative, data) {
  const file = path.join(root, 'docs', relative);
  const actual = await readFile(file).catch(error => { if(error.code==='ENOENT') return null; throw error; });
  const expected = Buffer.from(data);
  if (actual?.equals(expected) || (relative.endsWith('.html') && actual && withoutVersion(actual.toString()) === withoutVersion(expected.toString()))) return;
  if (check) throw new Error(`Static copy out of sync: ${relative}`);
  writes.push({ file, expected });
}
async function html(app, file, target) {
  let data = withoutVersion(await readFile(path.join(root,app,'public',file),'utf8'));
  const cockpit = app === 'landing';
  const parent = cockpit ? './' : '../';
  if (app === 'CTI_API' && file !== 'contacts.html') {
    // Downloads are always isolated demos; they cannot switch to a live server.
    data = once(data, /[ \t]*<label id="demo-control"[\s\S]*?<\/label>\n/, '');
    data = once(data, /[ \t]*<script src="\/demo-runtime\.js" data-nfon-optional-demo="cti"><\/script>\n/, '');
  }
  for(const name of ['appearance.js','appearance.css','i18n.js']) data = data.replaceAll(`"/${name}"`,`"${parent}${name}"`);
  data = once(data, 'src="/messages.js"', 'src="./messages.js"');
  data = once(data, 'href="/styles.css"', `href="${cockpit?'./landing/':'./'}styles.css"`);
  data = once(data, 'src="/app.js"', `src="${parent}demo-runtime.js"></script>\n    <script src="${cockpit?'./landing/':'./'}app.js"`);
  data = data.replace(/href="http:\/\/(?:localhost|127\.0\.0\.1):3010\/"/g, `href="${parent}index.html"`);
  data = data.replace(/\b(href|src)="\/([^"?#]*)([?][^"]*)?"/g, (_,attr,resource,query='') => `${attr}="./${resource || 'index.html'}${query}"`);
  data = once(data, '<body>', `<body data-nfon-app="${cockpit ? 'landing' : app === 'CTI_API' ? 'cti' : 'portal'}">`);
  await emit(target,data);
}
for(const [app,folder] of [['CTI_API','cti'],['landing','landing'],['Portal_API','portal']]) {
  for(const file of ['app.js','styles.css',...(app==='CTI_API'?['phone-number.js']:[])]) await emit(`${folder}/${file}`,await readFile(path.join(root,app,'public',file)));
}
const portalPdfFiles = ['callflow-pdf.js', 'jspdf.umd.min.js', 'jspdf.LICENSE.txt', 'pangram-font.js', 'THIRD_PARTY.md'];
for (const file of portalPdfFiles) await emit(`portal/pdf/${file}`, await readFile(path.join(root, 'Portal_API/public/pdf', file)));
for(const file of ['index.html','analytics.html','contacts.html','setup.html']) await html('CTI_API',file,`cti/${file}`);
await html('landing','index.html','index.html');
await html('Portal_API','index.html','portal/index.html');
for (const [folder, files] of Object.entries({landing:['app.js','styles.css'],cti:['app.js','styles.css','phone-number.js','index.html','analytics.html','setup.html','contacts.html','messages.js'],portal:['app.js','styles.css','index.html','messages.js','pdf'],'portal/pdf':portalPdfFiles})) {
  for (const entry of await readdir(path.join(root,'docs',folder)).catch(error => { if (error.code === 'ENOENT') return []; throw error; })) {
    if (files.includes(entry)) continue;
    if (check) throw new Error('Orphaned static asset: ' + folder + '/' + entry);
    orphans.push(path.join(root,'docs',folder,entry));
  }
}
// Validate all sources and destinations before replacing or pruning any output.
for (const { file, expected } of writes) {
  await mkdir(path.dirname(file), { recursive:true });
  const temporary = `${file}.${process.pid}.tmp`;
  try { await writeFile(temporary, expected); await rename(temporary,file); }
  finally { await rm(temporary,{force:true}); }
}
for (const file of orphans) await rm(file, { recursive:true, force:true });
console.log(`${check?'Verified':'Synced'} static cockpit, CTI and Portal assets from canonical sources.`);
