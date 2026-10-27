// Checks that static assets are wired up correctly. GitHub Pages lets browsers cache
// files for ~10 minutes, so a changed CSS/JS file must get a new ?v= or visitors keep
// the stale copy.
//
//   1. Every local href/src in every HTML file points at a file that exists.
//   2. With a base ref (BASE_REF env or first arg), every changed CSS/JS file that an
//      HTML page loads with ?v= has a different ?v= than on the base.
//   3. A service worker's precached ?v= URLs match what its index.html loads, and its
//      VERSION changes whenever a file it precaches changes.
//
// Usage: node scripts/check-assets.mjs [base-ref]

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, normalize, relative } from "node:path";

const ROOT = process.cwd();
const SKIP = new Set(["node_modules", ".git", "test-results", "playwright-report"]);
const base = process.argv[2] || process.env.BASE_REF || "";
const errors = [];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(ROOT, full));
  }
  return out;
}

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

function showAtBase(path) {
  try { return git("show", `${base}:${path}`); } catch { return null; }
}

const isLocal = (url) => !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(url);

// Local asset references in an HTML string: [{ file, version }]
function localRefs(htmlPath, html) {
  const refs = [];
  for (const [, url] of html.matchAll(/\s(?:href|src)="([^"]+)"/g)) {
    if (!isLocal(url)) continue;
    const [pathPart] = url.split("#");
    const [path, query = ""] = pathPart.split("?");
    let file = normalize(join(dirname(htmlPath), path));
    if (path === "" || path.endsWith("/")) file = join(file, "index.html");
    refs.push({ url, file, version: new URLSearchParams(query).get("v") });
  }
  return refs;
}

const files = walk(ROOT);
const htmlFiles = files.filter((f) => f.endsWith(".html"));

// 1. every local reference resolves to a file
for (const page of htmlFiles) {
  for (const ref of localRefs(page, readFileSync(page, "utf8"))) {
    if (!existsSync(ref.file)) errors.push(`${page}: "${ref.url}" points at missing file ${ref.file}`);
  }
}

// 2. changed versioned assets got a new ?v=
let changed = [];
if (base) {
  changed = git("diff", "--name-only", `${base}...HEAD`).split("\n").filter(Boolean);
  for (const page of htmlFiles) {
    const before = showAtBase(page);
    if (before === null) continue; // new page, nothing to compare against
    const oldVersions = new Map(localRefs(page, before).map((r) => [r.file, r.version]));
    for (const ref of localRefs(page, readFileSync(page, "utf8"))) {
      if (!ref.version || !changed.includes(ref.file)) continue;
      if (oldVersions.get(ref.file) === ref.version) {
        errors.push(`${page}: ${ref.file} changed but is still loaded as ?v=${ref.version}. Bump it so browsers refetch.`);
      }
    }
  }
}

// 3. service workers agree with their page and bump their cache name
for (const sw of files.filter((f) => f.endsWith("sw.js"))) {
  const page = join(dirname(sw), "index.html");
  if (!existsSync(page)) continue;
  const src = readFileSync(sw, "utf8");
  const shellBlock = src.match(/SHELL\s*=\s*\[([\s\S]*?)\]/);
  if (!shellBlock) continue;
  const shell = [...shellBlock[1].matchAll(/["']([^"']+)["']/g)].map((m) => m[1]);

  const pageVersions = new Map(localRefs(page, readFileSync(page, "utf8")).map((r) => [r.file, r.version]));
  const precached = [];
  for (const entry of shell) {
    const [path, query = ""] = entry.split("?");
    const file = normalize(join(dirname(sw), path === "./" ? "index.html" : path));
    precached.push(file);
    if (!existsSync(file)) errors.push(`${sw}: precaches "${entry}" but ${file} does not exist`);
    const v = new URLSearchParams(query).get("v");
    if (v && pageVersions.has(file) && pageVersions.get(file) !== v) {
      errors.push(`${sw}: precaches ${entry} but ${page} loads ?v=${pageVersions.get(file)}`);
    }
  }

  if (base) {
    const before = showAtBase(sw);
    const versionOf = (s) => (s.match(/VERSION\s*=\s*["']([^"']+)["']/) || [])[1];
    const touched = precached.filter((f) => changed.includes(f));
    if (before !== null && touched.length && versionOf(before) === versionOf(src)) {
      errors.push(`${sw}: ${touched.join(", ")} changed but VERSION is still "${versionOf(src)}". Bump it so installed apps update.`);
    }
  }
}

if (errors.length) {
  console.error(`✖ ${errors.length} asset problem(s):\n` + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(`✔ assets OK (${htmlFiles.length} HTML files${base ? `, compared against ${base}` : ""})`);
