# Portal API — Agent & Maintainer Guide

Orientation for an AI assistant or a new developer working on this app. It complements
`README.md` (human quickstart): this file explains how the app is built and where to change things.
Treat it as a map, not a spec — when in doubt, verify against the code.

## What this app is

A standalone demo of the **NFON Portal (admin) API**: service inventory, a visual callflow builder,
day/night readiness checks, phonebook sync, and admin-flow previews. Most actions are previews/dry-run
plans; live writes are disabled by default for safety. It runs without the other showcase apps.

## Tech & conventions (do not break)

- **Vanilla HTML/CSS/JS only.** No frameworks, no build step, **zero runtime dependencies** —
  just Node's built-in `http`. Do not introduce React/Tailwind/bundlers or copy component code.
- **Design tokens** live in `public/styles.css` (`:root`): background `#f5f7f8`, surface `#ffffff`,
  text `#202426`, one accent green `#00d981`. Sharp corners (no `border-radius` on panels/cards/buttons),
  8px spacing rhythm, Inter font, black header with a 4px green bottom border.
- **Live-write safety (critical):** live writes are off unless `PORTAL_ENABLE_LIVE_WRITES=true`, and
  `PORTAL_DISABLE_LIVE_WRITES=true` is a hard read-only override that always wins. `apply` routes must
  stay dry-run/plan unless live writes are explicitly enabled. Do not weaken this default.
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
