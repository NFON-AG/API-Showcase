# NFON CTI API — Demo App

A local demo that shows what you can build with the [NFON CTI API](https://github.com/NFON-AG/CTI-API). It connects to the real-time telephony event streams and renders a live dashboard with extension states, active calls, and Click-to-Dial.

## What it demonstrates

- Live extension presence and line states via CTI event streams.
- Active call monitoring with real-time updates.
- Click-to-Dial: initiate calls from the dashboard.
- Local call history with analytics view and CSV/XLS export.
- Optional Google Contacts lookup for caller identification.
- Demo mode when no live credentials are configured.
- Multi-language UI (header language selector).

## Run locally

```sh
cp .env.example .env
# Fill in your CTI credentials (see below)
npm start
```

The app listens on `http://localhost:3002`.

## Configuration

Copy `.env.example` to `.env`. Required credentials:

| Variable | Description |
|---|---|
| `NFON_K_ACCOUNT` | Your K-Account identifier |
| `NFON_API_USERNAME` | CTI API username |
| `NFON_API_PASSWORD` | CTI API password |

The account must have CTI enabled. See `.env.example` for optional settings like Google Contacts integration.

Without credentials the app still starts and shows the UI structure, but live telephony features require a configured CTI account.

## Optional: Google Contacts

The app can look up caller names from your Google Contacts. To enable this, add your Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) to `.env` and authorize the app through the Contacts section in the UI. This is entirely optional and not required for the core CTI functionality.

## API reference

The official CTI API documentation and integration resources are available at:
👉 [github.com/NFON-AG/CTI-API](https://github.com/NFON-AG/CTI-API)
