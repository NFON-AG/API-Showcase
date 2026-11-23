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
- `messages.js`, `appearance.js`, `appearance.css`, `assets/material/`: generated
  shared catalogs, appearance and licensed navigation icons. Sync with
  `npm run sync:shared` from the repository root.

## Local start

```sh
python3 -m http.server 3090 --directory docs
```

Open `http://127.0.0.1:3090/`.

## Scope

The visual interface and feature structure come from the same public apps used
by the local Node.js showcase. `demo-runtime.js` answers API calls in the browser
with synthetic demo content. Credential setup and operations that require a live
server are restricted or shown as previews.

The static demo shows what each API workflow does and why it matters:

- **CTI API**: demonstrates a live telephony dashboard with extension presence,
  active calls, call events, analytics, Click-to-Dial affordances, and local
  exports.
- **Portal API**: demonstrates Service Portal inventory, phonebook preparation,
  queue and skill-group administration, callflow editing and day/night previews.
  One-click night activation requires the local Portal server. Callflow PDFs
  download directly in color, with the
  dotted background, arrows, routing details and all target cards, including
  targets collapsed in the editor. These actions never change a real account.
- **Call History API**: demonstrates user call history, filters, transcript
  context and a separate fixed transcript-to-CRM showcase. Support-ticket,
  appointment and sales examples run automatically, including a calendar entry
  and a follow-up reminder. The CRM examples and charts never evaluate
  call-history data, including in a downloaded copy.
- **Landing**: demonstrates the shared entry point and the relationship between
  the independent API apps. Pause/resume and link-preview settings are local
  simulations persisted in browser storage. Card navigation stays inside this
  static demo, including when a preview URL is entered.

## Language support

The demo includes a shared header language selector for common European
business languages: English, German, French, Spanish, Italian, Dutch, Polish,
Portuguese, Swedish, Danish, Finnish, and Czech. First visits use English. An explicit selection is stored locally and carried
between apps through navigation links. All twelve languages have complete keyed messages. Edited names and genuine record content are not translated.

## Appearance

Modern Design is the default; Classic Design is available in the switch above the header. The
compact switch matches the header's Demo control and displays both **Classic
Design** and **Modern Design** labels. It supports keyboard focus and switching
without resetting forms or filters. Navigation retains its short underlines;
Setup headings and form content share responsive spacing. Static setup credentials
are read-only, but the language and appearance controls are active. The apps
need no npm installation and can also be opened without the cockpit. The Portal
PDF library and its font assets are bundled locally; see their
[third-party notices](portal/pdf/THIRD_PARTY.md).

## Boundary

The web-only demo never calls NFON, SSO, Portal, CTI, local services, or any
backend proxy. It has no live API connection, no secrets, and no Node.js runtime
on GitHub Pages. Live API access requires the local Node.js apps or a separately
hosted backend proxy.


Modern Design uses one four-role type scale (12/14/16/24px), shared spacing and
consistent status/action proportions. Cockpit navigates through its app cards
and has no sidebar. CTI, Portal and Call History retain their collapsible section
navigation.

Call History sources, including `crm-demo/`, are synchronized from
`CallHistory_API/public/` by `npm run sync:shared`. The CRM demo has no backend
requests; only theme, language and view visibility are passed to its embedded document.
