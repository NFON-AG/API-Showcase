# Call History API — Agent & Maintainer Guide

Orientation for an AI assistant or a new developer working on this app. It complements
`README.md` (human quickstart): this file explains how the app is built and where to change things.
Treat it as a map, not a spec — when in doubt, verify against the code.

## What this app is

A standalone demo of the **NFON Call History API** with **Login with NFON** (OAuth 2.0
Authorization Code + PKCE). It shows a user's call list with filters and metrics, transcript
hints, and a small ticket/CRM dry-run mapping. It runs without the other showcase apps.

## Tech & conventions (do not break)

- **Vanilla HTML/CSS/JS only.** No frameworks, no build step, **zero runtime dependencies** —
  just Node's built-in `http`. Do not introduce React/Tailwind/bundlers or copy component code.
- **Design tokens** live in `public/styles.css` (`:root`): background `#f5f7f8`, surface `#ffffff`,
  text `#202426`, one accent green `#00d981`. Sharp corners (no `border-radius` on panels/cards/buttons),
  8px spacing rhythm, Inter font, black header with a 4px green bottom border.
- **Security:** state-changing POST routes require a same-origin CSRF token read from `/api/status`
  (header `X-CSRF-Token`). Keep that guard. Never convert a live API failure into a silent demo response.
- **No secrets in the repo.** Only `.env.example` with placeholders; real config stays local
  (see `README.md` / `SECURITY.md`). Keep `npm test` green.

## File map

| Path | Role |
| --- | --- |
| `src/server.js` | Node `http` server: OAuth PKCE login, proxy to the NFON Call History API, CSRF guard, static file serving, demo-fixture fallback. |
| `public/index.html` | Markup and the four views: `history`, `transcripts`, `crm`, `setup`. |
| `public/app.js` | Client logic: rendering, filters, metric cards, transcript badge/popover, mini-CRM, OAuth/setup UI. |
| `public/styles.css` | All styling and design tokens. |
| `fixtures/*.json` | Synthetic demo calls and transcripts for demo mode and public-safe tests. |
| `test/security.test.js` | CSRF, redirect-bounds, and "no live→demo fallback" checks. |
| `.env.example` | Documented configuration; copy to a local `.env` or external config. |

## Server routes (current)

- `GET  /api/status` — health + CSRF token + auth state
- `GET  /api/calls` — call list (live via OAuth, or demo fixtures)
- `POST /api/assignment-preview` — ticket/customer dry-run mapping
- `POST /api/settings/browser-login`, `POST /api/auth/logout` — settings/session (CSRF-protected)
- `GET  /auth/login`, `GET /auth/call-history/callback` — OAuth PKCE flow
- everything else → static files from `public/`

## Run & test

```sh
npm start    # http://localhost:3000
npm test     # syntax check + security tests
```

Port **3000 is fixed** for the local showcase because the Login with NFON OAuth client is
registered for that origin (see `LOCAL_REDIRECT_STRATEGY.md`). Configure via `.env`
(`CALLHISTORY_*`, `PORT`, `HOST`); set `DEMO_MODE=true` to force synthetic data without OAuth.

## Where to change what

- **Look & feel / a component's style** → `public/styles.css`.
- **List rendering, filters, metrics, transcript badge, CRM** → `public/app.js`.
- **API calls, OAuth, data shaping, CSRF, routing** → `src/server.js`.
- **Demo data shown without login** → `fixtures/*.json`.

## Before committing or pushing

- `npm test` green and `npm run secret-scan` clean.
- No real credentials, tokens, customer/call/transcript data, or local paths.
- UI changes: keep the design tokens above; verify in the browser.
