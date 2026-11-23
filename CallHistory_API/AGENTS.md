# Call History API — Agent & Maintainer Guide

Orientation for an AI assistant or a new developer working on this app. It complements
`README.md` (human quickstart): this file explains how the app is built and where to change things.
Treat it as a map, not a spec — when in doubt, verify against the code.

## What this app is

A standalone demo of the **NFON Call History API** with **Login with NFON** (OAuth 2.0
Authorization Code + PKCE). It shows a user's call list with filters and metrics, transcript
hints, and a separate fixed transcript-to-CRM showcase. It runs without the other showcase apps.

## v1.2 appearance and language contract

Admin Portal is the default theme. The older visual rules below apply to Classic only.
Shared tokens and shell behavior live in `../shared/appearance.css` and `../shared/appearance.js`;
app-specific Admin Portal adapters must be scoped to `html[data-nfon-theme="admin-portal"]`.
Both themes share the same controls, application state and security guards. The top theme switch changes
only appearance; it must preserve drafts, filters, selections and authentication.

Use explicit keys in `i18n-messages.json` for complete messages in every offered language (EN, DE, FR, ES, IT, NL, PL, PT, SV, DA, FI, CS). Protect real names,
API data and edited values from translation; keep generated defaults distinguishable.
First visits use English; only an explicit saved language choice overrides it.
Run `npm run sync:shared` at the repository root after catalog/shared changes, then `npm test`.
Do not edit generated `public/messages.js` or the copied shared appearance files.

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
| `src/server.js` | Node `http` server: OAuth PKCE login, proxy to the NFON Call History API, CSRF guard, static file serving and generated synthetic records in Demo mode. |
| `public/index.html` | Markup and the four views: `history`, `transcripts`, `crm`, `setup`. |
| `public/app.js` | Client logic: history, filters, metrics, transcripts, OAuth/setup and the CRM iframe bridge. |
| `public/styles.css` | Parent-shell styling and design tokens. |
| `public/crm-demo/` | Fixed automatic transcript-to-CRM playback, charts and isolated styling; never consumes history API data. |
| `src/server.js` demo generators | Synthetic call-list records; prepared text is localized by the client. |
| `test/security.test.js` | CSRF, redirect-bounds, and "no live→demo fallback" checks. |
| `.env.example` | Documented configuration; copy to a local `.env` or external config. |

## Server routes (current)

- `GET  /api/status` — health + CSRF token + auth state
- `GET  /api/calls` — call list (live via OAuth, or generated synthetic records)
- `GET  /api/transcripts/:id` — transcript details (live via OAuth, or synthetic examples)
- `POST /api/settings/browser-login`, `POST /api/auth/logout` — settings/session (CSRF-protected)
- `GET  /auth/login`, `GET /auth/call-history/callback` — OAuth PKCE flow; `/` and `/auth/nfon/callback` also accept OAuth callbacks
- everything else → static files from `public/`

## Run & test

```sh
npm start    # http://localhost:3000
npm test     # syntax checks + server, client and CRM regression tests
```

Port **3000 is the default**, matching the configured local OAuth client (see `LOCAL_REDIRECT_STRATEGY.md`). Tests use ephemeral ports; another runtime port requires a matching registered redirect. Configure via `.env`
(`CALLHISTORY_*`, `PORT`, `HOST`); set `DEMO_MODE=true` to force synthetic data without OAuth.

## Where to change what

- **Look & feel / a component's style** → `public/styles.css`.
- **List rendering, filters, metrics, transcript badge, CRM** → `public/app.js`.
- **API calls, OAuth, data shaping, CSRF, routing** → `src/server.js`.
- **History demo data** → `createDemoCallHistoryData` in `src/server.js`; CRM examples → `public/crm-demo/`.

## Before committing or pushing

- `npm test` green and `npm run secret-scan` clean.
- No real credentials, tokens, customer/call/transcript data, or local paths.
- UI changes: keep the design tokens above; verify in the browser.

## Fixed CRM boundary

The sandboxed CRM page permits scripts and separate noopener documentation popups, but never same-origin access. The generated offline document embeds all scripts/styles/fonts because opaque file frames cannot load sibling resources. The sandboxed CRM page receives only `theme`, `lang` and view visibility (`active`) through a source-validated message bridge. Its opaque sandbox origin requires wildcard delivery; no credentials, call data or edited values cross the bridge. The parent validates the iframe window and self/opaque origin; the child validates the parent window/origin. Keep its fixed data independent from live/demo history, credentials and filters. Preserve playback state on language/theme changes; do not read or delete the legacy draft storage key. The static counterpart is generated by `scripts/sync-history.mjs` through `npm run sync:shared`; do not hand-edit `docs/call-history/`. Browser QA must include both themes, all twelve offered languages, automatic progression/replay, UUID deduplication, charts, navigation and narrow widths.
