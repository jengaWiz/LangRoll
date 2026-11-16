// Minimal static file server for local preview and the Playwright smoke tests.
// With no directory it serves the source tree through the mounts in site-layout.mjs,
// so edits show up on reload. With a directory (e.g. dist) it serves that tree as is.
//
// Usage: node scripts/serve.mjs [port] [dir]
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileForUrl } from "./site-layout.mjs";

const PORT = Number(process.argv[2] || process.env.PORT || 4173);
const DIR = process.argv[3] ? resolve(process.argv[3]) : null;
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

function fromDir(urlPath) {
  const file = normalize(join(DIR, decodeURIComponent(urlPath)));
  if (file !== DIR && !file.startsWith(DIR + sep)) return null;
  return existsSync(file) && statSync(file).isDirectory() ? join(file, "index.html") : file;
}

createServer((req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");
  const file = DIR ? fromDir(pathname) : fileForUrl(pathname);
  if (!file || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    return;
  }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, "127.0.0.1", () => console.log(`Serving ${DIR || "site layout"} at http://127.0.0.1:${PORT}`));
