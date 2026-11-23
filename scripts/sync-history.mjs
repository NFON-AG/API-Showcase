import { readFile, readdir, mkdir, writeFile, rename, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Generated download: one implementation, with explicit static-runtime adapters.
const root = fileURLToPath(new URL('../', import.meta.url));
const source = path.join(root, 'CallHistory_API/public');
const target = path.join(root, 'docs/call-history');
const check = process.argv.includes('--check');
const expected = new Set();
const outputs = new Map();

function replaceOnce(text, needle, replacement) {
  const matches = typeof needle === 'string' ? text.split(needle).length - 1 : [...text.matchAll(new RegExp(needle.source, 'g' + needle.flags.replaceAll('g', '')))].length;
  if (matches !== 1) throw new Error(`Static adapter must match exactly once (${matches}): ${needle}`);
  return text.replace(needle, typeof replacement === 'function' ? replacement : () => replacement);
}

function withoutAssetVersion(html) {
  return html.replace(/((?:src|href)=")([^"?#]+\.(?:js|css))(?:\?([^"#]*))?(#[^"]*)?"/g, (all, attribute, file, query = '', hash = '') => {
    const rest = query.split('&').filter(part => part && !part.startsWith('v='));
    return `${attribute}${file}${rest.length ? '?' + rest.join('&') : ''}${hash}"`;
  });
}

async function emit(relative, content) {
  expected.add(relative);
  const data = Buffer.isBuffer(content) ? content : Buffer.from(content);
  outputs.set(relative, data);
}

async function writeOutput(relative, data) {
  const file = path.join(target, relative);
  const actual = await readFile(file).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (actual?.equals(data)) return;
  if (relative.endsWith(".html") && actual && withoutAssetVersion(actual.toString("utf8")) === withoutAssetVersion(data.toString("utf8"))) return;
  if (check) throw new Error(`Call History static asset out of sync: ${relative}`);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try { await writeFile(temporary, data); await rename(temporary, file); }
  finally { await rm(temporary, { force: true }); }
}

// Validate the entire offline resource contract before writing any outputs.
const crmSourceHtml = await readFile(path.join(source, 'crm-demo/index.html'), 'utf8');
const htmlTags = text => text.match(/<[a-z][\w:-]*\b(?:[^"'<>]|"[^"]*"|'[^']*')*>/gi) || [];
// The source contract has one external stylesheet. Inline CSS would bypass its
// font/resource adapter, so reject it rather than silently shipping dependencies.
if (htmlTags(crmSourceHtml).some(tag => /^<style\b|\sstyle\s*=/i.test(tag))) throw new Error('Unsupported offline inline CSS');
if (htmlTags(crmSourceHtml).some(tag => /^<meta\b/i.test(tag) && /\bhttp-equiv\s*=\s*(?:"refresh"|'refresh'|refresh(?=[\s/>]))/i.test(tag))) throw new Error('Unsupported offline automatic navigation');
const scriptTags = [...crmSourceHtml.matchAll(/<script\b([^>]*)>[\s\S]*?<\/script>/gi)];
const externalScripts = [];
for (const match of scriptTags) {
  if (!/\bsrc\s*=/i.test(match[1])) continue;
  const src = match[1].match(/\bsrc\s*=\s*(["'])(.*?)\1/i)?.[2];
  if (!src || /\b(?:type|async|integrity|crossorigin)\s*=/i.test(match[1]) || /\basync\b/i.test(match[1]) || !/^[\w./-]+(?:\?[^#]*)?$/.test(src) || src.startsWith('/') || src.includes('..')) throw new Error('Unsupported offline script: ' + (src || 'invalid src'));
  externalScripts.push({ tag: match[0], src: src.split('?')[0] });
}
const stylesheets = [...crmSourceHtml.matchAll(/<link\b[^>]*>/gi)].filter(match => /rel\s*=\s*["']stylesheet["']/i.test(match[0]));
if (stylesheets.length !== 1 || !/href\s*=\s*["']styles\.css(?:\?[^"']*)?["']/i.test(stylesheets[0][0])) throw new Error('Unsupported offline stylesheet');

// Build and validate the complete offline document before changing any outputs.
// file:// in an opaque sandbox cannot load sibling CSS/JS/font files in Chrome.
let offline = crmSourceHtml;
const inlineScripts = [];
for (const { tag, src } of externalScripts) {
  const script = await readFile(path.join(source, 'crm-demo', src), 'utf8');
  inlineScripts.push('<script>' + script.replace(/<\/script/gi, '<\\/script') + '</script>');
  offline = replaceOnce(offline, tag, '');
}
let inlineCss = await readFile(path.join(source, 'crm-demo/styles.css'), 'utf8');
if (/@import\b/i.test(inlineCss)) throw new Error('Unsupported offline CSS import');
// image-set() also accepts bare quoted URLs, outside the supported url() adapter.
if (/(?:-webkit-)?image-set\s*\(/i.test(inlineCss)) throw new Error('Unsupported offline CSS image-set');
for (const match of inlineCss.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)) {
  const ref = match[2].trim();
  if (/^data:/i.test(ref)) continue;
  if (!/^\.\.\/assets\/fonts\/[\w.-]+\.woff2$/.test(ref)) throw new Error('Unsupported offline CSS resource: ' + ref);
  const font = await readFile(path.resolve(source, 'crm-demo', ref));
  inlineCss = inlineCss.replace(match[0], () => 'url("data:font/woff2;base64,' + font.toString('base64') + '")');
}
offline = replaceOnce(offline, stylesheets[0][0], '<style>' + inlineCss + '</style>');
// Attribute names and tags are case-insensitive in HTML; quote style is immaterial.
// Navigation links remain valid, but resource references must all be embedded.
if (htmlTags(offline).some(tag => /\s(?:src|srcset|poster|background)\s*=/i.test(tag)
  || (/^<(?:script|link|iframe|embed|object|image|use)\b/i.test(tag) && /\s(?:href|xlink:href|data)\s*=/i.test(tag)))) {
  throw new Error('Unresolved offline HTML resource');
}
offline = replaceOnce(offline, '</body>', inlineScripts.join('\n') + '\n</body>');

let app = await readFile(path.join(source, 'app.js'), 'utf8');
app = replaceOnce(app, 'demoMode: storedValue("callhistory-demo-mode") === "1"', 'demoMode: true');
app = replaceOnce(app, 'href="/auth/login"', 'href="#demo-login"');
await emit('app.js', app);
await emit('messages.js', await readFile(path.join(source, 'messages.js')));
await emit('styles.css', await readFile(path.join(source, 'styles.css')));
let html = await readFile(path.join(source, 'index.html'), 'utf8');
html = replaceOnce(html, /href="http:\/\/(?:localhost|127\.0\.0\.1):3010\/"/, 'href="../index.html"');
html = replaceOnce(html, /^[ \t]*<label class="demo-switch"[\s\S]*?<\/label>\n/m, '');
for (const [from, to] of [['src="/appearance.js', 'src="../appearance.js'], ['href="/appearance.css', 'href="../appearance.css'], ['href="/styles.css', 'href="./styles.css'], ['src="/messages.js', 'src="./messages.js'], ['src="/i18n.js', 'src="../i18n.js']]) html = replaceOnce(html, from, to);
html = replaceOnce(html, '<script src="/app.js', '<script src="../demo-runtime.js?v=1.2.0-review-20261017"></script>\n    <script src="./app.js');
html = replaceOnce(html, '<body>', '<body data-nfon-app="call-history">');
await emit('index.html', html);

async function copyDemo(directory = 'crm-demo') {
  for (const entry of await readdir(path.join(source, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory()) await copyDemo(relative);
    else {
      let data = await readFile(path.join(source, relative));
      if (relative === 'crm-demo/styles.css') data = Buffer.from(replaceOnce(data.toString('utf8'), '../assets/fonts/', '../../assets/fonts/'));
      else if (entry.name.endsWith('.css') && data.includes(Buffer.from('../assets/fonts/'))) throw new Error('Unexpected font adapter location: ' + relative);
      await emit(relative, data);
    }
  }
}
await copyDemo();
await emit('crm-demo/offline.html', offline);

// All source reads and adapters must succeed before replacing any prior output.
for (const [relative, data] of outputs) await writeOutput(relative, data);

// The app download directory is wholly generated; sibling documentation is untouched.
async function removeOrphans(directory = '') {
  for (const entry of await readdir(path.join(target, directory), { withFileTypes: true })) {
    const relative = path.join(directory, entry.name);
    if (entry.isDirectory() && [...expected].some(file => file.startsWith(relative + path.sep))) await removeOrphans(relative);
    else if (!expected.has(relative)) {
      if (check) throw new Error(`Orphaned Call History static asset: ${relative}`);
      await rm(path.join(target, relative), {recursive:true,force:true});
    }
  }
}
await removeOrphans();
console.log(`${check ? 'Verified' : 'Synced'} Call History and its fixed CRM demo for the static download.`);
