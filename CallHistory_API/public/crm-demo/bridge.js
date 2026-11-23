'use strict';

(() => {
  const embedded = window.parent !== window;
  let lastHeight = 0;
  let queued = false;
  function reportHeight() {
    queued = false;
    // Intrinsic content height, never document.scrollHeight (which includes the
    // current iframe viewport and can prevent shrinking after a tab change).
    const main = document.querySelector('main');
    const height = Math.max(400, Math.ceil(main.getBoundingClientRect().bottom + window.scrollY + 4));
    if (embedded && height !== lastHeight) {
      lastHeight = height;
      window.parent.postMessage({ type: 'nfon:crm-demo:height', height }, "*");
    }
  }
  function queueHeight() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(reportHeight);
  }
  function appearance({ theme, lang }) {
    if (theme === 'classic' || theme === 'admin-portal') document.documentElement.dataset.nfonTheme = theme;
    if (window.DEMO_I18N.supports(lang) && lang !== window.DEMO_I18N.lang) {
      window.DEMO_I18N.setLanguage(lang);
      window.dispatchEvent(new Event('nfon:crm-demo:language'));
    }
    queueHeight();
  }
  window.addEventListener('message', event => {
    if (!embedded || event.source !== window.parent || (event.origin !== location.origin && !(location.protocol === "file:" && event.origin === "null"))) return;
    // A sandboxed or file document has an opaque origin; the parent window is the authority.
    if (event.data?.type === 'nfon:crm-demo:appearance') appearance(event.data);
    if (typeof event.data?.active === 'boolean' && ['nfon:crm-demo:appearance', 'nfon:crm-demo:visibility'].includes(event.data.type)) {
      window.dispatchEvent(new CustomEvent('nfon:crm-demo:visibility', { detail: { active: event.data.active } }));
    }
  });
  const parameters = new URLSearchParams(location.search);
  appearance({ theme: parameters.get('theme') || 'admin-portal', lang: parameters.get('lang') || 'en' });
  new ResizeObserver(queueHeight).observe(document.querySelector('main'));
  window.addEventListener('resize', queueHeight);
  document.fonts.ready.then(queueHeight);
  if (embedded) window.parent.postMessage({ type: 'nfon:crm-demo:ready' }, "*");
  queueHeight();
})();
