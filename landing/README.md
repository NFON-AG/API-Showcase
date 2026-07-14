# NFON API Showcase — Landing Page

The landing page is a local cockpit that gives you a single entry point to all three NFON API demo apps. It shows their status at a glance and can start/stop them for you.

## What it provides

- A single local URL (`http://localhost:3010`) to access all demos.
- Status overview showing which apps are running (green), reachable with warnings (yellow), or offline (red).
- Gateway routing: `/cti/`, `/portal/`, and `/call-history/` redirect to the individual apps.
- Optional service control to start and stop the demo apps directly from the landing page.

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
