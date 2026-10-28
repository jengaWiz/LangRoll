# LangRoll

A basic static website. Open `index.html` in a browser, or visit the GitHub Pages site.

## The app

`app/` is the LangRoll app itself, an installable PWA (no build step). Serve the repo over HTTP and open `/app/`:

```
python -m http.server 8474
# http://localhost:8474/app/
```

Speech recognition and the service worker need `https://` or `localhost`; they won't run from `file://`.
When you change files in `app/`, bump the `?v=` query strings in `app/index.html` and `VERSION` + `SHELL` in `app/sw.js` so installed copies update.
