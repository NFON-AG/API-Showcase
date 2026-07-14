# Portal API — Developer Notes

Internal reference for developers working on or maintaining this app.
For the public-facing overview, see `README.md`. For agent/AI guidance, see `AGENTS.md`.

## Configuration details

The server loads `.env` automatically and reads credentials from environment variables first.

Full configuration reference:

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
consciously re-enabled in `Setup`. The header only displays the currently active account
and last check time.

## Live write protection

Live writes are disabled by default for RC/local showcase safety. Set
`PORTAL_ENABLE_LIVE_WRITES=true` only for a conscious local write session;
`PORTAL_DISABLE_LIVE_WRITES=true` remains a hard read-only override. Browser requests to
mutating routes require the local CSRF token and an allowed origin.

## Phonebook sync workflow

Upload a JSON/CSV contact source, map source fields to NFON first name, last name, and
phone number, then use the check action to compare the source and NFON inventory without
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

The `Setup` workspace includes a two-step day/night time-control workflow:

1. **Plan check (read-only):** evaluates every DID, its current day target, the selected
   night target, and whether a matching time-control service already exists. DIDs without a
   current day target are valid: they are planned as no target, can be routed to the night
   target, and restore back to no DID target by deleting the temporary time-control
   assignment. The desired night target is selected inside the time-control card before
   planning; changing it invalidates the visible plan until it is checked again.

2. **Create/update time-controls:** only creates missing time-control services named
   `TN <number>` or updates existing `TN` time controls to the selected night target; DID
   routing is not changed in this step.

Additional actions:
- **Delete-old-time-controls:** removes obsolete managed time controls only when their
  name follows the `TN <number>` convention and no current DID still needs them.
- **Night-mode reset:** full reset path for starting from zero — if DIDs already point to
  managed `TN ...` time controls, it first uses the stored restore plan to put them back on
  their original target or back to no target, then deletes all managed `TN ...` time controls.
- **Route-numbers-to-time-controls:** second live step, only available when all time
  controls are present and match the selected night target; deletes the old DID assignment
  and attaches the DID to the matching time control, with rollback attempts on failure.

After successful time-control creation/update the server stores
`data/daynight-gateway-migration.json` with the planned DID restore and migration data.

## Night target as voice dialog

Night targets can also be prepared as a voice dialog: choose an existing Portal
announcement, choose the target after playback (e.g., hang up or a front desk target),
and create a voice-dialog service. The NFON Portal API supports MP3/WAV announcement
upload through multipart `audiofile` requests on
`/api/customers/<customer>/announcements`; the UI currently exposes this as a disabled
placeholder until multipart signing is validated with a real audio test.

## Safety

The browser API intentionally returns compact inventory and endpoint status only. Raw
Portal API responses are not exposed to the frontend.
