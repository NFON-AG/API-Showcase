# NFON API Showcase Workspace

This workspace contains the three local NFON API showcase demos plus the optional local landing cockpit.

## Quick Start

```sh
npm test
npm run start:callhistory
npm run start:portal
npm run start:cti
npm run start:landing
```

Run the `start:*` commands in separate terminals when all apps should be open at once. Details: [LOCAL_SHOWCASE.md](LOCAL_SHOWCASE.md).

Static web-only demo:

```sh
python3 -m http.server 3090 --directory docs
```

Open `http://127.0.0.1:3090/`. The static demo uses the copied original public apps with a browser-side demo API adapter. Details: [WEB_ONLY_DEMO.md](WEB_ONLY_DEMO.md).

## Active Workspaces

- `Portal_API/` - NFON Portal API: Service Portal inventory, admin flows, callflow builder, dry-run plans.
- `CTI_API/` - NFON CTI API: live dashboard, analytics, streams, Click-to-Dial, local call history.
- `CallHistory_API/` - NFON Call History API: Login with NFON, user call history, filters, transcript hints.
- `landing/` - NFON API Landingpage: optional local cockpit and health checks, usually run on `localhost:3010` while Call History owns `localhost:3000`.
- `docs/` - GitHub-Pages-ready static demo with demo sample data.

Each API folder is intended to work as an individual standalone repo: copy that folder, run `npm start`, configure local `.env` from `.env.example` or an external local config folder, and keep credentials/runtime data out of the workspace. The `landing/` folder is optional and only needed for the all-in-one cockpit.

## Local Private Data

- This workspace should contain no real `.env`, `data/`, or `secrets/` folders.
- Local private config and runtime data should live outside this workspace, for example under `~/.config/nfon-api-showcase`.
- The apps auto-detect `~/.config/nfon-api-showcase`. Other machines can set `NFON_SHOWCASE_CONFIG_DIR` or use a local `.env` copied from `.env.example`.
- Standalone repos should not rely on sibling folders. Cross-app calls must use explicit URL env vars such as the landing upstream settings.

## Port Strategy

Current local showcase contract:

- `CallHistory_API/` owns `http://localhost:3000` because the current Login with NFON OAuth client is registered for that origin.
- `Portal_API/` runs on `http://localhost:3001`.
- `CTI_API/` runs on `http://localhost:3002`; Google Contacts uses the configured `GOOGLE_REDIRECT_URI`, currently `http://localhost:3002/auth/google/callback` for the local showcase.
- `landing/` can run as the optional cockpit on `http://localhost:3010`.

A future gateway can still make `localhost:3000` the single external entry point, but only after the OAuth redirect contracts are deliberately moved or relayed. Until then, do not move Call History away from port 3000.

## Pre-Push Checklist

Before pushing to the public repository, run:

```sh
npm test
npm run secret-scan
git status --short --ignored
```

Do not commit local `.env`, `data/`, `secrets/`, or archived local material. Full checklist: [PRE_PUSH_CHECKLIST.md](PRE_PUSH_CHECKLIST.md).
