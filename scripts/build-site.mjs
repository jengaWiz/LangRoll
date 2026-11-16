// Assembles the deployable site into dist/ from the mounts in site-layout.mjs.
// Usage: node scripts/build-site.mjs [out-dir]

import { existsSync } from "node:fs";
import { join } from "node:path";
import { buildSite } from "./site-layout.mjs";

const out = process.argv[2] || "dist";
buildSite(out);

// The pages people reach by URL or QR code must exist in the output.
const required = ["index.html", "app/index.html", "app/sw.js", "app/manifest.webmanifest", "present/index.html"];
const missing = required.filter((f) => !existsSync(join(out, f)));
if (missing.length) {
  console.error(`✖ ${out}/ is missing: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`✔ built site into ${out}/`);
