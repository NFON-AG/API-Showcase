# NFON Call History API — Demo App

A local demo that shows what you can build with the [NFON Call History API](https://github.com/NFON-AG/Call-History-API). It authenticates via OAuth (Login with NFON) and displays call records, filters, transcripts, and CRM ticket automation ideas.

## What it demonstrates

- OAuth 2.0 (PKCE) login flow against the NFON identity provider.
- Call history browsing with filters for date range, direction, outcome, and participant.
- Transcript preview and detail loading.
- Metrics overview: total calls, missed calls, average duration, transcript count.
- Dry-run CRM ticket assignment from call/transcript context.
- Demo mode with synthetic sample data when no credentials are configured.
- Multi-language UI (header language selector).

## Run locally

```sh
cp .env.example .env
# Fill in CALLHISTORY_CLIENT_ID (see below)
npm start
```

The app listens on `http://localhost:3000`.

## Configuration

Copy `.env.example` to `.env`. The only required credential is:

| Variable | Description |
|---|---|
| `CALLHISTORY_CLIENT_ID` | Your OAuth client ID, registered with redirect URI `http://localhost:3000` |

All other settings have sensible defaults. See `.env.example` for the full list of available options.

Without credentials the app starts in demo mode automatically and serves realistic sample data so you can explore the UI.

## How authentication works

The app uses the standard OAuth 2.0 Authorization Code flow with PKCE. When you click "Login with NFON", the browser is redirected to the NFON identity provider. After consent, the callback returns to `http://localhost:3000` where the server exchanges the code for tokens and stores them locally. No credentials are ever exposed to the browser.

## API reference

The official Call History API documentation and OpenAPI spec are available at:
👉 [github.com/NFON-AG/Call-History-API](https://github.com/NFON-AG/Call-History-API)
