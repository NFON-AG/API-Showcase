# Call History API — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. Repository maintenance conventions are in `AGENTS.md`.

## Configuration details

The server loads the first existing environment file in this order: `CallHistory_API_ENV_FILE`, local `.env`, then `env/CallHistory_API.env` under `NFON_SHOWCASE_CONFIG_DIR`. Existing process environment values take precedence. Duplicate keys within the selected file are rejected rather than silently choosing one. No credential values are hardcoded.

Full configuration reference:

```env
CALLHISTORY_AUTH_URL=
CALLHISTORY_TOKEN_URL=
CALLHISTORY_CLIENT_ID=
CALLHISTORY_REDIRECT_URI=http://localhost:3000
CALLHISTORY_PUBLIC_BASE_URL=http://localhost:3000
CALLHISTORY_SCOPE=openid profile email basic
CALLHISTORY_ALLOWED_ORIGIN=http://localhost:3000
CALLHISTORY_API_BASE_URL=https://start.cloudya.com/api/callhistory
CALLHISTORY_CALLS_PATH=/records
CALLHISTORY_RECORD_DETAILS_PATH=/records/{uuid}
CALLHISTORY_LIMIT=100
CALLHISTORY_MAX_RECORDS=10000
CALLHISTORY_MAX_REQUESTS=100
CALLHISTORY_TIMEOUT_MS=15000
CALLHISTORY_PAGING_BUDGET_MS=30000
CallHistory_API_ENV_FILE=
CALLHISTORY_DATA_DIR=
DEMO_MODE=false
```

## API behavior

The official Call History API exposes records under `GET /records` and details under
`GET /records/{uuid}`. Transcription summaries are part of the record payload under
`transcription`. Details use `GET /records/{uuid}`; `complete` is documented only for the list. Date filters retain the Unix-seconds convention; the official specification does not declare the units. See the API contract review in README.md.

### Stable API endpoint

The default is `https://start.cloudya.com/api/callhistory`. Update any old
`CALLHISTORY_API_BASE_URL` overrides in process environments, local `.env`
files, explicit `CallHistory_API_ENV_FILE` files, and external showcase configuration.
An existing override takes precedence over the new server default. Restart the
server after updating configuration.

Keep `/records` and `/records/{uuid}` relative to the base URL. Absolute endpoint
overrides bypass the base URL and must be reviewed separately. OAuth URLs, scopes,
client registration, local redirect URI, and response parsing remain unchanged for
this stable endpoint. The development API schema migration is a separate change.

After switching, verify an authenticated call list and a record with transcript
details; demo mode does not verify upstream connectivity.

## Local secrets

For an explicit private environment file set `CallHistory_API_ENV_FILE`. Alternatively use `env/CallHistory_API.env` under `NFON_SHOWCASE_CONFIG_DIR`. `CALLHISTORY_SECRET_FILE` is not supported.

Public repos should document the mechanism, not local machine paths.

## OAuth / redirects

OAuth callbacks require the locally stored PKCE state created by `/auth/login`; callbacks
without matching state are rejected.

The Setup view can also set a session-only `Redirect URI` registered for the local OAuth client. A redirect on another origin does not grant that origin access to the API. Leave it empty for the local `http://localhost:3000` default. The value must exactly
match the redirect registered with the Login with NFON OAuth client.

Standalone development should use `CALLHISTORY_REDIRECT_URI=http://localhost:3000` when the
OAuth client is registered only for the localhost origin. The app accepts OAuth callbacks on
`/` when the provider returns `code` and `state`, and also keeps `/auth/call-history/callback`
as a configurable alias.

When multiple showcase apps need to run at the same time, keep Call History on
`localhost:3000` and run Portal/CTI on their own ports.
See also: [LOCAL_REDIRECT_STRATEGY.md](LOCAL_REDIRECT_STRATEGY.md).

## Safety

- Tokens are stored in the configured data directory and written with owner-only permissions. PKCE state is process-local, single-use and expires after ten minutes.
- Prefer OAuth login; direct access/refresh token env vars are only for short local
  debugging and should not be committed.
- Demo fixtures are synthetic.
- Raw provider responses are normalized before they reach the browser.
- Logs only print whether configuration was found, never credential values.
- Live API failures return an error response. Demo data is used only for explicit demo mode
  or incomplete local configuration, not as a silent fallback for failed live requests.

## Session and asynchronous actions

Token refresh is shared within one session generation. Token persistence and
logout are serialized; an older refresh cannot overwrite a newer login or
restore a token after logout. Browser list, detail and copy requests also carry
their session/selection generation. Changing session or filtering out a selected
call invalidates its pending copy action; a later response cannot copy or display
content for an obsolete selection. A still-selected call remains usable after a
filter change.

List paging reports incomplete results when a safety limit, repeated page or
later-page error interrupts retrieval. Authentication failures invalidate the
live session instead of presenting a partial list as authenticated. Empty or
malformed provider bodies must not be treated as proof that all records were
retrieved. See `README.md` for the configuration bounds and provider-contract
limits.

## Fixed CRM automation

`public/crm-demo/` owns synthetic conversations, charts and a separate CRM
directory. Selecting an example automatically plays record retrieval, contact
matching and activity creation, followed by the example's calendar entry or
reminder. Replay upserts by UUID; it does not create duplicate activities. There
are no manual customer forms, billing calculations or save/reset actions.

The CRM document receives only theme, language and visibility from the parent.
It never receives history data or credentials, and never writes to an external
CRM or calendar. Its `offline.html` packages scripts, styles and font for the
downloaded copy. Edit the canonical files under `public/crm-demo/`, then run
`npm run sync:shared` at the repository root to regenerate `docs/call-history/`.
The local and downloaded CRM demo must remain independent of the selected live
history, authentication state and call-list filters.
