# NFON Service Portal API — Demo App

A local demo that shows what you can build with the [NFON Service Portal API](https://github.com/NFON-AG/Service-Portal-API). It connects to the Portal API using HMAC-signed requests and provides a read-only dashboard for tenant management, plus optional write operations for provisioning workflows.

## What it demonstrates

- Live connection to the NFON Service Portal API with HMAC-SHA1 authentication.
- Read-only inventory dashboard: extensions, devices, trunks, DIDs, phonebooks, groups, voice dialogs, and time controls.
- Graphical callflow builder prototype using live inventory data.
- Phonebook sync from a local contacts source to Portal API phonebooks.
- Batch extension creation with dry-run planning.
- Day/night time-control workflow for routing DIDs.
- Multi-language UI (header language selector).

## Run locally

```sh
cp .env.example .env
# Fill in your Portal API credentials (see below)
npm start
```

The app listens on `http://localhost:3001`.

## Configuration

Copy `.env.example` to `.env`. Required credentials:

| Variable | Description |
|---|---|
| `PORTAL_API_KEY_ID` | Your Portal API key ID |
| `PORTAL_API_KEY_SECRET` | Your Portal API key secret |
| `PORTAL_CUSTOMER_ACCOUNT` | The customer account (K-Account) to manage |

See `.env.example` for the full list of available options.

## Write protection

By default the app operates in **read-only mode**. No changes are made to your NFON account. To enable write operations (creating extensions, syncing phonebooks, managing time controls), set `PORTAL_ENABLE_LIVE_WRITES=true` in your `.env`. Write operations always show a dry-run preview before executing.

## API reference

The official Service Portal API documentation and OpenAPI spec are available at:
👉 [github.com/NFON-AG/Service-Portal-API](https://github.com/NFON-AG/Service-Portal-API)
