# NFON API Showcase

Interactive demos that show what you can build with the public NFON APIs — call history with transcripts, real-time telephony dashboards, and Admin Portal automation. Each app runs locally with your own NFON credentials in minutes.

---

## What is this?

A collection of working demo apps that showcase the integration possibilities of the NFON public APIs. The goal is to give you a hands-on feel for the use cases they can implement and the customizations available on top of the NFON platform.

> ⚠️ **This is not a developer guide or reference implementation.** The code was built primarily with AI assistance to illustrate API capabilities. It is meant for exploration and inspiration only — **do not use it in production.**

### Demo apps

| App | API | What it demonstrates |
|---|---|---|
| **Call History API Demo** | [github.com/NFON-AG/Call-History-API](https://github.com/NFON-AG/Call-History-API) | Call history browsing, filters, transcript previews, CRM ticket automation |
| **CTI API Demo** | [github.com/NFON-AG/CTI-API](https://github.com/NFON-AG/CTI-API) | Live extension states, active calls, Click-to-Dial, Google Contacts lookup |
| **Portal API Demo** | [github.com/NFON-AG/Service-Portal-API](https://github.com/NFON-AG/Service-Portal-API) | Tenant inventory, callflow builder, day/night switching, phonebook sync |

---

## Get started

### 1. Explore the online demo

No setup required. The hosted demo runs entirely in the browser with realistic sample data — a good way to see what the apps look like before configuring credentials.

👉 **[https://nfon-ag.github.io/API-Showcase](https://nfon-ag.github.io/API-Showcase)**

### 2. Clone the repository

```sh
git clone https://github.com/NFON-AG/API-Showcase.git
cd API-Showcase
```

Requires [Node.js 20+](https://nodejs.org/en). There are zero npm dependencies — no `npm install` needed.

### 3. Configure credentials

Each app ships with an `.env.example` listing all available options. Copy and fill in the ones you need:

```sh
cp CallHistory_API/.env.example CallHistory_API/.env
cp CTI_API/.env.example CTI_API/.env
cp Portal_API/.env.example Portal_API/.env
cp landing/.env.example landing/.env
```

Minimum configuration per app:

| App | Required variables |
|---|---|
| **Call History API Demo** | `CALLHISTORY_CLIENT_ID` (registered for `http://localhost:3000`) — the app handles the OAuth flow from there |
| **CTI API Demo** | `NFON_K_ACCOUNT`, `NFON_API_USERNAME`, `NFON_API_PASSWORD` (CTI-enabled account) |
| **Portal API Demo** | `PORTAL_API_KEY_ID`, `PORTAL_API_KEY_SECRET`, `PORTAL_CUSTOMER_ACCOUNT` |

### 4. Run locally

Start any app in its own terminal:

```sh
npm run start:callhistory   # http://localhost:3000
npm run start:portal        # http://localhost:3001
npm run start:cti           # http://localhost:3002
```

Or launch all apps together via the landing page cockpit:

```sh
npm run start:landing       # http://localhost:3010
```

The landing page can start and stop the other apps automatically (`LANDING_ENABLE_SERVICE_CONTROL=true` is enabled by default in `.env.example`).

If no credentials are configured the apps fall back to demo data automatically, so you can start exploring the UI right away.

---

## Project structure

```
├── CallHistory_API/    # Call History demo app
├── CTI_API/            # CTI Dashboard demo app
├── Portal_API/         # Service Portal demo app
├── landing/            # Landing page / cockpit (starts all apps together)
└── docs/               # Static GitHub Pages version (demo data only)
```

Each app follows the same layout:

```
<App>/
├── .env.example        # All available configuration options
├── src/server.js       # Node.js backend (API proxy + auth)
└── public/             # Frontend (plain HTML/CSS/JS, no build step)
```

---

## Explore the NFON APIs

- **NFON on GitHub** — [github.com/NFON-AG](https://github.com/NFON-AG) — API documentation, OpenAPI specs, and integration resources.
- **Get API access** — visit [nfon.com](https://www.nfon.com/en/integrations/api/) for information on available APIs and how to request credentials.
- **Learn with AI** — open any `src/server.js` or `public/app.js` in an AI-assisted editor and ask it to walk you through a specific flow.

---

## Terms of Use
By accessing and using the NFON APIs, you agree to the [terms of use](https://www.nfon.com/en/legal/gtc-sla/).

---

## Disclaimer

- **Not production code.** This showcase illustrates API capabilities — it is not designed to be deployed as a service. There is no formal support.
- **Keep your secrets local.** Never commit `.env` files or expose the local servers to the internet. Each app's `.gitignore` excludes credential files, but you are responsible for what you push.
- **AI-assisted development.** This codebase was built with AI assistance. It has been reviewed for correctness and security in the context of a local demo.
