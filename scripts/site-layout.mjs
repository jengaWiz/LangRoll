// Where each part of the public site comes from. This map is the one place that decides
// the deployed URLs, so files can move around the repo without breaking links,
// the presenter QR code, or copies of the app people have installed.
//
// Each mount serves `src` at the URL prefix `url` (relative to the site root).
// `include` limits a mount to the listed entries in `src`; without it the whole
// directory is served. More specific prefixes must come first.

import { cpSync, existsSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";

export const MOUNTS = [
  { url: "app/", src: "app" },
  { url: "present/", src: "present" },
  { url: "", src: ".", include: ["index.html", "style.css", "script.js"] },
];

// Map a public URL path ("/app/app.js") to a repo file, or null if nothing is mounted there.
export function fileForUrl(urlPath, root = process.cwd()) {
  const path = decodeURIComponent(urlPath).replace(/^\/+/, "");
  for (const m of MOUNTS) {
    if (!(path === m.url.replace(/\/$/, "") || path.startsWith(m.url))) continue;
    const rest = path.slice(m.url.length);
    if (m.include && !m.include.includes(rest.split("/")[0] || "index.html")) return null;
    const base = normalize(join(root, m.src));
    const file = normalize(join(base, rest));
    if (file !== base && !file.startsWith(base + sep)) return null; // path traversal
    if (existsSync(file) && statSync(file).isDirectory()) return join(file, "index.html");
    return file;
  }
  return null;
}

// Map a repo file to the public URL path it is served at, or null if it isn't deployed.
export function urlForFile(file, root = process.cwd()) {
  const rel = relative(root, normalize(join(root, file))).split(sep).join("/");
  for (const m of MOUNTS) {
    const src = m.src === "." ? "" : m.src + "/";
    if (!rel.startsWith(src)) continue;
    const rest = rel.slice(src.length);
    if (m.include && !m.include.includes(rest.split("/")[0])) continue;
    return "/" + m.url + rest;
  }
  return null;
}

// Copy every mount into `out`, producing the exact tree that gets deployed.
export function buildSite(out, root = process.cwd()) {
  rmSync(out, { recursive: true, force: true });
  for (const m of [...MOUNTS].reverse()) {
    const dest = join(out, m.url);
    mkdirSync(dest, { recursive: true });
    const entries = m.include || ["."];
    for (const entry of entries) cpSync(join(root, m.src, entry), join(dest, entry === "." ? "" : entry), { recursive: true });
  }
}
