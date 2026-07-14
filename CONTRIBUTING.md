# Contributing

This workspace is optimized for small, reviewable changes.

## Local Checks

```sh
npm test
```

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

Use `.env.example` when documenting configuration.

## Pull Requests

- Keep each change focused on one app or one cross-app concern.
- Include a short test note.
- Do not mix visual redesign with security or API behavior changes.
- Call out any OAuth redirect or port-contract change explicitly.
