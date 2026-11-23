# Landing Cockpit — Agent & Maintainer Guide

Orientation for an AI assistant or a new developer working on this app. It complements
`README.md` (human quickstart): this file explains how the app is built and where to change things.
Treat it as a map, not a spec — when in doubt, verify against the code.

## What this app is

The **optional** all-in-one cockpit for the showcase: product cards, health checks, start/stop
controls for the sibling APIs, editable upstream links, and gateway routes that redirect to each app.
The individual API tools must run without it — this app may know sibling paths only to start/stop
local services and route to configured upstreams.

## v1.2 appearance and language contract

Admin Portal is the default theme. The older visual rules below apply to Classic only.
Shared tokens and shell behavior live in `../shared/appearance.css` and `../shared/appearance.js`;
app-specific Admin Portal adapters must be scoped to `html[data-nfon-theme="admin-portal"]`.
Both themes share the same controls, application state and security guards. The switch above the header changes
only appearance; it must preserve drafts, filters, selections and authentication.

Use explicit keys in `i18n-messages.json` for complete messages in all twelve selectable languages.
First visits use English; only an explicit saved language choice overrides it. Protect real names,
API data and edited values from translation; keep generated defaults distinguishable.
Run `npm run sync:shared` at the repository root after catalog/shared changes, then `npm test`.
Do not edit generated `public/messages.js` or the copied shared appearance files.

## Tech & conventions (do not break)

- **Vanilla HTML/CSS/JS only.** No frameworks, no build step, **zero runtime dependencies** —
  just Node's built-in `http`. Do not introduce React/Tailwind/bundlers or copy component code.
- **Design tokens** live in `public/styles.css` (`:root`): background `#f5f7f8`, surface `#ffffff`,
  text `#202426`, one accent green `#00d981`. Sharp corners, 8px spacing rhythm, Inter font, black
  header with a 4px green bottom border, hover tint, and a mini-EKG heartbeat in the status chip.
- **Card layout invariants:** keep equal card heights and aligned title/text/status/footer lines.
  Each card's edit control (top-right) flips the card to an upstream-link editor — it must flip,
  not navigate (do not move it onto the card link). Health/status text wraps; no `nowrap`/ellipsis.
- **Service control & security:** control is off by default (`LANDING_ENABLE_SERVICE_CONTROL`).
  The `/start`, `/stop`, and `/upstream` routes require the same-origin CSRF token from `/api/status`
  (header `X-CSRF-Token`). Upstream precedence: override > env var > built-in default.
- **No secrets in the repo.** Only `.env.example` with placeholders; real config stays local
  (see `README.md` / `SECURITY.md`). Keep `npm test` green.

## File map

| Path | Role |
| --- | --- |
| `src/server.js` | Node `http` server: cockpit API, health checks, service start/stop, upstream override persistence, gateway redirects, CSRF guard, static serving. |
| `public/index.html` | Cockpit markup (`/combined/`). |
| `public/app.js` | Client logic: product cards, health polling, edit-flip, start/stop controls. |
| `public/styles.css` | All styling and design tokens. |
| `public/assets/nfon-logo.png` | NFON logo asset. |
| `start-cockpit.command` | macOS one-click launcher: starts the cockpit and (by default) the sibling APIs via the control API. |
| `test/cockpit.test.js` | CSRF, upstream override, and unknown-service checks. |
| `.env.example` | Documented configuration; copy to a local `.env` or external config. |

## Server routes (current)

- `GET  /api/status` — health + CSRF token
- `POST /api/services/<id>/start`, `/stop`, `/upstream` — service control (CSRF-protected)
- Gateway: `/cti`, `/portal`, `/core-history` (alias `/call-history`) redirect (302) to the configured upstreams
- `/combined/` and static files from `public/`

Service ids: `cti`, `portal`, `core-history`. Upstream overrides persist to
`~/.config/nfon-api-showcase/landing-upstreams.json` (owner-readable, never committed).

## Run & test

```sh
npm start    # http://localhost:3010/combined/
npm test     # syntax check + cockpit tests
```

Configure via `.env` (`PORT`, `LANDING_HOST`, `*_UPSTREAM`, `LANDING_ENABLE_SERVICE_CONTROL`).

## Where to change what

- **Look & feel / card styling** → `public/styles.css`.
- **Cards, health polling, edit-flip, start/stop UI** → `public/app.js`.
- **Health checks, service control, upstream persistence, gateway redirects, CSRF** → `src/server.js`.

## Before committing or pushing

- `npm test` green and `npm run secret-scan` clean.
- No real upstream secrets or local paths.
- UI changes: keep the design tokens and card invariants above; verify in the browser.
