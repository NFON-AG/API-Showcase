# Security Policy

These apps are local NFON API showcase demos. They are not a production gateway, identity provider, or hosted multi-tenant service.

`docs/` is a static browser-only demo-data showcase. It must not contain API tokens, real tenants, real call records, real contacts, or hosted proxy credentials.

## Secrets

Real credentials must stay outside the repository, or in local-only `.env`, `data/`, or `secrets/` paths that are never committed. This repository intentionally includes only `.env.example` files with empty or placeholder values.

Never commit:

- OAuth tokens.
- API keys or client secrets.
- Customer, contact, call, transcript, or tenant data from real environments.
- Local backup archives.
- Screenshots, PDFs, logs and audit outputs containing real test-account data.

Local verification folders are not automatically safe to publish. Review the
actual staged files; a passing secret scan does not identify every customer name,
telephone number or private screenshot.

Run before sharing:

```sh
npm run secret-scan
git status --short --ignored
```

## Local Runtime Files

The apps can write runtime state under an external local config folder through `*_DATA_DIR` variables. Token and state files should be outside the repository, ignored by Git, and owner-readable only on local machines.

## Reporting

Report security issues to [integration@nfon.com](mailto:integration@nfon.com). Do not include live credentials or real customer data in bug reports.

## Production Use

Before hosted or public operation, review deployment secrets, OAuth redirect registration, CORS origins, logging, rate limits, monitoring, and incident ownership.

GitHub Pages can host only the static demo-data showcase. The supplied live API
flows require the local Node.js apps. Hosting a live backend is a separate
deployment and security decision; the static demo does not become a live client
through CORS configuration alone.
