# Automatic CRM showcase

This dependency-free frontend is embedded in the Call History app. It simulates
an integration using only fixed synthetic records and a separate example CRM
contact directory. It never reads live history, tokens, contacts or external CRM
state. The HTTP version loads its own static assets; playback makes no API or external data requests. The offline document embeds its scripts, styles and font.

Selecting a conversation automatically runs the sequence: completed call,
transcript/summary retrieval, contact lookup by phone number, CRM call activity.
The resulting read-only activity contains the existing API summary and complete
transcript. The appointment case creates a calendar entry with a prepared invitation; support creates the agreed callback reminder, and sales creates an internal follow-up reminder. Replay updates the same activity and
follow-up by call UUID; it cannot create duplicates. There are no editable
drafts, required form fields or save/reset steps.

The support example concerns a PDF export problem in inventory software. The
sales example records an offer and demo follow-up; the appointment example
records an agreed setup session. All displayed records and charts remain fixed
examples, including in the downloaded copy.

The calendar entry reflects the explicitly agreed online session on 13 October
2026, 10:00–10:30 Europe/Berlin, with Lea Sommer and Lena Bergmann. Sales has no
agreed delivery deadline: its reminder follows a separate CRM rule, the next
business day at 09:00 Europe/Berlin (12 October in this fixed example), to follow
up the proposal and demo suggestion. Both outputs keep references to their
supporting conversation turns. Support promises a callback by 15:00 on Monday, 12 October, even if the cause is still unknown. The CRM reminder is scheduled for 14:30, thirty minutes before that deadline. The example call is on Friday, 9 October. No calendar invitation or notification is sent.

## API and integration boundary

The real Call History API supplies records and available transcriptions via
`GET /records?complete=true` or `GET /records/{uuid}`. A production connector
must handle authentication, transcription readiness and missing optional data.
Polling must revisit pending UUIDs/overlapping windows; the documented SSE feed
also delivers updated records. The demo's short sequence is playback, not a
claim about transcription processing time.

The CRM integration, not the NFON API, looks up a contact using the external
`caller.number` for inbound calls or `callee.number` for outbound calls, with
`context:global`. It writes a CRM activity via the destination CRM's own API.
The fixed directory has one matching contact per example. No/ambiguous matches
require handling by the real connector. Summary and transcript are copied without
rewriting or additional extraction. The example cohort includes
completed summaries; absent summaries must never be fabricated.

Calendar/reminder fields are prepared outputs of the consuming CRM workflow,
kept outside the API-shaped call record. This fixed showcase does not run a
general-purpose date/task extractor. A production integration needs its own
transcript analysis, date/time validation, CRM rules and destination APIs for
these actions; Call History itself does not create them. The simulation only
shows the resulting local entries.

Sources: https://nfon-ag.github.io/Call-History-API/ and
https://github.com/NFON-AG/Call-History-API/blob/main/specs/openapi.yaml .

## Implementation

- `scenarios.js` contains the fixed conversation metadata; `locales/` supplies
  complete UI texts, conversations and summaries for all twelve menu languages.
- `demo-records.js` builds the fixed chart cohort and API-shaped records.
- `automation.js` maps records to the synthetic CRM directory and upserts an
  immutable in-memory activity and scenario-specific follow-up by UUID. It
  accepts only existing fixed fixtures.
- `app.js` renders the playback and cancels pending stages when views change.
- `analytics.js` retains the fixed totals independently from playback.

The old `nfon-callhistory-crm-demo-v1` browser-storage key is left untouched.
The automatic simulation does not read, overwrite or delete previous drafts.
Reloading begins a new in-memory playback session. Locale changes translate only
prepared fixtures; they do not create extra activities.

The parent sends only theme, language and view visibility (`active`). The frame reports readiness and intrinsic height. Its sandbox permits `allow-scripts`, `allow-popups` and `allow-popups-to-escape-sandbox` so the documentation can open in a separate noopener tab. It has no same-origin or clipboard permission. PostMessage uses wildcard delivery for the opaque sandbox/file origin, and both sides validate the sending window and the expected parent/self/opaque origin before processing messages. No API data or credentials cross the bridge. Parent view changes and cockpit pause stop playback; resuming continues the same in-memory example. Modern/Classic and all twelve languages share the same flow. The shell owns navigation
and appearance controls.

Edit this source folder. `scripts/sync-history.mjs` generates the static/download
copy under `docs/call-history/`, including its relative shared-font path. The
historical standalone prototype remains outside this integration checkout.

Static HTTP hosts must allow cross-origin reads of the public `.woff2` font
(`Access-Control-Allow-Origin: *`) because the CRM sandbox has an opaque origin.
Without that header, the browser uses the fallback font. The local Node server
provides the header; the offline document embeds the font and needs no font request.
Do not relax the iframe sandbox or API-origin checks to accommodate a static host.
