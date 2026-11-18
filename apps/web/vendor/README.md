# Vendored libraries

Bundled with the app instead of loaded from a CDN, so the app works offline (the service worker
caches them) and a third-party server can't change the code it runs.

| File | Package | Source | License |
|---|---|---|---|
| `supabase-js-2.118.0.js` | `@supabase/supabase-js@2.118.0`, `dist/umd/supabase.js` | npm, integrity `sha512-FxI8UXMVC2UG7IkeiI8fuQZqq2oI3JeSuN8MPIC2RLVaoEAxKS0nqE6kii9Ewpq8f9gNPM6git1Y8f0vN/QLFw==` (verified) | MIT |

To upgrade: pick a release at least two weeks old, `npm pack` it, check the tarball's sha512 against
`npm view <pkg>@<version> dist.integrity`, copy `dist/umd/supabase.js` here under a new versioned
name, and update `index.html` and `sw.js`.
