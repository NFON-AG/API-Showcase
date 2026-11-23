# NFON Service Portal API — Demo App

A local demo that shows what you can build with the [NFON Service Portal API](https://github.com/NFON-AG/Service-Portal-API). It connects to the Portal API using HMAC-signed requests and provides a read-only dashboard for tenant management, plus optional write operations for provisioning workflows.

## What it demonstrates

- Live connection to the NFON Service Portal API with HMAC-SHA1 authentication.
- Read-only inventory dashboard: extensions, devices, trunks, DIDs, phonebooks, groups, voice dialogs, and time controls.
- Graphical callflow builder using live inventory: direct destinations, queues,
  skill groups, voice dialogs, announcements and time controls.
- Queue and skill-group membership changes saved in Services or through the callflow's Apply action.
- Direct PDF download with the selected design's colors, dotted canvas, arrows,
  complete target cards and routing details.
- Phonebook sync from a local contacts source to Portal API phonebooks.
- Batch extension creation with dry-run planning.
- One-step night-mode setup and activation, with restoration of the original day routing.
- Modern/Classic design switch and twelve interface languages. First visits use
  English; an explicit language choice is remembered locally.

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

The app starts in **read-only mode after every server start or restart**.
`PORTAL_ENABLE_LIVE_WRITES=true` permits writes but does not activate them by itself.
The current session can be enabled in Setup. Explicit Create, Apply and Delete
actions can also enable the permitted session as part of that operation, without
a separate trip to Setup. This covers resources, service memberships, batch
extensions, routing profiles, phonebook changes and night-mode setup.
`PORTAL_DISABLE_LIVE_WRITES=true` always enforces read-only mode. Account changes
and browser login turn session writes off.

Services, callflow, batch, profile and deletion keep their existing single app
confirmation. Cancel keeps the session unchanged. Create and phonebook Apply run
directly from their explicit action. Maintenance and saved-draft review also use
app dialogs.

## Callflow designer and PDF

Opening a callflow loads the current routing. A saved draft is restored when it
still matches that routing; an older conflicting draft remains available through
**Restore previous draft**. The designer supports editing, connections, Undo,
local drafts and target expansion. Targets use consistent spacing and, where space
allows, symmetric columns around their service. Manually positioned targets keep
their positions. The toolbar stays above the canvas.

**Download PDF** saves a file directly without opening a print dialog. It includes
all queue, skill-group and group targets even when they are collapsed in the
designer. The export preserves colors, target names and numbers, the dotted
background and connection arrows, with additional routing details as needed.
It leaves the current draft, expanded targets, scroll position and zoom unchanged.
PDF generation runs locally in the browser.

## Day and night routing

Choose a night target and select **Set up and activate night mode**. The action saves
the day profile if needed, creates a selected announcement target when required,
checks and prepares the time controls, then activates night routing. Matching time
controls are reused. A failed step or a changed account or target stops subsequent
steps. **Activate day mode** restores the saved original destinations, including
numbers that previously had no destination. It can enable the permitted session
within that action even if session writes were turned off during night mode.
Individual preparation and cleanup
actions remain under **Details and maintenance**.

## API availability

The dashboard distinguishes core inventory readiness from optional API areas.
For example, an unavailable feature-status or voicemail endpoint remains visible
without turning a successful core connection into a connection failure. A write
that depends on unavailable or incomplete inventory stays blocked. Live API errors
are never replaced with sample data. The separate browser-only demo uses synthetic
data and cannot change an NFON account.

## API reference

The official Service Portal API documentation and OpenAPI spec are available at:
[github.com/NFON-AG/Service-Portal-API](https://github.com/NFON-AG/Service-Portal-API)
