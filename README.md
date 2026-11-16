# LangRoll

A static website and app, deployed to GitHub Pages at https://jengawiz.github.io/LangRoll/.

## How the site is assembled

[`scripts/site-layout.mjs`](scripts/site-layout.mjs) maps each public URL to the folder it comes from
(`/` is the landing page, `/app/` the app, `/present/` the presenter slide). Files can move around the
repo without changing any URL, as long as this map is updated.

```
npm run build   # assemble the deployable site into dist/
npm run serve   # preview from source at http://127.0.0.1:4173/ (edits show on reload)
npm run check   # lint, asset checks, QR check and smoke tests (against dist/)
```

Every push to `main` builds `dist/` and publishes it to Pages ([`deploy.yml`](.github/workflows/deploy.yml)).

## The app

[`apps/web/`](apps/web/) is the LangRoll app itself, an installable PWA (no build step). Run `npm run serve` and open http://127.0.0.1:4173/app/.

Speech recognition and the service worker need `https://` or `localhost`; they won't run from `file://`.
When you change files in `apps/web/`, bump the `?v=` query strings in `apps/web/index.html` and `VERSION` + `SHELL` in `apps/web/sw.js` so installed copies update.

## The API

[`apps/api/`](apps/api/) is the backend: a TypeScript [Fastify](https://fastify.dev) service that will own
accounts, progress sync and review scheduling. It needs Node 22.12+.

```
npm install        # once, from the repo root (npm workspaces)
npm run dev:api    # http://127.0.0.1:8787/health, restarts on save
npm run test:api   # unit tests (vitest)
npm run typecheck

# integration tests need a Postgres (17, like Supabase) and fail if none is set
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres npm run test:integration -w @langroll/api
```

Schema changes are SQL files in [`apps/api/migrations/`](apps/api/migrations/); apply them with
`npm run db:migrate -w @langroll/api` before starting a new version.

The API needs `DATABASE_URL` (a `postgres://` connection string) and `SUPABASE_URL` to start.
Signed-in routes take a Supabase access token (`Authorization: Bearer …`), checked against the
project's public signing keys, so the API stores no auth secret. `GET /health` reports
liveness and `GET /ready` returns 503 while the database is unreachable.

Settings come from environment variables and are validated at startup in
[`apps/api/src/config.ts`](apps/api/src/config.ts); a bad value stops the server with a message naming it.
