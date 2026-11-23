# CTI API — Agent & Maintainer Guide

Orientation for an AI assistant or a new developer working on this app. It complements
`README.md` (human quickstart): this file explains how the app is built and where to change things.
Treat it as a map, not a spec — when in doubt, verify against the code.

## What this app is

A standalone demo of the **NFON CTI API**: a live dashboard with extension status, call-state
streaming, Click-to-Dial, analytics, and a local call history. Google Contacts is optional support
functionality, not the CTI core. It runs without the other showcase apps.

## v1.2 appearance and language contract

Admin Portal is the default theme. The older visual rules below apply to Classic only.
Shared tokens and shell behavior live in `../shared/appearance.css` and `../shared/appearance.js`;
app-specific Admin Portal adapters must be scoped to `html[data-nfon-theme="admin-portal"]`.
Both themes share the same controls, application state and security guards. The switch above
the header changes only appearance; it must preserve drafts, filters, selections and authentication.

Use explicit keys in `i18n-messages.json` for complete messages in all twelve selectable languages.
First visits use English; only an explicit saved language choice overrides it. Protect real names,
API data and edited values from translation; keep generated defaults distinguishable.
Run `npm run sync:shared` at the repository root after catalog/shared changes, then `npm test`.
Do not edit generated `public/messages.js` or the copied shared appearance files.

## Tech & conventions (do not break)

- **Vanilla HTML/CSS/JS only.** No frameworks, no build step, **zero runtime dependencies** —
  just Node's built-in `http`. Do not introduce React/Tailwind/bundlers or copy component code.
- **Design tokens** live in `public/styles.css` (`:root`): background `#f5f7f8`, surface `#ffffff`,
  text `#202426`, one accent green `#00d981`. Sharp corners (no `border-radius` on panels/cards/buttons),
  8px spacing rhythm, Inter font, black header with a 4px green bottom border.
- **Security:** state-changing POST routes require a same-origin CSRF token read from `/api/status`
  (header `X-CSRF-Token`). Remote control/read are off by default (`NFON_ALLOW_REMOTE`, `NFON_ALLOWED_HOSTS`, plus per-app
  `CTI_ALLOW_REMOTE_CONTROL` / `CTI_ALLOW_REMOTE_READ`). All must permit the request. Never convert a live API failure into a silent demo response.
- **No secrets in the repo.** Only `.env.example` with placeholders; real config stays local
  (see `README.md` and `../SECURITY.md`). Keep `npm test` green.

## File map

| Path | Role |
| --- | --- |
| `src/server.js` | Node `http` server: NFON CTI proxy, live event stream, Click-to-Dial, local history/contacts storage, Google OAuth, CSRF guard, static serving. |
| `public/index.html` | Live dashboard (extensions, states, active calls, history). |
| `public/analytics.html` | Analytics view. |
| `public/contacts.html` | Legacy relative redirect to setup, preserving query and fragment. |
| `public/setup.html` | Setup / configuration view. |
| `public/app.js` | Client logic for all pages. |
| `public/phone-number.js` | Shared server/client phone parsing with explicit optional national-number context. |
| `public/styles.css` | All styling and design tokens. |
| `test/*.test.js` | HTTP/mock, storage, auth, phone, localization and security regressions. |
| `.env.example` | Documented configuration; copy to a local `.env` or external config. |

## Server routes (current)

- `GET  /api/status` — health + CSRF token + auth state
- `GET  /api/extensions`, `/api/states`, `/api/active-calls`, `/api/history` — CTI data
- `POST /api/calls` — Click-to-Dial · `DELETE /api/calls/<id>` — request upstream cancellation of an active call setup; not a local-only deletion
- `GET  /api/events` — live event stream (up to four browser streams); `GET /api/snapshot` — private cached fallback for additional tabs
- `POST /api/settings/browser-login` — session credentials and account switch
- `GET /api/ui-config` — public setup/UI metadata
- `GET  /api/storage`, `/api/storage/backup` · `POST /api/storage/restore` — local state
- Google Contacts (optional): `/api/google/status|contacts|sync|disconnect`,
  `/api/contacts/lookup`, `/api/contacts/photo/<id>`, `/api/local-contacts`,
  `/auth/google/start`, `/auth/google/callback`
- everything else → static files from `public/`

## Run & test

```sh
npm start    # http://localhost:3002
npm test     # syntax checks + isolated HTTP, lifecycle, storage, localization and security regression tests
```

Configure via `.env` (`PORT`, `HOST`, `NFON_*`, `CTI_*`, optional `GOOGLE_*`). The Google redirect
URI must match the registered OAuth client (`http://localhost:3002/auth/google/callback`).

## Where to change what

- **Look & feel / a component's style** → `public/styles.css`.
- **Dashboard, analytics, contacts, setup UI** → `public/app.js` (+ the matching `*.html`).
- **CTI proxy, event stream, Click-to-Dial, storage, Google OAuth, CSRF** → `src/server.js`.

## Before committing or pushing

- `npm test` green and `npm run secret-scan` clean.
- No real credentials, tokens, contacts, or call data, and no local paths.
- UI changes: keep the design tokens above; verify in the browser.
