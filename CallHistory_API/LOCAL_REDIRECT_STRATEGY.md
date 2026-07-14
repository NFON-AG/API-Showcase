# Local Redirect Strategy

For the current local showcase, **Call History owns `localhost:3000`** because the Login with NFON OAuth client is registered for that origin. The CTI Google Contacts flow stays on its own registered redirect, currently `http://localhost:3002/auth/google/callback` in the local environment. Other showcase apps should use separate local ports unless and until a gateway/relay is explicitly configured.

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

If a future gateway owns port 3000 and the OAuth clients are re-registered for it, callbacks can stay stable:

```text
http://localhost:3000/auth/call-history/callback
```

## Practical options

1. Current standalone showcase

   Keep Call History on port 3000. Run Portal on 3001, CTI on 3002, and the optional landing cockpit on 3010. This is the safest local setup while OAuth redirects are fixed.

2. Gateway server on port 3000

   Only use this after redirect contracts are deliberately changed or relayed. The gateway proxies path prefixes to each app and owns all registered callback URLs. This keeps every showcase standalone for open source, while local development gets one stable OAuth origin.

3. Callback relay only

   Keep app UIs on their own ports, but let port 3000 receive `/auth/*/callback` and forward the code/state to the right local app. This is smaller than a full proxy, but it still has to preserve the Call History OAuth state.

4. Integrated workspace shell

   Build a local-only landing app on port 3000 that mounts the demos as modules. This gives the cleanest demo flow, but should not become a dependency of the public API showcase repos.

## Current recommendation

Use option 1 for the current local showcase. Keep each app standalone and configurable with `PORT`, `HOST`, and its own `*_REDIRECT_URI`. Revisit gateway/relay only after Call History and Google redirect registrations are intentionally updated.
