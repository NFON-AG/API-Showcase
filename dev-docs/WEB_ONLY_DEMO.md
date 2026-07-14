# Web-only Demo

`docs/` is the GitHub Pages-compatible demo layer of the NFON API Showcase. It
copies the existing `public` apps and replaces only the backend responses with a
browser-side demo adapter.

## Runtime

- Static files only: `index.html`, `cti/`, `portal/`, `call-history/`,
  `landing/`, `demo-runtime.js`, and `i18n.js`.
- No Node.js process on GitHub Pages.
- No build step.
- No network requests to NFON, SSO, Portal, CTI, or local services.
- Relative links work under GitHub Pages subpaths.

## Demo data model

On load, `demo-runtime.js` creates demo responses for the original endpoints:

- CTI API: overview, analytics, setup, extensions, calls, event history,
  CSV/XLS export, and local demo backup actions.
- Portal API: overview, phonebook, extensions, queues, skill groups, callflow,
  and setup dry-runs.
- Call History API: call list, transcripts, CRM demo, filters, metrics, and
  setup.

All data stays in the browser context of the static demo. No real API, auth, or
proxy requests are executed.

## Language runtime

`i18n.js` injects the header language selector and translates static and
dynamically rendered UI text through a shared runtime. Supported languages are
English, German, French, Spanish, Italian, Dutch, Polish, Portuguese, Swedish,
Danish, Finnish, and Czech. The selected language is stored in local storage; if
no language is selected, the browser language is used when supported.

## Security boundary

The web-only demo is intentionally not connected to live APIs. It demonstrates
existing UI and feature flows with demo content. Live access still requires the
local Node.js apps or a separately operated backend proxy.

## Checks

```sh
npm test
npm run secret-scan
git diff --check
```

For browser validation:

```sh
python3 -m http.server 3090 --directory docs
```
