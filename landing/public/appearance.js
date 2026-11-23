(() => {
  "use strict";
  const KEY = "nfon-showcase-theme";
  const NAV_KEY = "nfon-showcase-navigation-collapsed";
  const THEMES = new Set(["admin-portal", "classic"]);
  const scriptBase = new URL(".", document.currentScript?.src || location.href);
  let theme = "admin-portal";
  const fromLink = new URL(location.href).searchParams.get("theme");
  let saved;
  try { saved = localStorage.getItem(KEY); } catch { /* Storage is optional. */ }
  theme = THEMES.has(fromLink) ? fromLink : THEMES.has(saved) ? saved : theme;
  if (THEMES.has(fromLink)) {
    try { localStorage.setItem(KEY, theme); } catch { /* URL preference still applies. */ }
  }
  document.documentElement.dataset.nfonTheme = theme;
  let navigationCollapsed = false;
  try { navigationCollapsed = localStorage.getItem(NAV_KEY) === "true"; } catch { /* Optional persistence. */ }
  document.documentElement.dataset.nfonNavigationCollapsed = String(navigationCollapsed);
  const mobileNavigation = window.matchMedia("(max-width: 1000px)");

  let sidebar;
  let menuButton;
  let sidebarButton;
  let navItems = [];
  const m = (key, fallback) => window.NFON_I18N?.message(key) || fallback;

  function internalLink(href) {
    try {
      const url = new URL(href, location.href);
      const sameOrigin = url.origin === location.origin;
      const localSibling = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname) &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (!sameOrigin && !localSibling) return href;
      // Auth requests and downloads are not UI navigation.
      if (!/^https?:$/.test(url.protocol) || /\/(?:api|auth|oauth)(?:\/|$)/.test(url.pathname) ||
          /\.(?:csv|json|zip|pdf|txt)$/i.test(url.pathname) || (href.startsWith("#"))) return href;
      url.searchParams.set("theme", theme);
      const language = window.NFON_I18N?.getLanguage() || new URL(location.href).searchParams.get('lang');
      if (language) url.searchParams.set('lang', language);
      const cockpit = getCockpitUrl();
      if (cockpit && !url.searchParams.has('cockpit')) url.searchParams.set('cockpit', cockpit);
      return url.href;
    } catch { return href; }
  }

  function updateNavigation() {
    document.documentElement.dataset.nfonNavigationCollapsed = String(navigationCollapsed);
    const expanded = mobileNavigation.matches
      ? document.documentElement.classList.contains("nfon-navigation-open") : !navigationCollapsed;
    const key = expanded ? "appearance.collapseNavigation" : "appearance.expandNavigation";
    for (const button of [menuButton, sidebarButton].filter(Boolean)) {
      button.dataset.i18nAriaLabel = key;
      button.setAttribute("aria-label", m(key, expanded ? "Collapse navigation" : "Expand navigation"));
      button.setAttribute("aria-expanded", String(expanded));
    }
    sidebar?.querySelectorAll(".nav-button").forEach((node) => {
      node.setAttribute("title", node.textContent.trim());
    });
  }

  function closeNavigation() {
    document.documentElement.classList.remove("nfon-navigation-open");
    updateNavigation();
  }

  function decorateLinks() {
    document.querySelectorAll("a[href]").forEach((link) => {
      if (link.hasAttribute("download")) return;
      const href = link.getAttribute("href");
      const next = internalLink(href);
      if (next !== href) link.setAttribute("href", next);
    });
  }

  function validCockpit(value) {
    try {
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return '';
      const local = ['localhost', '127.0.0.1', '[::1]'];
      if (url.origin !== location.origin && !(local.includes(url.hostname) && local.includes(location.hostname))) return '';
      url.hash = ''; return url.href;
    } catch { return ''; }
  }

  function getCockpitUrl() {
    const query = validCockpit(new URL(location.href).searchParams.get('cockpit'));
    if (query) return query;
    try { return validCockpit(localStorage.getItem('nfon-showcase-cockpit-url')); } catch { return ''; }
  }

  async function configureHomeLinks() {
    if (location.protocol === 'file:' || (window.NFON_WEB_ONLY_DEMO && !window.NFON_LOCAL_DEMO)) return;
    const links = [...document.querySelectorAll('a.home-icon-button')].filter(link => /(?:localhost|127\.0\.0\.1):3010/.test(link.href));
    if (!links.length) return;
    const fromLink = validCockpit(new URL(location.href).searchParams.get('cockpit'));
    let stored = '';
    try { stored = validCockpit(localStorage.getItem('nfon-showcase-cockpit-url')); } catch { /* optional */ }
    let target = fromLink || stored;
    if (!target) {
      links.forEach(link => { link.hidden = true; });
      try { const response = await fetch('/api/ui-config'); if (response.ok) target = validCockpit((await response.json()).cockpitUrl); } catch { /* standalone */ }
    }
    if (target) try { localStorage.setItem('nfon-showcase-cockpit-url', target); } catch { /* optional */ }
    for (const link of links) {
      link.hidden = !target;
      if (target) link.href = internalLink(target);
    }
  }

  function applyTheme(nextTheme, persist = true) {
    if (!THEMES.has(nextTheme)) return false;
    const previousTheme = theme;
    theme = nextTheme;
    document.documentElement.dataset.nfonTheme = theme;
    if (persist) {
      try { localStorage.setItem(KEY, theme); } catch { /* Optional persistence. */ }
    }
    try {
      const url = new URL(location.href);
      if (url.searchParams.has("theme") && url.searchParams.get("theme") !== theme) {
        url.searchParams.set("theme", theme);
        history.replaceState(history.state, "", url.href);
      }
    } catch { /* The selection still applies without URL persistence. */ }
    if (sidebar) {
      for (const { node, placeholder } of navItems) {
        if (theme === "admin-portal") sidebar.querySelector("nav").append(node);
        else placeholder.after(node);
      }
    }
    document.querySelectorAll("[data-nfon-theme-switch]").forEach((control) => {
      control.setAttribute("aria-checked", String(theme === "admin-portal"));
    });
    decorateLinks();
    closeNavigation();
    if (nextTheme !== previousTheme) {
      document.dispatchEvent(new CustomEvent("nfon:theme-change", { detail: { theme, previousTheme } }));
    }
    return true;
  }

  function installSettings() {
    const header = document.querySelector(".app-header");
    if (header) {
      // Reuse the existing settings node, so switching never rebuilds a form.
      const container = document.querySelector("[data-appearance-settings]") || document.createElement("div");
      container.setAttribute("data-appearance-settings", "");
      const strip = document.createElement("div");
      strip.className = "nfon-appearance-strip";
      header.before(strip);
      strip.append(container);
    }
    document.querySelectorAll("[data-appearance-settings]").forEach((container) => {
      if (container.querySelector("[data-nfon-theme-switch]")) return;
      container.classList.add("appearance-settings");
      const label = document.createElement("span");
      label.className = "appearance-label";
      label.dataset.i18nKey = "appearance.label";
      label.textContent = m("appearance.label", "Appearance");
      const control = document.createElement("button");
      control.type = "button";
      control.className = "nfon-theme-switch";
      control.dataset.nfonThemeSwitch = "";
      control.setAttribute("role", "switch");
      control.dataset.i18nAriaLabel = "appearance.admin";
      control.setAttribute("aria-label", m("appearance.admin", "Modern Design"));
      const classic = document.createElement("span");
      classic.className = "nfon-theme-classic";
      classic.dataset.i18nKey = "appearance.classic";
      classic.textContent = m("appearance.classic", "Classic Design");
      const track = document.createElement("span");
      track.className = "nfon-theme-track";
      track.setAttribute("aria-hidden", "true");
      const modern = document.createElement("span");
      modern.className = "nfon-theme-modern";
      modern.dataset.i18nKey = "appearance.admin";
      modern.textContent = m("appearance.admin", "Modern Design");
      control.append(classic, track, modern);
      control.addEventListener("click", () => applyTheme(theme === "admin-portal" ? "classic" : "admin-portal"));
      container.append(label, control);
    });
  }

  function init() {
    configureHomeLinks();
    const header = document.querySelector(".app-header");
    const actions = header?.querySelector(".header-actions");
    if (header && actions && actions.querySelectorAll(":scope > .nav-button").length) {
      navItems = [...actions.querySelectorAll(":scope > .nav-button")].map((node) => {
        const view = node.dataset.view || node.getAttribute("href") || "";
        const icon = /setup|changes/.test(view) ? "settings" : /analytics/.test(view) ? "bar_chart" :
          /history/.test(view) ? "history" : /transcripts/.test(view) ? "description" :
          /crm/.test(view) ? "contacts" : /phonebook|contacts/.test(view) ? "contact_phone" :
          /extensions/.test(view) ? "dialpad" : /services/.test(view) ? "groups" :
          /callflow/.test(view) ? "account_tree" : "dashboard";
        node.dataset.nfonIcon = icon;
        const placeholder = document.createComment("navigation position for Classic");
        node.before(placeholder);
        return { node, placeholder };
      });
      sidebar = document.createElement("aside");
      sidebar.className = "nfon-sidebar";
      sidebar.id = "nfon-navigation";
      const nav = document.createElement("nav");
      nav.dataset.i18nAriaLabel = "appearance.navigation";
      nav.setAttribute("aria-label", m("appearance.navigation", "Main navigation"));
      sidebar.append(nav);
      header.after(sidebar);
      menuButton = document.createElement("button");
      menuButton.type = "button";
      menuButton.className = "nfon-menu-button";
      menuButton.dataset.i18nAriaLabel = "appearance.menu";
      menuButton.setAttribute("aria-label", m("appearance.menu", "Toggle navigation"));
      menuButton.setAttribute("aria-controls", sidebar.id);
      menuButton.setAttribute("aria-expanded", "false");
      const icon = document.createElement("img");
      icon.src = new URL("assets/material/menu.svg", scriptBase).href;
      icon.alt = "";
      icon.width = 24;
      icon.height = 24;
      menuButton.append(icon);
      header.prepend(menuButton);
      sidebarButton = document.createElement("button");
      sidebarButton.type = "button";
      sidebarButton.className = "nfon-sidebar-toggle";
      sidebarButton.setAttribute("aria-controls", sidebar.id);
      sidebar.append(sidebarButton);
      const toggleCollapsed = () => {
        navigationCollapsed = !navigationCollapsed;
        try { localStorage.setItem(NAV_KEY, String(navigationCollapsed)); } catch { /* Optional persistence. */ }
      };
      menuButton.addEventListener("click", () => {
        if (mobileNavigation.matches) document.documentElement.classList.toggle("nfon-navigation-open");
        else toggleCollapsed();
        updateNavigation();
      });
      sidebarButton.addEventListener("click", () => {
        if (mobileNavigation.matches) {
          closeNavigation();
          menuButton.focus();
        }
        else toggleCollapsed();
        updateNavigation();
      });
      mobileNavigation.addEventListener("change", closeNavigation);
      document.addEventListener("nfon:language-change", updateNavigation);
      // Some apps handle section navigation at document capture and stop propagation.
      document.addEventListener("click", (event) => {
        if (sidebar.contains(event.target) && event.target.closest("a,button")) closeNavigation();
      }, true);
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && document.documentElement.classList.contains("nfon-navigation-open")) {
          closeNavigation();
          menuButton.focus();
        }
      });
      document.addEventListener("click", (event) => {
        if (!sidebar.contains(event.target) && !menuButton.contains(event.target)) closeNavigation();
      });
    }
    if (window.ResizeObserver) new ResizeObserver(() => {
      if (theme === 'admin-portal') document.documentElement.style.setProperty('--nfon-header-height', header.getBoundingClientRect().height + 'px');
    }).observe(header);
    installSettings();
    applyTheme(theme, false);
    let linksQueued = false;
    const linkObserver = new MutationObserver(() => {
      if (linksQueued) return;
      linksQueued = true;
      requestAnimationFrame(() => {
        linksQueued = false;
        decorateLinks();
        linkObserver.takeRecords();
      });
    });
    linkObserver.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["href"] });
    document.addEventListener("click", (event) => {
      const link = event.target.closest("a[href]");
      if (!link || link.hasAttribute("download")) return;
      const href = link.getAttribute("href");
      const next = internalLink(href);
      if (next !== href) link.setAttribute("href", next);
    }, true);
    window.addEventListener("storage", (event) => {
      if (event.key === KEY && THEMES.has(event.newValue)) applyTheme(event.newValue, false);
      if (event.key === NAV_KEY) {
        navigationCollapsed = event.newValue === "true";
        updateNavigation();
      }
    });
    document.addEventListener('nfon:language-change', decorateLinks);
    window.NFON_I18N?.refresh();
  }
  window.NFON_APPEARANCE = { getTheme: () => theme, setTheme: applyTheme, internalLink, getCockpitUrl };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
