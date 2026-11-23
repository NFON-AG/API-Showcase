# Portal API — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. Maintenance conventions are in `AGENTS.md`.

## Configuration details

The server loads `.env` automatically and reads credentials from environment variables first.

Core configuration example; `.env.example` lists the available options:

```env
HOST=127.0.0.1
PORT=3001
PORTAL_ALLOWED_ORIGIN=http://localhost:3001
PORTAL_BASE_URL=https://portal-api.nfon.net:8090
PORTAL_API_KEY_ID=
PORTAL_API_KEY_SECRET=
PORTAL_CUSTOMER_ACCOUNT=
PORTAL_SECRET_FILE=
NFON_SECRET_FILE=
PORTAL_GOOGLE_CONTACTS_FILE=
PORTAL_DATA_DIR=
PORTAL_ENABLE_LIVE_WRITES=false
PORTAL_DISABLE_LIVE_WRITES=false
```

## Local secrets

Recommended local credential files live outside the repository under
`~/.config/nfon-api-showcase`, for example
`~/.config/nfon-api-showcase/secrets/Portal_API/portal-api-secret.txt`, and can be
referenced with `PORTAL_SECRET_FILE`. Repo-local secret files should only be used as
an explicit ignored standalone fallback.

Phonebook sync checks read the local contact source from `data/google-contacts.json`
by default for legacy compatibility or the explicit `PORTAL_GOOGLE_CONTACTS_FILE` path.

## Customer account switching

If the API credentials can see multiple NFON customer accounts, `Setup` shows a
customer-account switcher loaded from `GET /api/customers/`. If that list is blocked,
a K-account can be entered manually and validated through
`/api/customers/<customer>/basic-data`. Switching the active customer changes the
`/api/customers/<customer>/...` path for all reads and writes, clears the local API
cache, reloads inventory, and disables live writes for the new account until they are
explicitly re-enabled through Setup or a supported confirmed operation. The header
displays the currently active account and last check time.

## Live write protection

Every server start initializes session writes to off. `PORTAL_ENABLE_LIVE_WRITES=true`
permits an explicit session opt-in through Setup, the callflow Apply confirmation,
or **Set up and activate night mode**. The latter two operations enable the permitted
session as part of their existing action; they do not require a separate Setup step.
None of these controls can override a missing environment opt-in.
`PORTAL_DISABLE_LIVE_WRITES=true` remains a hard read-only override. Browser requests to
mutating routes require the local CSRF token and an allowed origin.
They also require `X-Portal-Context`, the opaque `settings.writeContext` returned
with the displayed overview. Every account/login change and server restart invalidates
that context, including A → B → A transitions. Only explicit account switching and
browser login are exempt. A stale or missing context returns 409 before any mutation;
fetching a fresh CSRF token does not refresh the prepared write context.

Callflow drafts retain a revision of their original routing content. Refreshing unchanged
provider data preserves the draft. When the routing has changed, opening the designer
shows the current provider flow and retains the previous local work separately through
**Restore previous draft**. Restoring it is an explicit edit against the current flow;
the server still validates the write context and fresh provider state before applying.
**Delete local draft** removes the saved draft and loads the current routing.

The normal callflow Apply also saves pending Queue/Skill membership changes. The client
records fresh member revisions after successful writes, so a failed later routing step
can be retried without blindly repeating completed member operations. Partial membership
failures retain completed, failed and unattempted results. Newly created resources use
their provider-returned identity for immediate target selection and member changes.

The focused closure regression runs are `node --test test/closure-*.test.js` and
`npm run test:closure:browser` (requires `PLAYWRIGHT_MODULE_PATH`, optionally
`BROWSER_EXECUTABLE_PATH`). Browser cases use isolated loopback providers, real UI
controls and provider-state assertions; they never connect to a real PBX.

## Phonebook sync workflow

Upload a JSON/CSV contact source and map source fields to the contact name and phone number.
First and last names are combined into the documented `displayName`; the write payload contains
only `displayName` and `displayNumber`. Numbers must include an explicit `+` or `00` country
prefix. No country code or extension expansion is inferred. Use the check action to compare the source and NFON inventory without
writing. If differences exist, the apply action sends the server-recomputed create/update
actions to the Portal API only when live writes are enabled. When live writes are disabled
globally, the apply button stays blocked.

## Batch extension creation

The Extensions workspace includes a Batch Import section for creating multiple extensions.
Required fields are `number`, `name`, and `mailboxPin`; all other fields are optional and
can be activated per customer in the field picker.

Supported Portal API create fields include: `accessCentralPhoneBook`, `phoneBookHide`,
`language`, `costCenter`, `callWaitingIndication`, `intercomEnabled`, `clirEnabled`,
`recordingMode`, `ctiInfo`, `clickToDialState`, `autodialTimeout`, `numberguessingLength`,
`ncontrolEnabled`, `ccbs`, `replicateAgent`, `timeoutAfterSipTransfer`,
`abandonOtherSoftphones`, `mediaGatewayEmergencyDialplanPriority`, `dialPrefix`,
`nMeeting`, `useTps`, `nhospitalityRoom`, `authorizeExternalByPin`, `isCoach`,
`isCoachee`, and `deskphoneCallTranscriptionNotificationEnabled`.

Voicemail fields use the separate voice-mail endpoint: `voicemailEmail`, `announceCID`,
`announceDateTime`, `sendEmail`, and `deleteAfterSending`; the mailbox PIN is always sent
as the voicemail password. The batch check validates duplicates and existing extension
numbers first. The batch apply action only appears after a clean plan and writes each
extension plus its voicemail PIN through the Portal API.

## Day/night time-control workflow

The primary Setup action is **Set up and activate night mode**. It refreshes inventory,
enables the permitted session if needed, saves a missing day profile, optionally creates
the selected announcement target, prepares time controls, verifies their readiness and
activates night routing. The operation retains the starting account/write context and
target identity; an intermediate error or changed selection stops later steps. Matching
time controls are reused. The header day/night control uses one application confirmation.

**Activate day mode** restores the original destinations stored for the active migration,
including DIDs that originally had no target. Individual steps remain available under
**Details and maintenance**:

1. **Plan check (read-only):** evaluates every DID, its current day target, the selected
   night target, and whether a matching time-control service already exists. DIDs without a
   current day target are valid: they are planned as no target, can be routed to the night
   target, and restore back to the documented `NO_ACTION` destination. The desired night target is selected inside the time-control card before
   planning; changing it invalidates the visible plan until it is checked again.

2. **Create/update time-controls:** creates missing time-control services named
   `TN <number>` or updates existing app-owned `TN` time controls to the selected night target; DID
   routing is not changed in this step.

Additional actions:
- **Delete-old-time-controls:** removes obsolete managed time controls only when their
  exact name and href are recorded in the account-specific ownership registry and neither a DID
  nor a known nested routing target references them. A name prefix alone never proves ownership.
- **Night-mode reset:** full reset path for starting from zero — if DIDs already point to
  managed `TN ...` time controls, it first uses the stored restore plan to put them back on
  their original target or back to no target, then deletes all managed `TN ...` time controls.
- **Route-numbers-to-time-controls:** routing step, only available when all time
  controls are present and match the selected night target. Each DID uses the documented atomic
  `PUT /api/customers/{customer}/dids/{id}/destination`, with a `destination` link. Rollback uses
  the same endpoint with the previous target. No DELETE/POST routing gap or guessed trunk ID is used.

The server stores planned DID restore data and recorded ownership in
`data/daynight-<sha256-of-account>.json`. The embedded account is validated on read.
Successful creations are recorded even if a later creation fails. Legacy snapshots without
account/ownership evidence are not used to delete resources. Retained legacy resources can still
be inspected and managed through their normal explicit resource actions.

## Night target as voice dialog

Night targets can also be prepared as a voice dialog: choose an existing Portal
announcement, choose the target after playback (e.g., hang up or a front desk target),
and create a voice-dialog service. The NFON Portal API supports MP3/WAV announcement
upload through multipart `audiofile` requests on
`/api/customers/<customer>/announcements`; the UI currently exposes this as a disabled
placeholder until multipart signing is validated with a real audio test.

## Safety

The browser API intentionally returns compact inventory and endpoint status only. Raw
Portal API responses are not exposed to the frontend. Readiness is based on completed
core reads; optional API failures remain visible separately. A partial or unavailable
collection is not treated as an authoritative empty list, and dependent writes remain
blocked. Live failures never fall back to synthetic data.

## Audit safety contracts (2026-10-17)

- Collection reads exhaust `_offset`/`_pagesize` pages and validate totals/repeated pages. A partial or failed collection blocks dependent writes. Detailed IVR/time-control read failures also mark that inventory incomplete.
- Membership drafts include `account` and a `baseRevision` per group. Apply sends explicit `add`, `remove`, and `update` lists. Fresh memberships are loaded and every group validated before any write. A stale revision or member-load failure returns 409, with zero mutations.
- The local server serializes mutations. A concurrent request receives 409; the client also gates repeated Apply clicks. An account generation invalidates delayed reads after switching accounts. Every write endpoint and customer link must belong to the active account.
- Upstream calls time out after 15 seconds. HTTP 429 establishes a bounded Retry-After cooldown (1–300 seconds, 30-second default); writes are never retried automatically. Unsupported discovery routes are cached for five minutes and cleared on account change. Detailed resource reads remain necessary to validate references and display the graph.
- Time syntax is explicit, for example `Mon-Fri 08:00-17:00`; invalid days, trailing text and times outside 00:00–23:59 return 400. New time controls use `INHERIT`, while an existing timezone is retained. Provider-specific AUTO/overnight evaluation remains a provider contract, not a simulated live guarantee.
- Browser login validates credentials against the server-configured origin before replacing the active credentials. Changing the endpoint is a server configuration action. Loopback/Host checks and response headers are provided by `src/server-safety.cjs`.
- `src/messages.cjs` adds complete message keys and untouched parameters to server responses; the canonical `i18n-messages.json` is required in standalone distributions. Inventory data and names bypass this adapter. Legacy text fields remain for compatibility.
- `GET /api/version` returns a bounded app/upstream version summary; `GET /api/status` includes `appId: portal`. No raw upstream error body is reflected to the browser.

The hermetic audit regressions are in `test/audit-regressions.test.js`, `test/runtime.test.js` and
`test/localization.test.js`. Tests use isolated mock endpoints and temporary data folders; they
do not enable or exercise writes against an NFON account. The official API contract is maintained
in [NFON Service Portal API](https://github.com/NFON-AG/Service-Portal-API).


## Retest contracts (2026-10-17)

- A version-2 day/night snapshot records original DID destinations **before** routing starts. While that snapshot is active, repeated activation is idempotent only for the identical target and unchanged DID set; creating/updating gateways, selecting a different night target or adding numbers to that migration is rejected with 409. Restore the original day routing before preparing a new migration. Adding a DID externally does not make the header claim day mode or add that DID to the old restore plan.
- Snapshot writes are atomic and account-scoped. Restore uses the saved original destination, not a destination inferred from a time control that was subsequently forced to night. Failed routing rolls back both DID destinations and the time-control bodies already changed; failures of rollback remain visible.
- Only provider-returned resource hrefs establish ownership. Successful deletions and authoritative inventory refreshes prune the ownership registry. Reference comparisons use normalized exact hrefs, including queue/skill rejection and timeout destinations and group timeout destinations. Missing reference collections or failed detail reads block deletion before writes.
- A bulk-routing request identifies DIDs and desired targets; previous destinations are re-read from the provider. Client-supplied before-values cannot influence rollback. IVR creation validates every requested target before POST and removes the actual newly created IVR if a dependent key/timeout write fails.
- Missing collection totals do not imply one page. Reads continue to an empty page; 100 pages, 50,000 items and a 60-second collection budget bound an invalid provider. Every individual request also retains its 15-second timeout. A bounded/incomplete result is unavailable, never an authoritative zero.
- Membership partial failures report completed, failed and unattempted operations. A stale saved draft remains available for explicit review; confirmed review reapplies only its add/remove/update intent to the latest revision, preserving unrelated external additions. Missing services stay unresolved. Nothing silently discards a stale draft.
- Time-window day tokens are English three-letter or full names (for example Mon-Fri); localized abbreviations such as Di, Do and So are rejected. Telephone suffixes such as ext 12 are rejected rather than appended to an international phone number. Separate first/last-name fields avoid duplicating a full name.
- Boolean environment values accept true/false, 1/0, yes/no and on/off (case insensitive). An absent value uses its documented default. Empty or unsupported values abort startup rather than weaken a write lock. The env loader accepts an optional export prefix and strips unquoted comments, including true#comment; quoted hashes remain part of the value and fail boolean validation.
- JSON write payloads must be objects. Null, arrays and primitives return 400 before any provider operation. Static file reads enforce realpath containment, including symlinks and SPA fallback.
- Dynamic server messages supply explicit catalog keys and untouched parameters. Arbitrary unknown messages are not guessed by regex or mislabeled as connection failures. The twelve-language catalog remains part of the standalone app. API names and edited values are protected from DOM translation.
- The static site and local application share the same client. The static runtime implements local callflow apply, supported service-group creation and membership edits; other mutation routes remain explicitly unavailable. A successful local apply updates authoritative demo routing before the overview reload. Its applied-flow snapshot is reused only when the current DID still matches.

### Deliberate limits and remaining provider questions

The server serializes mutating requests, including the live-write switch. Switching off writes during an already active batch returns 409: it is not an emergency-stop or cancellation guarantee. Cancelling an HTTP request cannot undo a provider mutation already accepted. Successful operations and rollback attempts must be assessed from the returned result.

New time controls use `INHERIT`; creation with POST and readback with GET were verified
on the test account on 16 November 2026. Existing timezone values are retained. This
does not establish general AUTO, DST, overnight/week-wrapping evaluation, provider
deletion constraints, quotas or maximum page sizes. Those remain provider-contract
questions; synthetic tests do not establish live behavior for them.

The retest tests use a stateful synthetic HMAC mock, temporary configuration/data/HOME and a connection guard restricted to its loopback port. They do not load a real tenant configuration or enable real NFON/Google writes. Run `node --test --test-concurrency=1 Portal_API/test/*.test.js` from the repository root after the root maintainer regenerates shared/static assets.


## Callflow regression checks

`npm test` includes the routing, editor-state and canvas-placement regression tests.
`npm run test:callflow:browser` in `Portal_API` runs the real-browser callflow suite:
character-by-character typing, focus/caret, Undo, provider readback after Apply and
reload, responsive layout, and the actual PDF export handler in both themes.

The browser suite needs an installed Playwright module, Chromium/Chrome and Poppler
(`pdfinfo`, `pdftotext`, `pdftohtml`, `pdftoppm`, `pdftocairo`). These are test tools only. Set
`PLAYWRIGHT_MODULE_PATH` if Playwright is outside normal module resolution and
`BROWSER_EXECUTABLE_PATH` for a system browser. `POPPLER_BIN` optionally points to
the Poppler executable directory. Evidence destinations can be selected with
`CALLFLOW_ROUTING_EVIDENCE_DIR`, `EDITOR_OUTPUT` and `CANVAS_OUTPUT`.
Missing browser prerequisites fail this explicit suite rather than count as coverage.

All write assertions use a disposable synthetic provider, temporary configuration
and a loopback-only browser connection. The normal local server and its session
write permission are not used. PDF text and font checks supplement rendered page
inspection. Tests capture the downloaded PDF bytes from the actual button; they do not use browser print-to-PDF. Export never opens the print dialog.

The browser creates the PDF locally using the pinned library and embedded Pangram
font in `public/pdf/`. No provider request, CDN or conversion server is involved.
The same assets are copied to `docs/portal/pdf/` for offline downloads. The graph
remains a vector overview with selectable text; long flows receive paginated
routing and member details. Unsupported characters are reported explicitly rather
than omitted. The bundled font covers the twelve interface languages, but not
arbitrary scripts or emoji. The source-font license remains separate; provenance
and the reproducible development-only conversion are in `public/pdf/THIRD_PARTY.md`.

`captureFlowPdfModel` captures a cloned flow with all Queue, Skill and Group targets
expanded through the existing designer renderer. A synchronous `finally` restores the
original flow reference, expanded-service selection, canvas markup, scroll position and
initial-DID marker. Export does not save the temporary layout or call the provider.
The model includes the actual card/text/border colors, dotted background and connection
markers. The same target-placement and connection functions serve the UI and PDF.

Default targets use stable order and equal row spacing. Larger groups use symmetric
banks on either side of the service where space permits; a single ordered column is
used otherwise. Existing manual positions are retained. Connections select side ports
for a single bank and radial geometry for opposite banks. The toolbar occupies a row
above the canvas; only an actual overlapping toolbar contributes a drag exclusion area.

The targeted checks are `test/pdf-*.test.js`, `test/callflow-target-layout.test.js` and
`test/callflow-canvas-regressions.test.js`. They cover collapsed/expanded targets, state
restoration after capture failure, names without known extension numbers, both layout
forms, occupied card space and connections crossing other cards. These automated checks
complement inspection of the PDF downloaded from the real UI.

## Prepared mutation context regressions

A checked extension batch keeps its account/session write context and an immutable
copy of the checked rows. Login clears account-scoped batch and phonebook drafts.
Edits and newer checks invalidate pending batch responses and confirmations.
Responses from an earlier account/session cannot replace a current prepared plan.
Profile, phonebook, gateway-preview and confirmation-based resource operations
retain the same original-context invariant; server context validation remains the
final guard for another tab, a process restart or a session change during transport.

`npm test` includes the complete-client/HTTP preparation regressions in
`test/prepared-mutation-context.test.js`. They exercise account changes, same-account
relogin, A-to-B-to-A transitions, held HTTP responses, pending confirmation, editing,
provider readback and current-session success/error controls. The tests execute the
complete client against the disposable synthetic provider; only browser platform
adapters and controlled response delivery are supplied by the harness.

`npm run test:prepared:browser` runs the visible Extensions → Batch import → Setup
login flow in isolated Chrome, including delayed checks and edit/recheck controls.
Use `PLAYWRIGHT_MODULE_PATH`, `BROWSER_EXECUTABLE_PATH` and optionally
`PORTAL_PREPARED_OUTPUT` as with the other browser suites. Synthetic credentials
are explicitly matched between the ephemeral app and provider. Neither suite
accesses an existing application server or a real provider account.
