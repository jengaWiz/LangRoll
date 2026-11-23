import { readFileSync } from "node:fs";
import vm from "node:vm";
import { expect, test } from "@playwright/test";

const WORKER_URL = "https://jengawiz.github.io/LangRoll/app/sw.js";

// A stand-in for the browser's Request: enough to see which URL and cache mode the worker asks for.
class FakeRequest {
  constructor(url, init = {}) {
    this.url = new URL(url, WORKER_URL).href;
    this.cache = init.cache || "default";
  }
}

// Load the real service worker into a sandbox and return the event listeners it registers.
function loadListeners(caches) {
  const listeners = {};
  const self = {
    location: new URL(WORKER_URL),
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: () => {} },
  };
  const fetch = () => Promise.resolve({ ok: false });
  vm.runInNewContext(readFileSync("apps/web/sw.js", "utf8"), { self, URL, Request: FakeRequest, caches, fetch });
  return listeners;
}

// The worker's fetch handler, reduced to "did it take this request over?"
function loadWorker() {
  const listeners = loadListeners({ match: () => Promise.resolve(undefined), open: () => Promise.resolve({ put() {}, addAll() {} }) });
  return (url, method = "GET") => {
    let handled = false;
    listeners.fetch({ request: { url, method }, respondWith: () => { handled = true; } });
    return handled;
  };
}

// The requests the worker stores when a new version installs.
async function installRequests() {
  const stored = [];
  const listeners = loadListeners({ open: () => Promise.resolve({ addAll: (requests) => { stored.push(...requests); } }) });
  let installing;
  listeners.install({ waitUntil: (p) => { installing = p; } });
  await installing;
  return stored;
}

test.describe("service worker", () => {
  test("caches the app's own files and its fonts", () => {
    const handles = loadWorker();
    expect(handles("https://jengawiz.github.io/LangRoll/app/app.js?v=8")).toBe(true);
    expect(handles("https://fonts.gstatic.com/s/inter/v1/a.woff2")).toBe(true);
  });

  test("never caches the API, auth or other sites", () => {
    const handles = loadWorker();
    expect(handles("https://langroll-api-staging.fly.dev/me/progress")).toBe(false);
    expect(handles("https://drlhfpjnynpajxnqmzjb.supabase.co/auth/v1/user")).toBe(false);
    expect(handles("https://example.com/x.js")).toBe(false);
    expect(handles("https://jengawiz.github.io/LangRoll/app/x", "POST")).toBe(false);
  });

  // GitHub Pages lets browsers keep files for 10 minutes. An update that read them from the
  // browser's cache could store yesterday's index.html as the new version.
  test("downloads a fresh copy of every app file when a new version installs", async () => {
    const stored = await installRequests();
    expect(stored.map((r) => r.url)).toContain("https://jengawiz.github.io/LangRoll/app/index.html");
    for (const r of stored) expect(r.cache, r.url).toBe("reload");
  });
});
