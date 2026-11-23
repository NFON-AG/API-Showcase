# Portal API — Agent & Maintainer Guide

Orientation for an AI assistant or a new developer working on this app. It complements
`README.md` (human quickstart): this file explains how the app is built and where to change things.
Treat it as a map, not a spec — when in doubt, verify against the code.

## What this app is

A standalone demo of the **NFON Portal (admin) API**: service inventory, a visual callflow builder,
day/night readiness checks, phonebook sync, and admin-flow previews. Most actions are previews/dry-run
plans; live writes are disabled by default for safety. It runs without the other showcase apps.

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
  just Node's built-in `http` on the server. The narrow exception is the pinned, locally vendored jsPDF browser exporter under `public/pdf/`; see its `THIRD_PARTY.md`. Do not introduce React/Tailwind/bundlers or copy component code.
- **Design tokens** live in `public/styles.css` (`:root`): background `#f5f7f8`, surface `#ffffff`,
  text `#202426`, one accent green `#00d981`. Sharp corners (no `border-radius` on panels/cards/buttons),
  8px spacing rhythm, Inter font, black header with a 4px green bottom border.
- **Live-write safety (critical):** every process starts with live writes off. `PORTAL_ENABLE_LIVE_WRITES=true`
  permits session opt-in through Setup or an explicit Create/Apply/Delete action, including one-click day-night setup. `PORTAL_DISABLE_LIVE_WRITES=true`
  is a hard read-only override that always wins. Account changes and browser login reset session writes off.
  Mutation routes require an enabled session; a permitted action may enable it as part of the action or its existing confirmation. Keep one existing confirmation for batch/profile/deletion; Create and phonebook Apply need no extra dialog. Do not add a separate Setup detour.
  Day-mode restore and night-routing reset may enable that permitted session while night mode is active; other writes keep the existing night-mode restriction.
- **Security:** state-changing POST routes require a same-origin CSRF token from `/api/status`
  (header `X-CSRF-Token`). Never convert a live API failure into a silent demo response.
- **No secrets in the repo.** Only `.env.example` with placeholders; real config stays local
  (see `README.md` / `SECURITY.md`). Keep `npm test` green.

## File map

| Path | Role |
| --- | --- |
| `src/server.js` | Node `http` server: Portal API proxy, inventory/overview, callflow + day/night planning and apply, phonebook sync, live-write gating, CSRF guard, static serving. |
| `public/index.html` | Markup and the views: `overview`, `services`, `callflow`, `extensions`, `phonebook`, `changes`. |
| `public/app.js` | Client logic: inventory rendering, the callflow canvas/builder, dry-run plans, forms. |
| `public/styles.css` | All styling and design tokens. |
| `test/security.test.js` | CSRF and security checks. |
| `.env.example` | Documented configuration; copy to a local `.env` or external config. |

## Server routes (current, selection)

- `GET  /api/status`, `/api/version`, `/api/customers`, `/api/overview`
- `GET  /api/callflow` · `POST /api/callflow/apply`, `/api/callflow/bulk-apply`
- `GET  /api/service-groups` · `POST /api/service-groups/apply`
- `POST /api/daynight/*` — gateway preview/apply, routing, time-control cleanup, reset/restore, announcement-target plan/apply
- `GET|POST /api/phonebook-sync/*` — mapping, preview, upload, apply
- `POST /api/settings/customer`, `/api/settings/browser-login`, `/api/settings/live-writes`
- everything else → static files from `public/`

## Run & test

```sh
npm start    # http://localhost:3001
npm test     # syntax check + security tests
```

Configure via `.env` (`PORT`, `HOST`, `PORTAL_*`). Keep live writes disabled unless you are running a
conscious local write session.

## Where to change what

- **Look & feel / a component's style** → `public/styles.css`.
- **Callflow canvas, inventory views, dry-run plan UI, forms** → `public/app.js`.
- **Portal proxy, plan/apply logic, live-write gating, day/night, phonebook sync, CSRF** → `src/server.js`.

## Before committing or pushing

- `npm test` green and `npm run secret-scan` clean.
- No real credentials, customer data, or raw Portal payloads, and no local paths.
- UI changes: keep the design tokens above; verify in the browser.
