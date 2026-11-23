# NFON CTI API — Demo App

A local demo that shows what you can build with the [NFON CTI API](https://github.com/NFON-AG/CTI-API). It connects to the real-time telephony event streams and renders a live dashboard with extension states, active calls, and Click-to-Dial.

## What it demonstrates

- Live extension presence and line states via CTI event streams.
- Active call monitoring with real-time updates.
- Click-to-Dial: initiate calls from the dashboard.
- Local call history with analytics view and CSV/XLS export.
- Optional Google Contacts lookup for caller identification.
- Header Demo switch for a complete view with synthetic data; live views never mix in demo calls.
- Twelve interface languages, with English on first visit and a saved language choice thereafter.

## Appearance and language

The switch above the header selects **Classic Design** or **Modern Design**.
Modern is the default. Overview, Analytics and Setup keep the selected design,
language and Demo mode when navigating between them. The sidebar can be collapsed.
Interface text, field examples, placeholders and export labels are translated;
names, real call data and edited values retain their original content.

## Run locally

```sh
cp .env.example .env
# Fill in your CTI credentials (see below)
npm start
```

The app listens on `http://localhost:3002`.

## Configuration

Copy `.env.example` to `.env`. Required credentials:

| Variable | Description |
|---|---|
| `NFON_K_ACCOUNT` | Your K-Account identifier |
| `NFON_API_USERNAME` | CTI API username |
| `NFON_API_PASSWORD` | CTI API password |

The account must have CTI enabled. See `.env.example` for optional settings like Google Contacts integration.

Without credentials the app still starts and shows the UI structure, but live telephony features require a configured CTI account.

The **Demo** switch in the header reloads the page with `demo=1` and serves CTI requests from the browser's synthetic demo adapter. Overview, Analytics and Setup preserve this selection, language, appearance and the Cockpit link. Switching it off reloads the live view. Demo actions do not place real calls or change the server's account, credentials or saved history. The downloaded static app remains a demo and has no switch to live data.

## Optional: Google Contacts

The app can look up caller names from Google Contacts. To enable this, add the Google OAuth credentials (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) to `.env` and authorize the app through **Setup → Contacts**. This is optional and not required for the core CTI functionality.

## API reference

The official CTI API documentation and integration resources are available at:
[github.com/NFON-AG/CTI-API](https://github.com/NFON-AG/CTI-API)

## Reliability and data boundaries

The event streams reconnect after outages and start after browser sign-in. Changing accounts cancels the old streams and clears their displayed state. Failed authentication retries use backoff. National numbers are not guessed: external Click-to-Dial targets require `+` or `00` and a country code.

History retains all valid local events, ordered by event time, and backup restore merges rather than replaces them. Invalid JSONL lines are skipped and counted in storage status. CSV dates use ISO 8601 UTC; Excel exports mark values as text. History is local to this app, not a complete upstream call-history archive. Calls whose stream state was lost are removed from the active list until a new event arrives.

Before another history append, a valid final event without a line break receives its missing separator. An incomplete invalid final fragment is removed. After a failed append, retries compare against the events actually committed to disk. A record is deduplicated only when its stored event identity matches, including the provider timestamp or, when absent, the local receive timestamp.

A newly received event without a provider timestamp gets a new receive timestamp, so an identical delivery can remain a separate history event. Events sharing a call UUID still count as one call, but a later repeated end event can extend its calculated duration. The available provider documentation does not establish an event identity or replay contract sufficient to decide whether such deliveries are duplicates. This is a documented boundary, not evidence that NFON sends these repetitions; heuristic deduplication is deferred until that identity is clarified.

Google OAuth states expire after ten minutes and can be consumed once. Contact photos accept only PNG, JPEG and WebP with matching file signatures. Photo requests never forward OAuth tokens. Local contact lookup uses exact normalized numbers; short extensions cannot match an external number suffix.

Bootstrap REST requests retry independently until extension and line snapshots load. Browser event streams close on page departure and reopen on back/forward restoration. Rejected resource tokens (401) use authentication backoff. A successful login alone does not clear that backoff. Permission failures (403) remain scoped to the requested operation and do not invalidate a working token.

Invalid event timestamps fall back to a valid receive timestamp. Records without either remain in history and export with an empty date; dates are never fabricated. The table starts with 80 calls, shows the displayed/total count and offers **Show more**. Exports include the entire history.

For national contact-number matching, set both `NFON_PHONE_COUNTRY_CODE` and `NFON_PHONE_NATIONAL_PREFIX` explicitly (for example `49` and `0`; Italy: `39` and an explicitly empty prefix). Without that context, national and international identities remain distinct. The interface language never determines a country. External Click-to-Dial accepts formatted international +/00 numbers and rejects suffixes such as “ext 5”.

**Cancel** sends a DELETE request to the upstream API for the selected active call. The provider documents cancellation of a call being established; the button is not a local history deletion or a guaranteed hang-up of established incoming calls.

Google disconnect always removes local tokens and cached Google contacts. If provider revocation is unavailable, the UI reports that permission could not be revoked; local contacts are preserved. Contact changes invalidate lookup caches in open tabs.

Remote access requires the shared `NFON_ALLOW_REMOTE=true` gate, explicit `NFON_ALLOWED_HOSTS`, an allowed `CTI_ALLOWED_ORIGIN`, and the applicable `CTI_ALLOW_REMOTE_READ` / `CTI_ALLOW_REMOTE_CONTROL` flag. Boolean settings accept only true/false, 1/0, yes/no or on/off; malformed app settings stop startup, while malformed shared boundary flags reject requests with 503. Duplicate keys in an env file stop startup.
