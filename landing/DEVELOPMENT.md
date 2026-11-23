# Landing Cockpit — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. Maintainer conventions are in `AGENTS.md`.

## Configuration details

The server loads the first available environment file from `LANDING_ENV_FILE`,
the app's `.env`, or `env/landing.env` under the local configuration directory.
`NFON_SHOWCASE_CONFIG_DIR` overrides that directory; its default is
`~/.config/nfon-api-showcase`. Existing process environment values take precedence.
No external API credentials are needed by the cockpit itself.

Full configuration reference:

```env
PORT=3010
LANDING_HOST=127.0.0.1
LANDING_ALLOWED_ORIGIN=http://localhost:3010
LANDING_ENABLE_SERVICE_CONTROL=true
CTI_UPSTREAM=http://127.0.0.1:3002
PORTAL_UPSTREAM=http://127.0.0.1:3001
CORE_HISTORY_UPSTREAM=http://127.0.0.1:3000
```

Legacy `CALL_HISTORY_UPSTREAM` is still accepted as an alias for `CORE_HISTORY_UPSTREAM`.

## Service control

The runtime default for `LANDING_ENABLE_SERVICE_CONTROL` is false. The supplied
`.env.example` and macOS launcher enable it for the local monorepo cockpit.
Control is limited to local sibling services.

Ownership is persisted atomically in `landing-services.json` in the local
configuration directory. Stopping a service requires its private token and
process identity to be verified, including after a cockpit restart. A PID alone
is not sufficient. Independently started servers remain visible but are not
stoppable from the cockpit. If an upstream address changes while an owned process
is still running, **Stop previous server** targets its verified original address.

The normal **Start server** action discards a stale ownership record only when
there is no current child handle or verified owner and both the old and new
addresses are free. There is no separate stale-entry clearing action. Startup
diagnostics are stored in owner-readable `logs/<service-id>.log` files in the
same configuration directory; the UI receives a short error category, not raw logs.

## Upstream editing

Each product card has an edit control in its top-right corner. It flips the card to a small
form where the upstream URL can be changed. The value is validated (http/https origin only),
saved locally to `~/.config/nfon-api-showcase/landing-upstreams.json` (owner-readable, never
committed), and becomes the single source for that service's health check, gateway redirect,
and server start only after the atomic save succeeds. The reset control restores
the environment or built-in default.

Precedence: local override > environment variable > built-in default.

Editing and the start/stop controls are protected by a same-origin CSRF token served from
`/api/status`.

## Gateway routing

Default local upstreams for the side-by-side showcase:

- `/cti/` → `http://127.0.0.1:3002`
- `/portal/` → `http://127.0.0.1:3001`
- `/call-history/` → `http://127.0.0.1:3000`
- `/core-history/` → legacy alias, same as `/call-history/`
- `/combined/` → local landing cockpit

## Health classification

Live health checks use each app's `/api/status` endpoint:
- **Green (online):** status endpoint responds OK and app-specific conditions are met
  (e.g., CTI streams connected, Portal cache healthy, Call History authenticated).
- **Yellow (warning):** status endpoint reachable but with incomplete state.
- **Red (offline):** no usable endpoint response within the 1.4-second total deadline.
- **Sign-in required:** the app is reachable but credentials are absent or rejected.

Each response is limited to 256 KiB and must be JSON from the expected app.
Redirects, wrong app identities, oversized bodies and incomplete responses do not
establish readiness. Portal readiness reflects completed reads of its core API
areas; unavailable optional areas are kept distinct from a general outage.

No detailed business metrics are shown on the landing page; operational data stays inside
the individual apps.

## Design direction

Modern Design is the default and uses the shared Admin Portal appearance; Classic
retains the black header and green accent. The compact appearance switch stays
above the header. The cockpit has no sidebar: its cards are the app navigation.
Keep card heights, content spacing and the proportions of status capsules and
action controls consistent. Forms and selected language must survive a theme change.

Shared appearance and language sources are synchronized from the repository root
with `npm run sync:shared`. `npm run check` verifies those copies and their
content-versioned browser asset URLs. HTML requires revalidation and API responses
use `no-store`; content-versioned JS/CSS may be cached as immutable.

## Port assignment

Keep `localhost:3000` assigned to Call History while the NFON Call History OAuth client is
registered for that origin. The landing cockpit uses `3010` by default.
