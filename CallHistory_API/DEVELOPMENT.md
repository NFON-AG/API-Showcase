# Call History API — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. For agent/AI guidance, see `AGENTS.md`.

## Configuration details

The server loads `.env` automatically. Credentials are read from environment variables first,
then from an explicit local secret file. No credential values are hardcoded.

Full configuration reference:

```env
CALLHISTORY_AUTH_URL=
CALLHISTORY_TOKEN_URL=
CALLHISTORY_CLIENT_ID=
CALLHISTORY_REDIRECT_URI=http://localhost:3000
CALLHISTORY_PUBLIC_BASE_URL=http://localhost:3000
CALLHISTORY_SCOPE=openid profile email basic
CALLHISTORY_ALLOWED_ORIGIN=http://localhost:3000
CALLHISTORY_API_BASE_URL=https://api.nfon.com/call-history
CALLHISTORY_CALLS_PATH=/records
CALLHISTORY_RECORD_DETAILS_PATH=/records/{uuid}
CALLHISTORY_LIMIT=50
CALLHISTORY_SECRET_FILE=
CALLHISTORY_DATA_DIR=
DEMO_MODE=false
```

## API behavior

The official Call History API exposes records under `GET /records` and details under
`GET /records/{uuid}`. Transcription summaries are part of the record payload under
`transcription`; complete transcript details are requested with `complete=true`. Date
filters are sent as Unix seconds in `from` and `to`.

## Local secrets

For local convenience set `CALLHISTORY_SECRET_FILE` to a private local credential file
outside the project directory, for example under
`~/.config/nfon-api-showcase/secrets/CallHistory_API/`.

Public repos should document the mechanism, not local machine paths.

## OAuth / redirects

OAuth callbacks require the locally stored PKCE state created by `/auth/login`; callbacks
without matching state are rejected.

The Setup view can also set a session-only `Redirect URI` for hosted or online callback
tests. Leave it empty for the local `http://localhost:3000` default. The value must exactly
match the redirect registered with the Login with NFON OAuth client.

Standalone development should use `CALLHISTORY_REDIRECT_URI=http://localhost:3000` when the
OAuth client is registered only for the localhost origin. The app accepts OAuth callbacks on
`/` when the provider returns `code` and `state`, and also keeps `/auth/call-history/callback`
as a configurable alias.

When multiple showcase apps need to run at the same time, keep Call History on
`localhost:3000` and run Portal/CTI on their own ports.
See also: [LOCAL_REDIRECT_STRATEGY.md](LOCAL_REDIRECT_STRATEGY.md).

## Safety

- Tokens are stored under `data/` and ignored by Git.
- Token and OAuth state files are written with owner-only permissions, and existing runtime
  files are repaired on server start when possible.
- Prefer OAuth login; direct access/refresh token env vars are only for short local
  debugging and should not be committed.
- Demo fixtures are synthetic.
- Raw provider responses are normalized before they reach the browser.
- Logs only print whether configuration was found, never credential values.
- Live API failures return an error response. Demo data is used only for explicit demo mode
  or incomplete local configuration, not as a silent fallback for failed live requests.
