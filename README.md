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

### Audio

Every word and line the app reads aloud is recorded ahead of time with Azure's neural voices (Mexican Spanish, French and Japanese native speakers), in [`apps/web/audio/`](apps/web/audio/). The app plays these, and uses the phone's built-in voice only for text that hasn't been recorded.

After changing lesson content, re-record:

1. Put the Speech key in a `.env` file at the repo root (git ignores it), never in code or chat:
   ```
   AZURE_SPEECH_KEY=...
   AZURE_SPEECH_REGION=eastus
   ```
2. Run `npm run audio`. It records only new or changed text and deletes recordings nothing uses.
3. Commit `apps/web/audio/` with the content change. CI fails if a language has recordings but is missing one.

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
project's public signing keys, so the API stores no auth secret.

In production also set `CORS_ORIGINS` (the web app's origin, e.g. `https://jengawiz.github.io`) and
`TRUST_PROXY_HOPS=1` behind the host's load balancer. Rate limits are 300 requests a minute per client
and 60 for writes. Health checks are never limited. `GET /health` reports
liveness and `GET /ready` returns 503 while the database is unreachable.

Settings come from environment variables and are validated at startup in
[`apps/api/src/config.ts`](apps/api/src/config.ts); a bad value stops the server with a message naming it.

### Container

[`apps/api/Dockerfile`](apps/api/Dockerfile) builds a production image (from the repo root) that runs as
a non-root user and ships only the API's runtime dependencies. The same image applies migrations:

```
docker build -f apps/api/Dockerfile -t langroll-api .
docker run --env-file apps/api/.env langroll-api node dist/migrate-cli.js   # migrate first
docker run --env-file apps/api/.env -p 8787:8787 langroll-api                # then start
```

CI builds the image, migrates a real Postgres from it, starts it and checks `/health` and `/ready`.

### Staging (Fly.io)

The API runs at `https://langroll-api-staging.fly.dev` in Fly's `iad` region, next to the Supabase
database (AWS us-east-1). Config is in [`apps/api/fly.toml`](apps/api/fly.toml). Every merge to `main`
that touches the API deploys through [`deploy-api.yml`](.github/workflows/deploy-api.yml), and
migrations run first as Fly's release command.

One-time setup:

1. Install flyctl (`brew install flyctl`), then `fly auth login`.
2. `fly apps create langroll-api-staging`
3. Set the database secret yourself. Never paste it into chat or commit it:
   `fly secrets set -a langroll-api-staging DATABASE_URL='<Supabase → Connect → Session pooler URI>'`
   Use the **session** pooler (port 5432), not the transaction pooler (6543): migrations rely on a
   session-level advisory lock. TLS is set by `DATABASE_CA` in `fly.toml`, which verifies the
   certificate against Supabase's CA ([`apps/api/certs/`](apps/api/certs/)), so any `sslmode` in the URL is ignored.
4. `fly tokens create deploy -a langroll-api-staging`, and save the token as the GitHub secret `FLY_API_TOKEN`.
5. Set the GitHub repository variable `FLY_DEPLOY_ENABLED` to `true`.
