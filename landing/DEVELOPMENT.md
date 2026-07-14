# Landing Cockpit — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. For agent/AI guidance, see `AGENTS.md`.

## Configuration details

The server loads `.env` automatically. No external API credentials are needed — the landing
page only routes to and manages the sibling apps.

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

Start/stop controls are disabled by default for standalone/release safety. Set
`LANDING_ENABLE_SERVICE_CONTROL=true` only for the local monorepo cockpit when the landing
page should start and stop sibling showcase servers. The stop action only targets server
processes started by the current cockpit session.

## Upstream editing

Each product card has an edit control in its top-right corner. It flips the card to a small
form where the upstream URL can be changed. The value is validated (http/https origin only),
saved locally to `~/.config/nfon-api-showcase/landing-upstreams.json` (owner-readable, never
committed), and becomes the single source for that service's health check, gateway redirect,
and server start. "Standard" resets the card to the environment or built-in default.

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
- **Red (offline):** status endpoint not reachable within 1.4s timeout.

No detailed business metrics are shown on the landing page; operational data stays inside
the individual apps.

## Design direction

Black header, NFON green accent, light workspace, white panels, status chips, concise API
cockpit layout. Do not turn the landing into a dark-card UI; the premium treatment comes
from spacing, panel quality, clear hierarchy, and live-status motion (mini-EKG heartbeat
in status chip).

## Port assignment

Keep `localhost:3000` assigned to Call History while the NFON Call History OAuth client is
registered for that origin. The landing cockpit uses `3010` by default.
