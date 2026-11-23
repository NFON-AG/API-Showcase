const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const { translateMarkup } = require('./translation-dom.cjs');
const root = path.resolve(__dirname, '../..');

// Execute the complete current client with only its network bootstrap calls
// suppressed. No product function, translation, or catalog entry is replaced.
function clientRenderer(language, globals = {}) {
  const catalog = { ...JSON.parse(fs.readFileSync(path.join(root, '../shared/i18n-messages.json'), 'utf8')),
    ...JSON.parse(fs.readFileSync(path.join(root, 'i18n-messages.json'), 'utf8')) };
  const source = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
  const bootstrap = /\nbindStaticNavigation\(\);\nloadOverview\(\);\s*$/;
  assert.match(source, bootstrap, 'Only documented network bootstrap is suppressed');
  const nodes = new Map();
  function element(selector) {
    if (!nodes.has(selector)) nodes.set(selector, {
      innerHTML: '', textContent: '', value: '', dataset: {}, hidden: false,
      classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
      style: { setProperty() {} },
      setAttribute(name, value) { this[name] = String(value); }, getAttribute(name) { return this[name] ?? null; },
      removeAttribute(name) { delete this[name]; }, toggleAttribute() {}, querySelector() { return null; },
      querySelectorAll() { return []; }, closest() { return null; }, addEventListener() {}, focus() {}, contains() { return false; },
    });
    return nodes.get(selector);
  }
  const storage = { getItem: () => null, setItem() {}, removeItem() {} };
  const context = vm.createContext({
    window: { location: { hash: '' }, history: { replaceState() {} }, NFON_I18N: translateMarkup('', language, catalog).api, NFON_MESSAGES: catalog, addEventListener() {} },
    localStorage: storage, document: { querySelector: () => null, querySelectorAll: () => [], addEventListener() {} },
    URL, Intl, Date, console, clearTimeout,
    setTimeout(callback, delay) { const timer = setTimeout(callback, delay); timer.unref(); return timer; },
    ...globals,
  });
  vm.runInContext(source.replace(bootstrap, ''), context);
  context.document.querySelector = selector => selector.includes(' ') || selector.startsWith('[') ? null : element(selector);
  context.document.body = element('body');
  return { evaluate: code => vm.runInContext(code, context), element, catalog,
    translated: selector => translateMarkup(element(selector).innerHTML, language, catalog) };
}
module.exports = { clientRenderer };
