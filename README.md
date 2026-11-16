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
