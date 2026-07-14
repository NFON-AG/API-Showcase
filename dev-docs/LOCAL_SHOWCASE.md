# Local Showcase Runbook

This workspace is intended to stay runnable as local standalone apps after repo cleanup. Keep real credentials and runtime state outside the repository.

## Static Web-only Demo

`docs/` is the GitHub-Pages-ready demo layer. It runs without Node.js, backend proxy, secrets, or live API access.

```sh
python3 -m http.server 3090 --directory docs
```

Open `http://127.0.0.1:3090/`. The static demo uses the copied original public apps with `demo-runtime.js` as browser-side API adapter. Details: [WEB_ONLY_DEMO.md](WEB_ONLY_DEMO.md).

## Requirements

- Node.js 20 or newer.
- No package install is required for the current dependency-free servers.
- Optional real API credentials copied from each `.env.example` into an external local config folder or a local `.env`.

## External Local Config

Recommended local config location:

Example path:
```text
~/.config/nfon-api-showcase
```

Structure:

```text
env/CTI_API.env
env/Portal_API.env
env/CallHistory_API.env
data/CTI_API/
data/Portal_API/
data/CallHistory_API/
secrets/CTI_API/
secrets/Portal_API/
secrets/CallHistory_API/
```

The apps auto-detect this folder. On another machine, set `NFON_SHOWCASE_CONFIG_DIR=/path/to/local-config`.

## Port Contract

| App | Local URL | Notes |
| --- | --- | --- |
| Call History API | `http://localhost:3000` | Must stay on 3000 for the current Login with NFON OAuth client. |
| Portal API | `http://localhost:3001` | Live writes are disabled unless explicitly enabled. |
| CTI API | `http://localhost:3002` | Google Contacts redirect must match the registered OAuth redirect. |
| Landing cockpit | `http://localhost:3010/combined/` | Optional local launcher and health cockpit. |

## Start From The Workspace Root

```sh
npm run start:callhistory
npm run start:portal
npm run start:cti
npm run start:landing
```

Run each command in a separate terminal when all apps should be open at once.

## One-Click Cockpit (macOS)

Double-click `landing/start-cockpit.command`. It starts the landing cockpit on
`http://127.0.0.1:3010/combined/` and, by default, starts the three showcase APIs
through the cockpit control API so the cockpit keeps ownership and can stop them again.
Set `LANDING_AUTOSTART_APIS=false` to only launch the cockpit and start each API by hand.

## Editing An Upstream Link

Each cockpit card has an edit control (top right). It flips the card to a form where the
upstream URL can be changed. The value is saved locally to
`~/.config/nfon-api-showcase/landing-upstreams.json` (owner-readable, never committed) and
becomes the single source for that service's health check, gateway redirect, and server start.
"Standard" resets the card back to the environment or built-in default. Editing and the
start/stop controls are protected by a same-origin CSRF token from `/api/status`.

## Start From A Standalone App Folder

```sh
cd CallHistory_API
npm start
```

The same pattern works for `Portal_API`, `CTI_API`, and `landing`.

## Local Configuration

For live credentials, prefer external env files:

```sh
mkdir -p ~/.config/nfon-api-showcase/env
cp CallHistory_API/.env.example ~/.config/nfon-api-showcase/env/CallHistory_API.env
cp Portal_API/.env.example ~/.config/nfon-api-showcase/env/Portal_API.env
cp CTI_API/.env.example ~/.config/nfon-api-showcase/env/CTI_API.env
cp landing/.env.example ~/.config/nfon-api-showcase/env/landing.env
```

As a standalone fallback, copy the relevant example file into the app folder:

```sh
cp CallHistory_API/.env.example CallHistory_API/.env
cp Portal_API/.env.example Portal_API/.env
cp CTI_API/.env.example CTI_API/.env
cp landing/.env.example landing/.env
```

Never commit `.env`, `data/`, `secrets/`, local config folders, or archived local material.

## Checks

```sh
npm test
npm run secret-scan
```

`npm test` runs syntax checks, focused app tests, and the commit-visible secret scan.
