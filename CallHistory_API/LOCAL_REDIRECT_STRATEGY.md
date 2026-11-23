# Local Redirect Strategy

The default local setup uses **Call History on `localhost:3000`** and CTI Google
Contacts on `http://localhost:3002/auth/google/callback`. Each OAuth client must
be registered with the exact redirect used by its app. The Cockpit navigates to
the standalone apps; it is not an OAuth callback relay.

## Recommended local model

```text
http://localhost:3000/                 -> CallHistory_API standalone
http://localhost:3001/                 -> Portal_API
http://localhost:3002/                 -> CTI_API, including the current Google redirect
http://localhost:3010/                 -> optional landing cockpit
```

If an OAuth client is registered only for the localhost origin, use the origin itself as the callback and let the app dispatch by `state`:

```text
http://localhost:3000
```

Call History also accepts this callback alias when it is explicitly configured
and registered with the provider:

```text
http://localhost:3000/auth/call-history/callback
```

## Configuration and return navigation

Keep the apps on separate ports. A different Call History port also requires
matching `CALLHISTORY_PUBLIC_BASE_URL`, `CALLHISTORY_REDIRECT_URI`, allowed-origin
configuration and provider registration. For CTI, `GOOGLE_REDIRECT_URI` must
match its registered callback exactly. `localhost` and `127.0.0.1` are distinct
OAuth redirect values even though both address the local machine.

Start Login with NFON from the local app so it can create the single-use PKCE
state. Opening a callback URL directly cannot sign in. The app keeps validated
language, appearance and Cockpit return preferences with that state and restores
them after the callback, including a return from `127.0.0.1` to `localhost`.
Those presentation preferences are not sent to the identity provider.
