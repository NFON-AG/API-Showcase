'use strict';
(() => {
  const catalogs = window.CRM_DEMO_LOCALES;
  // German is the message-key language; each other locale has a complete catalog.
  catalogs.de = { locale: 'de-DE', messages: Object.fromEntries(Object.keys(catalogs.en.messages).map(key => [key, key])) };
  const languages = Object.freeze(Object.keys(catalogs));
  const supports = value => languages.includes(value);
  const requested = new URLSearchParams(location.search).get('lang');
  let language = supports(requested) ? requested : 'en';
  function t(key, values = {}) {
    const message = catalogs[language].messages[key] ?? catalogs.en.messages[key] ?? key;
    return message.replace(/\{(\w+)\}/g, (match, name) => String(values[name] ?? match));
  }
  function translateStatic() {
    document.documentElement.lang = language;
    document.querySelectorAll('[data-i18n]').forEach(node => { node.textContent = t(node.dataset.i18n); });
    document.querySelectorAll('[data-i18n-aria-label]').forEach(node => { node.setAttribute('aria-label', t(node.dataset.i18nAriaLabel)); });
  }
  window.DEMO_I18N = { t, translateStatic, languages, supports,
    get lang() { return language; }, get locale() { return catalogs[language].locale; },
    setLanguage(value) { if (!supports(value)) return; language = value; translateStatic(); }
  };
})();
