# NFON Call History API — Demo App

A local demo that shows what you can build with the [NFON Call History API](https://github.com/NFON-AG/Call-History-API). It authenticates via OAuth (Login with NFON) and displays call records, filters, transcripts, and a fixed transcript-to-CRM showcase.

## What it demonstrates

- OAuth 2.0 (PKCE) login flow against the NFON identity provider.
- Call history browsing with filters for date range, direction, transcript availability, phone number and queue.
- Transcript preview and detail loading.
- Metrics overview: total calls, missed calls, average duration, transcript count.
- Fixed CRM demo: automatic phone-number matching, CRM call activities, calendar/reminder examples, transcripts, summaries and synthetic charts.
- The CRM demo uses its own fixed examples and never evaluates call-history data, including in the downloaded version.
- Explicit demo mode with synthetic sample data for call history and transcripts.
- Twelve interface languages, with English on first visit and a saved language choice thereafter.

## Appearance and language

The switch above the header selects **Classic Design** or **Modern Design**;
Modern is the default. The selected appearance and language follow navigation
and the login return. The sidebar can be collapsed. Interface text, field
examples and prepared CRM conversations are translated; real records,
transcripts and edited values retain their original content.

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

The default API base URL is `https://start.cloudya.com/api/callhistory`.
An existing `CALLHISTORY_API_BASE_URL` override takes precedence and must be
updated separately if it still points to the retired development endpoint.

The fixed CRM demo works without credentials. The separate call-history and
transcript views support explicit Demo mode; incomplete API configuration also
returns clearly labelled sample data. Once live configuration is complete,
authentication and upstream failures remain errors and are never silently
replaced by demo results.

## How authentication works

The app uses the standard OAuth 2.0 Authorization Code flow with PKCE. When you click "Login with NFON", the browser is redirected to the NFON identity provider. After consent, the callback returns to `http://localhost:3000` where the server exchanges the code for tokens and stores tokens in a local file with restricted permissions. No credentials are ever exposed to the browser.

## API reference

The official Call History API documentation and OpenAPI spec are available at:
[github.com/NFON-AG/Call-History-API](https://github.com/NFON-AG/Call-History-API)

## Fixed CRM demo

The interface and prepared conversations support all twelve menu languages.
Language changes preserve playback and existing CRM entries, calendar events and
reminders. Actual API content remains in its original language.

`public/crm-demo/` is a standalone, dependency-free document embedded in the existing app shell. It receives only theme/language preferences and view visibility from the parent; no calls, tokens or customer records cross that boundary. Its examples, charts and copied CRM entries always use fixed synthetic data. Complete example transcripts include their prepared summaries. A simulated connector matches the external phone number against a fixed CRM directory and creates a read-only call activity. The appointment example shows a prepared calendar entry and invitation. Technical support covers a PDF export problem in inventory software and creates a reminder thirty minutes before the agreed callback deadline; sales creates an internal reminder for the next business day. These are outputs of separate CRM logic, not native Call History fields. Replay updates the same UUID instead of creating duplicates. The flow needs no manual entry or save step; previous browser drafts remain untouched.

The standard call list, API transcript retrieval and OAuth setup remain separate. The old generated billing, ticket and customer-account dashboard has been removed. `npm run sync:shared` at the repository root also generates the static Call History client and its CRM assets via `scripts/sync-history.mjs`. Edit the local source, not the generated files under `docs/call-history/`.

## Local configuration and session boundary

Configuration is loaded from `.env` in this app, an explicit `CallHistory_API_ENV_FILE`, or `env/CallHistory_API.env` in `NFON_SHOWCASE_CONFIG_DIR` (see the loader for precedence). There is no `CALLHISTORY_SECRET_FILE` setting. The server accepts loopback requests only; this showcase is not a multi-user service.

Logout clears the app's stored token and invalidates environment-token access for the running process. It does not revoke the token or close the NFON identity-provider browser session. A server restart can reload a manually configured environment token. Independent login tabs have short-lived, single-use PKCE states. Validated language, theme and local cockpit return-link preferences travel inside each server-side state and return to the local app after success or failure, including localhost/127.0.0.1 origin changes. Preferences are not sent to the identity provider; credentials never appear in this return query.

The call list pages through the selected period with `CALLHISTORY_LIMIT` records per request. `CALLHISTORY_MAX_RECORDS` bounds memory use and `CALLHISTORY_MAX_REQUESTS` bounds list-page requests (default 100, including authentication retries). Reaching either produces a visible partial-result warning. An empty page proves completion even if the provider caps page size; repeated pages and safety limits produce a partial result. Upstream requests time out after `CALLHISTORY_TIMEOUT_MS` milliseconds, and `CALLHISTORY_PAGING_BUDGET_MS` bounds the whole retrieval. Paging settings must be integers within the ranges in `.env.example`; invalid explicit values stop startup instead of silently using a default. If a later page times out or returns an unexpected status/body, including malformed record entries, already retrieved pages remain available with a partial-result warning. An unexpected 204/404 or empty body is never treated as proof of completion; the provider contract needs confirmation. A first-page failure remains an error, and authorization failures never retain a partial list. The browser permits the maximum 60-second paging budget plus five seconds for the response. Invalid dates are excluded with a data-quality notice that remains visible alongside partial-result warnings. Filters on the downloaded period do not refetch it; Refresh does.

## API contract boundaries

The schema observations below come from the official repository README,
`specs/openapi.yaml`, `specs/openapi-2.0-early-access.2.yaml` and
`BREAKING_CHANGES.md` captured on 17 October 2026. They describe the reviewed
contracts, rather than an assurance about every provider deployment.

- Both captured schemas describe `from`/`to` as numeric timestamps and `duration` as an integer without declaring units. This client retains the Unix-seconds/seconds convention. A successful request alone does not establish that convention for a different provider configuration.
- `complete` is documented for the list endpoint only. Detail requests use `GET /records/{uuid}` without the undocumented query parameter; the detail examples already include transcript and summary.
- Transcription is asynchronous. `available:false` is not an available transcript; a refreshed record can later become available. Summary and transcript fields are optional. `language_autodetect` is a boolean, not a language code. The UI never invents German or translates real transcript text.
- Licensing, activation, supported speech languages and a guarantee that every transcript has a summary are not specified in these API contracts. Prepared multilingual CRM conversations are illustrative fixtures, not proof of automatic translation or guaranteed extraction. Real integrations need missing-content handling and validation of extracted appointments/reminders.
- The current contract/README use `https://start.cloudya.com/api/callhistory`; EA.2 declares `https://api.nfon.com/call-history`. Keep the current default and use `CALLHISTORY_API_BASE_URL` only for a provider-confirmed target. EA.2 release timing remains a provider question; the captured README announces a future status-page notice, not a fixed date.
- Routing labels support both `destination_type` (EA.1) and `service` (EA.2). Only documented answered/missed/cancelled outcomes are counted; aliases such as abandoned/no_answer and unknown direction values remain unknown. Explicit queue/skill metadata on callee, routing hops or caller is supported; no queue is inferred from a generic user label. The client does not consume the removed history `reason`, moved `crm` or new `custom_data` fields, so no migration shim is needed for those fields.
- Speaker labels come from documented `caller`/`callee` source markers and the record's party names. This does not claim diarization of additional speakers during transfers.

The CRM page's persistent **Demo** badge labels every displayed result as part of the simulation. There are no external CRM writes, sent invitations or real reminders. Playback stops when the view is hidden. The fixed example calls take place on Friday, 9 October; Monday callbacks and next-business-day rules follow that date.

The static CRM export includes a self-contained `offline.html` (scripts, CSS and font) for an opaque sandbox under `file://`; it uses the same fixed examples and never reads local or live call history. SSO URLs/scopes, including `basic`, require the registered provider configuration. National phone strings are substring searches only, never an inferred contact identity or dialing country.
