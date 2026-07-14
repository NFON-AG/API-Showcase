# NFON API Showcase Web-only Demo

The `docs/` folder contains the static GitHub Pages demo for the NFON API
Showcase. It is designed for users who want to explore the product flows before
running any local Node.js server or connecting their own NFON credentials.

## Structure

- `index.html` plus `landing/`: static copy of the local landing cockpit.
- `cti/`: static CTI public app with overview, analytics, setup, extension
  table, live-event simulation, and export flows.
- `portal/`: static Portal public app with overview, phonebook sync, extensions,
  queues, skill groups, callflow builder, and setup previews.
- `call-history/`: static Call History public app with call list, transcripts,
  CRM demo, filters, metrics, and setup.
- `demo-runtime.js`: browser-side demo API adapter for the original app
  endpoints.
- `i18n.js`: shared language selector and UI translation runtime.

## Local start

```sh
python3 -m http.server 3090 --directory docs
```

Open `http://127.0.0.1:3090/`.

## Scope

The visual interface and feature structure come from the same public apps used
by the local Node.js showcase. The only intentional difference is the data
source: `demo-runtime.js` answers API calls in the browser with synthetic demo
content.

The static demo shows what each API workflow does and why it matters:

- **CTI API**: demonstrates a live telephony dashboard with extension presence,
  active calls, call events, analytics, Click-to-Dial affordances, and local
  exports.
- **Portal API**: demonstrates Service Portal inventory, phonebook preparation,
  queue and skill-group administration, callflow planning, and dry-run safety
  before live writes.
- **Call History API**: demonstrates user call history, filters, transcript
  context, ticket preparation, CRM assignment, and billing-style metrics.
- **Landing**: demonstrates the shared entry point and the relationship between
  the independent API apps.

## Language support

The demo includes a shared header language selector for common European
business languages: English, German, French, Spanish, Italian, Dutch, Polish,
Portuguese, Swedish, Danish, Finnish, and Czech. If no language has been
selected, the browser language is used when it is supported.

## Boundary

The web-only demo never calls NFON, SSO, Portal, CTI, local services, or any
backend proxy. It has no live API connection, no secrets, and no Node.js runtime
on GitHub Pages. Live API access requires the local Node.js apps or a separately
hosted backend proxy.
