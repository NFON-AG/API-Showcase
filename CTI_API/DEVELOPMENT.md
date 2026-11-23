# CTI API — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. Repository maintenance conventions are in `AGENTS.md`.

## Configuration details

The server loads `.env` automatically and reads credentials from environment variables.
Tokens, real call events, and contact caches must not be committed.

Full configuration reference:

```env
HOST=127.0.0.1
PORT=3002
NFON_BASE_URL=https://providersupportdata.cloud-cfg.com/v1
CTI_ALLOWED_ORIGIN=http://localhost:3002
NFON_K_ACCOUNT=<k-account>
NFON_API_USERNAME=<api-user>
NFON_API_PASSWORD=...
NFON_SECRET_FILE=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CLIENT_SECRET_FILE=
GOOGLE_REDIRECT_URI=http://localhost:3002/auth/google/callback
NFON_ALLOW_REMOTE=false
NFON_ALLOWED_HOSTS=
NFON_PHONE_COUNTRY_CODE=
NFON_PHONE_NATIONAL_PREFIX=
CTI_ALLOW_REMOTE_CONTROL=false
CTI_ALLOW_REMOTE_READ=false
CTI_DATA_DIR=
```

## Local secrets

The recommended local config location is `~/.config/nfon-api-showcase`.
`NFON_SECRET_FILE` can point to a private file there, for example
`~/.config/nfon-api-showcase/secrets/CTI_API/secret.txt`. Repo-local secret
files should only be referenced intentionally through an environment variable
and must stay out of the repository.

## Google Contacts integration

Google Contacts is optional and only supports the contact module. It is not
required for the CTI core. OAuth tokens, synchronized contacts, and call history
are stored locally under `CTI_DATA_DIR`. Without `CTI_DATA_DIR`, the app uses
`~/.config/nfon-api-showcase/data/CTI_API` when that local config folder exists;
otherwise it falls back to `data/` inside the app folder.

The Google OAuth flow validates a local state value in the runtime data folder.
If the Google OAuth client has a fixed redirect URL, `GOOGLE_REDIRECT_URI` must
match that registered value exactly.

## Security & access control

Cross-origin access is not broadly open. For local gateway tests,
`CTI_ALLOWED_ORIGIN` can be set explicitly. Mutating control actions such as
Click-to-Dial, restore, and Google sync also require a CSRF token from the local
UI and are local by default. Remote access requires all applicable gates: the shared
`NFON_ALLOW_REMOTE=true`, explicit `NFON_ALLOWED_HOSTS`, an allowed
`CTI_ALLOWED_ORIGIN`, and `CTI_ALLOW_REMOTE_CONTROL=true` for mutations or
`CTI_ALLOW_REMOTE_READ=true` for private reads (including snapshots and events).
Malformed app flags stop startup; malformed shared boundary flags reject requests
with 503. Duplicate keys within an env file stop startup.

`NFON_PHONE_COUNTRY_CODE` and `NFON_PHONE_NATIONAL_PREFIX` define optional
national-to-international contact matching. For Italy, use country code `39`
and an empty prefix; for Germany, `49` and `0`. Dialing accepts an internal
extension of 1–6 digits or an explicit international number beginning with + or 00.

At most four browser EventSource connections remain open. Further tabs poll the
private `/api/snapshot` cache every three seconds and retry SSE after fifteen
seconds. Snapshot polling does not create additional provider requests. All
transports close on pagehide and reconnect after bfcache restoration.

Without real credentials, the server still starts for syntax and UI checks.
Live functions then return setup or credential guidance instead of performing
API calls.

## Demo mode and presentation

`public/demo-runtime.js` is generated from the shared static adapter. On the local
CTI pages it is inert until `demo=1` is present. The header Demo switch reloads
into or out of that isolated browser context; API requests and EventSource are
then served by synthetic data. Demo dialing, cancellation and contact edits do
not reach the local backend or alter persisted live history. Setup credentials
and backup restore stay read-only in this mode. Internal CTI links retain the
query selection. The static download remains permanently synthetic.

Shared appearance and language behavior comes from the repository's `shared/`
sources. English is the first-visit default; explicit language choices are stored
locally. All twelve menu languages cover templates, placeholders and feedback.
Run `npm run sync:shared` at the repository root after changes to shared assets or
catalogs; do not hand-edit generated copies.

## History persistence

History appends and restores share serialized persistence. Recovery distinguishes
valid final JSONL records without a newline from truncated invalid fragments, and
retry checks use records committed to disk. Restore merges records and preserves
events received while the import is in progress. Storage failures must remain
visible instead of reporting an unsuccessful write as persisted.

The stored event identity includes a provider timestamp or the local receive
timestamp when the provider omits one. It is not a provider replay identifier.
Do not deduplicate timestamp-free repeated deliveries by comparing their payload
alone: that could discard legitimate events. The documented event-identity limit
and its effect on calculated call duration are described in `README.md`.
