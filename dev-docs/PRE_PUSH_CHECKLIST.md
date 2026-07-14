# Pre-Push Checklist

Use this checklist before pushing to the public NFON GitHub repository.

## Must Stay Local (never push)

- `.env` files.
- Runtime `data/` files, including OAuth tokens, local contacts, call events, and migration plans.
- `secrets/` folders.
- External local config folders (e.g. `~/.config/nfon-api-showcase`).
- Archived local material outside the repository.
- Any real customer, contact, call, tenant, or credential material.

## Recommended Push Workflow

1. Keep this local working copy as the source of truth.
2. Run `npm test`.
3. Run `git status --short --ignored` and confirm private files are ignored, not staged.
4. Review the staging scope before running `git add .`.
5. Prefer pushing a sanitized working tree into a fresh repo instead of preserving old local Git history.
6. If old history must be preserved, run a full history secret scan before giving access to a wider audience.
7. Let NFON owners decide license, trademark wording, repository visibility, and production support posture before public release.

## Staging Scope

For the three-API launch prep plus the local cockpit, stage paths explicitly:

```sh
git add \
  .gitignore package.json scripts/secret-scan.mjs \
  README.md CONTRIBUTING.md SECURITY.md CHANGELOG.md LICENSE dev-docs docs .github \
  CTI_API Portal_API CallHistory_API landing
```

## Local Commands

```sh
npm test
npm run secret-scan
git status --short --ignored
git ls-files | rg '(^|/)(\\.env|data/|secrets/|Archiv/|Secrets/|Backup|Backups|.*token.*|client_secret_)'
```

The final `git ls-files` command should either return nothing or only intentionally public example files such as `.env.example`.

## Repo Expectations

- Root `README.md` is partner-facing: purpose, get started, how it works, API links, disclaimer, license.
- `docs/` is the GitHub Pages web demo — no live credentials, no server-side code.
- `dev-docs/LOCAL_SHOWCASE.md` explains how to keep the local showcase running.
- `dev-docs/WEB_ONLY_DEMO.md` explains the static GitHub Pages demo and its no-live-data boundary.
- `dev-docs/WORKSPACE.md` explains the workspace structure and port contracts.
- `SECURITY.md` documents local-only credential handling and vulnerability reporting.
- App-level `README.md` files explain standalone startup and configuration.
- CI should run `npm test` on Node.js 20 or newer.
