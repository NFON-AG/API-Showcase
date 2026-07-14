# Changelog

All notable changes to this workspace are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/), and versioning follows
[Semantic Versioning](https://semver.org/).

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
