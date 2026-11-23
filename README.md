# NFON API Showcase

Interactive demos that show what you can build with the public NFON APIs — call history with transcripts, real-time telephony dashboards, and Admin Portal automation. Each app runs locally with your own NFON credentials in minutes.

---

## What is this?

A collection of working demo apps that showcase the integration possibilities of the NFON public APIs. The goal is to give you a hands-on feel for the use cases they can implement and the customizations available on top of the NFON platform.

The apps are demonstrations for local exploration and integration planning, not a production service or an API reference. The official API documentation is linked below.

### Demo apps

| App | API | What it demonstrates |
|---|---|---|
| **Call History API Demo** | [github.com/NFON-AG/Call-History-API](https://github.com/NFON-AG/Call-History-API) | Call history browsing, filters, transcript previews, fixed CRM automation showcase |
| **CTI API Demo** | [github.com/NFON-AG/CTI-API](https://github.com/NFON-AG/CTI-API) | Live extension states, active calls, Click-to-Dial, Google Contacts lookup |
| **Portal API Demo** | [github.com/NFON-AG/Service-Portal-API](https://github.com/NFON-AG/Service-Portal-API) | Tenant inventory, callflow editing and PDF download, one-click day/night setup, phonebook sync |

### What's new in v1.2

- Modern and Classic designs share a switch above the header. English is the first-visit default; explicit language choices are saved and carried between apps.
- The CTI header's Demo switch selects separate sample data for the dashboard and analytics without placing live calls or adding demo records to live history.
- Call History uses the stable API endpoint. Its fixed CRM showcase demonstrates automatic support tickets, calendar entries and sales reminders from prepared transcript examples; it does not evaluate real call-history data, including in the download.
- Portal day/night setup performs preparation and switching in one action. The callflow builder loads current routing, supports membership edits and shows targets in an orderly layout. Direct color PDF downloads include all targets, connections and the dotted background, even when targets are collapsed in the editor.

See the [changelog](CHANGELOG.md) for the complete release changes and the individual guides for [CTI](CTI_API/README.md), [Portal](Portal_API/README.md), [Call History](CallHistory_API/README.md) and the [Cockpit](landing/README.md).

---

## Get started

### Appearance and language

Version 1.2 defaults to **Modern Design**, based on the current Admin Portal.
Every page has the same compact switch in the grey strip above its header,
with **Classic Design** and **Modern Design** labels. Switching preserves forms,
filters and authentication; internal app links carry the selection across the
independent local ports. Cockpit is the visual reference: four text roles
(12/14/16/24px), regular content, 28px status capsules and matching 28px icon
circles inside 40px hit areas. Top-menu and sidebar controls retain their short
underlines. Cockpit itself has no sidebar.

All twelve selectable languages cover app templates, example text, field placeholders
and interactive workflows. First visits start in English; an explicit language choice
is saved in local browser storage and restored on subsequent visits. API records,
names and edited values remain unchanged. Classic Design uses Inter
with system fallbacks; Modern Design uses the supplied licensed Pangram Sans font.

Shared appearance assets and message catalogs are maintained under `shared/` and
the app folders. After changes, run `npm run sync:shared` at the repository root.
`npm test` checks that all standalone copies match their sources.

### 1. Explore the online demo

No setup required. The hosted demo runs entirely in the browser with realistic sample data — a good way to see what the apps look like before configuring credentials.

👉 **[https://nfon-ag.github.io/API-Showcase](https://nfon-ag.github.io/API-Showcase)**

### 2. Clone the repository

```sh
git clone https://github.com/NFON-AG/API-Showcase.git
cd API-Showcase
```

Requires [Node.js 20+](https://nodejs.org/en). There are no npm runtime dependencies and no `npm install` step. The Portal PDF exporter includes a pinned browser library and embedded font assets; their notices are in [THIRD_PARTY.md](Portal_API/public/pdf/THIRD_PARTY.md).

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

Or manage the apps through the landing page cockpit:

```sh
npm run start:landing       # http://localhost:3010
```

The landing page can start and stop the other apps automatically (`LANDING_ENABLE_SERVICE_CONTROL=true` is enabled by default in `.env.example`).

Start the individual apps from the Cockpit cards. On macOS,
`landing/start-cockpit.command` starts the Cockpit and, by default, the API apps.
CTI and Portal need credentials for live data. Call History shows labelled sample
data while its API configuration is incomplete. The web-only download provides
separate synthetic demos without contacting live services. The fixed CRM showcase
is available in Call History independently of live history.

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
- **Explore the implementation** — each app's README covers its setup and workflows; its `DEVELOPMENT.md` describes the client/server boundaries and tests.

---

## Terms of Use
By accessing and using the NFON APIs, you agree to the [terms of use](https://www.nfon.com/en/legal/gtc-sla/).

---

## Disclaimer

- **Not production code.** This showcase illustrates API capabilities — it is not designed to be deployed as a service. There is no formal support.
- **Keep your secrets local.** Never commit `.env` files or expose the local servers to the internet. Each app's `.gitignore` excludes credential files, but you are responsible for what you push.
- **Development:** AI-assisted.


### Local server boundary and generated browser assets

All four local servers validate the requested host and reject non-loopback clients
by default. A deliberately operated LAN installation needs both
`NFON_ALLOW_REMOTE=true` and its host name in `NFON_ALLOWED_HOSTS`; this is not a
replacement for authentication or a production reverse proxy. OAuth and Cockpit
process control remain local-only. `NFON_COCKPIT_URL` configures an optional home
link for separately started apps; Cockpit navigation supplies this value itself.

The Cockpit persists ownership of children it starts in the local configuration
directory (`landing-services.json`, owner-readable). Stopping a service requires
its private ownership token, including after a Cockpit restart. Independently
started services remain visible but cannot be stopped by the Cockpit. Child
startup diagnostics are stored under that directory's `logs/`.

After browser code or translation changes, `npm run sync:shared` copies shared
assets, regenerates Call History's static copy and versions JS/CSS references
from their content. `npm run check` rejects stale copies or stale asset URLs.
Versioned assets may be cached; HTML and API responses are not immutable.
