# Changelog

All notable changes to this workspace are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versioning follows
[Semantic Versioning](https://semver.org/).

## [1.2.0] - 2026-11-23

### Added
- Modern Design across all four apps and the static demo, with a shared
  Classic/Modern switch above the header, collapsible app sidebars and a
  sidebar-free Cockpit. Navigation preserves appearance, language, Demo mode
  and the Cockpit return link.
- Complete messages in all twelve offered languages, including templates,
  free-text examples, placeholders, validation, accessibility labels, exports
  and the CRM scenarios. First visits start in English; explicit language
  choices are remembered locally. API records and edited values remain literal.
- A fixed, automatic transcript-to-CRM showcase with technical-support tickets,
  appointment calendar entries and sales follow-up reminders. The CRM demo does
  not evaluate call-history data, including in the downloaded version.
- Direct color Callflow PDF downloads with routing details, the dotted canvas,
  connection arrows and all Queue, Group and Skill targets, even when collapsed
  in the editor. Export preserves the current draft, expansion state and viewport.
- Shared catalogue and browser-asset synchronization, static-copy consistency
  checks and content-versioned asset URLs.

### Changed
- Move Call History defaults and configuration examples to the stable
  `https://start.cloudya.com/api/callhistory` endpoint. Existing environment
  overrides must be updated and the local server restarted.
- Combine Portal night setup into one action: enable permitted session writes,
  save the day profile when needed, prepare or reuse time controls, verify
  preparation and activate night routing. Day mode restores the saved routing;
  individual maintenance actions remain available under Details and maintenance.
- Let explicit Portal Create, Apply and Delete actions enable permitted session
  writes without a separate Setup visit, including service memberships, batches,
  phonebook changes and day/night restoration. Existing confirmations and the
  server read-only override remain effective.
- Load current Callflow routing when opening a number and retain an older local
  draft separately. Apply membership changes with the normal Callflow action.
- Arrange expanded service targets with consistent spacing and symmetric banks
  where space permits. Keep manually placed targets and move the toolbar above
  the canvas so it no longer covers cards.
- Show successful Portal actions inline and keep long resource lists, mobile
  login, wrapped headers and Callflow controls usable in smaller viewports.
- Give the static Cockpit local pause/resume and link-preview controls. Resolve
  stale managed-service entries during normal startup rather than requiring a
  separate cleanup action.

### Fixed
- Report the CTI package version consistently in status, backup metadata and
  upstream requests; retain explicit `APP_VERSION` overrides.
- Restore the CTI header Demo switch on Overview, Analytics and Setup. Synthetic
  actions stay separate from live calls and persisted live history; navigation
  and browser back/forward preserve the selected source.
- Preserve CTI committed history across partial writes, overlapping restores,
  retries and restarts. Pending events remain visible separately; analytics,
  exports and backups agree on committed records.
- Back off CTI stream reconnects after persistent failures and update connection
  state when dial authentication fails. Keep contact labels and keyboard popovers
  within their intended controls.
- Capture the export language before asynchronous contact lookups and retain
  accurate local/Google/unknown contact provenance in CSV and XLS output.
- Keep CTI export, demo-backup and Portal profile files available while the
  browser starts their download; release each file independently afterward.
- Isolate Call History login, refresh, token persistence and logout from stale
  asynchronous work. Handle authorization status before reading an error body.
- Keep transcript selection, refresh and clipboard actions tied to the current
  call, filters, source and session. Missing content is not replaced by UI text;
  an obsolete response cannot overwrite a newer selection or sign-in state.
- Keep transcript-summary previews within the visible list and screen, including
  the last row and narrow viewports.
- Preserve accepted History records when later pages are malformed and mark
  incomplete results explicitly. Validate configuration values and distinguish
  demo transport failures from live authentication errors.
- Bind prepared Portal batches, profiles, phonebook changes and confirmations to
  the current account, session and reviewed input. Reject stale operations while
  retaining normal apply and retry behavior for current changes.
- Show imported routing profiles with their preview and Apply controls in Setup.
- Use the app dialog for service changes and retain newer membership edits or
  removals when an earlier submission finishes loading its result.
- Validate Portal inventory records, member enabled flags, resource identities
  and pagination before dependent writes. Preserve distinct resource namespaces
  and valid disabled memberships.
- Follow the connected Callflow entry and explicit branch targets when applying
  routes. Preserve nested IVR/Skill branches, time windows and localized system
  labels through edits, reloads and language changes; retain user-entered names.
- Keep the Callflow number selector above the toolbar and open resource palettes.
  Constrain its scrollable menu to the available space on narrow screens.
- Create Queue and Skill resources from existing target cards with the correct
  service identifiers, then apply member additions/removals and update the local
  resource cache without requiring a manual reload.
- Keep resource creation and rollback tied to verified provider identities.
  Validate targets before dependent writes and preserve externally changed routing
  during restore or cleanup. Invalid graphs fail with a meaningful response.
- Keep current static-demo routes after reload and invalidate obsolete plans
  after connection edits. Static credentials remain read-only; contact edits and
  backup exports match the supported demo/import formats.
- Base Portal and Cockpit readiness on completed API reads, distinguish partial
  availability from connection failure and identify unavailable optional areas.
- Preserve dialog focus and current form values across language/theme changes.
  Refresh generated default labels without translating real resource names.
- Persist Cockpit upstream changes atomically before activation and preserve
  ownership of managed services across Cockpit restarts. Independently started
  or foreign processes are not stopped by stale local entries.
- Apply shared local-server host/client checks, validate startup configuration
  and keep diagnostics concise. Require valid translation catalogues before any
  generated output changes; synchronize files atomically and detect stale assets.
- Extend secret scanning to the supported credential names and quoted/multiline
  shell values while accepting genuine variable references.

### Removed
- Replace the previous billing/manual CRM workflow with the fixed automation
  showcase; remove its customer/logo editing and manual draft-save/reset controls.
- Remove the separate Cockpit “Clear stale entry” control and endpoint.
- Replace the Callflow print-dialog export with a direct PDF file download.

## [1.0.2] - 2026-08-25

### Fixed
- Completed the English translation of the Portal API day/night workflow,
  including the dynamically rendered time-control preview, migration steps,
  status metrics, table labels, behavior notes, operation feedback, and error
  states.
- Kept the shared i18n runtime byte-identical across the local API apps and the
  static GitHub Pages demo, backed by regression coverage for dynamic Portal
  day/night strings.

## [1.0.0] - 2026-07-14

First public release of the NFON API Showcase.

### Included
- **Landing**: local cockpit with product cards, editable upstream links, health
  checks, and service start/stop controls for the sibling apps.
- **CTI API**: live telephony dashboard with extension states, active calls,
  Click-to-Dial, analytics, CSV/XLS export, and optional Google Contacts lookup.
- **Portal API**: Service Portal inventory, callflow builder, day/night
  time-control workflow, phonebook sync, batch extension creation, and dry-run
  plans with optional live writes.
- **Call History API**: Login with NFON (OAuth 2.0 PKCE), call history browsing
  with filters, transcript previews, metrics, and CRM ticket automation preview.
- **Static GitHub Pages demo** under `docs/` for browser-only exploration with
  demo data — no setup or credentials required.

### Features
- Shared browser i18n runtime with header language selector: English, German,
  French, Spanish, Italian, Dutch, Polish, Portuguese, Swedish, Danish, Finnish,
  and Czech.
- Zero npm dependencies — vanilla HTML/CSS/JS with Node.js built-in `http`.
- CSRF and same-origin guards on all state-changing endpoints.
- Demo mode fallback when no live credentials are configured.
