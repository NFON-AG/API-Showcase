# NFON API Showcase — Landing Page

The landing page is a local cockpit that gives you a single entry point to all three NFON API demo apps. It shows their status at a glance and can start/stop them for you.

## What it provides

- A single local URL (`http://localhost:3010`) to access all demos.
- Status overview showing which apps are running (green), reachable with warnings (yellow), or offline (red).
- A separate sign-in state when an app is running but has no accepted credentials.
- Gateway routing: `/cti/`, `/portal/`, and `/call-history/` redirect to the individual apps.
- Optional service control to start and stop the demo apps directly from the landing page.
- A shared Modern/Classic switch above the header and twelve interface languages.
  First visits use English; explicit language and appearance choices are remembered
  and carried into the individual apps.

## Run locally

```sh
cp .env.example .env
npm start
```

The landing page listens on `http://localhost:3010`. Open `http://localhost:3010/combined/` for the full cockpit view.

## Configuration

Copy `.env.example` to `.env`. No credentials are needed — the landing page only routes to the other apps.

| Variable | Description |
|---|---|
| `LANDING_ENABLE_SERVICE_CONTROL` | Set to `true` to allow starting/stopping the other apps from the cockpit UI (enabled by default in `.env.example`) |
| `CTI_UPSTREAM` | Override where the CTI app is reachable (default: `http://127.0.0.1:3002`) |
| `PORTAL_UPSTREAM` | Override where the Portal app is reachable (default: `http://127.0.0.1:3001`) |
| `CORE_HISTORY_UPSTREAM` | Override where the Call History app is reachable (default: `http://127.0.0.1:3000`) |

## macOS quick start

On macOS you can double-click `start-cockpit.command` to launch the cockpit and all three demo apps in one step.
Set `LANDING_AUTOSTART_APIS=false` to start only the cockpit. Each API still needs
its own configuration before it can connect to NFON.

Services started by the cockpit remain manageable after a cockpit restart through
their saved private ownership record. Independently started servers can be opened
from the cards, but the cockpit does not stop them.

### Recovering a stale service record

The cockpit only stops a service after its private ownership endpoint confirms the saved token and process identity. A reused PID is never sufficient proof. **Start server** automatically replaces an obsolete local association when no child handle is held and both the previous and configured addresses are free. No process is stopped or signaled during this recovery. An occupied or unverifiable address remains untouched. If the upstream was changed while an owned server remained running, **Stop previous server** stops that verified server at its original address.

Health checks use a total deadline and a 256 KiB response limit. Wrong services, non-JSON, oversized and unfinished responses are not described as available apps. A later valid status clears an earlier startup error. Missing or rejected credentials are shown as a neutral sign-in state.

## Browser-only version

The copy under `docs/` uses fixed demo data. Its pause/resume controls affect only
the browser simulation; they do not start or stop Node.js processes. Edited preview
links do not take card navigation outside the static demo.
