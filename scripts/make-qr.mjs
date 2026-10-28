// Generates the QR code on the presenter page (present/qr.svg) that opens the live app.
// The SVG is committed so the page works without a network or a QR library at runtime.
//
// Usage: node scripts/make-qr.mjs           regenerate present/qr.svg
//        node scripts/make-qr.mjs --check   fail if the SVG or the page's printed URL is stale

import { readFileSync, writeFileSync } from "node:fs";
import QRCode from "qrcode";

export const APP_URL = "https://jengawiz.github.io/LangRoll/app/";
const SVG_PATH = "present/qr.svg";
const PAGE_PATH = "present/index.html";

const svg = await QRCode.toString(APP_URL, {
  type: "svg",
  errorCorrectionLevel: "M", // survives glare and a bit of projector blur without getting too dense
  margin: 4,
  color: { dark: "#0d0b0cff", light: "#ffffffff" },
});

if (process.argv.includes("--check")) {
  const errors = [];
  if (readFileSync(SVG_PATH, "utf8") !== svg) errors.push(`${SVG_PATH} is stale. Run: npm run qr`);
  const shown = APP_URL.replace(/^https:\/\//, "").replace(/\/$/, "");
  if (!readFileSync(PAGE_PATH, "utf8").includes(shown)) errors.push(`${PAGE_PATH} should print the app URL "${shown}"`);
  if (errors.length) {
    console.error("✖ " + errors.join("\n✖ "));
    process.exit(1);
  }
  console.log(`✔ QR code points at ${APP_URL}`);
} else {
  writeFileSync(SVG_PATH, svg);
  console.log(`wrote ${SVG_PATH} → ${APP_URL}`);
}
