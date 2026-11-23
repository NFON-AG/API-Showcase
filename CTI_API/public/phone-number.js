(function (root) {
  function digits(value) {
    const raw = String(value || '').trim();
    if (!raw || !/^[+\d\s().-]+$/.test(raw) || (raw.match(/\+/g) || []).length > 1 || (raw.includes('+') && !raw.startsWith('+'))) return '';
    const international = raw.startsWith('+') || raw.replace(/[\s().-]/g, '').startsWith('00');
    const clean = (international ? raw.replace(/\(0\)/g, '') : raw).replace(/[\s().-]/g, '');
    return { value: clean.replace(/^\+|^00/, ''), international };
  }
  function lookup(value, context = {}) {
    const number = digits(value);
    if (!number) return '';
    let key = number.value;
    const code = String(context.countryCode || '');
    const prefix = context.nationalPrefix;
    // Only an explicitly configured numbering plan may map national identities.
    if (!number.international && key.length >= 7 && /^[1-9]\d{0,2}$/.test(code) && typeof prefix === 'string' && /^\d{0,4}$/.test(prefix) && key.startsWith(prefix)) key = code + key.slice(prefix.length);
    return key;
  }
  function dial(value) {
    const number = digits(value);
    return number && number.international && /^[1-9]\d{6,14}$/.test(number.value) ? number.value : '';
  }
  function target(value, options = {}) {
    const raw = String(value || '').trim();
    if (options.context !== 'global' && /^\d{1,6}$/.test(raw)) return { number: raw, context: 'internal' };
    if (options.context === 'internal') return null;
    const number = dial(raw);
    return number ? { number, context: 'global' } : null;
  }
  const api = { lookup, dial, target };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NFON_PHONE = api;
})(globalThis);
