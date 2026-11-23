# Contributing

This workspace is optimized for small, reviewable changes.

## Local Checks

```sh
npm run sync:shared
npm test
```

Run synchronization after changing shared appearance, message catalogs or the
canonical browser apps. Generated copies under `docs/` must not be edited directly.
`npm test` checks syntax, generated-file consistency, regression tests and secrets.

For app-specific checks:

```sh
npm --prefix CTI_API test
npm --prefix Portal_API test
npm --prefix CallHistory_API test
npm --prefix landing test
```

## Local Data

Keep local credentials and runtime data out of changes:

- `.env`
- `data/`
- `secrets/`
- Local service-ownership files, logs and backup exports.
- Screenshots, PDFs and raw provider responses from real test accounts.

Use `.env.example` when documenting configuration.

## Pull Requests

- Keep each change focused on one app or one cross-app concern.
- Include a short test note.
- Do not mix visual redesign with security or API behavior changes.
- Call out any OAuth redirect or port-contract change explicitly.
- Update the app README and the unreleased changelog for user-visible changes.
- Stage release files deliberately. Local `output/` and audit material may contain
  private test data and are not a public release bundle.
