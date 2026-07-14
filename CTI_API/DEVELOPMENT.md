# CTI API — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. For agent/AI guidance, see `AGENTS.md`.

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
UI and are limited to local requests unless `CTI_ALLOW_REMOTE_CONTROL` is
enabled intentionally. Private read routes for contacts, history, active calls,
events, and backups stay local unless `CTI_ALLOW_REMOTE_READ` is enabled
intentionally.

Without real credentials, the server still starts for syntax and UI checks.
Live functions then return setup or credential guidance instead of performing
API calls.
